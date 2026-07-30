/**
 * The Gauntlet — `09-game-modes.md` §8.
 *
 * The load-bearing tests here are the ones no amount of clicking could do. A
 * draft is 20 leaders × 30 picks × 3 cards, and every one of those offers has to
 * be three *distinct* cards that are *legal* for the leader and respect a Prism
 * cutoff that changes as you draft. A person can check a handful of them.
 *
 * The other half is §8.1's rarity table, which this build's card pool cannot
 * satisfy: no selectable leader has three Legendaries to offer. That is not
 * routed around — it is measured, published on the screen, and asserted here, so
 * that a pool which later *can* satisfy it makes the assertion fail and says so.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { getContent, selectableLeaders } from "../src/engine/content";
import { TARGET_CURVE, curveBucket, legalCurrentsFor, validateDeck } from "../src/engine/deck";
import { subSeed } from "../src/engine/rng";
import {
  DEFERRED_GAUNTLET,
  beginRun,
  botDeck,
  checkGauntletData,
  chooseLeader,
  currentOffer,
  deckListFor,
  difficultyForWins,
  enterFight,
  isOver,
  leaderOffer,
  nextFight,
  offerCards,
  offerReality,
  pickCard,
  practiceReward,
  rarityShortfall,
  redraft,
  resolveFight,
  retire,
  rewardRowFor,
  startRun,
  type GauntletRun,
} from "../src/game/gauntlet";
import { RARITY_ORDER, gauntletData } from "../src/game/gauntlet/data";
import { claimGauntlet, gauntletStore, previewGauntlet } from "../src/save/gauntletSave";
import { aiCloutRemaining, aiCloutSpent, profileStore, spendAiClout } from "../src/save/profile";
import { aiDailyCap } from "../src/game/economy/income";

const content = getContent();
const data = gauntletData();

/** Draft a whole deck the way the bot does, so the run reaches `ready`. */
function draftFully(run: GauntletRun): GauntletRun {
  let current = run;
  for (let i = 0; i < data.draft.picks; i++) {
    const offer = currentOffer(content, current);
    if (!offer) break;
    current = pickCard(content, current, offer.cardIds[0]!);
  }
  return current;
}

/**
 * A run drafted and ready to play.
 *
 * The leader comes from `leaderChoices`, not from the roster — `chooseLeader`
 * refuses a leader the run never offered, and an earlier version of this helper
 * handed it one, which silently left every run in the leader-pick phase and made
 * four tests downstream assert against a run that had never started.
 */
const draftedRun = (seed: number): GauntletRun => {
  const run = startRun(content, seed, 0);
  return draftFully(chooseLeader(run, run.leaderChoices[0]!));
};

const leaderIds = selectableLeaders(content)
  .map((leader) => leader.id)
  .sort();

// ---------------------------------------------------------------------------

