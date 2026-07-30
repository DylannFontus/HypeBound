/**
 * Faction Mastery, Leader Mastery and the Bias Board.
 *
 * `08-progression.md` §4, §5 and §6. Two things in here are load-bearing and
 * neither is obvious from the code:
 *
 * **The calibration test.** §4.1's XP-per-rank numbers are derived from §2.2's
 * assumption that a match averages 75 XP, and the shipped match pays less than
 * that. `progression.json` therefore carries a re-scaled curve, and the thing
 * that must stay true is not the XP but the **match counts** in the design's own
 * rightmost column. That test re-derives them from the shipped match XP, so
 * changing what a match pays without re-scaling the curve fails immediately
 * rather than silently making every track twice as long.
 *
 * **The deferral allowlist.** Most of the design's mastery rewards are cosmetics
 * the game has no system for. They are carried in the data so the track can show
 * a player what is coming, and refused at grant time. Two tests walk that in both
 * directions: nothing may be deferred without a written reason, and no reason may
 * outlive the thing it excuses.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { CardDef, CurrentId, DeckList, MatchConfig, MatchRecord, MatchState, PlayerIntent, Seat } from "../src/engine/types";
import { openDrop } from "../src/game/economy/drops";
import { seedRng } from "../src/engine/rng";
import { fillDeck, fixtureContent, testCharacter, testLeader } from "./fixtures";
import { getContent, selectableLeaders } from "../src/engine/content";
import { autoBuildDeck } from "../src/engine/deck";
import { createMatch } from "../src/engine/state";
import { applyIntent } from "../src/engine/reducer";
import { chooseIntent } from "../src/ai/ai";
import { getAiProfile } from "../src/ai/profiles";
import { matchStats, readMatch } from "../src/game/missions/stats";
import {
  affinityView,
  canPick,
  checkMasteryData,
  claimKey,
  DEFERRED_COSMETICS,
  factionPool,
  factionTracks,
  isGrantable,
  leaderTracks,
  leadersOfFaction,
  matchXp,
  pickCandidates,
  rankFor,
  rewardsAt,
  xpForRank,
  xpToReach,
} from "../src/game/progression/mastery";
import { checkMasteryLore, masteryLore } from "../src/game/progression/masteryLore";
import { cardBackId, STARTER_EMOTES } from "../src/game/cosmetics";
import { matchesFilter } from "../src/game/missions/objectives";
import { weeklyPool } from "../src/game/missions";
import { SUM_STATS, type MatchOutcome } from "../src/game/missions/types";
import {
  biasBoard,
  claimAffinityTier,
  claimMasteryRank,
  claimMission,
  factionMastery,
  leaderMastery,
  masteryPickChoices,
  masteryUnclaimed,
  emoteWheel,
  missionViews,
  ownsCosmetic,
  profileStore,
  recordMatch,
  syncMissions,
  wearing,
} from "../src/save/profile";

import {
  affinityConfig,
  factionMasteryConfig,
  leaderMasteryConfig,
  xpConfig,
  type MasteryReward,
} from "../src/game/progression/data";

const content = getContent();
const faction = factionMasteryConfig();
const leader = leaderMasteryConfig();

/** Collectible characters, in a stable order, for the Bias Board tests. */
const collectibleCharacters = () =>
  Object.values(content.cards)
    .filter((card) => card.type === "character" && !card.token && !card.variantOf)
    .sort((a, b) => (a.id < b.id ? -1 : 1));

/** A full match, played by the engine's own AI, so the AP comes from the rules. */
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

describe("the curve", () => {
  it("starts every track at rank 1 with nothing banked", () => {
    const state = rankFor(faction, 0);
    expect(state.rank).toBe(1);
    expect(state.intoRank).toBe(0);
    expect(state.maxed).toBe(false);
    expect(state.toNext).toBe(xpToReach(faction, 2));
  });

  it("promotes exactly at the threshold, not a point before it", () => {
    const cost = xpToReach(faction, 2);
    expect(rankFor(faction, cost - 1).rank).toBe(1);
    expect(rankFor(faction, cost).rank).toBe(2);
    expect(rankFor(faction, cost).intoRank).toBe(0);
  });

  it("keeps the remainder as progress into the next rank", () => {
    const state = rankFor(faction, xpForRank(faction, 4) + 60);
    expect(state.rank).toBe(4);
    expect(state.intoRank).toBe(60);
    expect(state.toNext).toBe(xpToReach(faction, 5));
  });

  it("caps at the last rank and stops asking for more", () => {
    const state = rankFor(faction, xpForRank(faction, faction.ranks) + 100_000);
    expect(state.rank).toBe(faction.ranks);
    expect(state.maxed).toBe(true);
    expect(state.toNext).toBe(0);
    expect(state.intoRank).toBe(0);
  });

  it("charges the band price the design printed, band by band", () => {
    // §4.1: ranks 2-5 are the cheap band, 16-20 the dear one
    expect(xpToReach(faction, 2)).toBe(xpToReach(faction, 5));
    expect(xpToReach(faction, 6)).toBeGreaterThan(xpToReach(faction, 5));
    expect(xpToReach(faction, 20)).toBeGreaterThan(xpToReach(faction, 15));
  });

  it("is monotonic — more XP never means a lower rank", () => {
    let previous = 0;
    for (let xp = 0; xp <= xpForRank(faction, faction.ranks); xp += 97) {
      const { rank } = rankFor(faction, xp);
      expect(rank).toBeGreaterThanOrEqual(previous);
      previous = rank;
    }
  });

  it("treats negative XP as zero rather than throwing", () => {
    expect(rankFor(faction, -500).rank).toBe(1);
  });
});

