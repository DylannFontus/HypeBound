/**
 * Achievements — `08-progression.md` §9.
 *
 * Three things in here are load-bearing and none is obvious from the code.
 *
 * **The independent oracle.** `mostLeaderDamageInATurn` is the only statistic in
 * the deriver with a per-turn reset, and a reset is the kind of thing that is
 * either exactly right or silently off by one turn. So the test does not check
 * it against a plausible range — it replays the same match and computes the
 * answer a second way, from the raw event stream, and demands they agree. That
 * catches both failure modes at once: a tally that never resets (the maximum
 * becomes the lifetime total) and one that resets without banking the final turn
 * (the killing blow, which is usually the biggest, disappears).
 *
 * **The accumulator has one call site.** Mission progress is recomputed from
 * evidence and can be audited; a tally cannot. Crediting one match twice is
 * therefore permanent and invisible, so `recordMatch` being the only caller of
 * `creditMatch` is a property worth asserting rather than assuming.
 *
 * **The deferral allowlist, again.** `DEFERRED_FACTS` is the same bargain
 * `DEFERRED_COSMETICS` makes: an achievement that cannot be earned says why. Two
 * tests walk it in both directions, so neither a silent impossibility nor a
 * stale excuse can survive.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { MatchConfig, MatchRecord, MatchState, PlayerIntent, Seat } from "../src/engine/types";
import { getContent } from "../src/engine/content";
import { autoBuildDeck } from "../src/engine/deck";
import { createMatch } from "../src/engine/state";
import { applyIntent } from "../src/engine/reducer";
import { replay } from "../src/engine/replay";
import { chooseIntent } from "../src/ai/ai";
import { getAiProfile } from "../src/ai/profiles";
import { emptyStats, matchStats } from "../src/game/missions/stats";
import {
  achievementKey,
  achievementsData,
  achievementViews,
  ACCOUNT_FACTS,
  baseMode,
  checkAchievementsData,
  creditMatch,
  DEFERRED_FACTS,
  deferralOf,
  emptyTally,
  haveFor,
  isGrantable,
  milestoneKey,
  milestoneViews,
  pointsFrom,
  reachablePoints,
  SET_DIMENSIONS,
  TALLIED_STATS,
  TOTAL_STATS,
  unclaimedCount,
  type AccountFacts,
  type AchievementTally,
} from "../src/game/achievements";
import { allCosmetics, checkCosmeticsData, cosmeticById } from "../src/game/cosmetics";
import { cosmeticsData } from "../src/game/cosmetics/data";
import {
  accountFacts,
  achievementBoard,
  achievementsUnclaimed,
  claimAchievement,
  claimPointMilestone,
  craftCard,
  profileStore,
  recordMatch,
  wearing,
} from "../src/save/profile";

const content = getContent();
const LEADER = "idols-lumi-starcall";
const ENEMY = "goth-leader-alaric-thornheart";

/** An account with nothing done and nothing owned. */
const zeroFacts = (): AccountFacts =>
  Object.fromEntries(ACCOUNT_FACTS.map((fact) => [fact, 0])) as AccountFacts;

/** A full match, played by the engine's own AI, so the feats come from the rules. */
function playRecord(seed: number, a: string, b: string): MatchRecord {
  const matchConfig: MatchConfig = {
    seed,
    decks: [autoBuildDeck(content, a, "A"), autoBuildDeck(content, b, "B")],
    firstSeat: 0,
  };
  let state: MatchState = createMatch(matchConfig, content);
  const intents: PlayerIntent[] = [];
  const profiles = [getAiProfile("casual"), getAiProfile("casual")];

  while (state.phase === "mulligan") {
    const seat: Seat = state.players[0].mulliganDone ? 1 : 0;
    const decision = chooseIntent(state, content, seat, profiles[seat]!);
    if (!decision) break;
    intents.push(decision.intent);
    state = applyIntent(state, content, decision.intent).state;
  }
  let guard = 0;
  while (state.winner === null && guard++ < 700) {
    const seat = state.activeSeat;
    const decision = chooseIntent(state, content, seat, profiles[seat]!);
    if (!decision) break;
    intents.push(decision.intent);
    try {
      state = applyIntent(state, content, decision.intent).state;
    } catch {
      break;
    }
  }
  return { config: matchConfig, intents, result: { winner: state.winner, turns: state.turn } } as MatchRecord;
}

