/**
 * Where the online services live, and whether there are any.
 *
 * ## Literals, not `import.meta.env`
 *
 * Every value here is public. The Supabase project URL is in the JWT issuer of
 * every token, the anon key is designed to ship inside a client bundle and
 * grants nothing on its own, and the server URL is the thing browsers connect
 * to. None of it is a secret, so none of it needs build-time injection — and
 * avoiding `import.meta.env` avoids three problems at once:
 *
 * - `tests/server-portability.test.ts` bans `import.meta` anywhere the server's
 *   import graph can reach. This module is client-only today, but "client-only
 *   today" is not a property you want load-bearing.
 * - It would need a `define` in `vite.config.ts` **and** an `env:` block in the
 *   Pages workflow, and a value missing from either produces `undefined` at
 *   runtime rather than a build failure.
 * - A committed literal is reviewable. A build-time variable is a thing you
 *   have to go and look up somewhere else to know what shipped.
 *
 * The genuine secrets — the Supabase `service_role` key, a Cloudflare API
 * token — are not here because they are not anywhere: the match server verifies
 * tokens against a public JWKS and holds no credential at all.
 *
 * ## Empty means offline, and the UI must say so
 *
 * Blanking `serverUrl` is the switch that turns the online modes back into
 * "Coming online" tiles. Architecture contract §7 forbids shipping online UI
 * without the service behind it, and the only way to keep that honest is for
 * the UI to ask this module rather than assume.
 */

export interface OnlineConfig {
  /** Match server origin. Empty disables every online path. */
  readonly serverUrl: string;
  /** Supabase project URL. Empty means no identity provider, so no sign-in. */
  readonly supabaseUrl: string;
  /** Supabase anon key — public by design; grants nothing without a user token. */
  readonly supabaseAnonKey: string;
}

export const ONLINE: OnlineConfig = {
  serverUrl: "https://hypebound.dylann-andre-fontus-1.workers.dev",
  supabaseUrl: "https://vnvaqwbnmawcnvhodbel.supabase.co",
  supabaseAnonKey:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZudmFxd2JubWF3Y252aG9kYmVsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzODk0OTIsImV4cCI6MjEwMDk2NTQ5Mn0.m_2UnDt6S-WhUBIIP0qn8_QCQ9xjGu7-Fygfx79hugY",
};

/**
 * Is there anything to connect to?
 *
 * Both halves are required, and the reason is worth stating: with a server but
 * no identity provider every socket is refused with a 401, and with an identity
 * provider but no server there is nothing to sign in *for*. Either alone is a
 * queue that cannot work, which is exactly the thing §7 says not to ship.
 */
export function onlineAvailable(config: OnlineConfig = ONLINE): boolean {
  return config.serverUrl.length > 0 && config.supabaseUrl.length > 0 && config.supabaseAnonKey.length > 0;
}

/** `wss://…/match/:id/socket?access_token=…`, built in one place so it cannot drift. */
export function matchSocketUrl(matchId: string, accessToken: string, config: OnlineConfig = ONLINE): string {
  return `${websocketOrigin(config)}/match/${encodeURIComponent(matchId)}/socket?access_token=${encodeURIComponent(accessToken)}`;
}

/** `wss://…/queue/casual/socket?access_token=…`. */
export function queueSocketUrl(accessToken: string, config: OnlineConfig = ONLINE): string {
  return `${websocketOrigin(config)}/queue/casual/socket?access_token=${encodeURIComponent(accessToken)}`;
}

/**
 * `https:` → `wss:`, `http:` → `ws:`.
 *
 * A `WebSocket` constructed with an `https:` URL throws a `SyntaxError` in
 * every browser, and the mistake is easy to make because every other URL in
 * this file is an https one.
 */
function websocketOrigin(config: OnlineConfig): string {
  return config.serverUrl.replace(/^http/, "ws").replace(/\/+$/, "");
}