describe("the design's match counts survive the re-scale", () => {
  /**
   * §2.2 fixes the reference: a match averages the completion XP plus half the
   * win bonus, at the 50% winrate every calibration table in the doc assumes.
   */
  const averageMatchXp = (): number => (matchXp(true) + matchXp(false)) / 2;

  /** §4.1 and §5.1's rightmost column — the part that expresses the intent. */
  const DESIGN_MATCHES = {
    faction: [
      { throughRank: 5, matches: 21 },
      { throughRank: 10, matches: 53 },
      { throughRank: 15, matches: 80 },
      { throughRank: 20, matches: 107 },
    ],
    leader: [
      { throughRank: 4, matches: 12 },
      { throughRank: 7, matches: 24 },
      { throughRank: 10, matches: 48 },
    ],
  };

  it("prices a match at the XP the account level is actually paid", () => {
    const xp = xpConfig();
    expect(matchXp(false)).toBe(xp.matchComplete);
    expect(matchXp(true)).toBe(xp.matchComplete + xp.matchWin);
    expect(matchXp(true)).toBeGreaterThan(matchXp(false));
  });

  it("lands every faction band within 5% of the matches §4.1 promises", () => {
    let from = 1;
    for (const band of DESIGN_MATCHES.faction) {
      const cost = xpForRank(faction, band.throughRank) - xpForRank(faction, from);
      const matches = cost / averageMatchXp();
      expect(Math.abs(matches - band.matches) / band.matches).toBeLessThan(0.05);
      from = band.throughRank;
    }
  });

  it("lands every leader band within 5% of the matches §5.1 promises", () => {
    let from = 1;
    for (const band of DESIGN_MATCHES.leader) {
      const cost = xpForRank(leader, band.throughRank) - xpForRank(leader, from);
      const matches = cost / averageMatchXp();
      expect(Math.abs(matches - band.matches) / band.matches).toBeLessThan(0.05);
      from = band.throughRank;
    }
  });

  it("keeps the whole faction track near the design's ~261 matches", () => {
    const matches = xpForRank(faction, faction.ranks) / averageMatchXp();
    expect(matches).toBeGreaterThan(248);
    expect(matches).toBeLessThan(274);
  });

  it("front-loads the card value: ranks 1-10 are under a third of the XP", () => {
    // §4.1 "the first 10 ranks contain all card-value rewards and cost only 29%"
    const share = xpForRank(faction, 10) / xpForRank(faction, faction.ranks);
    expect(share).toBeLessThan(0.33);
  });

  /**
   * §4.1 and §4.2 disagree, and §4.2 is what shipped.
   *
   * §4.1's prose says ranks 1-10 hold *"all* card-value rewards" and 11-20 are
   * "cosmetic prestige for people in love" — and §14 restates that as a binding
   * constraint, "100% of the card value". But §4.2's own table, three paragraphs
   * later, puts Faction Packs at ranks 14 and 17, 150 Fragments at 15, and Clout
   * at 11, 13, 16 and 19. The two cannot both be true.
   *
   * The table wins, on the same rule that settled §3.4 against §08's level bands:
   * it is the more specific of the two, and it is the one a player reads on the
   * track. What §14 is *for* still holds and is what these two tests assert —
   * sampling factions has to stay more reward-dense than maining one, which is
   * true of the shipped table by a wide margin even though the back half is not
   * empty. The contradiction is flagged in docs/PROJECT-STATUS.md rather than
   * quietly resolved.
   */
  it("keeps every pick — the targeted card value — inside the first ten ranks", () => {
    for (let rank = 11; rank <= faction.ranks; rank++) {
      for (const reward of rewardsAt(faction, rank)) {
        expect(reward.kind, `rank ${rank} offers a pick, which belongs in the front half`).not.toBe("pick");
      }
    }
    const picks = [...Array(10).keys()].flatMap((index) =>
      rewardsAt(faction, index + 1).filter((reward) => reward.kind === "pick")
    );
    expect(picks.length).toBe(3);
  });

  it("keeps the first ten ranks far more reward-dense than the last ten", () => {
    const { pack, craftCost } = content.balance.economy;
    const worth = (reward: MasteryReward): number => {
      if (reward.kind === "clout") return reward.amount;
      if (reward.kind === "fragments") return reward.amount;
      if (reward.kind === "pack") return pack.price;
      if (reward.kind === "pick") return (craftCost[reward.rarity] ?? 0) * reward.copies;
      return 0;
    };
    const density = (from: number, to: number): number => {
      let total = 0;
      for (let rank = from; rank <= to; rank++) total += rewardsAt(faction, rank).reduce((s, r) => s + worth(r), 0);
      return total / (xpForRank(faction, to) - xpForRank(faction, from - 1));
    };
    expect(density(1, 10) / density(11, 20)).toBeGreaterThan(1.5);
  });
});

describe("rewards, and what is honestly deferred", () => {
  const allRewards = (): MasteryReward[] => [
    ...Object.values(faction.rewards).flat(),
    ...Object.values(leader.rewards).flat(),
    ...affinityConfig().tiers.flatMap((tier) => tier.rewards),
  ];

  it("has a written reason for every cosmetic it cannot grant", () => {
    // a cosmetic with a `ref` is granted for real now; only the ones without
    // need an excuse
    const missing = allRewards()
      .filter((reward) => reward.kind === "cosmetic" && !reward.ref)
      .map((reward) => (reward.kind === "cosmetic" ? reward.cosmetic : ""))
      .filter((cosmetic) => !DEFERRED_COSMETICS.has(cosmetic));
    expect([...new Set(missing)]).toEqual([]);
  });

  it("keeps no excuse for a cosmetic that now ships", () => {
    /**
     * The staleness half, and it earned its keep: when the cosmetics layer
     * landed, this test is what listed the five kinds — card backs, emotes,
     * frames, titles, badges — whose deferral had stopped being true.
     */
    const stillDeferred = new Set(
      allRewards().flatMap((reward) => (reward.kind === "cosmetic" && !reward.ref ? [reward.cosmetic] : []))
    );
    const stale = [...DEFERRED_COSMETICS.keys()].filter((cosmetic) => !stillDeferred.has(cosmetic));
    expect(stale).toEqual([]);
  });

  it("gives every deferral a reason worth reading, not a shrug", () => {
    for (const [cosmetic, reason] of DEFERRED_COSMETICS) {
      expect(reason.length, `${cosmetic} has no real reason`).toBeGreaterThan(20);
    }
  });

  it("counts cosmetics as ungrantable and everything else as grantable", () => {
    expect(isGrantable({ kind: "clout", amount: 100 })).toBe(true);
    expect(isGrantable({ kind: "pack" })).toBe(true);
    expect(isGrantable({ kind: "lore", page: 1 })).toBe(true);
    expect(isGrantable({ kind: "cosmetic", cosmetic: "title", name: "x" })).toBe(false);
  });

  it("pays the Clout §4.2 prints, at the ranks it prints them", () => {
    const cloutAt = (rank: number): number =>
      rewardsAt(faction, rank).reduce((sum, reward) => sum + (reward.kind === "clout" ? reward.amount : 0), 0);
    expect(cloutAt(1)).toBe(100);
    expect(cloutAt(4)).toBe(150);
    expect(cloutAt(11)).toBe(200);
    expect(cloutAt(16)).toBe(250);
    expect(cloutAt(19)).toBe(300);
  });

  it("makes leader mastery cosmetic and lore only, as §5 requires", () => {
    // "faction mastery already carries the card value, so trying a new leader
    // never feels like abandoning card progression"
    for (const rewards of Object.values(leader.rewards)) {
      for (const reward of rewards) {
        expect(["lore", "cosmetic"]).toContain(reward.kind);
      }
    }
  });

  it("makes affinity cosmetic and lore only, as §6 requires", () => {
    for (const tier of affinityConfig().tiers) {
      for (const reward of tier.rewards) {
        expect(["lore", "cosmetic"]).toContain(reward.kind);
      }
    }
  });
});