/** A dozen real matches, played once and shared by every invariant test. */
const SAMPLE = [11, 22, 33, 44, 55, 66, 77, 88, 99, 111, 222, 333].map((seed) => playRecord(seed, LEADER, ENEMY));

// ---------------------------------------------------------------------------

describe("the catalogue", () => {
  it("loads and validates", () => {
    expect(achievementsData().achievements.length).toBeGreaterThanOrEqual(20);
  });

  it("says nothing that is not true of the shipped content", () => {
    const problems = checkAchievementsData(content);
    expect(problems, problems.length === 0 ? "" : `\ndata/achievements.json:\n  ${problems.join("\n  ")}\n`).toEqual(
      []
    );
  });

  it("names §9's seven categories", () => {
    const names = achievementsData().categories.map((category) => category.name);
    expect(names).toEqual([
      "Highlight Reel",
      "The Hoard",
      "The Grindset",
      "Weather",
      "Tourist",
      "Community",
      "Deep Cuts",
    ]);
  });

  it("ships §9.1's twenty canonical achievements, by name", () => {
    const names = new Set(achievementsData().achievements.map((def) => def.name));
    for (const canonical of [
      "We Did It, Chat!",
      "Chronically Online",
      "Down Catastrophically",
      "Log Off Speedrun",
      "Untouched, Unbothered",
      "Running on Vibes",
      "Sold-Out Show",
      "Ratio'd Into Orbit",
      "Well, Actually—",
      "Weather Machine",
      "Pitch Perfect Signal",
      "Type Chart Understander",
      "Multifandom Menace",
      "Whale-Free Since Day One",
      "Digital Dragon",
      "Closet Cosplayer",
      "Speedran the Grindset",
      "Content Slayer",
      "Front Row Seat",
      "404: Board Not Found",
    ]) {
      expect(names, `§9.1 names "${canonical}"`).toContain(canonical);
    }
  });

  it("gives every achievement a requirement the tally can answer", () => {
    const totals = new Set(TOTAL_STATS);
    const dimensions = new Set<string>(SET_DIMENSIONS);
    const facts = new Set<string>(ACCOUNT_FACTS);
    for (const def of achievementsData().achievements) {
      const requirement = def.requirement;
      const known =
        requirement.need === "distinct"
          ? dimensions.has(requirement.of)
          : requirement.need === "account"
            ? facts.has(requirement.of)
            : totals.has(requirement.stat);
      expect(known, `${def.id} asks about something nothing banks`).toBe(true);
    }
  });

  it("pays only Clout, Fragments and cosmetics — never cards", () => {
    for (const def of achievementsData().achievements) {
      for (const reward of def.rewards) {
        expect(["clout", "fragments", "cosmetic"], `${def.id}`).toContain(reward.kind);
      }
    }
  });
});

