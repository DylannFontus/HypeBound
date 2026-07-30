/**
 * Signing in, without a Supabase client library.
 *
 * Supabase Auth (GoTrue) is a plain REST API. Everything this game needs is
 * four `POST`s with an `apikey` header, so `@supabase/supabase-js` would be
 * ~120 kB of Postgrest, Realtime, Storage and Functions clients the game never
 * calls — plus four concrete problems:
 *
 * - It breaks `tests/fairness.test.ts`, which pins the runtime dependency list
 *   to exactly `["three", "zod"]`, and `npm test` gates the Pages deploy.
 * - Its default browser flow is `implicit`, which returns tokens in the URL
 *   **fragment** — a head-on collision with this game's hash router, and a
 *   direct violation of multiplayer §10.1's "no tokens in URLs".
 * - It persists the session under its own key and would silently escape the
 *   privacy screen's "delete everything on this device".
 * - It fires network calls at construction, which `scripts/verify-fairness.mjs`
 *   fails on: that script records every request the page makes and asserts none
 *   left the machine.
 *
 * What is genuinely given up by hand-rolling: cross-tab session sync, and the
 * library's battle-tested refresh-token rotation. The second is the one that
 * matters, and it is why `refreshing` below is a single shared promise.
 *
 * ## Nothing here runs until something calls it
 *
 * No timers, no boot-time fetch, no session restore on import. The stored
 * session is read lazily on first use. That keeps the game's cold start
 * network-silent, which is a property `verify:fairness` checks and the privacy
 * page claims.
 */

import { ONLINE, type OnlineConfig } from "../config";

export interface Account {
  readonly userId: string;
  readonly email: string;
}

export interface Session {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Epoch milliseconds. */
  readonly expiresAtMs: number;
  readonly account: Account;
}

export type AuthResult = { ok: true; session: Session } | { ok: false; message: string };

/**
 * **Not** a `hypebound:` key, and that is deliberate.
 *
 * `exportSave()` walks every `hypebound:`-prefixed key into a JSON file the
 * player can download, and the privacy screen will print it into the page. An
 * access token in there is a bearer credential in a text file — exporting your
 * save would be handing someone your account.
 *
 * The prefix therefore differs, which creates the opposite hazard: a key the
 * "delete everything on this device" sweep would miss. `privacyScreen.ts`
 * clears this prefix too, and the asymmetry is the point — **the export is
 * "what this game knows about you"; the delete is "everything on this device"**.
 * A credential belongs in the second and not the first.
 */
export const SESSION_KEY = "hypebound-auth:session";

/** Refresh this long before expiry, so a request never races the clock. */
const REFRESH_MARGIN_MS = 60_000;

let cached: Session | null | undefined;
/** One shared refresh, so N concurrent callers rotate the token once. */
let refreshing: Promise<Session | null> | null = null;

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function readStored(): Session | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (
      typeof parsed.accessToken !== "string" ||
      typeof parsed.refreshToken !== "string" ||
      typeof parsed.expiresAtMs !== "number" ||
      typeof parsed.account?.userId !== "string"
    ) {
      return null;
    }
    return parsed as Session;
  } catch {
    // A corrupt session is not an error worth surfacing; it is a signed-out
    // player. Throwing here would break the lobby for anyone whose storage got
    // truncated.
    return null;
  }
}

function store(session: Session | null): void {
  cached = session;
  if (typeof localStorage === "undefined") return;
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}

/** The session as stored, without refreshing it. Null when signed out. */
export function currentSession(): Session | null {
  if (cached === undefined) cached = readStored();
  return cached;
}

export function currentAccount(): Account | null {
  return currentSession()?.account ?? null;
}

/** Test hook: forget the in-memory copy so a fixture's storage is re-read. */
export function resetSessionCache(): void {
  cached = undefined;
  refreshing = null;
}

// ---------------------------------------------------------------------------
// The four calls
// ---------------------------------------------------------------------------

interface GoTrueSession {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: { id?: string; email?: string };
  error_description?: string;
  msg?: string;
  message?: string;
}