describe("track views", () => {
  it("gives every faction but neutral a track", () => {
    const views = factionTracks(content, {}, []);
    expect(views.length).toBe(10);
    expect(views.some((view) => view.id === "neutral")).toBe(false);
  });

  it("gives every selectable leader a track, and no boss or tutorial leader one", () => {
    const views = leaderTracks(content, {}, []);
    expect(views.length).toBe(selectableLeaders(content).length);
    expect(views.some((view) => view.id.startsWith("boss-"))).toBe(false);
    expect(views.some((view) => view.id.startsWith("tut-"))).toBe(false);
  });

  it("marks a rank earned once the track reaches it", () => {
    const xp = xpForRank(faction, 3);
    const view = factionTracks(content, { "neon-idols": xp }, [])[0]!;
    const track = factionTracks(content, { "neon-idols": xp }, []).find((v) => v.id === "neon-idols")!;
    expect(view.rows.length).toBeGreaterThan(0);
    expect(track.rank).toBe(3);
    expect(track.rows.filter((row) => row.earned).map((row) => row.rank)).toEqual([1, 2, 3]);
  });

  it("counts only genuinely payable rows as unclaimed", () => {
    /**
     * Leader Mastery level 5 is an alternate static portrait and nothing else,
     * and portraits are still deferred — so reaching it must not put a number on
     * the lobby badge that no button can clear.
     *
     * This used to be faction rank 12, a deferred emote. Emotes ship now, and
     * every rank on the faction track is payable; the leader track is where the
     * genuinely unpayable rows moved to.
     */
    const leaderId = selectableLeaders(content)[0]!.id;
    const track = leaderTracks(content, { [leaderId]: xpForRank(leader, 5) }, []).find(
      (view) => view.id === leaderId
    )!;
    const level5 = track.rows.find((row) => row.rank === 5)!;
    expect(level5.earned).toBe(true);
    expect(level5.claimable).toBe(false);
    expect(track.rows.filter((row) => row.claimable).every((row) => row.rewards.some(isGrantable))).toBe(true);
  });

  it("stops counting a rank once it has been claimed", () => {
    const xp = { "neon-idols": xpForRank(faction, 4) };
    const before = factionTracks(content, xp, []).find((view) => view.id === "neon-idols")!;
    const after = factionTracks(content, xp, [claimKey("faction", "neon-idols", 1)]).find(
      (view) => view.id === "neon-idols"
    )!;
    expect(after.unclaimed).toBe(before.unclaimed - 1);
    expect(after.rows.find((row) => row.rank === 1)!.claimed).toBe(true);
  });

  it("never offers an unearned rank", () => {
    const track = factionTracks(content, { "neon-idols": 0 }, []).find((view) => view.id === "neon-idols")!;
    expect(track.unclaimed).toBe(0);
    expect(track.rows.every((row) => !row.claimable)).toBe(true);
  });

  it("pays nothing for a faction the account has never played", () => {
    /**
     * Rank 1 costs no XP and §4.2 hangs 100 Clout on it, so read literally a
     * brand-new account is owed 1,000 Clout across the ten tracks for having
     * played nothing at all. One match with the faction is the price of rank 1.
     */
    const untouched = factionTracks(content, {}, []);
    expect(untouched.reduce((sum, view) => sum + view.unclaimed, 0)).toBe(0);

    const played = factionTracks(content, { "neon-idols": matchXp(false) }, []);
    expect(played.find((view) => view.id === "neon-idols")!.unclaimed).toBe(1);
    expect(played.filter((view) => view.id !== "neon-idols").every((view) => view.unclaimed === 0)).toBe(true);
  });

  it("attributes a leader track to its own faction", () => {
    const views = leaderTracks(content, {}, []);
    for (const view of views) {
      expect(content.factions[view.factionId as keyof typeof content.factions]).toBeTruthy();
      expect(leadersOfFaction(content, view.factionId).some((l) => l.id === view.id)).toBe(true);
    }
  });
});