describe("the tally", () => {
  it("sums a statistic across matches", () => {
    const tally = emptyTally();
    creditMatch(tally, { ...emptyStats(0), charactersDefeated: 3 }, "ai-casual");
    creditMatch(tally, { ...emptyStats(0), charactersDefeated: 4 }, "ai-casual");
    expect(tally.totals["charactersDefeated"]).toBe(7);
  });

  it("keeps the best single match separately from the total", () => {
    const tally = emptyTally();
    creditMatch(tally, { ...emptyStats(0), mostLeaderDamageInATurn: 5 }, "ai-casual");
    creditMatch(tally, { ...emptyStats(0), mostLeaderDamageInATurn: 12 }, "ai-casual");
    creditMatch(tally, { ...emptyStats(0), mostLeaderDamageInATurn: 4 }, "ai-casual");
    expect(tally.bests["mostLeaderDamageInATurn"]).toBe(12);
    expect(tally.totals["mostLeaderDamageInATurn"]).toBe(21);
  });

  it("banks every statistic, not only the ones an achievement reads today", () => {
    /**
     * The point of the accumulator: a statistic that is not banked can never be
     * asked about retroactively, so an achievement added later would start every
     * existing account at zero.
     */
    const tally = emptyTally();
    const stats = emptyStats(0);
    for (const stat of TALLIED_STATS) stats[stat] = 1;
    creditMatch(tally, stats, "ai-casual");
    for (const stat of TALLIED_STATS) {
      expect(tally.totals[stat], `${stat} was not banked`).toBe(1);
    }
  });

  it("counts a faction only when the match was won", () => {
    const tally = emptyTally();
    creditMatch(tally, { ...emptyStats(0), factionId: "neon-idols", won: false }, "ai-casual");
    expect(tally.sets["factionsWon"] ?? []).toEqual([]);
    creditMatch(tally, { ...emptyStats(0), factionId: "neon-idols", won: true }, "ai-casual");
    expect(tally.sets["factionsWon"]).toEqual(["neon-idols"]);
  });

  it("never records the same distinct value twice", () => {
    const tally = emptyTally();
    for (let i = 0; i < 5; i++) {
      creditMatch(tally, { ...emptyStats(0), factionId: "neon-idols", won: true }, "ai-casual");
    }
    expect(tally.sets["factionsWon"]).toEqual(["neon-idols"]);
  });

  it("folds difficulty tiers into one mode", () => {
    const tally = emptyTally();
    creditMatch(tally, emptyStats(0), "ai-casual");
    creditMatch(tally, emptyStats(0), "ai-expert");
    creditMatch(tally, emptyStats(0), "boss-heroic");
    expect(tally.sets["modes"]).toEqual(["ai", "boss"]);
    expect(baseMode("doomscroll-elite")).toBe("doomscroll");
  });

  it("counts a boss win as a boss win and a loss as neither", () => {
    const tally = emptyTally();
    creditMatch(tally, { ...emptyStats(0), won: false }, "boss-heroic");
    expect(tally.totals["bossWins"] ?? 0).toBe(0);
    creditMatch(tally, { ...emptyStats(0), won: true }, "boss-heroic");
    expect(tally.totals["bossWins"]).toBe(1);
    // and an ordinary win is not one
    creditMatch(tally, { ...emptyStats(0), won: true }, "ai-casual");
    expect(tally.totals["bossWins"]).toBe(1);
    expect(tally.totals["wins"]).toBe(2);
  });

  it("collects distinct Confluences rather than counting activations", () => {
    const tally = emptyTally();
    creditMatch(tally, { ...emptyStats(0), confluencesActivated: 4, confluencesUsed: ["storm", "storm"] }, "ai");
    creditMatch(tally, { ...emptyStats(0), confluencesActivated: 1, confluencesUsed: ["bloom"] }, "ai");
    expect(tally.sets["confluences"]).toEqual(["storm", "bloom"]);
    expect(tally.totals["confluencesActivated"]).toBe(5);
  });
});

describe("reading a requirement", () => {
  const tally = (): AchievementTally => ({
    totals: { wins: 7 },
    bests: { mostLeaderDamageInATurn: 12 },
    sets: { confluences: ["a", "b", "c"] },
  });

  it("reads a lifetime total", () => {
    expect(haveFor({ need: "total", stat: "wins", target: 1 }, tally(), zeroFacts())).toBe(7);
  });

  it("reads a single-match best, which is not the total", () => {
    expect(haveFor({ need: "best", stat: "mostLeaderDamageInATurn", target: 12 }, tally(), zeroFacts())).toBe(12);
    expect(haveFor({ need: "total", stat: "mostLeaderDamageInATurn", target: 1 }, tally(), zeroFacts())).toBe(0);
  });

  it("reads a set size", () => {
    expect(haveFor({ need: "distinct", of: "confluences", target: 9 }, tally(), zeroFacts())).toBe(3);
  });

  it("reads an account fact", () => {
    const facts = { ...zeroFacts(), distinctCards: 142 };
    expect(haveFor({ need: "account", of: "distinctCards", target: 300 }, tally(), facts)).toBe(142);
  });

  it("treats a statistic never banked as zero rather than undefined", () => {
    expect(haveFor({ need: "total", stat: "cardsPlayed", target: 1 }, tally(), zeroFacts())).toBe(0);
  });
});

