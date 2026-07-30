/**
 * The client's half of sign-in.
 *
 * `fetch` is stubbed, because the thing under test is what this module does
 * with GoTrue's answers — not GoTrue. What is *not* stubbed is the module's own
 * state machine: storage, the expiry margin, and the shared refresh, which are
 * where a hand-rolled auth client actually goes wrong.
 *
 * Two properties here are load-bearing for claims made elsewhere in the game
 * and are asserted rather than assumed: **nothing touches the network until
 * something asks it to** (the privacy page says the game makes no request it
 * did not ship with, and `scripts/verify-fairness.mjs` fails on any off-origin
 * request in a whole session), and **the session is not stored under a
 * `hypebound:` key** (the save export would put a bearer token in a file the
 * player can download).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  SESSION_KEY,
  accessToken,
  currentAccount,
  currentSession,
  resetSessionCache,
  signIn,
  signOut,
  signUp,
} from "../src/auth/account";
import { ONLINE, matchSocketUrl, onlineAvailable, queueSocketUrl } from "../src/config";

const CONFIG = {
  serverUrl: "https://server.invalid",
  supabaseUrl: "https://project.invalid",
  supabaseAnonKey: "anon-key",
};
const NOW = 1_800_000_000_000;

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

let calls: Call[] = [];
const realFetch = globalThis.fetch;

/**
 * A `localStorage` that exists.
 *
 * Tests run in vitest's `node` environment, which has no DOM. Adding jsdom to
 * get one would add a devDependency — and `tests/fairness.test.ts` pins the
 * dependency manifest against `data/policies.json`'s attribution list, so a new
 * package means a licence entry and a legal-screen row for the privilege of
 * having a `Storage` object in a test. Fifteen lines is the cheaper honesty.
 *
 * Deliberately real enough to catch what matters: `Object.keys` over it works,
 * which is what the privacy screen's delete sweep iterates.
 */
function installLocalStorage(): void {
  const map = new Map<string, string>();
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
  // `Object.keys(localStorage)` must list the stored keys, as it does in a
  // browser, or the delete sweep this backs would silently find nothing.
  (globalThis as { localStorage?: unknown }).localStorage = new Proxy(storage, {
    ownKeys: () => [...map.keys()],
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
    get: (target, prop) =>
      typeof prop === "string" && map.has(prop) && !(prop in target) ? map.get(prop) : Reflect.get(target, prop),
  });
}

installLocalStorage();

