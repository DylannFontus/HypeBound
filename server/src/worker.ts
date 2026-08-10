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
export { CasualQueue } from "./casualQueue";
export { PlayerRecord } from "./playerRecord";
export { SaveStore } from "./saveStore";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    if (request.method === "OPTIONS") {
      // `/admin/*` is not merely uncorsed, it is un-preflightable. A browser
      // that cannot get a preflight past this line can never send the real
      // request, whatever it puts in its headers.
      if (url.pathname.startsWith("/admin/")) return new Response(null, { status: 403 });
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

    /**
     * Your own record, and only your own. The id comes from the verified token,
     * so there is no parameter naming whose record to read and therefore no
     * request that can ask for somebody else's.
     */
    if (url.pathname === "/me/record") {
      const identified = await identify(request, url, env);
      if ("response" in identified) return cors(identified.response, origin, env);
      const stub = env.PLAYER_RECORD.get(env.PLAYER_RECORD.idFromName(identified.userId));
      // `DELETE` erases it; anything else reads it. Same id, same token, same
      // impossibility of naming somebody else's.
      const method = request.method === "DELETE" ? "DELETE" : "GET";
      return cors(await stub.fetch(new Request("https://player/record", { method })), origin, env);
    }

    /**
     * Cloud saves (§12). Your own, and only your own, for the same reason
     * `/me/record` is: the account comes out of the verified token, so no
     * request can name a save that is not the caller's.
     *
     * The path is `/me/saves` rather than §12.3's `/v1/saves` to match the
     * route that already exists here. `/me/` is not decoration — it is where
     * this server puts things whose subject is fixed by the token, and putting
     * saves anywhere else would make that convention decorative.
     */
    if (url.pathname === "/me/saves" || url.pathname.startsWith("/me/saves/")) {
      const identified = await identify(request, url, env);
      if ("response" in identified) return cors(identified.response, origin, env);

      const stub = env.SAVE_STORE.get(env.SAVE_STORE.idFromName(identified.userId));
      const section = url.pathname.slice("/me/saves".length);

      if (section === "" || section === "/") {
        const method = request.method === "DELETE" ? "DELETE" : "GET";
        const inner = method === "DELETE" ? "https://saves/all" : "https://saves/manifest";
        return cors(await stub.fetch(new Request(inner, { method })), origin, env);
      }

      /**
       * The body and `If-Match` are forwarded rather than reconstructed.
       *
       * `If-Match` is the entire concurrency control, so a gateway that dropped
       * it would turn every write into a blind overwrite — and the object would
       * refuse with 428 rather than corrupt anything, which is the right
       * failure but an obscure one to debug. Copying it explicitly is cheaper
       * than remembering why every push fails.
       */
      const forwarded = new Request(`https://saves/section${section}`, {
        method: request.method,
        headers: request.headers.has("If-Match")
          ? { "If-Match": request.headers.get("If-Match")!, "content-type": "application/json" }
          : { "content-type": "application/json" },
        body: request.method === "PUT" ? await request.text() : undefined,
      });
      return cors(await stub.fetch(forwarded), origin, env);
    }

    /**
     * The operator's door onto one account's profile save — `scripts/grant.mjs`.
     *
     * ## It is a byte proxy, and refusing to make it anything more is the design
     *
     * `saves/store.ts` opens with the claim that this server never parses a
     * save, and draws the conclusion from it: *"a compromised server can
     * withhold or corrupt a save but cannot mint currency out of one."* A route
     * that spliced a grant into a payload server-side would be the shortest
     * possible way to delete that sentence. So the read-modify-write lives in
     * the operator's terminal, where `--dry-run` can print it, and this
     * forwards bytes and an `If-Match` exactly as `/me/saves` does — meaning a
     * grant races a player's own write on precisely the same terms, and loses
     * loudly with a 409 rather than quietly overwriting whatever they did next.
     *
     * ## Three ways it is closed to the client, not one
     *
     * The header it needs is a secret that exists only in the Worker's
     * environment and the operator's gitignored `.dev.vars`, and is in no
     * bundle; `Access-Control-Allow-Headers` does not list it, so no browser
     * would be permitted to send it; and any request arriving with an `Origin`
     * at all is refused here before the token is even looked at. A page cannot
     * reach this by being clever, only by not being a page.
     *
     * The account is named in the path rather than derived from a token — the
     * one place in this file where the subject is not the caller — so the shape
     * is deliberately narrow: one hard-coded section, and an id pattern that
     * cannot express an email address. The server has no Supabase credential
     * and therefore no way to resolve one; refusing the shape says so at the
     * boundary instead of leaving it to be discovered.
     */
    const admin = /^\/admin\/saves\/([A-Za-z0-9_-]{8,64})\/profile$/.exec(url.pathname);
    if (admin) {
      if (origin !== null) return new Response("forbidden", { status: 403 });
      if (!env.ADMIN_TOKEN || request.headers.get("X-Hypebound-Admin") !== env.ADMIN_TOKEN) {
        // Same precedent, and the same safe direction, as `/match/:id/init`:
        // with no `ADMIN_TOKEN` configured the route is closed entirely rather
        // than open.
        return new Response("forbidden", { status: 403 });
      }

      const stub = env.SAVE_STORE.get(env.SAVE_STORE.idFromName(admin[1]!));
      if (request.method === "GET") return stub.fetch(new Request("https://saves/section/profile"));
      if (request.method !== "PUT") return new Response("method not allowed", { status: 405 });

      return stub.fetch(
        new Request("https://saves/section/profile", {
          method: "PUT",
          headers: request.headers.has("If-Match")
            ? { "If-Match": request.headers.get("If-Match")!, "content-type": "application/json" }
            : { "content-type": "application/json" },
          body: await request.text(),
        })
      );
    }

    /**
     * The queue. One global shard — see `casualQueue.ts` for why sharding is a
     * fix for a problem this game does not have.
     */
    if (url.pathname === "/queue/casual" || url.pathname === "/queue/casual/socket") {
      const wantsSocket = request.headers.get("Upgrade") === "websocket";
      if (wantsSocket && !isAllowedOrigin(origin, env)) {
        return new Response("origin not allowed", { status: 403 });
      }
      const stub = env.CASUAL_QUEUE.get(env.CASUAL_QUEUE.idFromName("casual"));
      if (!wantsSocket) return cors(await stub.fetch(new Request("https://queue/status")), origin, env);

      const identified = await identify(request, url, env);
      if ("response" in identified) return identified.response;
      const forwarded = new Request("https://queue/socket", request);
      forwarded.headers.set("X-Hypebound-User", identified.userId);
      return stub.fetch(forwarded);
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

    const identified = await identify(request, url, env);
    if ("response" in identified) return identified.response;

    const forwarded = new Request(`https://room/socket`, request);
    forwarded.headers.set("X-Hypebound-User", identified.userId);
    return stub.fetch(forwarded);
  },
} satisfies ExportedHandler<Env>;