describe("what the deriver reads out of a real match", () => {
  it("never claims a bigger turn than the whole match", () => {
    for (const record of SAMPLE) {
      const stats = matchStats(record, content, 0);
      expect(stats.mostLeaderDamageInATurn).toBeLessThanOrEqual(stats.damageToEnemyLeader);
    }
  });

  it("agrees with the event stream about the biggest single turn", () => {
    /**
     * The independent oracle. This recomputes the answer from the raw events
     * rather than trusting the deriver's own bookkeeping, so a per-turn tally
     * that never resets and one that forgets the final turn both fail here.
     */
    let checkedANonTrivialMatch = false;
    for (const record of SAMPLE) {
      const stats = matchStats(record, content, 0);
      const { events } = replay(record, content);
      let best = 0;
      let thisTurn = 0;
      for (const event of events) {
        if (event.e === "turnStarted") {
          best = Math.max(best, thisTurn);
          thisTurn = 0;
        } else if (event.e === "damageDealt" && event.target.kind === "leader" && event.target.seat === 1) {
          thisTurn += event.amount;
        }
      }
      best = Math.max(best, thisTurn);
      expect(stats.mostLeaderDamageInATurn).toBe(best);
      if (best > 0 && best < stats.damageToEnemyLeader) checkedANonTrivialMatch = true;
    }
    // a sample where every match dealt all its damage in one turn would pass the
    // assertion above without ever exercising the reset
    expect(checkedANonTrivialMatch, "no sampled match spread leader damage across turns").toBe(true);
  });

  it("counts a board that never exceeds the six slots, and only on a win", () => {
    for (const record of SAMPLE) {
      const stats = matchStats(record, content, 0);
      expect(stats.widestWinningBoard).toBeLessThanOrEqual(content.balance.board.characterSlots);
      if (!stats.won) expect(stats.widestWinningBoard).toBe(0);
    }
  });

  it("sees characters leave the board as well as arrive", () => {
    /**
     * If nothing ever removed an instance, the peak would be every character
     * ever summoned rather than the most standing at once — which for a long
     * match is a much larger number than the board can hold.
     */
    const peaks = SAMPLE.map((record) => matchStats(record, content, 0)).map((stats) => stats.widestWinningBoard);
    expect(Math.max(...peaks)).toBeGreaterThan(0);
  });

  it("only calls a win flawless when the leader took nothing", () => {
    for (const record of SAMPLE) {
      const stats = matchStats(record, content, 0);
      if (stats.flawlessWin === 1) {
        expect(stats.won).toBe(true);
        expect(stats.leaderDamageTaken).toBe(0);
      }
      if (stats.shutoutWin === 1) {
        expect(stats.won).toBe(true);
        expect(stats.charactersDefeated).toBe(0);
      }
      if (stats.burnoutWin === 1) {
        expect(stats.won).toBe(true);
        expect(stats.fatigueTaken).toBeGreaterThan(0);
      }
    }
  });

  it("lists each Confluence once, and never more than it activated", () => {
    for (const record of SAMPLE) {
      const stats = matchStats(record, content, 0);
      expect(new Set(stats.confluencesUsed).size).toBe(stats.confluencesUsed.length);
      expect(stats.confluencesUsed.length).toBeLessThanOrEqual(stats.confluencesActivated);
    }
  });

  it("attributes damage to the leader that took it", () => {
    for (const record of SAMPLE) {
      const mine = matchStats(record, content, 0);
      const theirs = matchStats(record, content, 1);
      // what I dealt to their leader is what their leader took
      expect(mine.damageToEnemyLeader).toBe(theirs.leaderDamageTaken);
      expect(theirs.damageToEnemyLeader).toBe(mine.leaderDamageTaken);
    }
  });

  it("gives elemental bonus damage only where it gave a bonus hit", () => {
    for (const record of SAMPLE) {
      const stats = matchStats(record, content, 0);
      if (stats.elementalBonusHits === 0) expect(stats.elementalBonusDamage).toBe(0);
      else expect(stats.elementalBonusDamage).toBeGreaterThan(0);
    }
  });
});

