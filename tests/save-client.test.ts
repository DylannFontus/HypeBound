/**
 * The save client, against a fetch that does what it is told.
 *
 * Every outcome the sync layer branches on is produced here deliberately,
 * because in production most of them are rare and one of them — a corrupt
 * download — should never happen at all. A branch that only ever runs in an
 * emergency is a branch that has never run.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { SaveClient } from "../src/net/saveClient";
import { SECTION_BYTE_CAP, canonicalJson, checksumOf } from "../src/save/cloudSync";
import type { OnlineConfig } from "../src/config";

const CONFIG: OnlineConfig = {
  serverUrl: "https://server.test",
  supabaseUrl: "https://auth.test",
  supabaseAnonKey: "anon",
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A client with a scripted fetch and a token that always exists. */
function clientWith(fetchImpl: typeof fetch, token: string | null = "token") {
  return new SaveClient({ config: CONFIG, fetchImpl, token: async () => token });
}

describe("signed out", () => {
  it("does not call the network at all", async () => {
    const fetchImpl = vi.fn();
    const client = clientWith(fetchImpl as unknown as typeof fetch, null);

    expect((await client.manifest()).kind).toBe("signed-out");
    expect((await client.pull("profile")).kind).toBe("signed-out");
    expect((await client.push("profile", 1, {}, 0)).kind).toBe("signed-out");
    expect(await client.deleteAll()).toBe(false);

    // The assertion that matters: not merely that it reported signed-out, but
    // that nothing left the machine to find that out.
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("manifest", () => {
  it("sends the bearer token and returns the sections", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)?.authorization).toBe("Bearer token");
      return json({ sections: [{ section: "profile", revision: 2 }] });
    });

    const result = await clientWith(fetchImpl as unknown as typeof fetch).manifest();
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.sections).toHaveLength(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://server.test/me/saves");
  });

  it("treats an empty body as no sections rather than as an error", async () => {
    const result = await clientWith((async () => json({})) as unknown as typeof fetch).manifest();
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.sections).toEqual([]);
  });

  it("reports a network failure without throwing", async () => {
    const result = await clientWith((async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch).manifest();
    expect(result.kind).toBe("error");
  });
});

describe("pull", () => {
  it("returns the parsed payload when the checksum agrees", async () => {
    const data = { clout: 7, decks: [] };
    const payload = canonicalJson(data);
    const checksum = await checksumOf(data);

    const result = await clientWith((async () =>
      json({ section: "profile", version: 1, revision: 4, updatedAt: "x", checksum, bytes: payload.length, payload })) as unknown as typeof fetch).pull(
      "profile"
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.data).toEqual(data);
    expect(result.entry.revision).toBe(4);
    // The payload must not travel on as part of the metadata.
    expect("payload" in result.entry).toBe(false);
  });

  it("reports absence as absence, not as an error", async () => {
    const result = await clientWith((async () => json({ error: "none" }, 404)) as unknown as typeof fetch).pull("profile");
    expect(result.kind).toBe("absent");
  });

  it("refuses a payload that does not hash to its own metadata", async () => {
    /**
     * The case this whole check exists for. The body is valid JSON and would
     * parse cleanly into a smaller collection, which is exactly why a parse
     * cannot be the test.
     */
    const result = await clientWith((async () =>
      json({ checksum: "0".repeat(64), payload: '{"clout":7}' })) as unknown as typeof fetch).pull("profile");

    expect(result.kind).toBe("corrupt");
    if (result.kind !== "corrupt") return;
    expect(result.actual).not.toBe(result.expected);
  });

  it("refuses a payload that is not JSON even when the checksum agrees", async () => {
    const payload = "not json at all";
    const checksum = await sha256(payload);
    const result = await clientWith((async () => json({ checksum, payload })) as unknown as typeof fetch).pull("profile");
    expect(result.kind).toBe("corrupt");
  });

  it("reports a response with no payload as an error", async () => {
    const result = await clientWith((async () => json({ checksum: "x" })) as unknown as typeof fetch).pull("profile");
    expect(result.kind).toBe("error");
  });
});