/**
 * Who is asking.
 *
 * **`Authorization` first, query parameter second, and the order is the point.**
 * A bearer token belongs in a header: headers stay out of referrers, browser
 * history and most access logs, and a query parameter does not. Ordinary
 * `fetch` calls therefore use the header and this reads it first.
 *
 * The query parameter exists for exactly one caller: a browser `WebSocket`,
 * which has no API for setting a header at all. The alternatives there are a
 * cookie or a first-message `hello` that leaves the socket unauthenticated
 * until it arrives, and both are worse. So it is a narrow exception rather than
 * the scheme — the token is short-lived, the URL is https, and nothing logs it.
 * It must never be a refresh token.
 *
 * Reading only the query parameter was the original bug: `/me/record` is a
 * plain `fetch` and sent the header, so it was refused with a 401 for a token
 * that was sitting in the request.
 */
async function identify(
  request: Request,
  url: URL,
  env: Env
): Promise<{ userId: string } | { response: Response }> {
  const header = request.headers.get("Authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const token = bearer || url.searchParams.get("access_token") || "";
  if (!token) return { response: new Response("missing access_token", { status: 401 }) };

  let verified;
  try {
    verified = await verifySupabaseToken(token, env.SUPABASE_URL, Date.now());
  } catch (error) {
    // The identity provider is unreachable. That is a 503 and not a 401: a
    // player whose login is fine should not be told their login is not.
    return { response: new Response(`identity provider unavailable: ${String(error)}`, { status: 503 }) };
  }
  if (!verified.ok) return { response: new Response(verified.reason, { status: 401 }) };
  return { userId: verified.identity.userId };
}

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

/**
 * Attach CORS headers, on a copy.
 *
 * The copy is not defensive style — it is required. A `Response` that came back
 * from `fetch()`, which is what a Durable Object stub returns, has **immutable
 * headers**, so `headers.set()` on it does not attach anything. `/health` built
 * its response with `Response.json()` and worked; `/me/record` proxies one from
 * a stub and silently shipped no `Access-Control-Allow-Origin` at all.
 *
 * The browser then reports that as an opaque "Failed to fetch", with the actual
 * cause visible only in the console — which is how this survived a passing
 * server-side check and was caught by a real page instead.
 */
function cors(response: Response, origin: string | null, env: Env): Response {
  if (origin === null || !isAllowedOrigin(origin, env)) return response;
  const copy = new Response(response.body, response);
  copy.headers.set("Access-Control-Allow-Origin", origin);
  copy.headers.set("Vary", "Origin");
  return copy;
}

function preflight(origin: string | null, env: Env): Response {
  if (origin === null || !isAllowedOrigin(origin, env)) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      // `PUT` for save writes. Omitting a method here fails only in a browser:
      // every server-side test calls the object directly and never sees a
      // preflight, so this list is one of the few things here that cannot be
      // proven by the unit suite.
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      // `authorization`, or the preflight for any authenticated `fetch` is
      // refused before the request is ever made. The browser does not tell the
      // page why in any detail, so this failed as an opaque "Failed to fetch".
      //
      // `if-match` for the same reason, and it would fail the same way: the
      // header is the whole of the save concurrency control, and a preflight
      // that does not list it makes every push an opaque network error.
      "Access-Control-Allow-Headers": "authorization, content-type, if-match",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    },
  });
}