describe("the data", () => {
  it("passes its own check", () => {
    const problems = checkGauntletData(content);
    expect(problems, problems.length === 0 ? "" : `\ngauntlet.json:\n  ${problems.join("\n  ")}\n`).toEqual([]);
  });

  it("catches a rarity row that does not add up", () => {
    const original = data.draft.rarity.standard.common;
    data.draft.rarity.standard.common = 0.5;
    expect(checkGauntletData(content).join(" ")).toContain("weights sum to");
    data.draft.rarity.standard.common = original;
  });

  it("catches a reward row that was never written", () => {
    const rows = data.rewards.rows;
    const removed = rows.splice(5, 1);
    expect(checkGauntletData(content).join(" ")).toContain("no row for 5 wins");
    rows.splice(5, 0, ...removed);
    expect(checkGauntletData(content)).toEqual([]);
  });

  it("catches a reward that names a cosmetic nothing resolves", () => {
    const row = data.rewards.rows.find((entry) => entry.cosmetics)!;
    const original = [...row.cosmetics!];
    row.cosmetics = ["title:award:a-title-nobody-wrote"];
    expect(checkGauntletData(content).join(" ")).toContain("resolves to nothing");
    row.cosmetics = original;
  });

  it("catches a difficulty ramp that skips zero wins", () => {
    const first = data.practice.difficultyByWins[0]!;
    const original = first.minWins;
    first.minWins = 1;
    expect(checkGauntletData(content).join(" ")).toContain("no row covers zero wins");
    first.minWins = original;
  });

  /**
   * §8.4's Practice table is *derived* from §8.3's, never authored beside it. A
   * second hand-written table would only disagree with the first for the players
   * who reached a row nobody re-checked.
   */
  it("derives the Practice payout from the competitive row rather than restating it", () => {
    for (const row of data.rewards.rows) {
      const practice = practiceReward(row.wins);
      expect(practice.clout, `${row.wins} wins`).toBe(Math.round(row.clout * data.practice.scale));
      expect(practice.signal, `${row.wins} wins`).toBe(Math.round(row.signal * data.practice.scale));
      // §8.4 excludes packs; Tickets buy a mode that needs a server
      expect(practice.packs).toBe(0);
      expect(practice.tickets).toBe(0);
      // a cosmetic has no 25% of itself
      expect(practice.cosmetics).toEqual(row.cosmetics ?? []);
      expect(practice.cardBackProgress).toBe(row.cardBackProgress ?? 0);
    }
  });

  it("pays the row you finished on, not the sum of the rows below it", () => {
    expect(rewardRowFor(7).clout).toBe(225);
    expect(rewardRowFor(12).clout).toBe(400);
    // a count past the table clamps rather than falling off it
    expect(rewardRowFor(99).wins).toBe(data.run.winsToRetire);
  });

  it("accounts for everything §8 asks for and this build cannot give", () => {
    expect(DEFERRED_GAUNTLET.size).toBeGreaterThan(0);
    for (const [name, reason] of DEFERRED_GAUNTLET) {
      expect(reason.trim().length, name).toBeGreaterThan(40);
      expect(reason, name).toMatch(/\.$/);
    }
  });
});

// ---------------------------------------------------------------------------