describe("points", () => {
  it("counts what is unlocked, not what has been collected", () => {
    /**
     * Otherwise the point milestones sit behind a chore: a player who earned
     * twenty achievements and never opened the screen would have zero points.
     */
    const tally: AchievementTally = { totals: { wins: 1 }, bests: {}, sets: {} };
    const unclaimed = achievementViews(tally, zeroFacts(), []);
    const claimed = achievementViews(tally, zeroFacts(), [achievementKey("we-did-it-chat")]);
    expect(pointsFrom(unclaimed)).toBe(pointsFrom(claimed));
    expect(pointsFrom(unclaimed)).toBeGreaterThan(0);
  });

  it("lists no milestone nobody can reach", () => {
    for (const milestone of achievementsData().milestones) {
      expect(milestone.points, `milestone ${milestone.points}`).toBeLessThanOrEqual(reachablePoints());
    }
  });

  it("excludes the achievements nothing can earn from the reachable total", () => {
    const everything = achievementsData().achievements.reduce((sum, def) => sum + def.points, 0);
    const deferred = achievementsData()
      .achievements.filter((def) => deferralOf(def) !== null)
      .reduce((sum, def) => sum + def.points, 0);
    expect(deferred).toBeGreaterThan(0);
    expect(reachablePoints()).toBe(everything - deferred);
  });

  it("unlocks a milestone at its threshold, not a point before it", () => {
    const first = achievementsData().milestones[0]!;
    expect(milestoneViews(first.points - 1, [])[0]!.unlocked).toBe(false);
    expect(milestoneViews(first.points, [])[0]!.unlocked).toBe(true);
  });
});

describe("the deferral allowlist", () => {
  it("gives every unearnable achievement a written reason", () => {
    for (const def of achievementsData().achievements) {
      if (def.requirement.need !== "account") continue;
      const fact = def.requirement.of;
      if (!DEFERRED_FACTS.has(fact as never)) continue;
      expect(DEFERRED_FACTS.get(fact as never)!.length, `${def.id}`).toBeGreaterThan(10);
    }
    // and the one that ships deferred is the one §9 puts behind a server
    const social = achievementsData().achievements.filter((def) => deferralOf(def) !== null);
    expect(social.map((def) => def.id)).toEqual(["front-row-seat"]);
  });

  it("keeps no excuse alive past the thing it excuses", () => {
    /**
     * The staleness half. `accountFacts` is what the game actually computes, so
     * the day spectating starts producing a number, this fails and whoever wired
     * it has to delete the line — making the achievement earnable in the same
     * commit rather than leaving it greyed out forever.
     */
    profileStore.reset();
    const facts = accountFacts(content);
    for (const [fact, reason] of DEFERRED_FACTS) {
      expect(facts[fact], `"${reason}" — but ${fact} is being computed now`).toBe(0);
    }
  });

  it("does not offer a claim for something nobody can unlock", () => {
    const board = achievementViews(emptyTally(), zeroFacts(), []);
    const front = board.find((view) => view.def.id === "front-row-seat")!;
    expect(front.deferred).not.toBeNull();
    expect(front.unlocked).toBe(false);
  });
});

