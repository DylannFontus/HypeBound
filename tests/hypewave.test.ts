/**
 * The Hype Wave — `08-progression.md` §10.
 *
 * Two things in here are load-bearing.
 *
 * **The calibration test, which §10.6.8 makes release-blocking.** *"The pass is
 * completable comfortably below 40 min/day average and this calibration is a
 * release-blocking test on `data/progression.json` values."* §10.4 derives its
 * pacing from §2.2's assumption that a match averages 75 XP; the shipped match
 * pays 25 plus 15 for a win, the same re-scale the Mastery curve carries. So the
 * test does not check the XP — it re-derives §10.4's three player models from the
 * shipped constants and asserts the *rightmost column*: Regular week 7, Casual
 * week 8, Lurker week 10. Changing what a match or a mission pays without
 * re-scaling the tier cost fails here immediately.
 *
 * **The no-expiry rules, which §10.6 makes binding.** A season ending must not
 * take an unfinished pass away, two missed seasons must not silently drop the
 * older one, and buying the Backstage Pass late must pay out everything already
 * earned. Those are properties of the state machine, so they are tested against
 * a clock the test controls rather than against the one on the wall.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { getContent } from "../src/engine/content";
import { xpConfig } from "../src/game/progression/data";
import { matchXp } from "../src/game/progression/mastery";
import {
  canPassPick,
  checkHypeWaveData,
  creditFor,
  DEFERRED_PASS,
  emptyPass,
  hypeWaveData,
  isGrantable,
  pacingOf,
  paceLine,
  passComplete,
  passPickCandidates,
  passView,
  reboundGuaranteeXpPerWeek,
  reboundMultiplier,
  refFor,
  rewardsAt,
  seasonAt,
  seasonById,
  seasonEnd,
  seasonStart,
  tierFor,
  weeksElapsed,
  welcomeBackDue,
  xpForTier,
  type PassState,
} from "../src/game/progression/hypeWave";
import { checkCosmeticsData, cosmeticById } from "../src/game/cosmetics";
import {
  buyBackstagePass,
  claimEncore,
  claimPassTier,
  getProfile,
  hypeWaveUnclaimed,
  hypeWaveViews,
  passPickChoices,
  profileStore,
  recordMatch,
  skipPassTier,
  syncHypeWave,
  wearing,
} from "../src/save/profile";

const content = getContent();
const data = hypeWaveData();
const S1 = data.seasons[0]!;
const S2 = data.seasons[1]!;

const WEEK = 604_800_000;
const DAY = 86_400_000;

/** A moment `weeks` into season 1, plus a nudge so it is never exactly a boundary. */
const inSeason1 = (weeks: number): number => seasonStart(S1) + weeks * WEEK + DAY;

// ---------------------------------------------------------------------------

