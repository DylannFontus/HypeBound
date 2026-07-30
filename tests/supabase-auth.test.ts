/**
 * Token verification, tested against real signatures.
 *
 * This is the entire authentication surface: everything past it — the room, the
 * match, the seat — trusts the `userId` this function returns. So the tests sign
 * genuine ES256 and RS256 tokens with Node's WebCrypto, serve a real JWKS
 * document from a stubbed `fetch`, and check that the tampered and expired ones
 * are refused for the reason they are actually wrong.
 *
 * A mocked verifier would prove nothing here. The failure this guards against is
 * not "the function returned false" but "the function returned true for a token
 * the server should not have accepted", and only a real signature can
 * distinguish those.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetJwksCache, verifySupabaseToken } from "../server/src/auth/supabase";

const PROJECT = "https://abcdefghijklmnop.supabase.co";
const ISSUER = `${PROJECT}/auth/v1`;
const JWKS_URL = `${PROJECT}/auth/v1/.well-known/jwks.json`;
const NOW = 1_800_000_000_000;

const b64url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** `<ArrayBuffer>`, not a bare `Uint8Array`: the latter admits `SharedArrayBuffer` and WebCrypto refuses it. */
const utf8 = (value: string): Uint8Array<ArrayBuffer> => new Uint8Array(new TextEncoder().encode(value));

const encodeJson = (value: unknown): string => b64url(utf8(JSON.stringify(value)));

interface Signer {
  jwk: JsonWebKey & { kid: string; alg: string };
  sign: (data: Uint8Array<ArrayBuffer>) => Promise<ArrayBuffer>;
}

