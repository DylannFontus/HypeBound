/**
 * The gateway: TLS termination, origin and token checks, and routing to a room.
 *
 * Multiplayer §3 puts the trust boundary here. Everything past it — the Durable
 * Object — is unreachable from the internet, so this is the only place a
 * stranger's bytes are ever looked at, and it is deliberately small enough to
 * read in one sitting.
 *
 * What it does *not* do is decide anything about a game. It does not check
 * whether a move is legal, whose turn it is, or what a player can see. Those
 * belong to the room, which is the only thing holding the state they depend on.
 */

import { contentHash, getContent } from "./shared/engine";
import { PROTOCOL_VERSION } from "./shared/wire";
import { verifySupabaseToken } from "./auth/supabase";
import type { Env } from "./env";

export { MatchRoom } from "./matchRoom";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    if (request.method === "OPTIONS") {
      return preflight(origin, env);
    }

    if (url.pathname === "/health") {
      return cors(
        Response.json({
          ok: true,
          protocolVersion: PROTOCOL_VERSION,
          build: env.BUILD ?? "dev",
          contentHash: contentHash(getContent()),
          identityConfigured: Boolean(env.SUPABASE_URL),
        }),
        origin,
        env
      );
    }

    const match = /^\/match\/([A-Za-z0-9_-]{1,64})\/(socket|init)$/.exec(url.pathname);
    if (!match) return new Response("not found", { status: 404 });
    const [, matchId, action] = match as unknown as [string, string, "socket" | "init"];

    const stub = env.MATCH_ROOM.get(env.MATCH_ROOM.idFromName(matchId));

    if (action === "init") {
      /**
       * Creating matches belongs to the matchmaker (§9), which does not exist
       * yet. Until it does the route is guarded by a secret rather than left
       * open, because "nothing is calling it" is not a property of a public URL.
       * With no `ADMIN_TOKEN` set it is closed entirely — the safe direction for
       * a missing config value.
       */
      if (!env.ADMIN_TOKEN || request.headers.get("X-Hypebound-Admin") !== env.ADMIN_TOKEN) {
        return new Response("forbidden", { status: 403 });
      }
      return stub.fetch(new Request(`https://room/init`, { method: "POST", body: request.body }));
    }

    if (!isAllowedOrigin(origin, env)) {
      // A WebSocket request is not subject to CORS, so the browser will not stop
      // a page on any origin from opening one. The check has to be here or it
      // does not happen at all.
      return new Response("origin not allowed", { status: 403 });
    }

    /**
     * The token arrives as a query parameter, which is not where a bearer token
     * belongs. Browser `WebSocket` cannot set an `Authorization` header — there
     * is no API for it — so the alternatives are this, a cookie, or a
     * first-message `hello` that leaves the socket unauthenticated until it
     * arrives. A query parameter is chosen and then *narrowed*: the token is a
     * short-lived Supabase access token, the URL is https, and the room never
     * logs it. It must not be a refresh token.
     */
    const token = url.searchParams.get("access_token") ?? "";
    if (!token) return new Response("missing access_token", { status: 401 });

    let verified;
    try {
      verified = await verifySupabaseToken(token, env.SUPABASE_URL, Date.now());
    } catch (error) {
      // The identity provider is unreachable. That is a 503 and not a 401: a
      // player whose login is fine should not be told their login is not.
      return new Response(`identity provider unavailable: ${String(error)}`, { status: 503 });
    }
    if (!verified.ok) return new Response(verified.reason, { status: 401 });

    const forwarded = new Request(`https://room/socket`, request);
    forwarded.headers.set("X-Hypebound-User", verified.identity.userId);
    return stub.fetch(forwarded);
  },
} satisfies ExportedHandler<Env>;

function allowedOrigins(env: Env): string[] {
  return env.ALLOWED_ORIGINS.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function isAllowedOrigin(origin: string | null, env: Env): boolean {
  // A missing Origin is a non-browser client (a test harness, curl). It is not
  // granted browser privileges, but it is not a cross-site request either.
  if (origin === null) return true;
  return allowedOrigins(env).includes(origin);
}

function cors(response: Response, origin: string | null, env: Env): Response {
  if (origin !== null && isAllowedOrigin(origin, env)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Vary", "Origin");
  }
  return response;
}

function preflight(origin: string | null, env: Env): Response {
  if (origin === null || !isAllowedOrigin(origin, env)) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    },
  });
}
