/**
 * The decision that can destroy a collection.
 *
 * `decideSync` is four booleans wide, so it is tested as a truth table rather
 * than by example. Every row is here, including the ones that look obvious,
 * because the failure mode is not "the wrong branch is hard to reach" — it is
 * "somebody adds a case later and the branch order changes underneath the
 * obvious ones".
 */

import { describe, expect, it } from "vitest";
import {
  SAVE_SECTIONS,
  SECTION_BYTE_CAP,
  SYNC_DEBOUNCE_MS,
  canonicalJson,
  checksumOf,
  decideSync,
  isSaveSection,
  type ManifestEntry,
  type SyncInputs,
} from "../src/save/cloudSync";

const remoteAt = (revision: number, checksum: string): ManifestEntry => ({
  section: "profile",
  version: 1,
  revision,
  updatedAt: "2026-07-30T00:00:00.000Z",
  checksum,
  bytes: 1024,
});

const inputs = (over: Partial<SyncInputs>): SyncInputs => ({
  localChecksum: "local",
  localIsDefault: false,
  remote: null,
  link: null,
  ...over,
});

describe("decideSync", () => {
  it("does nothing when neither side has a save", () => {
    expect(decideSync(inputs({ localIsDefault: true, remote: null, link: null }))).toBe("in-sync");
  });

  it("uploads a local save when the cloud holds nothing", () => {
    expect(decideSync(inputs({ localIsDefault: false, remote: null }))).toBe("push");
  });

  it("re-uploads when the cloud copy has vanished under a linked device", () => {
    // The account's server data was deleted. The local save is still the
    // player's, so it goes back up rather than being treated as stale.
    expect(decideSync(inputs({ remote: null, link: { revision: 4, checksum: "local" } }))).toBe("push");
  });

  it("treats identical content as in sync no matter what the revisions say", () => {
    /**
     * The important half of this test is the link: revision 1 against a server
     * at revision 9 is normally a pull, and it is *not* one when the bytes are
     * the same. Without this branch every device that reached the same state
     * independently would trade downloads forever.
     */
    const same = decideSync(
      inputs({
        localChecksum: "abc",
        remote: remoteAt(9, "abc"),
        link: { revision: 1, checksum: "abc" },
      })
    );
    expect(same).toBe("in-sync");
  });

  it("pulls into a browser that has never been played on", () => {
    expect(decideSync(inputs({ localIsDefault: true, remote: remoteAt(3, "cloud") }))).toBe("pull");
  });

  it("asks when both sides hold real saves and nobody has chosen", () => {
    expect(decideSync(inputs({ localChecksum: "mine", remote: remoteAt(3, "theirs"), link: null }))).toBe("adopt");
  });

  it("does nothing when neither side has moved since the last agreement", () => {
    expect(
      decideSync(
        inputs({
          localChecksum: "same",
          remote: remoteAt(5, "other"),
          link: { revision: 5, checksum: "same" },
        })
      )
    ).toBe("in-sync");
  });

  it("pushes when only this device moved", () => {
    expect(
      decideSync(
        inputs({
          localChecksum: "changed",
          remote: remoteAt(5, "old"),
          link: { revision: 5, checksum: "old" },
        })
      )
    ).toBe("push");
  });

  it("pulls when only the server moved", () => {
    expect(
      decideSync(
        inputs({
          localChecksum: "unchanged",
          remote: remoteAt(6, "newer"),
          link: { revision: 5, checksum: "unchanged" },
        })
      )
    ).toBe("pull");
  });

  it("refuses to pick a winner when both moved", () => {
    /**
     * This is the row the whole module exists for. §12.2 nominally asks for
     * last-writer-wins, which resolves this silently — and silently is how an
     * afternoon of offline play disappears because the other device happened to
     * sync second.
     */
    expect(
      decideSync(
        inputs({
          localChecksum: "mine",
          remote: remoteAt(6, "theirs"),
          link: { revision: 5, checksum: "was" },
        })
      )
    ).toBe("conflict");
  });

  it("never reports a conflict for a device that has nothing of its own", () => {
    // localIsDefault outranks the link: a save that was wiped locally should
    // come back from the cloud, not raise a question.
    expect(
      decideSync(
        inputs({
          localIsDefault: true,
          localChecksum: "empty",
          remote: remoteAt(9, "full"),
          link: { revision: 2, checksum: "was" },
        })
      )
    ).toBe("pull");
  });
});

describe("canonicalJson", () => {
  it("does not care what order the keys were written in", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it("sorts at every depth, not just the top", () => {
    expect(canonicalJson({ outer: { z: 1, a: 2 } })).toBe('{"outer":{"a":2,"z":1}}');
  });

  it("keeps array order, because in a save the order is the data", () => {
    // A deck is a list of cards in an order the player chose; sorting it would
    // make two different decks hash the same.
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalJson([1, 2, 3])).not.toBe(canonicalJson([3, 2, 1]));
  });

  it("drops undefined members, matching what actually gets uploaded", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(JSON.parse(JSON.stringify({ a: 1, b: undefined }))).toEqual({ a: 1 });
  });

  it("keeps null, which is a value and not an absence", () => {
    // `hypeWave.pass: null` means "no live pass". Dropping it would let
    // fillDefaults invent a season nobody played.
    expect(canonicalJson({ pass: null })).toBe('{"pass":null}');
  });
});

describe("checksumOf", () => {
  it("agrees across key orders and disagrees across contents", async () => {
    const one = await checksumOf({ clout: 10, cards: ["a", "b"] });
    const reordered = await checksumOf({ cards: ["a", "b"], clout: 10 });
    const different = await checksumOf({ clout: 11, cards: ["a", "b"] });

    expect(one).toBe(reordered);
    expect(one).not.toBe(different);
    expect(one).toMatch(/^[0-9a-f]{64}$/);
  });

  it("notices a reordered deck", async () => {
    const a = await checksumOf({ deck: ["x", "y"] });
    const b = await checksumOf({ deck: ["y", "x"] });
    expect(a).not.toBe(b);
  });
});

describe("sections", () => {
  it("names the stores that actually exist", () => {
    // If a sixth store is added, this fails and whoever added it has to decide
    // whether it syncs. That is the point: silence would mean it does not.
    expect([...SAVE_SECTIONS]).toEqual(["profile", "settings", "story", "gauntlet", "doomscroll"]);
  });

  it("rejects anything else, including near misses", () => {
    expect(isSaveSection("profile")).toBe(true);
    expect(isSaveSection("collection")).toBe(false);
    expect(isSaveSection("")).toBe(false);
    expect(isSaveSection(null)).toBe(false);
  });
});

describe("caps", () => {
  it("debounces cloud writes far more slowly than local ones", () => {
    /**
     * The local store writes 250 ms after a change because that write is free.
     * A cloud write is a row against a 100,000-per-day allowance shared by
     * every player of the game, so the two numbers should not be close.
     */
    expect(SYNC_DEBOUNCE_MS).toBeGreaterThanOrEqual(100 * 250);
    expect(SECTION_BYTE_CAP).toBe(512 * 1024);
  });
});