describe("the offer — §8.1", () => {
  /**
   * The whole draft, for every leader.
   *
   * 600 offers. Each one has to be three distinct cards, each legal for that
   * leader by the deck builder's own rule. This is the test that would have
   * caught the rarity shortfall if the fill ladder had not been written for it,
   * and it is the reason the ladder exists rather than a `slice(0, 3)`.
   */
  it("gives three distinct legal cards at every pick, for every leader", () => {
    const failures: string[] = [];

    for (const leaderCardId of leaderIds) {
      const leader = content.leaders[leaderCardId]!;
      const currents = legalCurrentsFor(leader);
      const deck: string[] = [];

      for (let pick = 1; pick <= data.draft.picks; pick++) {
        const offer = offerCards(content, leaderCardId, deck, 4242, 0, pick);
        if (offer.cardIds.length !== data.draft.offerSize) {
          failures.push(`${leaderCardId} pick ${pick}: ${offer.cardIds.length} cards`);
        }
        if (new Set(offer.cardIds).size !== offer.cardIds.length) {
          failures.push(`${leaderCardId} pick ${pick}: a repeated card in one offer`);
        }
        for (const cardId of offer.cardIds) {
          const card = content.cards[cardId];
          if (!card) {
            failures.push(`${leaderCardId} pick ${pick}: ${cardId} is not a card`);
            continue;
          }
          if (card.token || card.type === "leader" || card.variantOf) {
            failures.push(`${leaderCardId} pick ${pick}: ${cardId} is not collectible`);
          }
          if (card.faction !== leader.faction && card.faction !== "neutral") {
            failures.push(`${leaderCardId} pick ${pick}: ${cardId} is ${card.faction}`);
          }
          if (card.current !== "prism" && !currents.includes(card.current)) {
            failures.push(`${leaderCardId} pick ${pick}: ${cardId} is ${card.current}`);
          }
        }
        deck.push(offer.cardIds[0]!);
      }
    }

    expect(failures, failures.length === 0 ? "" : `\n${failures.length} bad offers:\n  ${failures.slice(0, 10).join("\n  ")}\n`).toEqual(
      []
    );
  });

  /**
   * §8.1's Prism rule, in both directions.
   *
   * The splash limit is read from `balance.deck.prismSplashLimit` rather than
   * copied into the mode's own data, and a leader whose own Current is Prism was
   * never subject to it — the same carve-out `validateDeck` makes and the one
   * `autoBuildDeck` had to be taught after it spent a while building Vera
   * Foamhammer decks out of half her faction.
   */
  it("stops offering Prism at the canonical splash limit, and never to a Prism leader", () => {
    const limit = content.balance.deck.prismSplashLimit;
    const prismCards = Object.values(content.cards).filter(
      (card) => card.current === "prism" && !card.token && card.type !== "leader" && !card.variantOf
    );
    const splasher = content.leaders["goth-leader-morvina-vane"]!;
    const native = content.leaders["cosplay-vera-foamhammer"]!;
    expect(native.primaryCurrent === "prism" || native.secondaryCurrent === "prism").toBe(true);

    const spent = prismCards.slice(0, limit).map((card) => card.id);
    expect(spent.length).toBe(limit);

    // the splasher has drafted its limit: no Prism may be offered again
    for (let pick = 1; pick <= 8; pick++) {
      const offer = offerCards(content, splasher.id, spent, 99, 0, pick);
      expect(offer.prismOpen).toBe(false);
      for (const cardId of offer.cardIds) expect(content.cards[cardId]!.current).not.toBe("prism");
    }

    // the native leader is not splashing and never closes
    for (let pick = 1; pick <= 8; pick++) {
      expect(offerCards(content, native.id, spent, 99, 0, pick).prismOpen).toBe(true);
    }
  });

  it("is stable across a reload and different after a re-draft", () => {
    const leaderCardId = leaderIds[0]!;
    const first = offerCards(content, leaderCardId, [], 7, 0, 1);
    expect(offerCards(content, leaderCardId, [], 7, 0, 1).cardIds).toEqual(first.cardIds);

    // a re-draft bumps the generation, and the second draft has to be a
    // different draft or the one free re-draft is worth nothing
    const later = Array.from({ length: 12 }, (_, pick) => ({
      before: offerCards(content, leaderCardId, [], 7, 0, pick + 1).cardIds.join(),
      after: offerCards(content, leaderCardId, [], 7, 1, pick + 1).cardIds.join(),
    }));
    expect(later.filter((entry) => entry.before !== entry.after).length).toBeGreaterThan(8);
  });

  it("puts the Spotlight Picks where §8.1 numbers them, and never rolls a zero-weight rarity", () => {
    expect(data.draft.spotlightPicks).toEqual([1, 10, 20, 30]);
    const leaderCardId = leaderIds[3]!;
    for (let seed = 0; seed < 200; seed++) {
      for (const pick of data.draft.spotlightPicks) {
        const offer = offerCards(content, leaderCardId, [], seed, 0, pick);
        expect(offer.spotlight).toBe(true);
        // Common carries zero weight on a spotlight row
        expect(offer.rarity).not.toBe("common");
      }
      const ordinary = offerCards(content, leaderCardId, [], seed, 0, 5);
      expect(ordinary.spotlight).toBe(false);
    }
  });

  /**
   * The rolled rarity should follow the published table.
   *
   * Not the *offered* rarity — the ladder deliberately substitutes, and that is
   * the next test. This one checks that the roll itself is the roll §8.1 wrote
   * down, which is the number the rules panel prints.
   */
  it("rolls the rarities the published table says it will", () => {
    const counts: Record<string, number> = { common: 0, rare: 0, epic: 0, legendary: 0 };
    const trials = 4000;
    for (let seed = 0; seed < trials; seed++) {
      counts[offerCards(content, leaderIds[0]!, [], seed, 0, 5).rarity]! += 1;
    }
    for (const rarity of RARITY_ORDER) {
      const expected = data.draft.rarity.standard[rarity];
      expect(counts[rarity]! / trials, rarity).toBeCloseTo(expected, 1);
    }
  });

  /**
   * The finding, asserted rather than worked around.
   *
   * If a later card pool gives every leader three Legendaries, this fails — and
   * failing is correct: the fill ladder would then be dead code, the screen's
   * "your pool cannot fill a Legendary offer" line would be a lie, and both
   * should be revisited.
   */
  it("records that no leader in this build can fill a Legendary offer", () => {
    const short = rarityShortfall(content);
    expect(short.legendary).toBe(leaderIds.length);
    expect(short.common).toBe(0);
    expect(short.rare).toBe(0);
    // exactly one leader is thin at Epic too
    expect(short.epic).toBe(1);

    for (const entry of offerReality(content)) {
      expect(entry.counts.legendary, entry.leaderCardId).toBeLessThan(data.draft.offerSize);
    }
  });

  it("fills what the rolled rarity cannot, from the nearest rarity below", () => {
    const leaderCardId = leaderIds[0]!;
    let sawSubstitution = false;
    for (let seed = 0; seed < 600 && !sawSubstitution; seed++) {
      const offer = offerCards(content, leaderCardId, [], seed, 0, 1);
      if (offer.rarity !== "legendary") continue;
      sawSubstitution = true;
      expect(offer.cardIds.length).toBe(data.draft.offerSize);
      expect(offer.substituted).toBeGreaterThan(0);
      // down, never up: nothing above Legendary exists, and the substitutes are Epic
      const substitutes = offer.cardIds
        .map((cardId) => content.cards[cardId]!.rarity)
        .filter((rarity) => rarity !== "legendary");
      for (const rarity of substitutes) expect(rarity).toBe("epic");
    }
    expect(sawSubstitution, "no Legendary pick rolled in 600 seeds").toBe(true);
  });

  /**
   * The curve assist, measured rather than asserted by reading the code.
   *
   * A draft already stuffed with one-cost cards should be offered fewer of them
   * than a draft with none. "Softly" means the effect is a lean, so this checks
   * the direction and not a magnitude.
   */
  it("leans offers toward the cost buckets a draft is short of", () => {
    const leaderCardId = "grass-leader-juniper-vale";
    const cheap = Object.values(content.cards)
      .filter((card) => card.cost === 1 && card.faction === content.leaders[leaderCardId]!.faction)
      .slice(0, 1)
      .map((card) => card.id);
    expect(cheap.length).toBe(1);

    const stuffed = new Array<string>(TARGET_CURVE[1]! + 4).fill(cheap[0]!);
    const share = (deck: string[]): number => {
      let ones = 0;
      let total = 0;
      for (let seed = 0; seed < 400; seed++) {
        for (const cardId of offerCards(content, leaderCardId, deck, seed, 0, 4).cardIds) {
          total += 1;
          if (curveBucket(content.cards[cardId]!.cost) === 1) ones += 1;
        }
      }
      return ones / total;
    };

    expect(share(stuffed)).toBeLessThan(share([]));
  });
});