describe("faction packs and picks", () => {
  it("gives every faction a pool big enough for a Faction Pack", () => {
    for (const id of Object.keys(content.factions)) {
      if (id === "neutral") continue;
      expect(factionPool(content, id).length).toBeGreaterThanOrEqual(content.balance.economy.packSize);
    }
  });

  it("draws a pack pool from one faction only", () => {
    for (const card of factionPool(content, "gothic-royalty")) {
      expect(card.faction).toBe("gothic-royalty");
    }
  });

  it("offers the same three cards every time it is asked", () => {
    const first = pickCandidates(content, "neon-idols", 3, "common", 3);
    const second = pickCandidates(content, "neon-idols", 3, "common", 3);
    expect(first.map((card) => card.id)).toEqual(second.map((card) => card.id));
    expect(first).toHaveLength(3);
  });

  it("offers different cards at different ranks", () => {
    const rank3 = pickCandidates(content, "neon-idols", 3, "rare", 3).map((card) => card.id);
    const rank6 = pickCandidates(content, "neon-idols", 6, "rare", 3).map((card) => card.id);
    expect(rank3).not.toEqual(rank6);
  });

  it("offers only cards of the rarity and faction the reward names", () => {
    for (const card of pickCandidates(content, "digital-demons", 6, "rare", 3)) {
      expect(card.rarity).toBe("rare");
      expect(card.faction).toBe("digital-demons");
    }
  });

  it("never offers the same card twice in one pick", () => {
    for (const id of Object.keys(content.factions)) {
      if (id === "neutral") continue;
      const ids = pickCandidates(content, id, 3, "common", 3).map((card) => card.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("still fills a pack when the pool has no card of the rolled rarity", () => {
    /**
     * A restricted pool can be missing a rarity, and the Rare floor makes that
     * bite on nearly every pack: `minRarePerPack` forces the last slot to Rare,
     * and a Commons-only pool has none. Without the substitution the pack
     * silently arrives short, which is the failure this project keeps finding.
     *
     * Driven by a deliberately impoverished pool rather than by a faction,
     * because every shipped faction stocks all four rarities — so the fallback
     * would otherwise be code that exists and is never once executed.
     */
    const commonsOnly = (card: CardDef): boolean => card.faction === "neon-idols" && card.rarity === "common";
    for (let seed = 1; seed <= 20; seed++) {
      const drop = openDrop(content, { owned: {}, sinceLegendary: 0 }, seedRng(seed), { pool: commonsOnly });
      expect(drop.cards, `seed ${seed} produced a short pack`).toHaveLength(content.balance.economy.packSize);
      for (const card of drop.cards) expect(card.rarity).toBe("common");
    }
  });

  it("only accepts a card it actually offered", () => {
    const offered = pickCandidates(content, "neon-idols", 3, "common", 3);
    expect(canPick(content, "neon-idols", 3, "common", 3, offered[0]!.id)).toBe(true);
    const notOffered = factionPool(content, "neon-idols")
      .filter((card) => card.rarity === "common")
      .find((card) => !offered.some((pick) => pick.id === card.id));
    expect(notOffered, "the faction has no fourth Common to test with").toBeTruthy();
    expect(canPick(content, "neon-idols", 3, "common", 3, notOffered!.id)).toBe(false);
    expect(canPick(content, "neon-idols", 3, "common", 3, "not-a-card")).toBe(false);
  });
});

describe("the Bias Board", () => {
  const config = affinityConfig();
  const character = Object.values(content.cards).find((card) => card.type === "character" && !card.token)!;

  it("starts every character at no tier", () => {
    const view = affinityView(character, 0, new Set());
    expect(view.tier).toBe(0);
    expect(view.tierName).toBeNull();
    expect(view.nextAt).toBe(config.tiers[0]!.ap);
    expect(view.unclaimed).toBe(0);
  });

  it("promotes at each published threshold", () => {
    config.tiers.forEach((tier, index) => {
      expect(affinityView(character, tier.ap - 1, new Set()).tier).toBe(index);
      expect(affinityView(character, tier.ap, new Set()).tier).toBe(index + 1);
    });
  });

  it("tops out at the last tier and asks for nothing more", () => {
    const top = config.tiers[config.tiers.length - 1]!;
    const view = affinityView(character, top.ap * 4, new Set());
    expect(view.tier).toBe(config.tiers.length);
    expect(view.nextAt).toBe(0);
    expect(view.tierName).toBe(top.name);
  });

  it("caps AP per character per match, as §6.1 requires", () => {
    expect(config.perMatchCap).toBe(15);
    // the cap has to bite: playing, winning and supporting once must exceed it
    const uncapped = config.ap.play + config.ap.win + config.ap.support * 12;
    expect(uncapped).toBeGreaterThan(config.perMatchCap);
  });
});

describe("the content can pay what the tables promise", () => {
  it("has no unpayable reward anywhere", () => {
    expect(checkMasteryData(content)).toEqual([]);
  });
});

describe("affinity, derived from real matches", () => {
  const config = affinityConfig();


  const record = playRecord(11, "idols-lumi-starcall", "goth-leader-alaric-thornheart");

  it("awards AP to characters that were actually played", () => {
    /**
     * The inert-field guard. A tracker that exists, validates and never moves is
     * indistinguishable from a player who has not got round to it — so this
     * insists a real match moves it, rather than trusting the walk.
     */
    const { affinity, stats } = readMatch(record, content, 0);
    const earners = Object.keys(affinity);
    expect(earners.length).toBeGreaterThan(0);
    expect(stats.cardsPlayed).toBeGreaterThan(0);
    for (const cardId of earners) {
      expect(content.cards[cardId]?.type, `${cardId} is not a character`).toBe("character");
    }
  });

  it("banks nothing against a token, which the Bias Board could never show", () => {
    /**
     * The board is drawn from the collection, and a Follower or an Anon is not
     * in it. AP earned by supporting a token would be real state, written to the
     * save forever, that no screen can ever display — the invisible reward
     * again, only permanent.
     */
    for (const seed of [11, 77, 404, 909, 1234]) {
      const played = playRecord(seed, "viral-leader-blayze-trendall", "meme-leader-chairperson-nobody");
      for (const seat of [0, 1] as Seat[]) {
        for (const cardId of Object.keys(readMatch(played, content, seat).affinity)) {
          const card = content.cards[cardId];
          expect(card?.token, `${cardId} is a token`).toBeFalsy();
          expect(card?.variantOf, `${cardId} is a variant, not a base card`).toBeFalsy();
        }
      }
    }
  });

  it("never exceeds the per-match cap, whatever happened in the match", () => {
    for (const seed of [11, 77, 404, 909]) {
      const played = playRecord(seed, "idols-lumi-starcall", "corp-leader-cressida-vale");
      for (const seat of [0, 1] as Seat[]) {
        for (const [cardId, points] of Object.entries(readMatch(played, content, seat).affinity)) {
          expect(points, `${cardId} on seat ${seat}`).toBeLessThanOrEqual(config.perMatchCap);
        }
      }
    }
  });

  it("gives each seat only its own characters", () => {
    /**
     * Asserted by faction, not by "does the other side also have it".
     *
     * The weaker version passed while `supported()` credited *both* seats: the
     * opponent's characters would only collide if they had also been played, and
     * a summoned one never is. Checking the faction is exact — these decks are
     * auto-built from two different factions, so a Gothic card in the Neon
     * Idols' map is wrong however it got there.
     */
    const factionOf = (cardId: string): string => content.cards[cardId]!.faction;
    const check = (seat: Seat, expected: string): void => {
      const affinity = readMatch(record, content, seat).affinity;
      expect(Object.keys(affinity).length).toBeGreaterThan(0);
      for (const cardId of Object.keys(affinity)) {
        expect([expected, "neutral"], `${cardId} was credited to seat ${seat}`).toContain(factionOf(cardId));
      }
    };
    check(0, "neon-idols");
    check(1, "gothic-royalty");
  });

  /**
   * The win bonus needs exact arithmetic, and an AI match cannot give it.
   *
   * In a real match a character can reach the board without being played —
   * summoned, resurrected, transformed into — and those earn support AP but no
   * win bonus, which is correct and also means no clean floor holds across the
   * whole affinity map. So the bonus is asserted on a scripted match instead:
   * two fixture leaders, one character, one attack, a known winner, and numbers
   * that can be written down in advance.
   */
  describe("the win bonus, on a scripted match", () => {
    const fixture = fixtureContent([
      testLeader("t-leader-win", { health: 30 }),
      testLeader("t-leader-lose", { health: 4 }),
      testCharacter("t-star", 1, 5, 5),
    ]);

    /** Play a scripted match and keep the intents, so it can be replayed. */
    function scripted(concedeInstead: boolean): MatchRecord {
      const decks: [DeckList, DeckList] = [
        fillDeck("t-leader-win", ["t-star"], "Winner"),
        fillDeck("t-leader-lose", ["t-star"], "Loser"),
      ];
      const matchConfig: MatchConfig = { seed: 909, decks, firstSeat: 0 };
      let state = createMatch(matchConfig, fixture);
      const intents: PlayerIntent[] = [];
      const send = (intent: PlayerIntent): void => {
        intents.push(intent);
        state = applyIntent(state, fixture, intent).state;
      };

      send({ type: "mulligan", seat: 0, replaceInstanceIds: [] });
      send({ type: "mulligan", seat: 1, replaceInstanceIds: [] });

      const star = state.players[0].hand.find((card) => card.cardId === "t-star");
      expect(star, "the scripted deck did not deal its one card").toBeTruthy();
      send({ type: "playCard", seat: 0, instanceId: star!.instanceId, slot: 0 });

      if (concedeInstead) {
        send({ type: "concede", seat: 0 });
      } else {
        send({ type: "endTurn", seat: 0 });
        send({ type: "endTurn", seat: 1 });
        const attacker = state.players[0].board.find((c) => c?.cardId === "t-star");
        expect(attacker, "the character left the board").toBeTruthy();
        send({
          type: "attack",
          seat: 0,
          attackerInstanceId: attacker!.instanceId,
          target: { kind: "leader", seat: 1 },
        });
      }
      return { config: matchConfig, intents, result: { winner: state.winner, turns: state.turn } } as MatchRecord;
    }

    it("pays play plus win to a character the winner played", () => {
      const won = readMatch(scripted(false), fixture, 0);
      expect(won.stats.won).toBe(true);
      expect(won.affinity["t-star"]).toBe(config.ap.play + config.ap.win);
    });

    it("pays only the play award when the same character loses", () => {
      const lost = readMatch(scripted(true), fixture, 0);
      expect(lost.stats.won).toBe(false);
      expect(lost.affinity["t-star"]).toBe(config.ap.play);
    });

    it("gives the opponent nothing for a character they never played", () => {
      const theirs = readMatch(scripted(false), fixture, 1);
      expect(theirs.stats.won).toBe(false);
      expect(theirs.affinity["t-star"]).toBeUndefined();
    });
  });

  it("reads the same numbers from the same record every time", () => {
    // affinity is an accumulator, so the deriver has to be a function of the
    // record alone — a number that drifts between reads cannot be audited
    expect(readMatch(record, content, 0).affinity).toEqual(readMatch(record, content, 0).affinity);
  });

  it("still produces stats when it produces affinity", () => {
    // the whole point of one replay, two products: neither may cost the other
    const reading = readMatch(record, content, 0);
    expect(reading.stats.cardsPlayed).toBeGreaterThan(0);
    expect(reading.stats.leaderCardId).toBe("idols-lumi-starcall");
    expect(matchStats(record, content, 0)).toEqual(reading.stats);
  });
});

describe("what a finished match credits", () => {
  const LEADER = "idols-lumi-starcall";
  const FACTION = "neon-idols";

  beforeEach(() => profileStore.reset());

  const play = (outcome: "win" | "loss", record: MatchRecord, leaderCardId = LEADER): void => {
    recordMatch(record, outcome, {
      deckName: "T",
      leaderCardId,
      opponentLeaderCardId: "goth-leader-alaric-thornheart",
      mode: "ai-casual",
      content,
    });
  };

  /** A cheap record — these tests are about the save layer, not the engine. */
  const trivialRecord = (): MatchRecord =>
    ({
      config: {
        seed: 5,
        decks: [autoBuildDeck(content, LEADER, "A"), autoBuildDeck(content, "goth-leader-alaric-thornheart", "B")],
        firstSeat: 0,
      },
      intents: [],
      result: { winner: 0, turns: 1 },
    }) as unknown as MatchRecord;

  it("pays the faction and the leader the same XP the account level got", () => {
    play("win", trivialRecord());
    const profile = profileStore.get();
    expect(profile.mastery.faction[FACTION]).toBe(matchXp(true));
    expect(profile.mastery.leader[LEADER]).toBe(matchXp(true));
  });

  it("pays a loss too — §4 measures matches played, not matches won", () => {
    play("loss", trivialRecord());
    expect(profileStore.get().mastery.faction[FACTION]).toBe(matchXp(false));
    expect(matchXp(false)).toBeGreaterThan(0);
  });

  it("accumulates across matches rather than replacing", () => {
    play("win", trivialRecord());
    play("loss", trivialRecord());
    expect(profileStore.get().mastery.faction[FACTION]).toBe(matchXp(true) + matchXp(false));
  });

  it("credits nothing to a leader with no track", () => {
    /**
     * Boss and tutorial leaders are `token: true` and have no mastery track, so
     * XP banked against one would be state no screen can ever show — the same
     * invisible-reward problem, written to the save.
     */
    play("win", trivialRecord(), "boss-king-ratio");
    const { mastery } = profileStore.get();
    expect(mastery.leader["boss-king-ratio"]).toBeUndefined();
    expect(Object.keys(mastery.faction)).toEqual([]);
  });

  it("does not let a mission claim feed mastery", () => {
    /**
     * §4 is explicit: "Missions and bonuses do not count — mastery measures
     * matches actually played." A mission pays a large lump of account XP, and
     * the easy mistake is to route mastery off the same number.
     */
    play("win", trivialRecord());
    const before = { ...profileStore.get().mastery.faction };
    expect(syncMissions(content).some((view) => view.def.cadence === "daily")).toBe(true);

    /**
     * Forge evidence that finishes *whatever* was issued.
     *
     * Two things make this fiddly, and both caused the test to fail one run in
     * five before they were handled.
     *
     * The three dailies an account holds are drawn from a **clock-seeded RNG**,
     * so a fixture tuned to one of them passes or fails depending on the minute
     * the suite runs. Every faction against every Current, with each statistic
     * well over any published target, satisfies `sum`, `matches` and `distinct`
     * alike whatever was drawn.
     *
     * And a freshly issued mission takes `issuedAt: now`, so evidence recorded
     * *before* `syncMissions` sits outside its window and counts for nothing.
     * The forged matches are therefore stamped after the sync above — which is
     * also the real order of events: you are given a mission, then you play.
     */
    const forgedAt = Date.now();
    profileStore.update((draft) => {
      const template = draft.missions.outcomes[0]!;
      const factions = Object.keys(content.factions).filter((id) => id !== "neutral");
      const currents = Object.keys(content.currents) as CurrentId[];
      const modes = ["ai-casual", "story-1", "doomscroll-normal", "boss-bronze"];
      const forged: MatchOutcome[] = [];
      // every faction against every Current, so no filter in the pool can miss
      for (const [index, factionId] of factions.entries()) {
        for (const [step, current] of currents.entries()) {
          forged.push({
            ...template,
            mode: modes[(index + step) % modes.length]!,
            playedAt: forgedAt,
            deckEditedThisPeriod: true,
            masteryAtPlay: { faction: 1, leader: 1 },
            stats: {
              ...template.stats,
              won: true,
              factionId,
              primaryCurrent: current,
              ...Object.fromEntries(SUM_STATS.map((stat) => [stat, 99])),
            },
          } as MatchOutcome);
        }
      }
      draft.missions.outcomes = draft.missions.outcomes.concat(forged);
    });
    const completed = missionViews(content).find((view) => view.progress.complete);
    /**
     * Asserted, not guarded. `if (completed)` would let this pass on a day when
     * no mission happened to complete — a test that proves nothing while looking
     * green, which this project has shipped before and does not intend to again.
     */
    expect(completed, "no mission completed, so nothing was claimed to test").toBeTruthy();
    const paid = claimMission(content, completed!.def.cadence, completed!.def.id);
    expect(paid!.xp).toBeGreaterThan(0);
    expect(profileStore.get().accountXp + profileStore.get().accountLevel * 1000).toBeGreaterThan(0);
    expect(profileStore.get().mastery.faction).toEqual(before);
    expect(profileStore.get().mastery.leader).toEqual({ [LEADER]: matchXp(true) });
  });

  it("survives a save written before a field existed inside `mastery`", () => {
    /**
     * The store merges defaults **shallowly**, so an older save keeps its own
     * `mastery` object and any field added since arrives `undefined`. For an
     * accumulator with nothing to re-derive from, a crash on the first match
     * after an update costs real progress rather than one render — so the shape
     * is normalised on the way in, and this is what proves it.
     */
    profileStore.update((draft) => {
      (draft as unknown as { mastery: unknown }).mastery = { faction: { "neon-idols": 500 } };
    });
    expect(() => play("win", trivialRecord())).not.toThrow();
    const { mastery } = profileStore.get();
    expect(mastery.faction[FACTION]).toBe(500 + matchXp(true));
    expect(mastery.leader[LEADER]).toBe(matchXp(true));
    expect(mastery.claimed).toEqual([]);
    expect(mastery.affinity).toBeTruthy();
  });

  it("banks affinity for the characters a real match played", () => {
    const record = playRecord(11, LEADER, "goth-leader-alaric-thornheart");
    play("win", record);
    const banked = profileStore.get().mastery.affinity;
    expect(Object.keys(banked).length).toBeGreaterThan(0);
    expect(Math.max(...Object.values(banked))).toBeGreaterThan(0);
  });
});

describe("claiming a mastery rank", () => {
  const FACTION = "neon-idols";
  beforeEach(() => profileStore.reset());

  /** Put a track at a rank without playing two hundred matches for it. */
  const setRank = (rank: number): void => {
    profileStore.update((draft) => {
      // rank 1 costs no XP, and a track with no XP has earned nothing, so the
      // rank-1 fixture still has to represent one played match
      draft.mastery.faction[FACTION] = Math.max(1, xpForRank(faction, rank));
    });
  };

  it("pays exactly the Clout the rank prints", () => {
    setRank(4);
    const before = profileStore.get().clout;
    const grant = claimMasteryRank(content, "faction", FACTION, 4);
    expect(grant).toBeTruthy();
    expect(grant!.clout).toBe(150);
    expect(profileStore.get().clout - before).toBe(150);
  });

  it("pays nothing the second time", () => {
    setRank(4);
    claimMasteryRank(content, "faction", FACTION, 4);
    const before = profileStore.get().clout;
    expect(claimMasteryRank(content, "faction", FACTION, 4)).toBeNull();
    expect(profileStore.get().clout).toBe(before);
  });

  it("refuses a rank the track has not reached", () => {
    setRank(3);
    const before = profileStore.get().clout;
    expect(claimMasteryRank(content, "faction", FACTION, 11)).toBeNull();
    expect(profileStore.get().clout).toBe(before);
  });

  it("refuses a rank whose whole payout is a deferred cosmetic", () => {
    // Leader Mastery 5 — an alternate portrait, which nothing can render
    const leaderId = selectableLeaders(content)[0]!.id;
    profileStore.update((draft) => {
      draft.mastery.leader[leaderId] = xpForRank(leader, 5);
    });
    expect(claimMasteryRank(content, "leader", leaderId, 5)).toBeNull();
  });

  it("grants the card back rank 5 promises, and wears it", () => {
    setRank(5);
    const grant = claimMasteryRank(content, "faction", FACTION, 5);
    expect(grant?.cosmetics.map((cosmetic) => cosmetic.id)).toEqual([cardBackId(FACTION)]);
    expect(ownsCosmetic(cardBackId(FACTION))).toBe(true);
    // the first of a kind is worn automatically, so the next match shows it
    expect(wearing(content, "cardBack")?.id).toBe(cardBackId(FACTION));
  });

  it("grants §13's title at rank 20, by name", () => {
    setRank(20);
    const grant = claimMasteryRank(content, "faction", FACTION, 20);
    expect(grant?.cosmetics.map((cosmetic) => cosmetic.name)).toEqual(["Center Stage"]);
    // the Premium variant voucher in the same row still cannot be paid
    expect(grant!.deferred).toContain("Animated Premium variant voucher");
  });

  it("adds an unlocked emote to the wheel without replacing the starters", () => {
    setRank(12);
    const before = emoteWheel(content);
    const grant = claimMasteryRank(content, "faction", FACTION, 12);
    expect(grant?.cosmetics).toHaveLength(1);
    const after = emoteWheel(content);
    expect(after.length).toBe(before.length + 1);
    for (const starter of STARTER_EMOTES) expect(after).toContain(starter);
  });

  it("opens a Faction Pack drawn only from that faction", () => {
    setRank(2);
    const grant = claimMasteryRank(content, "faction", FACTION, 2);
    expect(grant?.pack).toBeTruthy();
    expect(grant!.pack!.cards).toHaveLength(content.balance.economy.packSize);
    for (const card of grant!.pack!.cards) {
      expect(content.cards[card.cardId]?.faction).toBe(FACTION);
    }
  });

  it("logs a Faction Pack in the opening history, like any other Drop", () => {
    setRank(2);
    claimMasteryRank(content, "faction", FACTION, 2);
    const { drops } = profileStore.get();
    expect(drops.opened).toBe(1);
    expect(drops.log[0]?.cards).toHaveLength(content.balance.economy.packSize);
  });

  it("refuses a pick with no choice made", () => {
    setRank(3);
    expect(claimMasteryRank(content, "faction", FACTION, 3)).toBeNull();
  });

  it("refuses a card the pick never offered", () => {
    setRank(3);
    const offered = masteryPickChoices(content, "faction", FACTION, 3)!;
    const other = factionPool(content, FACTION)
      .filter((card) => card.rarity === "common")
      .find((card) => !offered.some((pick) => pick.id === card.id))!;
    expect(claimMasteryRank(content, "faction", FACTION, 3, other.id)).toBeNull();
    expect(profileStore.get().collection[other.id]).toBeUndefined();
  });

  it("grants the copies the pick promises", () => {
    setRank(3);
    const chosen = masteryPickChoices(content, "faction", FACTION, 3)![0]!;
    const grant = claimMasteryRank(content, "faction", FACTION, 3, chosen.id);
    expect(grant?.cards).toEqual([{ cardId: chosen.id, copies: 2 }]);
    expect(profileStore.get().collection[chosen.id]).toBe(2);
  });

  it("converts a pick to Signal when the collection is already full of it", () => {
    setRank(3);
    const chosen = masteryPickChoices(content, "faction", FACTION, 3)![0]!;
    profileStore.update((draft) => {
      draft.collection[chosen.id] = 99;
    });
    const before = profileStore.get().shards;
    const grant = claimMasteryRank(content, "faction", FACTION, 3, chosen.id);
    expect(grant?.cards).toEqual([]);
    expect(grant!.signal).toBeGreaterThan(0);
    expect(profileStore.get().shards - before).toBe(grant!.signal);
  });

  it("unlocks a lore page and names which one", () => {
    setRank(1);
    const grant = claimMasteryRank(content, "faction", FACTION, 1);
    expect(grant?.lore).toEqual([{ kind: "faction", id: FACTION, page: 1 }]);
    expect(masteryLore("faction", FACTION, 1, FACTION).written).toBe(true);
  });

  it("reports what it could not grant instead of pretending", () => {
    setRank(10); // an alt portrait (still deferred) + a Faction Pack + Fragments
    const grant = claimMasteryRank(content, "faction", FACTION, 10);
    expect(grant?.pack).toBeTruthy();
    expect(grant!.fragments).toBe(100);
    expect(grant!.deferred).toContain("Leader alt portrait");
    expect(grant!.cosmetics).toEqual([]);
  });

  it("keeps mastery claims out of the ledger that trims itself", () => {
    /**
     * `claimedRewards` drops its oldest entries at 400, which is what made the
     * Grand Tour reward re-claimable after a few months. A mastery rank must
     * never enter it.
     */
    setRank(4);
    claimMasteryRank(content, "faction", FACTION, 4);
    expect(profileStore.get().claimedRewards).toEqual([]);
    expect(profileStore.get().mastery.claimed).toEqual(["faction:neon-idols:4"]);
  });

  it("counts what is waiting, for the lobby badge", () => {
    expect(masteryUnclaimed(content)).toBe(0);
    setRank(4);
    // ranks 1-4 hold three payable rows: 1 (lore + Clout), 3 (pick), 4 (Clout).
    // rank 2 is a pack, also payable — so four
    expect(masteryUnclaimed(content)).toBe(4);
    claimMasteryRank(content, "faction", FACTION, 4);
    expect(masteryUnclaimed(content)).toBe(3);
  });
});

describe("the Bias Board, claimed", () => {
  beforeEach(() => profileStore.reset());
  const character = collectibleCharacters()[0]!;

  it("shows a character the account owns, even at zero", () => {
    profileStore.update((draft) => {
      draft.collection[character.id] = 1;
    });
    const board = biasBoard(content);
    expect(board.some((view) => view.cardId === character.id)).toBe(true);
  });

  it("pays the tier-1 lore page once", () => {
    profileStore.update((draft) => {
      draft.mastery.affinity[character.id] = 50;
    });
    const grant = claimAffinityTier(content, character.id, 1);
    expect(grant?.lore).toEqual([{ kind: "bias", id: character.id, page: 1 }]);
    expect(claimAffinityTier(content, character.id, 1)).toBeNull();
  });

  it("refuses a tier the character has not reached", () => {
    profileStore.update((draft) => {
      draft.mastery.affinity[character.id] = 10;
    });
    expect(claimAffinityTier(content, character.id, 1)).toBeNull();
  });
});

describe("the two weeklies mastery unblocked", () => {
  const base = (over: Partial<MatchOutcome>): MatchOutcome =>
    ({
      mode: "ai-casual",
      playedAt: 1,
      deckEditedThisPeriod: false,
      stats: { won: true } as MatchOutcome["stats"],
      ...over,
    }) as MatchOutcome;

  it("counts a match played below the threshold", () => {
    const outcome = base({ masteryAtPlay: { faction: 3, leader: 2 } });
    expect(matchesFilter(outcome, { won: true, factionMasteryBelow: 10 })).toBe(true);
    expect(matchesFilter(outcome, { won: true, leaderMasteryBelow: 5 })).toBe(true);
  });

  it("stops counting once the track passes the threshold", () => {
    const outcome = base({ masteryAtPlay: { faction: 10, leader: 5 } });
    expect(matchesFilter(outcome, { factionMasteryBelow: 10 })).toBe(false);
    expect(matchesFilter(outcome, { leaderMasteryBelow: 5 })).toBe(false);
  });

  it("never counts a match with no rank stamped on it", () => {
    /**
     * The whole reason these two were held back was that a condition which is
     * always true pays for nothing. An unstamped outcome — recorded before
     * mastery shipped, or played with a leader that has no track — must fail the
     * filter rather than pass it by default.
     */
    const outcome = base({});
    expect(matchesFilter(outcome, { factionMasteryBelow: 10 })).toBe(false);
    expect(matchesFilter(outcome, { leaderMasteryBelow: 5 })).toBe(false);
  });

  it("stamps the rank the match started at, not the one it ended at", () => {
    profileStore.reset();
    const record = {
      config: {
        seed: 5,
        decks: [
          autoBuildDeck(content, "idols-lumi-starcall", "A"),
          autoBuildDeck(content, "goth-leader-alaric-thornheart", "B"),
        ],
        firstSeat: 0,
      },
      intents: [],
      result: { winner: 0, turns: 1 },
    } as unknown as MatchRecord;
    // one XP short of rank 2, so the match itself promotes the track
    profileStore.update((draft) => {
      draft.mastery.faction["neon-idols"] = xpToReach(faction, 2) - 1;
      draft.mastery.leader["idols-lumi-starcall"] = xpToReach(leader, 2) - 1;
    });
    recordMatch(record, "win", {
      deckName: "T",
      leaderCardId: "idols-lumi-starcall",
      opponentLeaderCardId: "goth-leader-alaric-thornheart",
      mode: "ai-casual",
      content,
    });
    const stored = profileStore.get().missions.outcomes.at(-1);
    expect(stored?.masteryAtPlay).toEqual({ faction: 1, leader: 1 });
    // and the track really did move past it
    expect(profileStore.get().mastery.faction["neon-idols"]).toBeGreaterThanOrEqual(xpToReach(faction, 2));
  });

  it("ships all ten of §8.1's weeklies", () => {
    expect(weeklyPool().map((mission) => mission.id)).toContain("understudy-arc");
    expect(weeklyPool().map((mission) => mission.id)).toContain("second-bias");
  });
});

describe("the lore the tracks unlock", () => {
  it("names nothing that does not exist", () => {
    expect(checkMasteryLore(content).unknown).toEqual([]);
  });

  it("has all forty faction pages written", () => {
    /**
     * Faction Mastery is the value track and its lore is the reward at ranks 1,
     * 7, 13 and 19 — four pages for each of ten factions. Unlike the leader
     * chapters, these are not allowed to be missing: a track whose headline
     * non-currency reward is a placeholder is a track that pays a placeholder.
     */
    const missing = checkMasteryLore(content).unwritten.filter((key) => key.startsWith("faction:"));
    expect(missing).toEqual([]);
  });

  it("gives every leader a first chapter, so level 2 always pays something real", () => {
    const missing = checkMasteryLore(content)
      .unwritten.filter((key) => key.startsWith("leader:") && key.endsWith(":1"));
    expect(missing).toEqual([]);
  });

  /**
   * This test used to assert that exactly `leaders × 3` pages were unwritten,
   * with a comment saying it existed "so the number is visible and shrinks
   * rather than being forgotten."
   *
   * It shrank to zero. Every leader chapter and every Bias Board page is
   * written, so the assertion is inverted rather than deleted: the point was
   * always to keep the count honest, and "none outstanding" is the same
   * statement with a better number in it.
   */
  it("has no unwritten pages left, and still reports honestly if that changes", () => {
    const { unwritten } = checkMasteryLore(content);
    expect(unwritten, `still to write:\n  ${unwritten.slice(0, 10).join("\n  ")}`).toEqual([]);
  });

  it("gives every leader all four chapters, not just the first", () => {
    const written = checkMasteryLore(content);
    for (const leader of selectableLeaders(content)) {
      for (const chapter of [1, 2, 3, 4]) {
        const page = masteryLore("leader", leader.id, chapter, leader.name);
        expect(page.written, `${leader.id} chapter ${chapter} is not written`).toBe(true);
        expect(page.body.join(" ").length).toBeGreaterThan(80);
      }
    }
    void written;
  });

  it("reads a written page back with its title and prose", () => {
    const page = masteryLore("faction", "neon-idols", 4, "Neon Idols");
    expect(page.written).toBe(true);
    expect(page.title).toBe("The Projector");
    expect(page.body.join(" ")).toContain("projector");
    expect(page.quote).toBeTruthy();
  });

  /**
   * The placeholder still matters and is still tested — but against a page that
   * genuinely does not exist, rather than one that merely happened to be
   * unwritten on the day the test was authored.
   *
   * It previously used Lumi's chapter 4. That chapter is written now, so the
   * test broke the moment the prose landed — while the behaviour it was actually
   * checking never changed. Pinning it to a real id made it a test of the
   * content calendar instead of a test of the fallback.
   */
  it("shows an honest placeholder for a page nobody has written", () => {
    const page = masteryLore("leader", "a-leader-that-does-not-exist", 4, "Nobody At All");
    expect(page.written).toBe(false);
    expect(page.title).toBe("Nobody At All");
    expect(page.body.join(" ")).toMatch(/not been written/i);
  });

  it("does not fall over on a page that was never in the file", () => {
    const page = masteryLore("faction", "not-a-faction", 9, "Fallback");
    expect(page.written).toBe(false);
    expect(page.title).toBe("Fallback");
  });
});