describe("the catalogue", () => {
  it("loads and validates", () => {
    expect(data.tiers).toBe(50);
    expect(data.seasons.length).toBeGreaterThanOrEqual(2);
  });

  it("says nothing that is not true of the shipped content", () => {
    const problems = checkHypeWaveData(content);
    expect(problems, problems.length === 0 ? "" : `\ndata/hype-wave.json:\n  ${problems.join("\n  ")}\n`).toEqual([]);
  });

  it("leaves the cosmetics catalogue consistent", () => {
    const problems = checkCosmeticsData(content);
    expect(problems, problems.length === 0 ? "" : `\ndata/cosmetics.json:\n  ${problems.join("\n  ")}\n`).toEqual([]);
  });

  it("pays something at every one of the fifty tiers", () => {
    // §10.2: "Every tier pays something (no dead tiers)"
    for (let tier = 1; tier <= data.tiers; tier++) {
      expect(rewardsAt("free", tier).length, `free tier ${tier}`).toBeGreaterThan(0);
      expect(rewardsAt("backstage", tier).length, `backstage tier ${tier}`).toBeGreaterThan(0);
    }
  });

  it("keeps cards, packs and Glimmer on the free track", () => {
    // §10.2: "all cards, packs, wildcards, and Glimmer sit on the free track"
    const free = Array.from({ length: data.tiers }, (_, i) => rewardsAt("free", i + 1)).flat();
    expect(free.some((reward) => reward.kind === "pack")).toBe(true);
    expect(free.some((reward) => reward.kind === "pick")).toBe(true);
    expect(free.some((reward) => reward.kind === "glimmer")).toBe(true);
  });

  it("keeps the Backstage Pass cosmetic-only, Glimmer aside", () => {
    // §10.3, and the design puts the Glimmer there itself so the pass part-funds the next
    for (let tier = 1; tier <= data.tiers; tier++) {
      for (const reward of rewardsAt("backstage", tier)) {
        expect(["cosmetic", "glimmer"], `backstage tier ${tier}`).toContain(reward.kind);
      }
    }
  });

  it("pays the free-track totals §10.2 states", () => {
    const free = Array.from({ length: data.tiers }, (_, i) => rewardsAt("free", i + 1)).flat();
    const packs = free.filter((reward) => reward.kind === "pack").length;
    const glimmer = free.reduce((sum, r) => sum + (r.kind === "glimmer" ? r.amount : 0), 0);
    const fragments = free.reduce((sum, r) => sum + (r.kind === "fragments" ? r.amount : 0), 0);
    const picks = free.filter((reward) => reward.kind === "pick").length;
    const clout = free.reduce((sum, r) => sum + (r.kind === "clout" ? r.amount : 0), 0);
    expect(packs).toBe(5);
    expect(glimmer).toBe(400);
    expect(fragments).toBe(100);
    expect(picks).toBe(2);
    // "~3,000 Clout"
    expect(clout).toBeGreaterThan(2500);
    expect(clout).toBeLessThan(3500);
  });
});

describe("the pacing calibration — §10.6.8, release-blocking", () => {
  /**
   * §10.4's three models, re-derived from what the shipped game pays.
   *
   * One documented difference: §10.4 credits 200 XP for the first win of the
   * day, and the shipped first-win bonus pays 30 Clout and no XP. These
   * baselines exclude it, so the calibration measures the game that exists.
   */
  const perMatch = (matchXp(true) + matchXp(false)) / 2;
  const { dailyXp, weeklyXp } = content.balance.economy.missions;
  const weekly = (matches: number, dailies: number, weeklies: number): number =>
    matches * perMatch + dailies * dailyXp + weeklies * weeklyXp;

  const MODELS = [
    { name: "The Regular", xp: weekly(32, 7, 3), week: 7 },
    { name: "The Casual", xp: weekly(21, 7, 2), week: 8 },
    { name: "The Lurker", xp: weekly(14, 6, 1.5), week: 10 },
  ];
  const total = data.tiers * data.xpPerTier;

  it("reaches tier 50 in the week §10.4's table says, for all three models", () => {
    for (const model of MODELS) {
      const weeks = Math.ceil(total / model.xp);
      expect(
        weeks,
        `${model.name} earns ${Math.round(model.xp)} XP/week and finishes in week ${weeks}, ` +
          `but §10.4 says week ${model.week}. Re-scale xpPerTier in data/hype-wave.json.`
      ).toBe(model.week);
    }
  });

  it("completes comfortably inside the season at 40 min/day average", () => {
    // §10.6.8. "The Regular" is §10.4's 40 min/day model; comfortable means it
    // finishes with weeks to spare rather than on the final day.
    const weeks = Math.ceil(total / MODELS[0]!.xp);
    expect(weeks).toBeLessThanOrEqual(S1.weeks - 2);
  });

  it("keeps missions, not playtime, the dominant source", () => {
    /**
     * §10.4: "for the Regular, 61% of weekly XP is bounded mission objectives.
     * Doubling playtime does not double progress." That is a *design property*
     * of the pass, not an accident of the numbers, so it is asserted.
     */
    const regularMatches = 32 * perMatch;
    const regularMissions = 7 * dailyXp + 3 * weeklyXp;
    expect(regularMissions / (regularMatches + regularMissions)).toBeGreaterThan(0.6);
  });

  it("guarantees a Rebound finish at a threshold it computes rather than quotes", () => {
    /**
     * §10.5.1 states the figure for the design's 50,000-XP pass. The shipped
     * pass costs less, so the true threshold is lower — and is derived, because
     * a number copied out of a document stops being true silently.
     */
    const threshold = reboundGuaranteeXpPerWeek(S1.weeks);
    expect(threshold * (1 + data.rebound.bonus) * S1.weeks).toBeGreaterThanOrEqual(total);
    // and the slowest model clears it, which is what "nobody is locked out" means
    expect(MODELS[2]!.xp).toBeGreaterThanOrEqual(threshold);
  });

  it("is calibrated against the same XP a match actually pays", () => {
    // the guard on the guard: if `matchXp` stops reading progression.json, the
    // models above would be calibrated against a constant nothing grants
    expect(perMatch).toBe(xpConfig().matchComplete + xpConfig().matchWin / 2);
  });
});