function stubFetch(reply: (call: Call) => { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const call: Call = {
      url,
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    };
    calls.push(call);
    const { status = 200, body } = await reply(call);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

const goodSession = (over: Record<string, unknown> = {}) => ({
  access_token: "access-1",
  refresh_token: "refresh-1",
  expires_in: 3600,
  user: { id: "user-uuid", email: "player@example.com" },
  ...over,
});

beforeEach(() => {
  calls = [];
  localStorage.clear();
  resetSessionCache();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("nothing happens until it is asked to", () => {
  it("makes no request on import or on reading the current session", () => {
    /**
     * The property `verify:fairness` checks in a browser and this checks here.
     * A library that refreshed on construction would fail both, and the privacy
     * page's "no request that is not a file it shipped with" would become false
     * at boot rather than at sign-in.
     */
    stubFetch(() => ({ body: goodSession() }));
    expect(currentSession()).toBeNull();
    expect(currentAccount()).toBeNull();
    expect(calls, "reading a signed-out session hit the network").toEqual([]);
  });

  it("does not refresh a token that is still comfortably valid", async () => {
    stubFetch(() => ({ body: goodSession() }));
    await signIn("a@b.c", "pw", CONFIG, NOW);
    calls = [];

    expect(await accessToken(CONFIG, NOW + 60_000)).toBe("access-1");
    expect(calls).toEqual([]);
  });
});

describe("signing up and in", () => {
  it("posts to the right endpoint with the anon key", async () => {
    stubFetch(() => ({ body: goodSession() }));
    const result = await signUp("player@example.com", "hunter2hunter2", CONFIG, NOW);

    expect(result.ok, result.ok ? "" : result.message).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://project.invalid/auth/v1/signup");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.headers.apikey).toBe("anon-key");
    expect(calls[0]!.body).toEqual({ email: "player@example.com", password: "hunter2hunter2" });
  });

  it("uses the password grant for sign-in and keeps the account", async () => {
    stubFetch(() => ({ body: goodSession() }));
    const result = await signIn("player@example.com", "pw", CONFIG, NOW);

    expect(calls[0]!.url).toBe("https://project.invalid/auth/v1/token?grant_type=password");
    expect(result.ok && result.session.account).toEqual({ userId: "user-uuid", email: "player@example.com" });
    expect(currentAccount()?.userId).toBe("user-uuid");
  });

  it("computes expiry from `expires_in`, and defaults it rather than treating it as eternal", async () => {
    stubFetch(() => ({ body: goodSession({ expires_in: undefined }) }));
    const result = await signIn("a@b.c", "pw", CONFIG, NOW);
    // GoTrue's own default is an hour; a missing field must shorten the life of
    // the token, never extend it.
    expect(result.ok && result.session.expiresAtMs).toBe(NOW + 3_600_000);
  });

  it("passes the service's own refusal through instead of inventing one", async () => {
    stubFetch(() => ({ status: 400, body: { error_description: "Invalid login credentials" } }));
    const result = await signIn("a@b.c", "wrong", CONFIG, NOW);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toBe("Invalid login credentials");
    expect(currentSession()).toBeNull();
  });

  it("tells an outage apart from a refusal", async () => {
    // The player's password is fine and their network is not. Saying "invalid
    // credentials" would send them to reset a password that works.
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    const result = await signIn("a@b.c", "pw", CONFIG, NOW);
    expect(result.ok === false && result.message).toContain("Could not reach");
  });
});

describe("where the session is stored", () => {
  it("is not under a `hypebound:` key, because the save export would carry it", () => {
    /**
     * `exportSave()` serialises every `hypebound:`-prefixed key into a file the
     * player can download, and the privacy screen prints it into the page. A
     * bearer token in there is an account handed to whoever reads the file.
     */
    expect(SESSION_KEY.startsWith("hypebound:")).toBe(false);
    expect(SESSION_KEY.startsWith("hypebound-auth:")).toBe(true);
  });

  it("is cleared by the privacy screen's delete, which the export skips", () => {
    /**
     * A cross-file invariant, so it is checked across files.
     *
     * `SESSION_KEY` lives here and the sweep lives in `privacyScreen.ts`, and
     * the two are only correct together: the key sits outside the `hypebound:`
     * prefix so `exportSave()` cannot put a bearer token in a downloadable
     * file, which means the delete sweep has to name it explicitly or "delete
     * everything on this device" quietly leaves the account signed in.
     */
    const screen = readFileSync(fileURLToPath(new URL("../src/ui/screens/privacyScreen.ts", import.meta.url)), "utf8");
    const prefix = SESSION_KEY.slice(0, SESSION_KEY.indexOf(":") + 1);
    expect(prefix).toBe("hypebound-auth:");
    expect(screen, "the delete sweep does not clear the session key").toContain(`startsWith("${prefix}")`);

    // and the save prefix is still swept as well, so this widened the delete
    // rather than replacing it
    expect(screen).toContain('startsWith("hypebound:")');
  });

  it("survives a reload, and clears on sign-out", async () => {
    stubFetch(() => ({ body: goodSession() }));
    await signIn("a@b.c", "pw", CONFIG, NOW);
    expect(localStorage.getItem(SESSION_KEY)).toContain("access-1");

    resetSessionCache(); // what a page reload looks like
    expect(currentAccount()?.userId).toBe("user-uuid");

    await signOut(CONFIG);
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
    expect(currentSession()).toBeNull();
  });

  it("treats a corrupt stored session as signed out rather than throwing", () => {
    // Truncated storage should not break the lobby.
    localStorage.setItem(SESSION_KEY, "{not json");
    resetSessionCache();
    expect(currentSession()).toBeNull();

    localStorage.setItem(SESSION_KEY, JSON.stringify({ accessToken: "x" }));
    resetSessionCache();
    expect(currentSession(), "a half-written session is not a session").toBeNull();
  });

  it("signs out locally even when telling the server fails", async () => {
    stubFetch(() => ({ body: goodSession() }));
    await signIn("a@b.c", "pw", CONFIG, NOW);
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as typeof fetch;

    await expect(signOut(CONFIG)).resolves.toBeUndefined();
    expect(currentSession(), "sign-out must not depend on the network").toBeNull();
  });
});

describe("refreshing", () => {
  it("refreshes inside the margin, before the token is actually dead", async () => {
    stubFetch((call) =>
      call.url.includes("refresh_token")
        ? { body: goodSession({ access_token: "access-2", refresh_token: "refresh-2" }) }
        : { body: goodSession() }
    );
    await signIn("a@b.c", "pw", CONFIG, NOW);
    calls = [];

    // 30s before expiry: still valid, but inside the 60s margin.
    const token = await accessToken(CONFIG, NOW + 3_600_000 - 30_000);
    expect(token).toBe("access-2");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("grant_type=refresh_token");
    expect(calls[0]!.body).toEqual({ refresh_token: "refresh-1" });
  });

  it("rotates once for concurrent callers, not once each", async () => {
    /**
     * The classic way a hand-rolled refresh signs everybody out: opening the
     * queue and a match at the same moment rotates the refresh token twice, and
     * the loser of the race is holding one the server has already spent.
     */
    let refreshes = 0;
    stubFetch((call) => {
      if (!call.url.includes("refresh_token")) return { body: goodSession() };
      refreshes += 1;
      return { body: goodSession({ access_token: `access-${refreshes + 1}`, refresh_token: `refresh-${refreshes + 1}` }) };
    });
    await signIn("a@b.c", "pw", CONFIG, NOW);

    const expiring = NOW + 3_600_000 - 1_000;
    const tokens = await Promise.all([
      accessToken(CONFIG, expiring),
      accessToken(CONFIG, expiring),
      accessToken(CONFIG, expiring),
    ]);

    expect(refreshes, "the refresh token was rotated more than once").toBe(1);
    expect(new Set(tokens).size, "callers disagreed about the current token").toBe(1);
    expect(tokens[0]).toBe("access-2");
  });

  it("signs out when the refresh token is spent, instead of failing for ever", async () => {
    stubFetch((call) =>
      call.url.includes("refresh_token")
        ? { status: 400, body: { error_description: "Invalid Refresh Token" } }
        : { body: goodSession() }
    );
    await signIn("a@b.c", "pw", CONFIG, NOW);

    expect(await accessToken(CONFIG, NOW + 3_600_000)).toBeNull();
    // Signed out, so the UI shows a sign-in form rather than an error on every
    // subsequent call.
    expect(currentSession()).toBeNull();
  });

  it("returns null when signed out, without calling anything", async () => {
    stubFetch(() => ({ body: goodSession() }));
    expect(await accessToken(CONFIG, NOW)).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe("the config", () => {
  it("knows whether there is anything to connect to", () => {
    expect(onlineAvailable(CONFIG)).toBe(true);
    expect(onlineAvailable({ ...CONFIG, serverUrl: "" })).toBe(false);
    expect(onlineAvailable({ ...CONFIG, supabaseUrl: "" })).toBe(false);
    expect(onlineAvailable({ ...CONFIG, supabaseAnonKey: "" })).toBe(false);
  });

  it("builds websocket URLs, not https ones", () => {
    // `new WebSocket("https://…")` throws a SyntaxError in every browser, and
    // every other URL in the config file is an https one.
    expect(matchSocketUrl("m1", "tok", CONFIG)).toBe("wss://server.invalid/match/m1/socket?access_token=tok");
    expect(queueSocketUrl("tok", CONFIG)).toBe("wss://server.invalid/queue/casual/socket?access_token=tok");
    expect(matchSocketUrl("m", "t", { ...CONFIG, serverUrl: "http://localhost:8787" })).toContain("ws://localhost:8787");
  });

  it("escapes what it puts in the URL", () => {
    expect(matchSocketUrl("a/b?c", "to ken", CONFIG)).toBe("wss://server.invalid/match/a%2Fb%3Fc/socket?access_token=to%20ken");
  });

  it("ships a real project, and an anon key rather than a service key", () => {
    // The anon key is public by design. A `service_role` key in a client bundle
    // would be a total compromise of the database, so this is worth pinning.
    expect(onlineAvailable()).toBe(true);
    const payload = JSON.parse(atob(ONLINE.supabaseAnonKey.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as {
      role: string;
      ref: string;
    };
    expect(payload.role, "a non-anon key is committed in src/config.ts").toBe("anon");
    expect(ONLINE.supabaseUrl).toContain(payload.ref);
  });
});
