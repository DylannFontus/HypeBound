/**
 * Verifying a Supabase access token, using nothing the server has to keep secret.
 *
 * Supabase signs access tokens with an asymmetric key (ES256 or RS256) and
 * publishes the public half at `/auth/v1/.well-known/jwks.json`. Verifying one
 * therefore needs a *public* key and no account credentials at all: this server
 * holds no Supabase secret, because there is nothing it would be used for. That
 * is worth more than the convenience — a secret that does not exist cannot be
 * leaked by a misconfigured var, a log line, or a stack trace in an error
 * response.
 *
 * **The one project setting this depends on.** A project still using the legacy
 * shared-secret (HS256) signing keys cannot be verified this way, because HS256
 * verification requires the *signing* secret — the same value that mints tokens.
 * Putting that in a Worker would mean the match server could forge any player's
 * identity. So an HS256 token is **refused**, loudly, with a message naming the
 * setting to change, rather than accepted on weaker terms.
 *
 * §10.1 describes OAuth 2.1 / OIDC with a first-party provider. Supabase Auth is
 * that provider; the flow is unchanged, and the client still uses Authorization
 * Code + PKCE. This is only the resource-server half: given a bearer token,
 * decide who is holding it.
 */

/**
 * Who is holding this token — a user id and nothing else.
 *
 * The token also carries an `email` claim, and an earlier version of this file
 * read it into a field that **no caller ever used**. Removed rather than left
 * available, for three reasons that compound:
 *
 * - `[observability] enabled = true` in `wrangler.toml`, so anything that ends
 *   up in an error path can end up in a log. An address that is never extracted
 *   cannot be logged by accident.
 * - It lets the privacy page say "this game's own server never stores your
 *   email" flatly, instead of a hedge about what it does with one it holds. A
 *   sentence that needs a caveat usually means the code should change instead.
 * - Nothing needed it. Collecting a piece of personal data on the grounds that
 *   it arrived anyway is how a system ends up holding things it cannot justify.
 *
 * If a feature ever genuinely needs the address it is one line to restore —
 * and at that point it deserves the argument.
 */
export interface Identity {
  readonly userId: string;
  readonly expiresAtMs: number;
}

export type VerifyResult =
  | { ok: true; identity: Identity }
  | { ok: false; reason: string };

interface Jwk {
  kid?: string;
  kty: string;
  alg?: string;
  crv?: string;
  [key: string]: unknown;
}

/**
 * Algorithms this server accepts, and how WebCrypto names them.
 *
 * The parameter types are written out structurally rather than using
 * `EcKeyImportParams` and friends, because those are DOM names and this file has
 * to compile under two configurations: `server/tsconfig.json`, which has no DOM
 * in `lib` and calls them `SubtleCryptoImportKeyAlgorithm`, and the root one,
 * which does have DOM and does not. A shape both accept is the only thing that
 * satisfies both, and it costs nothing — WebCrypto reads these as plain objects.
 */
interface AlgorithmSpec {
  readonly importParams: { name: string; namedCurve?: string; hash?: string };
  readonly verifyParams: { name: string; hash?: string };
}

const ALGORITHMS: Record<string, AlgorithmSpec> = {
  ES256: {
    importParams: { name: "ECDSA", namedCurve: "P-256" },
    verifyParams: { name: "ECDSA", hash: "SHA-256" },
  },
  RS256: {
    importParams: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    verifyParams: { name: "RSASSA-PKCS1-v1_5" },
  },
};

/**
 * JWKS cache.
 *
 * Module scope, so it survives across requests on one isolate and is discarded
 * with it. Keys rotate rarely and a cache miss is one fetch, so the TTL is
 * generous; a token signed by a key that is not in the cache forces a single
 * refresh, which is what makes rotation work without a deploy.
 */
const JWKS_TTL_MS = 10 * 60 * 1000;
let jwksCache: { url: string; fetchedAtMs: number; keys: Jwk[] } | null = null;

async function fetchJwks(supabaseUrl: string, nowMs: number, force: boolean): Promise<Jwk[]> {
  const url = `${supabaseUrl.replace(/\/+$/, "")}/auth/v1/.well-known/jwks.json`;
  if (!force && jwksCache && jwksCache.url === url && nowMs - jwksCache.fetchedAtMs < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`JWKS fetch failed: ${response.status}`);
  const body = (await response.json()) as { keys?: Jwk[] };
  const keys = body.keys ?? [];
  jwksCache = { url, fetchedAtMs: nowMs, keys };
  return keys;
}