async function post(
  path: string,
  body: unknown,
  config: OnlineConfig,
  nowMs: number,
  bearer?: string
): Promise<AuthResult> {
  let response: Response;
  try {
    response = await fetch(`${config.supabaseUrl.replace(/\/+$/, "")}/auth/v1/${path}`, {
      method: "POST",
      headers: {
        apikey: config.supabaseAnonKey,
        "content-type": "application/json",
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch {
    // Offline, DNS failure, a blocked request. Distinguished from a refusal
    // because the fix is completely different: wait, versus fix your password.
    return { ok: false, message: "Could not reach the sign-in service. Check your connection and try again." };
  }

  let payload: GoTrueSession;
  try {
    payload = (await response.json()) as GoTrueSession;
  } catch {
    return { ok: false, message: `The sign-in service answered with something unreadable (${response.status}).` };
  }

  if (!response.ok) {
    // GoTrue puts its reason in one of three fields depending on the endpoint.
    const reason = payload.error_description ?? payload.msg ?? payload.message ?? `error ${response.status}`;
    return { ok: false, message: reason };
  }

  const session = toSession(payload, nowMs);
  if (!session) {
    return { ok: false, message: "The sign-in service returned no session, which should not happen." };
  }
  store(session);
  return { ok: true, session };
}

function toSession(payload: GoTrueSession, nowMs: number): Session | null {
  if (!payload.access_token || !payload.refresh_token || !payload.user?.id) return null;
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    // `expires_in` is seconds from now. Defaulted to an hour, which is
    // GoTrue's own default, so a missing field degrades to refreshing sooner
    // rather than to a token treated as eternal.
    expiresAtMs: nowMs + (payload.expires_in ?? 3600) * 1000,
    account: { userId: payload.user.id, email: payload.user.email ?? "" },
  };
}

export function signUp(email: string, password: string, config = ONLINE, nowMs = Date.now()): Promise<AuthResult> {
  return post("signup", { email, password }, config, nowMs);
}

export function signIn(email: string, password: string, config = ONLINE, nowMs = Date.now()): Promise<AuthResult> {
  return post("token?grant_type=password", { email, password }, config, nowMs);
}

/**
 * Sign out.
 *
 * The local session is cleared **first and unconditionally**. Telling the
 * server is best-effort: if it fails, the player is still signed out on this
 * device, which is what they asked for and the only part this code controls.
 */
export async function signOut(config = ONLINE): Promise<void> {
  const session = currentSession();
  store(null);
  if (!session) return;
  try {
    await fetch(`${config.supabaseUrl.replace(/\/+$/, "")}/auth/v1/logout`, {
      method: "POST",
      headers: { apikey: config.supabaseAnonKey, authorization: `Bearer ${session.accessToken}` },
    });
  } catch {
    // Deliberately swallowed — see above.
  }
}

/**
 * A token that will still be valid when it arrives, or null if signed out.
 *
 * Every online path goes through this rather than reading `accessToken`
 * directly, because a token that expires mid-queue produces a 401 the player
 * cannot interpret. The margin means "valid now" is really "valid for at least
 * another minute".
 *
 * Concurrent callers share one refresh. Without that, opening the queue and a
 * match at the same moment would rotate the refresh token twice, and the loser
 * of that race holds a token the server has already invalidated — which is the
 * classic way a hand-rolled refresh signs everybody out.
 */
export async function accessToken(config = ONLINE, nowMs = Date.now()): Promise<string | null> {
  const session = currentSession();
  if (!session) return null;
  if (session.expiresAtMs - REFRESH_MARGIN_MS > nowMs) return session.accessToken;

  refreshing ??= (async () => {
    const result = await post("token?grant_type=refresh_token", { refresh_token: session.refreshToken }, config, nowMs);
    if (result.ok) return result.session;
    /**
     * The refresh token is spent or revoked. There is no recovering from that
     * in the client, and keeping a dead session would make every subsequent
     * call fail in a way that looks like the server being broken. Sign out, so
     * the UI shows a sign-in form instead of an error.
     */
    store(null);
    return null;
  })().finally(() => {
    refreshing = null;
  });

  return (await refreshing)?.accessToken ?? null;
}