describe("tiers", () => {
  it("starts at tier 0 with nothing banked", () => {
    const state = tierFor(0);
    expect(state.tier).toBe(0);
    expect(state.intoTier).toBe(0);
    expect(state.complete).toBe(false);
  });

  it("promotes exactly at the threshold, not a point before it", () => {
    expect(tierFor(data.xpPerTier - 1).tier).toBe(0);
    expect(tierFor(data.xpPerTier).tier).toBe(1);
    expect(tierFor(data.xpPerTier).intoTier).toBe(0);
  });

  it("keeps the remainder as progress into the next tier", () => {
    const state = tierFor(xpForTier(4) + 120);
    expect(state.tier).toBe(4);
    expect(state.intoTier).toBe(120);
  });

  it("caps at fifty and counts the rest as Encore", () => {
    const state = tierFor(xpForTier(53) + 10);
    expect(state.tier).toBe(50);
    expect(state.complete).toBe(true);
    expect(state.encore).toBe(3);
    expect(state.intoTier).toBe(0);
  });

  it("treats negative XP as zero rather than throwing", () => {
    expect(tierFor(-5000).tier).toBe(0);
  });
});

describe("Wave Rebound", () => {
  it("puts nobody behind in week one", () => {
    expect(weeksElapsed(S1, inSeason1(0))).toBe(0);
    expect(paceLine(S1, inSeason1(0))).toBe(0);
    expect(pacingOf(0, S1, inSeason1(0))).toBe("on-pace");
  });

  it("moves the pace line five tiers per completed week", () => {
    expect(paceLine(S1, inSeason1(3))).toBe(15);
    expect(paceLine(S1, inSeason1(6))).toBe(30);
  });

  it("stops the pace line at the last tier", () => {
    expect(paceLine(S1, inSeason1(40))).toBe(data.tiers);
  });

  it("pays +50% while behind, and nothing extra while ahead", () => {
    expect(reboundMultiplier(pacingOf(10, S1, inSeason1(3)))).toBe(1.5);
    expect(reboundMultiplier(pacingOf(20, S1, inSeason1(3)))).toBe(1);
    expect(pacingOf(20, S1, inSeason1(3))).toBe("ahead");
    expect(pacingOf(15, S1, inSeason1(3))).toBe("on-pace");
  });

  it("can be forced on for somebody who is ahead — Welcome Back", () => {
    expect(pacingOf(40, S1, inSeason1(3), true)).toBe("rebound");
  });

  it("credits the multiplier into the XP a pass actually receives", () => {
    const behind: PassState = { ...emptyPass(S1.id), xp: 0 };
    expect(creditFor(behind, 1000, inSeason1(3))).toBe(1500);
    const ahead: PassState = { ...emptyPass(S1.id), xp: xpForTier(40) };
    expect(creditFor(ahead, 1000, inSeason1(3))).toBe(1000);
  });
});

describe("the Archive Pass", () => {
  it("earns at half rate once its season has ended", () => {
    const pass: PassState = { ...emptyPass(S1.id), xp: xpForTier(10) };
    const after = seasonEnd(S1) + WEEK;
    expect(creditFor(pass, 1000, after)).toBe(500);
  });

  it("never gets Rebound — it has no season to be behind in", () => {
    const pass: PassState = { ...emptyPass(S1.id), xp: 0 };
    const after = seasonEnd(S1) + WEEK;
    expect(creditFor(pass, 1000, after, { forcedRebound: true })).toBe(500);
  });

  it("stops earning once it reaches the top, and not before", () => {
    const nearly: PassState = { ...emptyPass(S1.id), xp: xpForTier(49) };
    const done: PassState = { ...emptyPass(S1.id), xp: xpForTier(50) };
    const after = seasonEnd(S1) + WEEK;
    expect(creditFor(nearly, 1000, after)).toBeGreaterThan(0);
    expect(creditFor(done, 1000, after)).toBe(0);
    expect(passComplete(done)).toBe(true);
  });
});

