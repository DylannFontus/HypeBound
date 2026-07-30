/**
 * The save layer's durability — known gap 25.
 *
 * Two failure modes, one of which had never fired and one of which had been
 * worked around twelve times.
 *
 * **A version bump was a whole-save wipe.** `storage.ts` returned `defaults()`
 * whenever a stored version did not match and the store carried no `migrate`.
 * The profile store was version 1 with no migration, so the day somebody bumped
 * it, every existing account would silently have lost its collection, its
 * decks, its Mastery and its cosmetics — a bug in a line nobody touched,
 * triggered by a line somebody did. Nothing had ever migrated, so nothing had
 * ever gone wrong, which is exactly the shape of a landmine.
 *
 * **Defaults merged one level deep.** A field added *inside* a saved object was
 * never back-filled, which is why twelve fields of `PlayerProfile` carry the
 * same warning comment and are read defensively everywhere. Reading defensively
 * works; remembering to, on every future field, is the part that does not.
 */

import { describe, expect, it } from "vitest";
import { createStore, fillDefaults } from "../src/save/storage";
import { PROFILE_VERSION, migrateProfile, profileStore } from "../src/save/profile";
import { settingsStore } from "../src/save/settings";

// ---------------------------------------------------------------------------

describe("filling defaults", () => {
  it("fills a field added inside a saved object", () => {
    const defaults = { outer: { kept: 1, added: "new" }, top: true };
    const saved = { outer: { kept: 9 } };
    expect(fillDefaults(defaults, saved)).toEqual({ outer: { kept: 9, added: "new" }, top: true });
  });

  it("fills at any depth, not just the second", () => {
    const defaults = { a: { b: { c: { kept: 0, added: 7 } } } };
    const saved = { a: { b: { c: { kept: 3 } } } };
    expect(fillDefaults(defaults, saved)).toEqual({ a: { b: { c: { kept: 3, added: 7 } } } });
  });

  /**
   * A saved list is the list. Merging element-wise would resurrect deleted
   * history and hand out entries nobody earned — the worst possible direction
   * for a bug in a save layer to point.
   */
  it("never merges an array", () => {
    expect(fillDefaults({ log: [1, 2, 3] }, { log: [] })).toEqual({ log: [] });
    expect(fillDefaults({ log: ["a", "b"] }, { log: ["z"] })).toEqual({ log: ["z"] });
  });

  /**
   * `null` is a value, not an absence. `hypeWave.pass: null` means "no live
   * pass"; a merge that could not tell those apart would hand somebody a season
   * they never played.
   */
  it("never replaces a saved null with a default", () => {
    expect(fillDefaults({ pass: { tier: 1 } }, { pass: null })).toEqual({ pass: null });
    expect(fillDefaults({ rng: [1, 2, 3, 4] }, { rng: null })).toEqual({ rng: null });
  });

  it("keeps a saved key the defaults have never heard of", () => {
    expect(fillDefaults({ known: 1 }, { known: 1, fromAFutureBuild: "keep me" })).toEqual({
      known: 1,
      fromAFutureBuild: "keep me",
    });
  });

  /**
   * Map values are taken whole. `collection`, `banners.state` and
   * `mastery.faction` all default to `{}`, so there is no template to fill a
   * per-card or per-banner entry from — those stay defensively read, honestly.
   */
  it("does not invent structure inside a map's values", () => {
    const filled = fillDefaults({ state: {} as Record<string, unknown> }, { state: { b1: { pulls: 4 } } });
    expect(filled).toEqual({ state: { b1: { pulls: 4 } } });
  });

  it("takes the saved value when the shapes disagree, and the default when nothing was saved", () => {
    expect(fillDefaults({ x: { deep: 1 } }, { x: 5 })).toEqual({ x: 5 });
    expect(fillDefaults({ x: 1, y: 2 }, {})).toEqual({ x: 1, y: 2 });
    expect(fillDefaults({ x: 1 }, undefined)).toEqual({ x: 1 });
  });
});

// ---------------------------------------------------------------------------

