/**
 * When a save may be overwritten.
 *
 * `applyPut` is the only code in the project that can destroy a player's
 * collection, so it is tested for what it refuses rather than for what it
 * allows. The check order is asserted too: a request that is both too large and
 * wrongly checksummed must be refused for the reason that costs least to
 * establish, or a client debugging a 400 will go looking in the wrong place.
 */

import { describe, expect, it } from "vitest";
import { SECTION_BYTE_CAP, applyPut, manifestOf, sha256Hex, utf8Bytes, type StoredSection } from "../server/src/saves/store";
import { canonicalJson, checksumOf } from "../src/save/cloudSync";

const NOW = Date.parse("2026-07-30T12:00:00.000Z");

const stored = (over: Partial<StoredSection> = {}): StoredSection => ({
  version: 1,
  revision: 3,
  updatedAt: "2026-07-29T00:00:00.000Z",
  checksum: "old",
  bytes: 10,
  payload: '{"a":1}',
  ...over,
});

/** A request whose claimed checksum is correct, so tests opt in to breaking it. */
async function goodRequest(payload: string, ifMatch: number | null, version = 1) {
  return {
    request: { version, payload, claimedChecksum: await sha256Hex(payload), ifMatch },
    actual: await sha256Hex(payload),
  };
}

describe("applyPut", () => {
  it("accepts a first write and starts revisions at 1", async () => {
    const { request, actual } = await goodRequest('{"clout":0}', 0);
    const outcome = applyPut(null, request, actual, NOW);

    expect(outcome.status).toBe(200);
    if (outcome.status !== 200) return;
    expect(outcome.entry.revision).toBe(1);
    expect(outcome.entry.updatedAt).toBe("2026-07-30T12:00:00.000Z");
    expect(outcome.entry.payload).toBe('{"clout":0}');
  });

  it("takes its timestamp from the clock it is given, not from the client", async () => {
    const { request, actual } = await goodRequest('{"a":1}', 0);
    const outcome = applyPut(null, request, actual, Date.parse("2001-01-01T00:00:00.000Z"));
    if (outcome.status !== 200) throw new Error("expected 200");
    expect(outcome.entry.updatedAt).toBe("2001-01-01T00:00:00.000Z");
  });

  it("advances the revision by exactly one", async () => {
    const { request, actual } = await goodRequest('{"a":2}', 3);
    const outcome = applyPut(stored({ revision: 3 }), request, actual, NOW);
    if (outcome.status !== 200) throw new Error("expected 200");
    expect(outcome.entry.revision).toBe(4);
  });

  it("refuses a write that expects the wrong revision, and says what is there", async () => {
    const current = stored({ revision: 7 });
    const { request, actual } = await goodRequest('{"a":2}', 3);
    const outcome = applyPut(current, request, actual, NOW);

    expect(outcome.status).toBe(409);
    if (outcome.status !== 409) return;
    expect(outcome.current?.revision).toBe(7);
  });

  it("refuses a first-write claim when something is already there", async () => {
    // The dangerous direction: a device that has forgotten it ever synced would
    // otherwise silently replace the save it forgot about.
    const { request, actual } = await goodRequest('{"a":2}', 0);
    expect(applyPut(stored(), request, actual, NOW).status).toBe(409);
  });

  it("refuses an update claim when nothing is there", async () => {
    const { request, actual } = await goodRequest('{"a":2}', 5);
    const outcome = applyPut(null, request, actual, NOW);
    expect(outcome.status).toBe(409);
    if (outcome.status !== 409) return;
    expect(outcome.current).toBeNull();
  });

  it("refuses a blind write outright", async () => {
    /**
     * The safety property in one assertion. A client that does not say what it
     * expects to replace cannot be told it was wrong.
     */
    const { request, actual } = await goodRequest('{"a":2}', null);
    expect(applyPut(stored(), request, actual, NOW).status).toBe(428);
  });

  it("refuses a payload over the cap", async () => {
    const huge = `"${"x".repeat(SECTION_BYTE_CAP + 1)}"`;
    const { request, actual } = await goodRequest(huge, 0);
    const outcome = applyPut(null, request, actual, NOW);

    expect(outcome.status).toBe(413);
    if (outcome.status !== 413) return;
    expect(outcome.bytes).toBeGreaterThan(outcome.cap);
  });

  it("checks the size before the checksum", async () => {
    /**
     * Not pedantry. Hashing runs before this function is called, so the caller
     * has already paid for it — but the *reason* returned decides where a
     * developer looks. "Too large" is actionable; "checksum mismatch" on a
     * truncated oversize upload sends them to the wrong module.
     */
    const huge = `"${"x".repeat(SECTION_BYTE_CAP + 1)}"`;
    const outcome = applyPut(null, { version: 1, payload: huge, claimedChecksum: "nonsense", ifMatch: 0 }, "actual", NOW);
    expect(outcome.status).toBe(413);
  });

  it("refuses bytes that do not hash to what was claimed", async () => {
    const outcome = applyPut(null, { version: 1, payload: '{"a":1}', claimedChecksum: "wrong", ifMatch: 0 }, "right", NOW);
    expect(outcome.status).toBe(400);
    if (outcome.status !== 400) return;
    expect(outcome.reason).toMatch(/checksum/);
  });

  it("refuses a version that is not a positive integer", async () => {
    for (const version of [0, -1, 1.5, Number.NaN]) {
      const { request, actual } = await goodRequest('{"a":1}', 0, version);
      expect(applyPut(null, request, actual, NOW).status, `version ${version}`).toBe(400);
    }
  });

  it("accepts version 1 and above", async () => {
    // The other half of the previous test: a guard that refuses everything
    // passes a test that only feeds it bad input.
    for (const version of [1, 2, 99]) {
      const { request, actual } = await goodRequest('{"a":1}', 0, version);
      expect(applyPut(null, request, actual, NOW).status, `version ${version}`).toBe(200);
    }
  });
});

describe("utf8Bytes", () => {
  it("counts bytes, not UTF-16 code units", () => {
    // A deck called "🔥🔥🔥" is 6 code units and 12 bytes. A cap measured in the
    // wrong unit is not a cap.
    expect("🔥".length).toBe(2);
    expect(utf8Bytes("🔥")).toBe(4);
    expect(utf8Bytes("é")).toBe(2);
    expect(utf8Bytes("abc")).toBe(3);
  });
});

describe("manifestOf", () => {
  it("carries everything except the payload", () => {
    const entry = manifestOf("profile", stored({ payload: "SECRET" }));
    expect(entry).toEqual({
      section: "profile",
      version: 1,
      revision: 3,
      updatedAt: "2026-07-29T00:00:00.000Z",
      checksum: "old",
      bytes: 10,
    });
    expect(JSON.stringify(entry)).not.toContain("SECRET");
  });
});

describe("the two checksum implementations", () => {
  it("agree, or every upload would be refused", async () => {
    /**
     * The client hashes with `checksumOf` and the server re-derives with
     * `sha256Hex`. If they ever disagreed, every single push would come back
     * 400 and the cause would look like a network problem. They are separate
     * functions because one takes a value and the other takes text, so this
     * asserts the seam between them rather than assuming it.
     */
    const value = { clout: 12, decks: [{ name: "🔥", cards: ["a", "b"] }], pass: null };
    expect(await sha256Hex(canonicalJson(value))).toBe(await checksumOf(value));
  });
});