describe("seasons", () => {
  it("finds the season a moment falls inside", () => {
    expect(seasonAt(inSeason1(2))?.id).toBe(S1.id);
    expect(seasonAt(seasonStart(S2) + DAY)?.id).toBe(S2.id);
  });

  it("has no season before the first one starts", () => {
    expect(seasonAt(seasonStart(S1) - DAY)).toBeNull();
  });

  it("has no season after the last one ends", () => {
    expect(seasonAt(seasonEnd(S2) + DAY)).toBeNull();
  });

  it("runs each season for the weeks it declares", () => {
    expect(seasonEnd(S1) - seasonStart(S1)).toBe(S1.weeks * WEEK);
  });

  it("names a season nobody authored as nothing, rather than throwing", () => {
    expect(seasonById("s99-nope")).toBeNull();
    expect(passView(emptyPass("s99-nope"), inSeason1(1))).toBeNull();
  });
});

describe("the deferral allowlist", () => {
  it("gives every un-grantable reward a written reason", () => {
    for (const track of ["free", "backstage"] as const) {
      for (let tier = 1; tier <= data.tiers; tier++) {
        for (const reward of rewardsAt(track, tier)) {
          if (reward.kind !== "cosmetic" || reward.ref) continue;
          expect(DEFERRED_PASS.has(reward.name), `${track} tier ${tier}: "${reward.name}"`).toBe(true);
          expect(DEFERRED_PASS.get(reward.name)!.length).toBeGreaterThan(10);
        }
      }
    }
  });

  it("keeps no excuse alive past the thing it excuses", () => {
    /**
     * The staleness half. A reward that gained a `ref` must leave this list in
     * the same commit — otherwise a reason sits here explaining why something
     * that now works does not.
     */
    const named = new Set<string>();
    for (const track of ["free", "backstage"] as const) {
      for (let tier = 1; tier <= data.tiers; tier++) {
        for (const reward of rewardsAt(track, tier)) {
          if (reward.kind === "cosmetic" && !reward.ref) named.add(reward.name);
        }
      }
    }
    // "Welcome Back mission slots" is not a tier reward; it is §10.5.4's other half
    named.add("Welcome Back mission slots");
    for (const name of DEFERRED_PASS.keys()) {
      expect(named, `"${name}" is deferred but nothing defers to it any more`).toContain(name);
    }
  });

  it("resolves every ref a tier promises, for every season", () => {
    for (const season of data.seasons) {
      for (const track of ["free", "backstage"] as const) {
        for (let tier = 1; tier <= data.tiers; tier++) {
          for (const reward of rewardsAt(track, tier)) {
            const ref = refFor(reward, season.id);
            if (!ref) continue;
            expect(cosmeticById(content, ref), `${ref}`).not.toBeNull();
          }
        }
      }
    }
  });

  it("calls a cosmetic grantable exactly when it names a ref", () => {
    expect(isGrantable({ kind: "cosmetic", name: "x" })).toBe(false);
    expect(isGrantable({ kind: "cosmetic", name: "x", ref: "title:season:{season}" })).toBe(true);
    expect(isGrantable({ kind: "pack" })).toBe(true);
  });
});

describe("picks", () => {
  it("offers the same three cards every time it is asked", () => {
    const a = passPickCandidates(content, S1.id, 25, "rare", 3).map((card) => card.id);
    const b = passPickCandidates(content, S1.id, 25, "rare", 3).map((card) => card.id);
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
  });

  it("offers different cards at a different tier", () => {
    const a = passPickCandidates(content, S1.id, 25, "rare", 3).map((card) => card.id);
    const b = passPickCandidates(content, S1.id, 45, "rare", 3).map((card) => card.id);
    expect(a).not.toEqual(b);
  });

  it("offers the rarity the tier asked for, from any faction", () => {
    const cards = passPickCandidates(content, S1.id, 45, "epic", 3);
    expect(cards.every((card) => card.rarity === "epic")).toBe(true);
    expect(cards.every((card) => !card.token && !card.variantOf)).toBe(true);
  });

  it("accepts only what it offered", () => {
    const [first] = passPickCandidates(content, S1.id, 25, "rare", 3);
    expect(canPassPick(content, S1.id, 25, "rare", 3, first!.id)).toBe(true);
    expect(canPassPick(content, S1.id, 25, "rare", 3, "not-a-card")).toBe(false);
  });
});