describe("the award cosmetics", () => {
  it("still leaves the catalogue consistent", () => {
    const problems = checkCosmeticsData(content);
    expect(problems, problems.length === 0 ? "" : `\ndata/cosmetics.json:\n  ${problems.join("\n  ")}\n`).toEqual([]);
  });

  it("resolves every ref an achievement or milestone promises", () => {
    const refs = [
      ...achievementsData().achievements.flatMap((def) => def.rewards),
      ...achievementsData().milestones.map((milestone) => milestone.reward),
    ]
      .filter((reward) => reward.kind === "cosmetic")
      .map((reward) => (reward.kind === "cosmetic" ? reward.ref : undefined));
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref, "an achievement promises a cosmetic with no ref").toBeTruthy();
      expect(cosmeticById(content, ref!), `${ref} resolves to nothing`).not.toBeNull();
    }
  });

  it("refuses to resolve an award into the wrong slot", () => {
    // "stormfront" is a title; asking for it as a frame must not produce a frame
    expect(cosmeticById(content, "title:award:stormfront")).not.toBeNull();
    expect(cosmeticById(content, "frame:award:stormfront")).toBeNull();
    expect(cosmeticById(content, "badge:award:stormfront")).toBeNull();
  });

  it("names §13's titles exactly", () => {
    for (const [id, title] of [
      ["title:award:chronically-online", "Chronically Online"],
      ["title:award:certified-grass-toucher", "Certified Grass Toucher"],
      ["title:award:stormfront", "Stormfront"],
      ["title:award:multifandom-menace", "Multifandom Menace"],
      ["title:award:terminally-levelled", "Terminally Levelled"],
    ]) {
      expect(cosmeticById(content, id!)?.name).toBe(title);
    }
  });

  it("puts every award in the catalogue, so a picker can show it", () => {
    const catalogue = new Set(allCosmetics(content).map((cosmetic) => cosmetic.id));
    for (const [award, entry] of Object.entries(cosmeticsData().awards)) {
      expect(catalogue, `${award} is not in allCosmetics`).toContain(`${entry.kind}:award:${award}`);
    }
  });
});

