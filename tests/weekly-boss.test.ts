/**
 * Weekly Boss: rotation, tiers and the twist mechanism.
 *
 * The interesting claim is that a boss needs no hardcoding — its rule twist is
 * an ordinary passive on its leader card, and its difficulty is an AI profile
 * plus config the engine already understood.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { getContent, resolveMatchContent, selectableLeaders } from "../src/engine/content";
import { BOSSES, BOSS_TIERS, bossForWeek, bossScenario, clearKey, tierById, weekIndex } from "../src/game/weeklyBoss";
import { claimOnce, hasClaimed, getProfile, profileStore } from "../src/save/profile";

const content = getContent();

describe("boss roster", () => {
  it("gives every boss a real leader card carrying its twist as a passive", () => {
    for (const boss of BOSSES) {
      const leader = content.leaders[boss.leaderCardId];
      expect(leader, `${boss.id} has no leader card`).toBeDefined();
      // the twist IS the passive — a boss whose passive is empty has a twist
      // that exists only in the blurb
      expect(leader!.passive.length, `${boss.id}'s twist does nothing`).toBeGreaterThan(0);
      expect(content.leaders[boss.deckLeaderCardId], `${boss.id} deck leader`).toBeDefined();
    }
  });

  it("keeps boss leaders out of the player's pool", () => {
    const pickable = selectableLeaders(content).map((l) => l.id);
    for (const boss of BOSSES) expect(pickable).not.toContain(boss.leaderCardId);
  });
});

describe("weekly rotation", () => {
  it("is stable within a week and moves between weeks", () => {
    const week = 7 * 24 * 60 * 60 * 1000;
    const monday = weekIndex(0) === 0 ? 0 : 0;
    expect(bossForWeek(monday).id).toBe(bossForWeek(monday + week - 1).id);
    if (BOSSES.length > 1) {
      expect(bossForWeek(monday).id).not.toBe(bossForWeek(monday + week).id);
    }
  });

  it("cycles through every boss", () => {
    const week = 7 * 24 * 60 * 60 * 1000;
    const seen = new Set(BOSSES.map((_, i) => bossForWeek(i * week).id));
    expect(seen.size).toBe(BOSSES.length);
  });
});

describe("difficulty tiers", () => {
  it("escalates AI and reward together", () => {
    const order = BOSS_TIERS.map((t) => t.clout);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(tierById("impossible").ai).toBe("boss");
    expect(tierById("nonsense").id).toBe("normal");
  });

  it("gives the boss extra health WITHOUT touching the player's", () => {
    // leader.startingHealth would raise both sides, which is why this is a
    // setup op on one seat instead of a balance override
    const scenario = bossScenario(tierById("impossible"), 1);
    expect(scenario?.setup).toEqual([{ op: "leaderHealth", seat: 1, value: 40, max: 40 }]);
    expect(bossScenario(tierById("normal"))).toBeUndefined();
  });

  it("only bends balance through paths the validator accepts", () => {
    for (const tier of BOSS_TIERS) {
      if (!tier.balanceOverrides) continue;
      expect(() => resolveMatchContent(content, tier.balanceOverrides)).not.toThrow();
    }
  });
});

describe("first-clear rewards", () => {
  beforeEach(() => {
    profileStore.update((draft) => {
      draft.claimedRewards = [];
      draft.clout = 0;
    });
  });

  it("pays once per boss, per tier, per week", () => {
    const boss = BOSSES[0]!;
    const tier = tierById("normal");
    const now = 0;
    expect(claimOnce(clearKey(boss, tier, now), tier.clout)).toEqual({ clout: tier.clout });
    expect(claimOnce(clearKey(boss, tier, now), tier.clout)).toBeNull();
    expect(getProfile().clout).toBe(tier.clout);
  });

  it("pays again next week, and separately per tier", () => {
    const boss = BOSSES[0]!;
    const week = 7 * 24 * 60 * 60 * 1000;
    claimOnce(clearKey(boss, tierById("normal"), 0), 50);
    expect(hasClaimed(clearKey(boss, tierById("nightmare"), 0))).toBe(false);
    expect(hasClaimed(clearKey(boss, tierById("normal"), week))).toBe(false);
    expect(claimOnce(clearKey(boss, tierById("normal"), week), 50)).toEqual({ clout: 50 });
  });
});