describe("earning and claiming", () => {
  const NOW = inSeason1(3);

  beforeEach(() => {
    profileStore.reset();
    syncHypeWave(NOW);
  });

  /** Put the live pass at a tier without playing a hundred matches for it. */
  const setTier = (tier: number): void => {
    profileStore.update((draft) => {
      draft.hypeWave.pass!.xp = xpForTier(tier);
    });
  };

  it("starts a pass for the live season", () => {
    const { live } = hypeWaveViews(NOW);
    expect(live?.season.id).toBe(S1.id);
    expect(live?.state.tier).toBe(0);
    expect(live?.backstage).toBe(false);
  });

  it("claims a free tier once and refuses the second time", () => {
    setTier(5);
    const before = getProfile().pendingDrops;
    const grant = claimPassTier(content, S1.id, "free", 5, undefined, NOW);
    expect(grant?.drops).toBe(1);
    expect(getProfile().pendingDrops).toBe(before + 1);
    expect(claimPassTier(content, S1.id, "free", 5, undefined, NOW)).toBeNull();
  });

  it("refuses a tier that has not been reached", () => {
    setTier(4);
    expect(claimPassTier(content, S1.id, "free", 5, undefined, NOW)).toBeNull();
  });

  it("pays the seasonal card back at tier 1, and wears it", () => {
    setTier(1);
    const grant = claimPassTier(content, S1.id, "free", 1, undefined, NOW);
    expect(grant?.cosmetics.map((cosmetic) => cosmetic.id)).toEqual([`cardBack:season:${S1.id}`]);
    expect(wearing(content, "cardBack")?.id).toBe(`cardBack:season:${S1.id}`);
  });

  it("records what it cannot pay rather than pretending", () => {
    setTier(35);
    const grant = claimPassTier(content, S1.id, "free", 35, undefined, NOW);
    expect(grant).toBeNull(); // nothing grantable at all, so the tier offers no claim
    const view = hypeWaveViews(NOW).live!;
    expect(view.rows.find((row) => row.tier === 35)!.freeClaimable).toBe(false);
    expect(view.rows.find((row) => row.tier === 35)!.unlocked).toBe(true);
  });

  it("pays the deferred half of a tier that also pays something real", () => {
    setTier(50);
    const grant = claimPassTier(content, S1.id, "free", 50, undefined, NOW)!;
    expect(grant.glimmer).toBe(100);
    expect(grant.cosmetics.map((cosmetic) => cosmetic.kind)).toEqual(["title"]);
    expect(grant.deferred).toEqual(["Animated upgrade of the tier-1 card back"]);
  });

  it("needs a valid pick where the tier has one", () => {
    setTier(25);
    expect(claimPassTier(content, S1.id, "free", 25, undefined, NOW)).toBeNull();
    expect(claimPassTier(content, S1.id, "free", 25, "not-a-card", NOW)).toBeNull();
    const choices = passPickChoices(content, S1.id, 25)!;
    const grant = claimPassTier(content, S1.id, "free", 25, choices[0]!.id, NOW);
    expect(grant?.cards[0]?.cardId).toBe(choices[0]!.id);
  });

  it("refuses the Backstage track without a Backstage Pass", () => {
    setTier(5);
    expect(claimPassTier(content, S1.id, "backstage", 5, undefined, NOW)).toBeNull();
  });

  it("sells the Backstage Pass for Glimmer, and only when it can be afforded", () => {
    expect(buyBackstagePass(S1.id, NOW)).toBe(false);
    profileStore.update((draft) => {
      draft.glimmer = data.backstagePrice;
    });
    expect(buyBackstagePass(S1.id, NOW)).toBe(true);
    expect(getProfile().glimmer).toBe(0);
    expect(buyBackstagePass(S1.id, NOW)).toBe(false); // already held
  });

  it("retro-claims every tier already earned when the pass is bought late", () => {
    /**
     * §10.1: "rewards for already-earned tiers granted instantly". It needs no
     * separate code path because claimability is recomputed from the tier
     * reached rather than stamped when the tier was passed — this is the test
     * that keeps that true.
     */
    setTier(20);
    profileStore.update((draft) => {
      draft.glimmer = data.backstagePrice;
    });
    expect(hypeWaveViews(NOW).live!.rows.filter((row) => row.backstageClaimable)).toHaveLength(0);
    buyBackstagePass(S1.id, NOW);
    const claimable = hypeWaveViews(NOW).live!.rows.filter((row) => row.backstageClaimable);
    expect(claimable.length).toBeGreaterThan(0);
    expect(claimable.every((row) => row.tier <= 20)).toBe(true);
  });

  it("pays Encore tiers past fifty, endlessly and once each", () => {
    profileStore.update((draft) => {
      draft.hypeWave.pass!.xp = xpForTier(53);
    });
    const before = getProfile().clout;
    const paid = claimEncore(NOW)!;
    expect(paid.tiers).toBe(3);
    expect(paid.clout).toBe(3 * data.encoreClout);
    expect(getProfile().clout).toBe(before + paid.clout);
    expect(claimEncore(NOW)).toBeNull();

    profileStore.update((draft) => {
      draft.hypeWave.pass!.xp = xpForTier(55);
    });
    expect(claimEncore(NOW)!.tiers).toBe(2);
  });

  it("skips a tier for Glimmer, and adds XP rather than a counter", () => {
    profileStore.update((draft) => {
      draft.glimmer = data.tierSkipPrice;
    });
    setTier(3);
    expect(skipPassTier(S1.id, NOW)).toBe(true);
    expect(hypeWaveViews(NOW).live!.state.tier).toBe(4);
    expect(getProfile().glimmer).toBe(0);
    expect(skipPassTier(S1.id, NOW)).toBe(false);
  });

  it("counts what is waiting, for the lobby badge", () => {
    expect(hypeWaveUnclaimed(NOW)).toBe(0);
    setTier(2);
    // tier 1 pays a card back and tier 2 pays filler Clout
    expect(hypeWaveUnclaimed(NOW)).toBe(2);
  });
});

