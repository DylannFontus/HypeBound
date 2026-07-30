/**
 * The Remix Queue — `09-game-modes.md` §12, "This Week's Meta".
 *
 * The mode is a rotation plus a config assembler, so these are mostly about two
 * things that would be invisible until somebody played a match and lost to them:
 *
 * **The rule applies to both players.** A global modifier patched onto one
 * leader is a house rule only one side plays by. It is the single most important
 * property here and the easiest to get wrong, because patching one leader looks
 * exactly like patching two until you read whose id it was.
 *
 * **A deferred modifier does nothing at all.** Four of §12.1's ten need engine
 * work and stay in the data so the launch table is not quietly rewritten. A
 * deferral that still carried rules would apply while claiming not to, which is
 * worse than either shipping it or removing it.
 *
 * Every test passes its own `now`. The rotation is a function of the calendar,
 * and a suite that only passes during one week is a suite that fails during the
 * next one for a reason nobody will remember.
 */

import { describe, expect, it } from "vitest";
import { getContent, collectibleCards } from "../src/engine/content";
import {
  DEFERRED_REMIX,
  REMIX_MODE,
  allModifiers,
  checkRemixData,
  deferredModifiers,
  modifierById,
  modifierForWeek,
  playableModifiers,
  remixData,
  remixMatchConfig,
  remixQuest,
  weekEnd,
} from "../src/game/remix";
import { weekIndex } from "../src/game/weeklyBoss";

const content = getContent();
const WEEK = 7 * 24 * 60 * 60 * 1000;
const LEADERS = ["idols-lumi-starcall", "goth-leader-morvina-vane"];

// ---------------------------------------------------------------------------