describe("push", () => {
  it("sends canonical text, a matching checksum and the If-Match header", async () => {
    const seen: { body?: string; headers?: Record<string, string> } = {};
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      seen.body = init?.body as string;
      seen.headers = init?.headers as Record<string, string>;
      return json({ section: "profile", revision: 5 });
    };

    // Keys deliberately out of order, so the canonical form is observably
    // different from what was passed in.
    const result = await clientWith(fetchImpl as unknown as typeof fetch).push("profile", 3, { b: 1, a: 2 }, 4);

    expect(result.kind).toBe("ok");
    expect(seen.headers?.["If-Match"]).toBe("4");
    const body = JSON.parse(seen.body ?? "{}") as { payload: string; checksum: string; version: number };
    expect(body.payload).toBe('{"a":2,"b":1}');
    expect(body.version).toBe(3);
    expect(body.checksum).toBe(await checksumOf({ a: 2, b: 1 }));
  });

  it("sends If-Match 0 as the literal string, not as an omitted header", async () => {
    /**
     * `String(0)` is `"0"`, but a truthiness check somewhere in the chain would
     * turn it into a missing header — and a missing `If-Match` is a 428 that
     * looks like a server bug rather than a client one.
     */
    let header: string | undefined;
    await clientWith((async (_u: unknown, init?: RequestInit) => {
      header = (init?.headers as Record<string, string>)["If-Match"];
      return json({});
    }) as unknown as typeof fetch).push("profile", 1, {}, 0);
    expect(header).toBe("0");
  });

  it("reports a 409 as a conflict and carries what is actually there", async () => {
    const result = await clientWith((async () =>
      json({ error: "another device wrote first", current: { section: "profile", revision: 9 } }, 409)) as unknown as typeof fetch).push(
      "profile",
      1,
      {},
      3
    );

    expect(result.kind).toBe("conflict");
    if (result.kind !== "conflict") return;
    expect(result.current?.revision).toBe(9);
  });

  it("survives a 409 with an unreadable body", async () => {
    const result = await clientWith((async () => new Response("nope", { status: 409 })) as unknown as typeof fetch).push(
      "profile",
      1,
      {},
      3
    );
    expect(result.kind).toBe("conflict");
    if (result.kind !== "conflict") return;
    expect(result.current).toBeNull();
  });

  it("refuses an oversized save before spending a request on it", async () => {
    const fetchImpl = vi.fn();
    const huge = { blob: "x".repeat(SECTION_BYTE_CAP) };
    const result = await clientWith(fetchImpl as unknown as typeof fetch).push("profile", 1, huge, 0);

    expect(result.kind).toBe("too-large");
    // The free plan allows 100,000 row writes a day. Burning one to be told no
    // is a waste the client can avoid, and this proves it does.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("measures the cap in bytes, not characters", async () => {
    /**
     * A payload of emoji is four bytes each and two characters each. Measured
     * in characters this passes; measured in bytes it does not, and the server
     * would refuse it after the request had already been made.
     */
    const fetchImpl = vi.fn(async () => json({}));
    const justUnderInChars = { blob: "🔥".repeat(SECTION_BYTE_CAP / 4) };
    const result = await clientWith(fetchImpl as unknown as typeof fetch).push("profile", 1, justUnderInChars, 0);

    expect(canonicalJson(justUnderInChars).length).toBeLessThan(SECTION_BYTE_CAP);
    expect(result.kind).toBe("too-large");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("deleteAll", () => {
  it("reports success only when the server says so", async () => {
    expect(await clientWith((async () => json({ ok: true })) as unknown as typeof fetch).deleteAll()).toBe(true);
    expect(await clientWith((async () => json({}, 500)) as unknown as typeof fetch).deleteAll()).toBe(false);
    expect(
      await clientWith((async () => {
        throw new Error("offline");
      }) as unknown as typeof fetch).deleteAll()
    ).toBe(false);
  });
});

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