describe("earning and claiming", () => {
  beforeEach(() => profileStore.reset());

  /** Bank a forged match without playing one. */
  const bank = (over: Partial<ReturnType<typeof emptyStats>>, mode = "ai-casual"): void => {
    profileStore.update((draft) => {
      creditMatch(draft.achievements.tally, { ...emptyStats(0), ...over }, mode);
    });
  };

  it("starts with nothing unlocked and nothing to claim", () => {
    const board = achievementBoard(content);
    expect(board.points).toBe(0);
    expect(board.views.some((view) => view.unlocked)).toBe(false);
    expect(achievementsUnclaimed(content)).toBe(0);
  });

  it("unlocks the first win the moment a win is banked", () => {
    bank({ won: true, factionId: "neon-idols" });
    const view = achievementBoard(content).views.find((entry) => entry.def.id === "we-did-it-chat")!;
    expect(view.unlocked).toBe(true);
    expect(view.claimable).toBe(true);
  });

  it("pays the Clout once and refuses the second time", () => {
    bank({ won: true, factionId: "neon-idols" });
    const before = profileStore.get().clout;
    const grant = claimAchievement(content, "we-did-it-chat");
    expect(grant?.clout).toBe(100);
    expect(profileStore.get().clout).toBe(before + 100);
    expect(claimAchievement(content, "we-did-it-chat")).toBeNull();
    expect(profileStore.get().clout).toBe(before + 100);
  });

  it("refuses an achievement nobody has unlocked", () => {
    const before = profileStore.get().clout;
    expect(claimAchievement(content, "we-did-it-chat")).toBeNull();
    expect(profileStore.get().clout).toBe(before);
    expect(profileStore.get().achievements.claimed).toEqual([]);
  });

  it("refuses an id that names no achievement", () => {
    expect(claimAchievement(content, "not-a-real-achievement")).toBeNull();
  });

  it("grants a title, and wears it because the slot was empty", () => {
    for (let i = 0; i < 25; i++) bank({ charactersBanished: 1 });
    const grant = claimAchievement(content, "log-off-speedrun");
    expect(grant?.cosmetics.map((cosmetic) => cosmetic.name)).toEqual(["Certified Grass Toucher"]);
    expect(wearing(content, "title")?.id).toBe("title:award:certified-grass-toucher");
  });

  it("counts the ten factions rather than ten wins", () => {
    for (let i = 0; i < 10; i++) bank({ won: true, factionId: "neon-idols" });
    expect(achievementBoard(content).views.find((v) => v.def.id === "multifandom-menace")!.unlocked).toBe(false);

    const factions = Object.values(content.factions)
      .filter((faction) => faction.id !== "neutral")
      .map((faction) => faction.id);
    expect(factions.length).toBe(10);
    for (const factionId of factions) bank({ won: true, factionId });
    expect(achievementBoard(content).views.find((v) => v.def.id === "multifandom-menace")!.unlocked).toBe(true);
  });

  it("reads the account rather than the tally for a collection achievement", () => {
    profileStore.update((draft) => {
      for (let i = 0; i < 100; i++) draft.collection[`fake-card-${i}`] = 1;
    });
    expect(accountFacts(content).distinctCards).toBe(100);
    expect(achievementBoard(content).views.find((v) => v.def.id === "curator")!.unlocked).toBe(true);
  });

  it("counts a crafted Legendary, and only a Legendary", () => {
    const legendary = Object.values(content.cards).find((card) => card.rarity === "legendary" && !card.token)!;
    const common = Object.values(content.cards).find((card) => card.rarity === "common" && !card.token)!;
    profileStore.update((draft) => {
      draft.shards = 100_000;
    });
    expect(craftCard(content, common.id)).toBe(true);
    expect(accountFacts(content).legendariesCrafted).toBe(0);
    expect(craftCard(content, legendary.id)).toBe(true);
    expect(accountFacts(content).legendariesCrafted).toBe(1);
    expect(achievementBoard(content).views.find((v) => v.def.id === "whale-free")!.unlocked).toBe(true);
  });

  it("hides a hidden achievement until it is unlocked, and never after", () => {
    const hidden = () => achievementBoard(content).views.find((v) => v.def.id === "board-not-found")!;
    expect(hidden().concealed).toBe(true);
    expect(hidden().def.hint).toBeTruthy();
    bank({ won: true, shutoutWin: 1, factionId: "neon-idols" });
    expect(hidden().concealed).toBe(false);
    expect(hidden().unlocked).toBe(true);
  });

  it("pays a point milestone once the points are there", () => {
    const first = achievementsData().milestones[0]!;
    expect(claimPointMilestone(content, first.points)).toBeNull();

    // unlock enough to cross the threshold, without claiming any of them
    const confluenceIds = Object.keys(content.confluences);
    profileStore.update((draft) => {
      draft.accountLevel = 60;
      creditMatch(
        draft.achievements.tally,
        {
          ...emptyStats(0),
          won: true,
          fullFixations: 1,
          charactersBanished: 25,
          flawlessWin: 1,
          burnoutWin: 1,
          shutoutWin: 1,
          widestWinningBoard: 6,
          mostLeaderDamageInATurn: 12,
          reactionsTriggered: 50,
          perfectResonances: 10,
          elementalBonusDamage: 250,
          confluencesUsed: confluenceIds,
        },
        "ai"
      );
    });
    const board = achievementBoard(content);
    expect(board.points).toBeGreaterThanOrEqual(first.points);

    const grant = claimPointMilestone(content, first.points);
    expect(grant?.cosmetics.map((cosmetic) => cosmetic.id)).toEqual(["frame:award:trophy-shelf"]);
    expect(wearing(content, "frame")?.id).toBe("frame:award:trophy-shelf");
    expect(claimPointMilestone(content, first.points)).toBeNull();
  });

  it("keeps claim keys out of the ledger that trims itself", () => {
    /**
     * `claimedRewards` evicts old keys at 400 entries. An achievement is
     * permanent, so a key that aged out of it would become claimable again —
     * the bug the Grand Tour reward hit.
     */
    bank({ won: true, factionId: "neon-idols" });
    claimAchievement(content, "we-did-it-chat");
    expect(profileStore.get().achievements.claimed).toEqual([achievementKey("we-did-it-chat")]);
    expect(profileStore.get().claimedRewards).not.toContain(achievementKey("we-did-it-chat"));
  });

  it("counts what is waiting, for the lobby badge", () => {
    expect(achievementsUnclaimed(content)).toBe(0);
    bank({ won: true, factionId: "neon-idols" });
    expect(achievementsUnclaimed(content)).toBe(1);
    claimAchievement(content, "we-did-it-chat");
    expect(achievementsUnclaimed(content)).toBe(0);
  });

  it("counts milestones in the same badge", () => {
    const views = achievementViews(emptyTally(), zeroFacts(), []);
    expect(unclaimedCount(views, milestoneViews(0, []))).toBe(0);
  });
});