async function makeSigner(alg: "ES256" | "RS256", kid: string): Promise<Signer> {
  const params =
    alg === "ES256"
      ? { name: "ECDSA", namedCurve: "P-256" }
      : { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
  const signParams = alg === "ES256" ? { name: "ECDSA", hash: "SHA-256" } : { name: "RSASSA-PKCS1-v1_5" };

  const pair = (await crypto.subtle.generateKey(params as AlgorithmIdentifier, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  return {
    jwk: { ...jwk, kid, alg },
    sign: (data) => crypto.subtle.sign(signParams as AlgorithmIdentifier, pair.privateKey, data),
  };
}

interface ClaimOverrides {
  iss?: string;
  sub?: string;
  exp?: number;
  email?: string;
}

async function mintToken(signer: Signer, overrides: ClaimOverrides = {}, alg = signer.jwk.alg): Promise<string> {
  const header = encodeJson({ alg, typ: "JWT", kid: signer.jwk.kid });
  const payload = encodeJson({
    iss: overrides.iss ?? ISSUER,
    sub: overrides.sub ?? "11111111-2222-3333-4444-555555555555",
    aud: "authenticated",
    exp: overrides.exp ?? Math.floor(NOW / 1000) + 3600,
    email: overrides.email ?? "player@example.com",
  });
  const signature = await signer.sign(utf8(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(new Uint8Array(signature))}`;
}

/** A stubbed JWKS endpoint that counts its own hits, so a vacuous test is visible. */
function serveJwks(keys: JsonWebKey[]): { hits: () => number; setKeys: (next: JsonWebKey[]) => void } {
  let current = keys;
  let hits = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url !== JWKS_URL) throw new Error(`unexpected fetch: ${url}`);
    hits += 1;
    return new Response(JSON.stringify({ keys: current }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { hits: () => hits, setKeys: (next) => (current = next) };
}

const realFetch = globalThis.fetch;

let es256: Signer;
let rs256: Signer;

beforeEach(async () => {
  resetJwksCache();
  es256 ??= await makeSigner("ES256", "key-es-1");
  rs256 ??= await makeSigner("RS256", "key-rs-1");
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("a token this server should accept", () => {
  it("accepts a valid ES256 token and returns who signed in", async () => {
    const jwks = serveJwks([es256.jwk]);
    const result = await verifySupabaseToken(await mintToken(es256), PROJECT, NOW);

    expect(result.ok, result.ok ? "" : result.reason).toBe(true);
    if (!result.ok) return;
    expect(result.identity.userId).toBe("11111111-2222-3333-4444-555555555555");
    expect(result.identity.expiresAtMs).toBeGreaterThan(NOW);
    /**
     * The token carries an `email` claim and the server deliberately does not
     * read it — asserted, because "we never store your email" is a promise on
     * the privacy page, and a promise nothing checks is a promise waiting to be
     * broken by a convenient one-line addition.
     */
    expect(Object.keys(result.identity).sort()).toEqual(["expiresAtMs", "userId"]);
    // and it really did go and fetch the keys rather than passing on a guess
    expect(jwks.hits()).toBe(1);
  });

  it("accepts RS256 as well", async () => {
    serveJwks([rs256.jwk]);
    const result = await verifySupabaseToken(await mintToken(rs256), PROJECT, NOW);
    expect(result.ok, result.ok ? "" : result.reason).toBe(true);
  });

  it("caches the key set instead of fetching per token", async () => {
    const jwks = serveJwks([es256.jwk]);
    await verifySupabaseToken(await mintToken(es256), PROJECT, NOW);
    await verifySupabaseToken(await mintToken(es256), PROJECT, NOW + 1000);
    expect(jwks.hits()).toBe(1);
  });

  it("survives a key rotation by refreshing once", async () => {
    /**
     * Without the forced second attempt, every player would be refused for up
     * to the cache TTL after Supabase rotates its signing key — an outage with
     * no error anywhere and no deploy that caused it.
     */
    const jwks = serveJwks([es256.jwk]);
    await verifySupabaseToken(await mintToken(es256), PROJECT, NOW);
    expect(jwks.hits()).toBe(1);

    const rotated = await makeSigner("ES256", "key-es-2");
    jwks.setKeys([rotated.jwk]);

    const result = await verifySupabaseToken(await mintToken(rotated), PROJECT, NOW + 1000);
    expect(result.ok, result.ok ? "" : result.reason).toBe(true);
    expect(jwks.hits(), "the stale cache was never refreshed").toBe(2);
  });
});

describe("a token this server must refuse", () => {
  it("refuses a payload edited after signing", async () => {
    serveJwks([es256.jwk]);
    const token = await mintToken(es256);
    const [header, , signature] = token.split(".") as [string, string, string];
    const forged = `${header}.${encodeJson({ iss: ISSUER, sub: "somebody-else", exp: Math.floor(NOW / 1000) + 3600 })}.${signature}`;

    const result = await verifySupabaseToken(forged, PROJECT, NOW);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("signature did not verify");
  });

  it("refuses a token signed by a key the project does not publish", async () => {
    const stranger = await makeSigner("ES256", "key-es-1"); // same kid, different key
    serveJwks([es256.jwk]);
    const result = await verifySupabaseToken(await mintToken(stranger), PROJECT, NOW);
    expect(result.ok).toBe(false);
  });

  it("refuses an expired token", async () => {
    serveJwks([es256.jwk]);
    const token = await mintToken(es256, { exp: Math.floor(NOW / 1000) - 1 });
    const result = await verifySupabaseToken(token, PROJECT, NOW);
    expect(result.ok === false && result.reason).toContain("expired");
  });

  it("refuses a validly signed token from another project", async () => {
    // The signature is genuine. It is simply not this game's identity provider.
    serveJwks([es256.jwk]);
    const token = await mintToken(es256, { iss: "https://someone-else.supabase.co/auth/v1" });
    const result = await verifySupabaseToken(token, PROJECT, NOW);
    expect(result.ok === false && result.reason).toContain("not https://abcdefghijklmnop.supabase.co/auth/v1");
  });

  it("refuses HS256, and says which setting to change", async () => {
    /**
     * The important refusal. Verifying HS256 requires the secret that *mints*
     * tokens, so accepting it would mean the match server could forge any
     * player's identity. Refusing quietly would instead send someone hunting
     * through their client for a bug that is in their project settings.
     */
    serveJwks([es256.jwk]);
    const header = encodeJson({ alg: "HS256", typ: "JWT" });
    const payload = encodeJson({ iss: ISSUER, sub: "x", exp: Math.floor(NOW / 1000) + 60 });
    const result = await verifySupabaseToken(`${header}.${payload}.bm90LWEtc2lnbmF0dXJl`, PROJECT, NOW);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("asymmetric JWT signing keys");
  });

  it("refuses `alg: none` and anything else unrecognised", async () => {
    serveJwks([es256.jwk]);
    const header = encodeJson({ alg: "none", typ: "JWT" });
    const payload = encodeJson({ iss: ISSUER, sub: "x", exp: Math.floor(NOW / 1000) + 60 });
    const result = await verifySupabaseToken(`${header}.${payload}.`, PROJECT, NOW);
    expect(result.ok === false && result.reason).toContain("unsupported signing algorithm none");
  });

  it("refuses junk without fetching anything", async () => {
    const jwks = serveJwks([es256.jwk]);
    expect((await verifySupabaseToken("not-a-token", PROJECT, NOW)).ok).toBe(false);
    expect((await verifySupabaseToken("", PROJECT, NOW)).ok).toBe(false);
    expect(jwks.hits(), "a malformed token should not cost a network round trip").toBe(0);
  });

  it("refuses everything when no identity provider is configured", async () => {
    serveJwks([es256.jwk]);
    const result = await verifySupabaseToken(await mintToken(es256), "", NOW);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("SUPABASE_URL is empty");
  });
});

describe("an outage is not a rejection", () => {
  it("throws when the JWKS endpoint is unreachable, so the caller can answer 503", async () => {
    /**
     * The distinction matters to a real player: a 401 tells them their login is
     * broken and sends them to re-authenticate, which will also fail. A 503
     * tells them to try again, which will eventually work.
     */
    globalThis.fetch = (async () => new Response("nope", { status: 500 })) as typeof fetch;
    await expect(verifySupabaseToken(await mintToken(es256), PROJECT, NOW)).rejects.toThrow(/JWKS fetch failed: 500/);
  });
});
