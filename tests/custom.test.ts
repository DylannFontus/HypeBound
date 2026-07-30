/**
 * The Custom Lobby — `09-game-modes.md` §17.
 *
 * Two properties carry this mode and neither is about the knobs themselves:
 *
 * **A configuration cannot be made easier than standard and still pay.** §17
 * says flagged combinations pay zero to prevent farming, which is only a rule if
 * "flagged" has a definition. It does: easier than standard. These tests pin
 * both directions — easier pays nothing, *harder* still pays, because nobody
 * farms a game they made harder and a mode that punished difficulty would be
 * its own kind of wrong.
 *
 * **A knob that equals the standard value writes nothing into the config.** A
 * `balanceOverrides` entry is recorded into `MatchConfig` and rebuilt by
 * `replay()`, so a lobby that stamped all six knobs every time would put six
 * redundant numbers into every replay of an otherwise ordinary match.
 */

import { describe, expect, it } from "vitest";
import { getContent, collectibleCards } from "../src/engine/content";
import {
  CUSTOM_LIMITS,
  DEFERRED_CUSTOM,
  allowedPool,
  bannedInDeck,
  checkCustomSettings,
  chosenModifier,
  clampSettings,
  customMatchConfig,
  defaultSettings,
  integrityFlags,
  isBanned,
  paysRewards,
  type CustomSettings,
} from "../src/game/custom";
import { playableModifiers } from "../src/game/remix";
import type { DeckList } from "../src/engine/types";

const content = getContent();
const NOW = Date.parse("2026-07-29T12:00:00.000Z");
const LEADERS = ["idols-lumi-starcall", "goth-leader-morvina-vane"];

const settingsWith = (over: Partial<CustomSettings> = {}): CustomSettings => ({
  ...defaultSettings(content),
  ...over,
});

// ---------------------------------------------------------------------------

describe("the knobs stay inside §17's ranges", () => {
  it("starts from the shipped balance, so 'standard' is never a second opinion", () => {
    const standard = defaultSettings(content);
    expect(standard.startingHealth).toBe(content.balance.leader.startingHealth);
    expect(standard.deckSize).toBe(content.balance.deck.size);
    expect(standard.handFirst).toBe(content.balance.hand.first);
    expect(standard.turnSeconds).toBe(content.balance.timer.turnSeconds);
  });

  it("clamps anything outside the published ranges", () => {
    const wild = clampSettings(
      content,
      settingsWith({ startingHealth: 9_999, deckSize: 1, turnSeconds: 5, handFirst: 99 })
    );
    expect(wild.startingHealth).toBe(CUSTOM_LIMITS.health.max);
    expect(wild.deckSize).toBe(CUSTOM_LIMITS.deck.min);
    expect(wild.turnSeconds).toBe(CUSTOM_LIMITS.timer.min);
    expect(wild.handFirst).toBe(CUSTOM_LIMITS.hand.max);
  });

  it("keeps 'timer off' as off rather than clamping it to a number", () => {
    expect(clampSettings(content, settingsWith({ turnSeconds: null })).turnSeconds).toBeNull();
  });

  it("drops a modifier id that is not playable", () => {
    expect(clampSettings(content, settingsWith({ modifierId: "no-such-rule" })).modifierId).toBeNull();
    expect(clampSettings(content, settingsWith({ modifierId: "touch-some-grass" })).modifierId).toBeNull();

    const playable = playableModifiers()[0]!;
    expect(clampSettings(content, settingsWith({ modifierId: playable.id })).modifierId).toBe(playable.id);
  });

  it("reports settings a lobby should refuse", () => {
    expect(checkCustomSettings(content, defaultSettings(content))).toEqual([]);
    expect(checkCustomSettings(content, settingsWith({ startingHealth: 5 })).join(" ")).toContain("starting health");
    expect(checkCustomSettings(content, settingsWith({ bannedCardIds: ["nope"] })).join(" ")).toContain("does not exist");
  });
});

// ---------------------------------------------------------------------------

describe("the ban list", () => {
  const anyCard = collectibleCards(content)[0]!;

  it("refuses a card by id and by faction", () => {
    expect(isBanned(settingsWith({ bannedCardIds: [anyCard.id] }), anyCard)).toBe(true);
    expect(isBanned(settingsWith({ bannedFactionIds: [anyCard.faction as string] }), anyCard)).toBe(true);
    expect(isBanned(defaultSettings(content), anyCard)).toBe(false);
  });

  it("shrinks the pool by exactly what it banned", () => {
    const full = allowedPool(content, defaultSettings(content)).length;
    const banned = allowedPool(content, settingsWith({ bannedCardIds: [anyCard.id] })).length;
    expect(banned).toBe(full - 1);
  });

  it("names the refused cards in a deck once each, not once per copy", () => {
    const deck: DeckList = {
      name: "Doubled",
      leaderCardId: LEADERS[0]!,
      cards: [anyCard.id, anyCard.id, anyCard.id],
    };
    const refused = bannedInDeck(content, settingsWith({ bannedCardIds: [anyCard.id] }), deck);
    expect(refused.map((card) => card.id)).toEqual([anyCard.id]);
    expect(bannedInDeck(content, defaultSettings(content), deck)).toEqual([]);
  });

  it("catches a ban list that removes the whole game", () => {
    const everyFaction = [...new Set(collectibleCards(content).map((card) => card.faction as string))];
    const problems = checkCustomSettings(content, settingsWith({ bannedFactionIds: everyFaction }));
    expect(problems.join(" ")).toContain("every card");
  });
});