describe("the modifier data", () => {
  it("loads and validates", () => {
    expect(checkRemixData(content)).toEqual([]);
  });

  /**
   * §12.1 publishes a ten-modifier launch rotation. Six ship; four need engine
   * work. All ten stay in the file — dropping the four would quietly rewrite the
   * table a reader of the design expects to find.
   */
  it("keeps the whole launch table, playable or not", () => {
    expect(allModifiers().length).toBe(10);
    expect(playableModifiers().length).toBeGreaterThan(0);
    expect(playableModifiers().length).toBeLessThan(allModifiers().length);
  });

  it("gives every deferred modifier a real reason and no rules", () => {
    for (const modifier of allModifiers()) {
      if (!modifier.deferred) continue;
      expect(modifier.deferred.trim().length, `${modifier.id} is deferred without a reason`).toBeGreaterThan(40);
      expect(modifier.balance, `${modifier.id} is deferred but carries balance overrides`).toBeUndefined();
      expect(modifier.passive, `${modifier.id} is deferred but carries a passive`).toBeUndefined();
      expect(modifier.costCeiling, `${modifier.id} is deferred but carries a cost ceiling`).toBeUndefined();
    }
  });

  it("gives every playable modifier something to actually do", () => {
    for (const modifier of playableModifiers()) {
      const hasRules =
        Boolean(modifier.balance) || Boolean(modifier.passive?.length) || modifier.costCeiling !== undefined;
      expect(hasRules, `${modifier.id} is playable but changes nothing`).toBe(true);
    }
  });

  it("exposes the deferred reasons the screen prints", () => {
    const deferred = deferredModifiers();
    expect(deferred.size).toBe(allModifiers().filter((m) => m.deferred).length);
    for (const [, reason] of deferred) expect(reason.length).toBeGreaterThan(40);
    for (const [, reason] of DEFERRED_REMIX) expect(reason.length).toBeGreaterThan(40);
  });

  /**
   * A balance key that is not a real dotted path is a modifier that silently
   * changes nothing — `balanceOverrides` is a bag of strings, so a typo does not
   * fail anywhere else.
   */
  it("only names balance paths that exist in the balance data", () => {
    const flatten = (value: unknown, prefix = ""): string[] =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) =>
            key.startsWith("_") ? [] : flatten(entry, `${prefix}${key}.`)
          )
        : [prefix.slice(0, -1)];
    const known = new Set(flatten(content.balance));

    for (const modifier of playableModifiers()) {
      for (const key of Object.keys(modifier.balance ?? {})) {
        expect(known.has(key), `${modifier.id} overrides "${key}", which is not a balance path`).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------

describe("the weekly rotation", () => {
  it("rotates only over the playable modifiers", () => {
    const playable = new Set(playableModifiers().map((modifier) => modifier.id));
    for (let week = 0; week < 20; week++) {
      const modifier = modifierForWeek(week * WEEK);
      expect(playable.has(modifier.id), `week ${week} dealt a modifier that is not playable`).toBe(true);
    }
  });

  it("deals every playable modifier across a full cycle", () => {
    const seen = new Set<string>();
    for (let week = 0; week < playableModifiers().length; week++) {
      seen.add(modifierForWeek(week * WEEK).id);
    }
    expect(seen.size, "the rotation skips a modifier").toBe(playableModifiers().length);
  });

  it("holds the same rule all week and changes at the boundary", () => {
    const start = weekIndex(Date.now()) * WEEK;
    expect(modifierForWeek(start).id).toBe(modifierForWeek(start + WEEK - 1).id);
    expect(modifierForWeek(start + WEEK).id).not.toBe(modifierForWeek(start).id);
  });

  it("ends the week where the next one begins", () => {
    const now = Date.now();
    expect(weekEnd(now)).toBe((weekIndex(now) + 1) * WEEK);
    expect(weekEnd(now)).toBeGreaterThan(now);
  });

  /** The rotation ticks with the Weekly Boss, so the two never disagree by a day. */
  it("turns over on the same boundary the Weekly Boss does", () => {
    const start = weekIndex(Date.now()) * WEEK;
    expect(weekIndex(start)).toBe(weekIndex(start + WEEK - 1));
    expect(weekIndex(start + WEEK)).toBe(weekIndex(start) + 1);
  });

  it("reaches a named modifier, and falls back to this week's", () => {
    const target = playableModifiers()[2] ?? playableModifiers()[0]!;
    expect(modifierById(target.id, Date.now()).id).toBe(target.id);
    expect(modifierById("no-such-rule", Date.now()).id).toBe(modifierForWeek(Date.now()).id);
    expect(modifierById(null, Date.now()).id).toBe(modifierForWeek(Date.now()).id);
  });

  /** A deferred modifier must not be reachable even by naming it in the URL. */
  it("refuses to deal a deferred modifier by id", () => {
    const deferred = allModifiers().find((modifier) => modifier.deferred);
    if (!deferred) return;
    expect(modifierById(deferred.id, Date.now()).id).not.toBe(deferred.id);
  });
});

// ---------------------------------------------------------------------------

describe("turning a modifier into a match", () => {
  /**
   * The property this mode lives or dies by. A rule patched onto one leader is
   * a house rule only one player is bound by.
   */
  it("applies a passive to BOTH leaders", () => {
    const modifier = playableModifiers().find((entry) => entry.passive?.length);
    if (!modifier) return;

    const config = remixMatchConfig(content, modifier, LEADERS);
    for (const leaderCardId of LEADERS) {
      const patch = config.cardOverrides?.[leaderCardId];
      expect(patch, `${leaderCardId} got no patch, so the rule bound only one player`).toBeDefined();
      expect(patch!.passive).toEqual(modifier.passive);
    }
  });

  it("patches a mirror match's single leader exactly once", () => {
    const modifier = playableModifiers().find((entry) => entry.passive?.length);
    if (!modifier) return;

    const config = remixMatchConfig(content, modifier, [LEADERS[0]!, LEADERS[0]!]);
    const patch = config.cardOverrides?.[LEADERS[0]!];
    expect(
      patch?.passive?.length,
      "a mirror match doubled the rule on the one leader both players share"
    ).toBe(modifier.passive!.length);
  });

  it("carries balance overrides through untouched", () => {
    const modifier = playableModifiers().find((entry) => entry.balance);
    if (!modifier) return;
    expect(remixMatchConfig(content, modifier, LEADERS).balanceOverrides).toEqual(modifier.balance);
  });

  /**
   * The cost ceiling is expressed as a negative delta per card, because
   * `CardPatch.cost` is *added* to the printed cost. Only cards above the
   * ceiling are patched: patching the whole collection with a zero delta would
   * put every card in a config that `replay()` rebuilds from.
   */
  it("expresses a cost ceiling as a delta, and only for cards above it", () => {
    const modifier = playableModifiers().find((entry) => entry.costCeiling !== undefined);
    if (!modifier) return;
    const ceiling = modifier.costCeiling!;
    const config = remixMatchConfig(content, modifier, LEADERS);

    const above = collectibleCards(content).filter((card) => card.cost > ceiling);
    expect(above.length, "the ceiling is above every card, so it changes nothing").toBeGreaterThan(0);

    for (const card of above) {
      const patch = config.cardOverrides?.[card.id];
      expect(patch, `${card.id} costs ${card.cost} and was not brought down to ${ceiling}`).toBeDefined();
      expect(card.cost + patch!.cost!, `${card.id} did not land on the ceiling`).toBe(ceiling);
    }
    for (const card of collectibleCards(content).filter((entry) => entry.cost <= ceiling)) {
      expect(config.cardOverrides?.[card.id]?.cost, `${card.id} was patched but is already under the ceiling`).toBeUndefined();
    }
  });

  it("returns nothing it was not asked for", () => {
    const passiveOnly = playableModifiers().find((entry) => entry.passive?.length && !entry.balance);
    if (passiveOnly) expect(remixMatchConfig(content, passiveOnly, LEADERS).balanceOverrides).toBeUndefined();

    const balanceOnly = playableModifiers().find((entry) => entry.balance && !entry.passive?.length && entry.costCeiling === undefined);
    if (balanceOnly) expect(remixMatchConfig(content, balanceOnly, LEADERS).cardOverrides).toBeUndefined();
  });

  it("never builds a config for a deferred modifier that changes anything", () => {
    for (const modifier of allModifiers().filter((entry) => entry.deferred)) {
      const config = remixMatchConfig(content, modifier, LEADERS);
      expect(config.balanceOverrides).toBeUndefined();
      expect(config.cardOverrides).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------

describe("the weekly quest", () => {
  const { questWinsRequired, questClout } = remixData();

  it("counts toward the published target", () => {
    const now = Date.now();
    expect(remixQuest(0, -1, now).complete).toBe(false);
    expect(remixQuest(questWinsRequired - 1, -1, now).complete).toBe(false);
    expect(remixQuest(questWinsRequired, -1, now).complete).toBe(true);
    expect(remixQuest(questWinsRequired, -1, now).clout).toBe(questClout);
  });

  it("knows when it has already been paid this week", () => {
    const now = Date.now();
    expect(remixQuest(questWinsRequired, weekIndex(now), now).claimed).toBe(true);
    expect(remixQuest(questWinsRequired, weekIndex(now) - 1, now).claimed).toBe(false);
  });

  it("stamps the week the wins belong to", () => {
    const now = Date.now();
    expect(remixQuest(1, -1, now).week).toBe(weekIndex(now));
  });

  it("names a mode string match history can be filtered by", () => {
    expect(REMIX_MODE).toBe("remix");
  });
});