describe("a version bump", () => {
  interface Shape {
    earned: number;
    nested: { kept: string; addedLater: number };
    list: string[];
  }
  const defaults = (): Shape => ({ earned: 0, nested: { kept: "", addedLater: 42 }, list: [] });

  /**
   * The regression this closes, end to end: write at version 1, read at version
   * 2 with no migration, and keep everything.
   *
   * Before, this returned `defaults()` — `earned` back to 0 and the list empty.
   */
  it("carries a save forward instead of throwing it away", () => {
    const key = `durability-${Math.random().toString(36).slice(2)}`;
    const v1 = createStore<Shape>({ key, version: 1, defaults });
    v1.update((draft) => {
      draft.earned = 1200;
      draft.nested.kept = "a thing the player did";
      draft.list = ["one", "two"];
    });
    v1.flush();

    const v2 = createStore<Shape>({ key, version: 2, defaults });
    expect(v2.get().earned).toBe(1200);
    expect(v2.get().nested.kept).toBe("a thing the player did");
    expect(v2.get().list).toEqual(["one", "two"]);
    // and the field the new version added arrives with its default, not undefined
    expect(v2.get().nested.addedLater).toBe(42);
  });

  it("runs a migration when one is given, and still back-fills after it", () => {
    const key = `durability-${Math.random().toString(36).slice(2)}`;
    const v1 = createStore<Shape>({ key, version: 1, defaults });
    v1.update((draft) => {
      draft.earned = 10;
    });
    v1.flush();

    const v2 = createStore<Shape>({
      key,
      version: 2,
      defaults,
      // the units changed: what was tens is now hundreds
      migrate: (data) => ({ ...(data as Shape), earned: (data as Shape).earned * 100 }),
    });
    expect(v2.get().earned).toBe(1000);
    expect(v2.get().nested.addedLater).toBe(42);
  });

  it("still starts fresh on a payload that is not a save at all", () => {
    const key = `durability-${Math.random().toString(36).slice(2)}`;
    const store = createStore<Shape>({ key, version: 1, defaults });
    store.update((draft) => {
      draft.earned = 5;
    });
    store.flush();
    expect(createStore<Shape>({ key, version: 1, defaults }).get().earned).toBe(5);

    // an envelope with no version is not ours
    const junk = createStore<Shape>({ key: `${key}-junk`, version: 1, defaults });
    expect(junk.get()).toEqual(defaults());
  });
});

// ---------------------------------------------------------------------------

describe("the profile's migration chain", () => {
  it("exists at all — this is the whole of gap 25", () => {
    expect(profileStore["options"].migrate, "the profile store has no migrate").toBeTypeOf("function");
    expect(settingsStore["options"].migrate).toBeTypeOf("function");
  });

  /**
   * There are no steps yet, because nothing has ever migrated. The chain still
   * has to be lossless, or the first bump is the one that finds out.
   */
  it("carries every field of an older save forward untouched", () => {
    const old = {
      clout: 4321,
      collection: { "idols-lumi-starcall": 2 },
      decks: [{ name: "mine", leaderCardId: "x", cards: [] }],
      mastery: { faction: { "neon-idols": 900 } },
      cosmetics: { owned: ["title:award:stormfront"] },
    };
    const carried = migrateProfile(old, PROFILE_VERSION - 1) as unknown as Record<string, unknown>;
    expect(carried["clout"]).toBe(4321);
    expect(carried["collection"]).toEqual({ "idols-lumi-starcall": 2 });
    expect(carried["mastery"]).toEqual({ faction: { "neon-idols": 900 } });
    expect(carried["cosmetics"]).toEqual({ owned: ["title:award:stormfront"] });
  });

  /**
   * A save from a *newer* build. A downgrade cannot be migrated in any honest
   * sense, and keeping the data is still strictly better than deleting it: a
   * reader either understands a field or leaves it alone.
   */
  it("keeps a payload from a future version rather than deleting it", () => {
    const carried = migrateProfile({ clout: 7, somethingNew: true }, PROFILE_VERSION + 3) as unknown as Record<
      string,
      unknown
    >;
    expect(carried["clout"]).toBe(7);
    expect(carried["somethingNew"]).toBe(true);
  });

  it("survives a payload that is not an object", () => {
    expect(migrateProfile(null, 1)).toEqual({});
    expect(migrateProfile("nonsense", 1)).toEqual({});
  });

  /**
   * The realistic case: a save written before the last several blocks existed.
   * Everything earned survives, and every field added since arrives with its
   * default rather than as `undefined` — which is what the twelve "read it
   * defensively" comments were guarding against.
   */
  it("loads a save written before the inbox, news, banners and the AI cap existed", () => {
    const before = profileStore.get();
    const ancient = {
      displayName: "Early Adopter",
      clout: 999,
      shards: 120,
      collection: { "idols-lumi-starcall": 2 },
      stats: { matchesPlayed: 40, wins: 25, losses: 15, draws: 0 },
      mastery: { faction: { "neon-idols": 5000 }, leader: {}, affinity: {} },
    };
    const loaded = fillDefaults(structuredClone(before), migrateProfile(ancient, 1));

    expect(loaded.clout).toBe(999);
    expect(loaded.stats.wins).toBe(25);
    expect(loaded.mastery.faction["neon-idols"]).toBe(5000);
    // added since, and back-filled rather than left undefined
    expect(loaded.mastery.claimed).toEqual([]);
    expect(loaded.stats.legendariesCrafted).toBe(0);
    expect(loaded.inbox).toEqual({ read: [], claimed: [], deleted: [] });
    expect(loaded.news).toEqual({ read: [], seenVersions: [] });
    expect(loaded.aiClout).toEqual({ day: "", spent: 0 });
    expect(loaded.banners.tokens).toBe(0);
    expect(loaded.hypeWave.pass).toBeNull();
  });
});