// ---------------------------------------------------------------------------

describe("§17's anti-farming rule", () => {
  it("pays for a standard game", () => {
    expect(integrityFlags(content, defaultSettings(content))).toEqual([]);
    expect(paysRewards(content, defaultSettings(content))).toBe(true);
  });

  it("pays nothing for anything easier than standard", () => {
    const standard = defaultSettings(content);
    expect(paysRewards(content, settingsWith({ startingHealth: standard.startingHealth - 5 }))).toBe(false);
    expect(paysRewards(content, settingsWith({ deckSize: standard.deckSize - 5 }))).toBe(false);
    expect(paysRewards(content, settingsWith({ handFirst: standard.handFirst + 2 }))).toBe(false);
  });

  /**
   * The other half, and the one a naive "any non-default setting pays zero"
   * rule would get wrong. Nobody farms a game they made harder.
   */
  it("still pays for anything harder than standard", () => {
    const standard = defaultSettings(content);
    expect(paysRewards(content, settingsWith({ startingHealth: standard.startingHealth + 8 }))).toBe(true);
    expect(paysRewards(content, settingsWith({ deckSize: standard.deckSize + 8 }))).toBe(true);
    expect(paysRewards(content, settingsWith({ handFirst: 1, handSecond: 1 }))).toBe(true);
    expect(paysRewards(content, settingsWith({ difficulty: "boss" }))).toBe(true);
  });

  it("pays nothing for Hotseat, whatever the settings", () => {
    expect(paysRewards(content, settingsWith({ opponent: "hotseat" }))).toBe(false);
    expect(integrityFlags(content, settingsWith({ opponent: "hotseat" })).join(" ")).toContain("same account");
  });

  it("does not flag a Remix modifier — both seats get it", () => {
    const playable = playableModifiers()[0]!;
    expect(paysRewards(content, settingsWith({ modifierId: playable.id }))).toBe(true);
  });

  it("says why, in words a lobby can print before the match", () => {
    const flags = integrityFlags(content, settingsWith({ startingHealth: 20, deckSize: 20 }));
    expect(flags.length).toBe(2);
    for (const flag of flags) expect(flag.length).toBeGreaterThan(20);
  });
});

// ---------------------------------------------------------------------------

describe("assembling the match", () => {
  it("writes nothing into the config for a standard game", () => {
    const config = customMatchConfig(content, defaultSettings(content), LEADERS, NOW);
    expect(config.balanceOverrides).toBeUndefined();
    expect(config.cardOverrides).toBeUndefined();
  });

  it("writes only the knobs that were actually moved", () => {
    const config = customMatchConfig(content, settingsWith({ startingHealth: 40 }), LEADERS, NOW);
    expect(config.balanceOverrides).toEqual({ "leader.startingHealth": 40 });
  });

  it("expresses 'timer off' as a timer nobody will reach", () => {
    const config = customMatchConfig(content, settingsWith({ turnSeconds: null }), LEADERS, NOW);
    expect(config.balanceOverrides?.["timer.turnSeconds"]).toBeGreaterThan(3_600);
  });

  it("carries a Remix modifier through to both leaders", () => {
    const modifier = playableModifiers().find((entry) => entry.passive?.length);
    if (!modifier) return;
    const config = customMatchConfig(content, settingsWith({ modifierId: modifier.id }), LEADERS, NOW);
    for (const leaderCardId of LEADERS) {
      expect(config.cardOverrides?.[leaderCardId]?.passive).toEqual(modifier.passive);
    }
  });

  /**
   * A modifier is a named rule from a published catalogue that both seats agreed
   * to. A knob is one room's house rule. When they name the same number, the
   * catalogue wins — otherwise a lobby could quietly defang a modifier.
   */
  it("lets a modifier win over a knob that names the same number", () => {
    const speedrun = playableModifiers().find((entry) => entry.balance?.["timer.turnSeconds"] !== undefined);
    if (!speedrun) return;
    const config = customMatchConfig(
      content,
      settingsWith({ modifierId: speedrun.id, turnSeconds: 120 }),
      LEADERS,
      NOW
    );
    expect(config.balanceOverrides?.["timer.turnSeconds"]).toBe(speedrun.balance!["timer.turnSeconds"]);
  });

  it("resolves the chosen modifier, and only a playable one", () => {
    const playable = playableModifiers()[0]!;
    expect(chosenModifier(settingsWith({ modifierId: playable.id }), NOW)?.id).toBe(playable.id);
    expect(chosenModifier(settingsWith({ modifierId: null }), NOW)).toBeNull();
    expect(chosenModifier(settingsWith({ modifierId: "touch-some-grass" }), NOW)).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("what is deliberately not built", () => {
  it("says why, for every deferral", () => {
    expect(DEFERRED_CUSTOM.size).toBeGreaterThan(0);
    for (const [name, reason] of DEFERRED_CUSTOM) {
      expect(reason.trim().length, `${name} is deferred without a real reason`).toBeGreaterThan(40);
    }
  });

  it("still defers the parts that need a server", () => {
    expect([...DEFERRED_CUSTOM.keys()]).toContain("Online custom lobbies");
    expect([...DEFERRED_CUSTOM.keys()]).toContain("Friend invites");
  });
});