describe("season rollover", () => {
  const LATE_S1 = inSeason1(9);
  const IN_S2 = seasonStart(S2) + DAY;

  beforeEach(() => profileStore.reset());

  it("archives an unfinished pass and starts a fresh one", () => {
    syncHypeWave(LATE_S1);
    profileStore.update((draft) => {
      draft.hypeWave.pass!.xp = xpForTier(12);
    });
    syncHypeWave(IN_S2);

    const profile = getProfile();
    expect(profile.hypeWave.pass?.seasonId).toBe(S2.id);
    expect(profile.hypeWave.pass?.xp).toBe(0);
    expect(profile.hypeWave.archives.map((a) => a.seasonId)).toEqual([S1.id]);
    expect(profile.hypeWave.archives[0]!.xp).toBe(xpForTier(12));
  });

  it("does not archive a pass that was finished", () => {
    syncHypeWave(LATE_S1);
    profileStore.update((draft) => {
      draft.hypeWave.pass!.xp = xpForTier(50);
    });
    syncHypeWave(IN_S2);
    expect(getProfile().hypeWave.archives).toHaveLength(0);
  });

  it("keeps an archive's unclaimed rewards claimable forever", () => {
    // §10.6: "the pass itself never expires (Archive Pass)"
    syncHypeWave(LATE_S1);
    profileStore.update((draft) => {
      draft.hypeWave.pass!.xp = xpForTier(6);
    });
    syncHypeWave(IN_S2);

    const { archives } = hypeWaveViews(IN_S2);
    expect(archives).toHaveLength(1);
    expect(archives[0]!.rows.find((row) => row.tier === 5)!.freeClaimable).toBe(true);
    const grant = claimPassTier(content, S1.id, "free", 5, undefined, IN_S2);
    expect(grant?.drops).toBe(1);
  });

  it("keeps both of two missed seasons", () => {
    /**
     * A single archive slot would silently drop the older one — and with it,
     * every reward that pass had not yet paid out.
     */
    profileStore.update((draft) => {
      draft.hypeWave.archives = [{ ...emptyPass(S1.id), xp: xpForTier(4) }];
      draft.hypeWave.pass = { ...emptyPass(S2.id), xp: xpForTier(7) };
    });
    syncHypeWave(seasonEnd(S2) + DAY);
    expect(getProfile().hypeWave.archives.map((a) => a.seasonId).sort()).toEqual([S1.id, S2.id].sort());
  });

  it("has no live pass between seasons, and says so rather than inventing one", () => {
    syncHypeWave(seasonEnd(S2) + WEEK);
    expect(getProfile().hypeWave.pass).toBeNull();
    expect(hypeWaveViews(seasonEnd(S2) + WEEK).live).toBeNull();
  });
});