describe("the accumulator, through a real match", () => {
  beforeEach(() => profileStore.reset());

  const record = SAMPLE[0]!;

  it("credits exactly one match per recorded match", () => {
    recordMatch(record, "win", {
      deckName: "T",
      leaderCardId: LEADER,
      opponentLeaderCardId: ENEMY,
      mode: "ai-casual",
      content,
    });
    expect(profileStore.get().achievements.tally.totals["matches"]).toBe(1);

    recordMatch(record, "loss", {
      deckName: "T",
      leaderCardId: LEADER,
      opponentLeaderCardId: ENEMY,
      mode: "ai-casual",
      content,
    });
    expect(profileStore.get().achievements.tally.totals["matches"]).toBe(2);
  });

  it("banks the same numbers the deriver read", () => {
    const expected = matchStats(record, content, 0);
    recordMatch(record, expected.won ? "win" : "loss", {
      deckName: "T",
      leaderCardId: LEADER,
      opponentLeaderCardId: ENEMY,
      mode: "ai-casual",
      content,
    });
    const tally = profileStore.get().achievements.tally;
    expect(tally.totals["cardsPlayed"]).toBe(expected.cardsPlayed);
    expect(tally.totals["charactersDefeated"]).toBe(expected.charactersDefeated);
    expect(tally.bests["mostLeaderDamageInATurn"] ?? 0).toBe(expected.mostLeaderDamageInATurn);
  });

  it("credits nothing at all without the content index", () => {
    // no content means no replay, which means no statistics to bank
    recordMatch(record, "win", {
      deckName: "T",
      leaderCardId: LEADER,
      opponentLeaderCardId: ENEMY,
      mode: "ai-casual",
    });
    expect(profileStore.get().achievements.tally.totals["matches"] ?? 0).toBe(0);
  });

  it("survives a save written before achievements existed", () => {
    profileStore.update((draft) => {
      delete (draft as { achievements?: unknown }).achievements;
    });
    expect(() =>
      recordMatch(record, "win", {
        deckName: "T",
        leaderCardId: LEADER,
        opponentLeaderCardId: ENEMY,
        mode: "ai-casual",
        content,
      })
    ).not.toThrow();
    expect(profileStore.get().achievements.tally.totals["matches"]).toBe(1);
    expect(() => achievementBoard(content)).not.toThrow();
  });
});

describe("grantability", () => {
  it("calls a cosmetic grantable exactly when it names a ref", () => {
    expect(isGrantable({ kind: "cosmetic", name: "x" })).toBe(false);
    expect(isGrantable({ kind: "cosmetic", name: "x", ref: "title:award:stormfront" })).toBe(true);
    expect(isGrantable({ kind: "clout", amount: 1 })).toBe(true);
  });

  it("ships nothing that promises a cosmetic it cannot pay", () => {
    for (const def of achievementsData().achievements) {
      for (const reward of def.rewards) {
        expect(isGrantable(reward), `${def.id} promises "${reward.kind}" it cannot pay`).toBe(true);
      }
    }
  });
});