// ---------------------------------------------------------------------------

describe("the drafted deck", () => {
  /**
   * §8.1(4) is the mode's only rule override, and this is what keeps it to one.
   *
   * A drafted deck is deliberately something `validateDeck` rejects — duplicates
   * past the constructed limit are legal here. So the assertion is not "it
   * validates", it is "the *only* thing wrong with it is the rule the mode
   * waived": every faction, Current, Prism and size rule still holds.
   */
  it("breaks the copy limit and nothing else", () => {
    for (const leaderCardId of leaderIds) {
      const deck = botDeck(content, 31337, leaderCardId, "Bot");
      expect(deck.cards.length, leaderCardId).toBe(data.draft.picks);
      const codes = new Set(validateDeck(content, deck).map((problem) => problem.code));
      codes.delete("tooManyCopies");
      expect([...codes], `${leaderCardId} broke more than the copy limit`).toEqual([]);
    }
  });

  it("is exactly the deck size the engine expects", () => {
    expect(data.draft.picks).toBe(content.balance.deck.size);
  });

  it("drafts a different deck for a different seed, and the same one twice", () => {
    const a = botDeck(content, 1, leaderIds[0]!, "a");
    const b = botDeck(content, 2, leaderIds[0]!, "b");
    expect(botDeck(content, 1, leaderIds[0]!, "a").cards).toEqual(a.cards);
    expect(b.cards).not.toEqual(a.cards);
  });

  it("covers the curve rather than drafting thirty of one cost", () => {
    for (const leaderCardId of leaderIds) {
      const deck = botDeck(content, 5, leaderCardId, "Bot");
      const buckets = new Set(deck.cards.map((cardId) => curveBucket(content.cards[cardId]!.cost)));
      expect(buckets.size, leaderCardId).toBeGreaterThanOrEqual(4);
    }
  });
});