/** Test hook: drop the cached JWKS so a fixture can serve a different key set. */
export function resetJwksCache(): void {
  jwksCache = null;
}

/**
 * The `<ArrayBuffer>` on the return type is not decoration.
 *
 * A bare `Uint8Array` is `Uint8Array<ArrayBufferLike>`, which includes
 * `SharedArrayBuffer` and is therefore *not* assignable to WebCrypto's
 * `BufferSource`. Workers' own type definitions are laxer and accept it, so this
 * file compiled under `server/tsconfig.json` and failed under the root one — a
 * reminder that "it compiles" is a claim about one configuration.
 */
function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** As above: `TextEncoder.encode` is typed `ArrayBufferLike`, so the copy normalizes it. */
function utf8(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new TextEncoder().encode(value));
}

function decodeJson(segment: string): Record<string, unknown> | null {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment))) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Verify a bearer token and return who sent it.
 *
 * Never throws for a bad token — an invalid token is the expected input at a
 * trust boundary, not an exception. It does throw if the JWKS endpoint is
 * unreachable, because that is an outage rather than a rejection and must not
 * be reported to every player as "your login is invalid".
 */
export async function verifySupabaseToken(token: string, supabaseUrl: string, nowMs: number): Promise<VerifyResult> {
  if (!supabaseUrl) {
    return { ok: false, reason: "no identity provider is configured (SUPABASE_URL is empty)" };
  }

  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "not a JWT" };
  const [rawHeader, rawPayload, rawSignature] = parts as [string, string, string];

  const header = decodeJson(rawHeader);
  if (!header) return { ok: false, reason: "unreadable JWT header" };

  const alg = typeof header.alg === "string" ? header.alg : "";
  const spec = ALGORITHMS[alg];
  if (!spec) {
    // Named explicitly, because "invalid token" would send someone hunting
    // through their client for a bug that is in their project settings.
    if (alg === "HS256") {
      return {
        ok: false,
        reason:
          "this project still signs tokens with the legacy shared secret (HS256). " +
          "Verifying those would require giving the match server the key that mints them. " +
          "Switch the project to asymmetric JWT signing keys in Supabase → Auth → JWT Keys.",
      };
    }
    return { ok: false, reason: `unsupported signing algorithm ${alg || "(absent)"}` };
  }

  const kid = typeof header.kid === "string" ? header.kid : null;
  const signature = base64UrlToBytes(rawSignature);
  const signed = utf8(`${rawHeader}.${rawPayload}`);

  // One retry with a forced refresh, so a key rotation heals itself instead of
  // rejecting every player until the TTL runs out.
  let verified = false;
  for (const force of [false, true]) {
    const keys = await fetchJwks(supabaseUrl, nowMs, force);
    const candidates = kid ? keys.filter((key) => key.kid === kid) : keys;
    for (const jwk of candidates) {
      if (jwk.alg && jwk.alg !== alg) continue;
      let key: CryptoKey;
      try {
        key = await crypto.subtle.importKey("jwk", jwk as JsonWebKey, spec.importParams, false, ["verify"]);
      } catch {
        continue; // a key we cannot import is not a token we can reject over
      }
      if (await crypto.subtle.verify(spec.verifyParams, key, signature, signed)) {
        verified = true;
        break;
      }
    }
    if (verified) break;
  }
  if (!verified) return { ok: false, reason: "signature did not verify against any published key" };

  const payload = decodeJson(rawPayload);
  if (!payload) return { ok: false, reason: "unreadable JWT payload" };

  const exp = typeof payload.exp === "number" ? payload.exp : 0;
  if (exp * 1000 <= nowMs) return { ok: false, reason: "token has expired" };

  const expectedIssuer = `${supabaseUrl.replace(/\/+$/, "")}/auth/v1`;
  if (payload.iss !== expectedIssuer) {
    // A valid signature from the wrong project is still the wrong project.
    return { ok: false, reason: `issued by ${String(payload.iss)}, not ${expectedIssuer}` };
  }

  const subject = typeof payload.sub === "string" ? payload.sub : "";
  if (!subject) return { ok: false, reason: "token names no subject" };

  // Note what is NOT read here: `payload.email` is present and deliberately
  // ignored. See `Identity`.
  return { ok: true, identity: { userId: subject, expiresAtMs: exp * 1000 } };
}