describe("Welcome Back", () => {
  const NOW = inSeason1(4);

  beforeEach(() => profileStore.reset());

  it("is not due for an account that has never been away", () => {
    expect(welcomeBackDue(0, NOW)).toBe(false);
    expect(welcomeBackDue(NOW - DAY, NOW)).toBe(false);
  });

  /**
   * The Clout is **posted, not paid**. It used to land straight in the wallet
   * during a lobby mount with nothing anywhere saying where it came from, which
   * §4.2.4 forbids outright ("No reward is auto-consumed invisibly"). It is an
   * inbox attachment now — `tests/inbox.test.ts` owns the claim; what matters
   * here is that syncing offers it exactly once and moves no money on its own.
   */
  it("posts once after the stated absence, and pays nothing by itself", () => {
    syncHypeWave(NOW - 20 * DAY);
    const before = getProfile().clout;
    const posted = syncHypeWave(NOW);
    expect(posted?.clout).toBe(data.welcomeBack.clout);
    expect(getProfile().clout).toBe(before);
    expect(getProfile().hypeWave.welcomeBackAt).toBe(NOW);
    // returning again immediately does not post again
    expect(syncHypeWave(NOW + DAY)).toBeNull();
  });

  it("forces Rebound on for the stated week", () => {
    syncHypeWave(NOW - 20 * DAY);
    syncHypeWave(NOW);
    expect(getProfile().hypeWave.forcedReboundUntil).toBeGreaterThan(NOW);
    expect(getProfile().hypeWave.forcedReboundUntil).toBeLessThanOrEqual(NOW + WEEK + 1);
  });
});

describe("the XP funnel", () => {
  const NOW = inSeason1(2);

  beforeEach(() => {
    profileStore.reset();
    syncHypeWave(NOW);
  });

  it("feeds the pass from the same XP a match pays the account", () => {
    /**
     * §10.1: "The single account XP stream. No separate pass currency." A pass
     * that had its own accrual would be a second thing to keep in step.
     */
    const record = { config: { seed: 1, decks: [], firstSeat: 0 }, intents: [] } as never;
    recordMatch(record, "win", {
      deckName: "T",
      leaderCardId: "idols-lumi-starcall",
      opponentLeaderCardId: "goth-leader-alaric-thornheart",
      mode: "ai-casual",
      now: NOW,
    });
    const pass = getProfile().hypeWave.pass!;
    // week 2 with tier 0 is behind the pace line, so Rebound applies
    expect(pass.xp).toBe(Math.round(matchXp(true) * (1 + data.rebound.bonus)));
  });

  it("credits an archive at half rate from the same match", () => {
    profileStore.update((draft) => {
      draft.hypeWave.archives = [{ ...emptyPass(S2.id), xp: 0 }];
    });
    const record = { config: { seed: 1, decks: [], firstSeat: 0 }, intents: [] } as never;
    recordMatch(record, "loss", {
      deckName: "T",
      leaderCardId: "idols-lumi-starcall",
      opponentLeaderCardId: "goth-leader-alaric-thornheart",
      mode: "ai-casual",
      now: NOW,
    });
    // S2 has not started at NOW, so its pass is not live and takes the archive rate
    expect(getProfile().hypeWave.archives[0]!.xp).toBe(Math.round(matchXp(false) * data.archiveRate));
  });

  it("survives a save written before the pass existed", () => {
    profileStore.update((draft) => {
      delete (draft as { hypeWave?: unknown }).hypeWave;
    });
    expect(() => syncHypeWave(NOW)).not.toThrow();
    expect(getProfile().hypeWave.pass?.seasonId).toBe(S1.id);
  });
});