// ---------------------------------------------------------------------------

describe("a run", () => {
  it("offers three leaders from three different factions", () => {
    for (let seed = 0; seed < 60; seed++) {
      const offered = leaderOffer(content, seed);
      expect(offered.length).toBe(data.draft.leaderChoices);
      expect(new Set(offered).size).toBe(offered.length);
      const factions = offered.map((id) => content.leaders[id]!.faction);
      expect(new Set(factions).size, `seed ${seed} repeated a faction`).toBe(factions.length);
      for (const id of offered) expect(content.leaders[id]!.token).toBeFalsy();
    }
  });

  it("walks from a leader pick to a full deck", () => {
    let run = startRun(content, 12, 0);
    expect(run.phase).toBe("leader");
    expect(currentOffer(content, run)).toBeNull();

    run = chooseLeader(run, run.leaderChoices[1]!);
    expect(run.phase).toBe("draft");

    run = draftFully(run);
    expect(run.deck.length).toBe(data.draft.picks);
    expect(run.phase).toBe("ready");
    expect(currentOffer(content, run)).toBeNull();
    expect(deckListFor(run).cards.length).toBe(data.draft.picks);
  });

  it("refuses a leader it never offered, and a card it never showed you", () => {
    let run = startRun(content, 3, 0);
    const notOffered = leaderIds.find((id) => !run.leaderChoices.includes(id))!;
    expect(chooseLeader(run, notOffered)).toEqual(run);

    run = chooseLeader(run, run.leaderChoices[0]!);
    const offer = currentOffer(content, run)!;
    const elsewhere = Object.keys(content.cards).find((id) => !offer.cardIds.includes(id))!;
    expect(pickCard(content, run, elsewhere)).toEqual(run);
  });

  /**
   * §8.2's one free "Delete and Repost", before the first match.
   *
   * It sends you back to pick one rather than handing over a generated list — a
   * re-draft you do not get to make is a reroll, and §8.2 calls it a re-draft.
   */
  it("re-drafts once, from pick one, and then refuses", () => {
    let run = draftedRun(8);
    const first = [...run.deck];

    run = redraft(run);
    expect(run.phase).toBe("draft");
    expect(run.deck).toEqual([]);
    expect(run.redraftsUsed).toBe(1);

    run = draftFully(run);
    expect(run.deck).not.toEqual(first);

    const refused = redraft(run);
    expect(refused.generation).toBe(run.generation);
    expect(refused.deck).toEqual(run.deck);
  });

  it("ends on the third loss and on the twelfth win", () => {
    const base = beginRun(draftedRun(21));

    let losing = base;
    for (let i = 0; i < data.run.lossesToRetire; i++) {
      losing = resolveFight(enterFight(content, losing), false);
    }
    expect(losing.losses).toBe(data.run.lossesToRetire);
    expect(isOver(losing)).toBe(true);
    expect(losing.phase).toBe("done");
    // and it will not deal another board
    expect(enterFight(content, losing)).toEqual(losing);

    let winning = base;
    for (let i = 0; i < data.run.winsToRetire; i++) {
      winning = resolveFight(enterFight(content, winning), true);
    }
    expect(winning.wins).toBe(data.run.winsToRetire);
    expect(isOver(winning)).toBe(true);
  });

  /**
   * Walking out of a losing board gives the same board back.
   *
   * The Doomscroll mixes its re-entry count into the battle seed so a restart is
   * at least a different game. The Gauntlet does the opposite on purpose: a loss
   * is the resource being spent here, so a fresh roll would be worth farming.
   * The most an offline build can do is refuse to reroll and keep the count.
   */
  it("hands the same fight back to somebody who walked out of it", () => {
    let run = beginRun(draftedRun(55));
    run = enterFight(content, run);
    const first = run.pending!;

    // navigating away and back
    run = enterFight(content, run);
    expect(run.pending).toEqual(first);
    expect(run.fightsEntered).toBe(2);

    // and it is a genuinely different fight once the record moves
    run = resolveFight(run, true);
    expect(nextFight(content, run).seed).not.toBe(first.seed);
  });

  it("escalates the opponent as wins accumulate (§8.4)", () => {
    expect(difficultyForWins(0)).toBe("casual");
    expect(difficultyForWins(3)).toBe("casual");
    expect(difficultyForWins(4)).toBe("intermediate");
    expect(difficultyForWins(7)).toBe("intermediate");
    expect(difficultyForWins(8)).toBe("advanced");
    expect(difficultyForWins(12)).toBe("advanced");
  });

  it("retires early for the row it reached", () => {
    let run = beginRun(draftedRun(9));
    run = resolveFight(enterFight(content, run), true);
    run = resolveFight(enterFight(content, run), true);
    const retired = retire(run);
    expect(retired.phase).toBe("done");
    expect(retired.retiredEarly).toBe(true);
    expect(retired.pending).toBeNull();
    expect(practiceReward(retired.wins).clout).toBe(Math.round(rewardRowFor(2).clout * data.practice.scale));
  });

  it("picks a real opponent leader for every fight", () => {
    const run = beginRun(draftedRun(77));
    for (let wins = 0; wins <= data.run.winsToRetire; wins++) {
      const fight = nextFight(content, { ...run, wins });
      expect(leaderIds, `at ${wins} wins`).toContain(fight.enemyLeaderCardId);
      expect(fight.seed).toBe(subSeed(run.seed, "fight", wins, 0));
    }
  });
});

// ---------------------------------------------------------------------------

describe("what a run pays", () => {
  beforeEach(() => {
    profileStore.reset();
    gauntletStore.reset();
  });

  const finished = (wins: number): GauntletRun => ({
    ...beginRun(draftedRun(4)),
    wins,
    phase: "done",
  });

  it("pays the preview, exactly", () => {
    const run = finished(6);
    const preview = previewGauntlet(content, run);
    const before = profileStore.get().clout;
    const paid = claimGauntlet(content, run);

    expect(paid.clout).toBe(preview.clout);
    expect(paid.signal).toBe(preview.signal);
    expect(paid.cosmetics).toEqual(preview.cosmetics);
    expect(profileStore.get().clout).toBe(before + preview.clout);
  });

  it("banks Signal, and never a pack or a Ticket", () => {
    const before = profileStore.get().shards;
    const paid = claimGauntlet(content, finished(9));
    expect(paid.signal).toBe(Math.round(rewardRowFor(9).signal * data.practice.scale));
    expect(profileStore.get().shards).toBe(before + paid.signal);
    expect(profileStore.get().pendingDrops).toBe(0);
  });

  it("grants the 12-win cosmetics once and never again", () => {
    const first = claimGauntlet(content, finished(12));
    expect(first.cosmetics).toContain("title:award:perfect-run");
    expect(first.cosmetics).toContain(data.cardBack.cosmeticId);
    expect(profileStore.get().cosmetics.owned).toContain("title:award:perfect-run");

    const second = claimGauntlet(content, finished(12));
    expect(second.cosmetics).toEqual([]);
  });

  /**
   * §8.3's rows 10 and 11 pay "card-back progress +1" and never say what the
   * back costs. The threshold is authored in data with that stated; this checks
   * the counter accumulates across runs and grants exactly once.
   */
  it("accumulates card-back progress across runs and grants at the threshold", () => {
    const required = data.cardBack.progressRequired;
    for (let run = 0; run < required - 1; run++) {
      const paid = claimGauntlet(content, finished(10));
      expect(paid.cardBackEarned).toBe(false);
      expect(paid.cosmetics).toEqual([]);
    }
    expect(gauntletStore.get().cardBackProgress).toBe(required - 1);

    const last = claimGauntlet(content, finished(11));
    expect(last.cardBackEarned).toBe(true);
    expect(last.cosmetics).toEqual([data.cardBack.cosmeticId]);
    expect(profileStore.get().cosmetics.owned).toContain(data.cardBack.cosmeticId);

    // the counter keeps counting; it is the record of how the back was earned
    expect(gauntletStore.get().cardBackProgress).toBe(required);
    expect(claimGauntlet(content, finished(10)).cosmetics).toEqual([]);
  });

  it("clears the run so a closed tab cannot come back to a corpse", () => {
    gauntletStore.set({ run: finished(3) });
    claimGauntlet(content, gauntletStore.get().run!);
    expect(gauntletStore.get().run).toBeNull();
    expect(gauntletStore.get().runsFinished).toBe(1);
    expect(gauntletStore.get().bestWins).toBe(3);
  });
});

// ---------------------------------------------------------------------------

describe("the AI daily Clout cap — 09 §3", () => {
  beforeEach(() => {
    profileStore.reset();
    gauntletStore.reset();
  });

  const cap = aiDailyCap();

  it("spends against one shared ledger", () => {
    expect(aiCloutRemaining(cap)).toBe(cap);
    expect(spendAiClout(30, cap)).toBe(30);
    expect(aiCloutSpent()).toBe(30);
    expect(aiCloutRemaining(cap)).toBe(cap - 30);
  });

  it("hands back only what is left, never more", () => {
    expect(spendAiClout(cap - 10, cap)).toBe(cap - 10);
    expect(spendAiClout(500, cap)).toBe(10);
    expect(spendAiClout(1, cap)).toBe(0);
    expect(aiCloutSpent()).toBe(cap);
  });

  it("resets on a calendar day rather than a rolling window", () => {
    const monday = Date.parse("2026-03-02T22:00:00Z");
    const tuesday = Date.parse("2026-03-03T09:00:00Z");
    expect(spendAiClout(cap, cap, monday)).toBe(cap);
    expect(aiCloutRemaining(cap, monday)).toBe(0);
    expect(aiCloutRemaining(cap, tuesday)).toBe(cap);
  });

  /**
   * A capped payout says it was capped.
   *
   * A run that quietly pays less than the table it just showed you is the
   * subtraction §6's honesty rules exist to stop, so the amount withheld is
   * reported and the summary prints it.
   */
  it("reports what the cap withheld instead of quietly paying less", () => {
    const run: GauntletRun = {
      ...beginRun(draftedRun(4)),
      wins: 12,
      phase: "done",
    };
    const full = practiceReward(12).clout;
    expect(full).toBeGreaterThan(0);

    spendAiClout(cap - 10, cap);
    const paid = claimGauntlet(content, run);
    expect(paid.clout).toBe(10);
    expect(paid.cloutCapped).toBe(full - 10);
    expect(previewGauntlet(content, run).clout).toBe(0);
  });
});
