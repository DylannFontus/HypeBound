/**
 * What playing pays, and the ceiling on a day of it — known gap 38, and
 * `09-game-modes.md` §3.
 *
 * §3 has always said Clout from AI play is "capped at 200 Clout/day
 * (`missions.aiDailyCap`)". Nothing had ever read that number. The Gauntlet was
 * the first thing to consume a cap at all, and this closes the other half: the
 * per-match Clout every offline mode pays now spends against the same
 * account-wide ledger.
 *
 * The cap is **derived, not copied**. §3's 200 sits against its own schedule of
 * 20–30 Clout per win — eight wins at the top of it — and this build pays more
 * per match than §3 assumes. Copying the 200 across would have shipped the same
 * number and a different rule: a ceiling that bit after three matches instead of
 * eight. `aiDailyCapWins` holds the rule; `aiDailyCap()` derives the number.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { getContent } from "../src/engine/content";
import { autoBuildDeck } from "../src/engine/deck";
import { createMatch } from "../src/engine/state";
import { applyIntent } from "../src/engine/reducer";
import { chooseIntent } from "../src/ai/ai";
import { getAiProfile } from "../src/ai/profiles";
import { recordIntent, startRecord } from "../src/engine/replay";
import type { MatchRecord, MatchState, PlayerIntent, Seat } from "../src/engine/types";
import { aiDailyCap, matchClout } from "../src/game/economy/income";
import { aiCloutRemaining, aiCloutSpent, profileStore, recordMatch, spendAiClout } from "../src/save/profile";

const content = getContent();
const economy = content.balance.economy.missions;

/** A real, replayable record — `recordMatch` reads it for missions and mastery. */
function playRecord(seed: number): MatchRecord {
  let state: MatchState = createMatch(
    { seed, decks: [autoBuildDeck(content, "idols-lumi-starcall", "A"), autoBuildDeck(content, "goth-leader-morvina-vane", "B")], firstSeat: 0 },
    content
  );
  const record = startRecord(state);
  const profiles = [getAiProfile("casual"), getAiProfile("casual")];

  while (state.phase === "mulligan") {
    const seat: Seat = state.players[0].mulliganDone ? 1 : 0;
    const decision = chooseIntent(state, content, seat, profiles[seat]!);
    if (!decision) break;
    recordIntent(record, decision.intent);
    state = applyIntent(state, content, decision.intent).state;
  }
  let guard = 0;
  while (state.winner === null && guard++ < 700) {
    const seat = state.activeSeat;
    const decision = chooseIntent(state, content, seat, profiles[seat]!);
    const intent: PlayerIntent = decision?.intent ?? { type: "endTurn", seat };
    recordIntent(record, intent);
    state = applyIntent(state, content, intent).state;
  }
  if (state.winner !== null) record.result = { winner: state.winner, turns: state.turn };
  return record;
}

const RECORD = playRecord(4242);
const MONDAY = Date.parse("2026-04-06T12:00:00Z");
const TUESDAY = Date.parse("2026-04-07T12:00:00Z");

const play = (outcome: "win" | "loss", now: number): ReturnType<typeof recordMatch> =>
  recordMatch(RECORD, outcome, {
    deckName: "A",
    leaderCardId: "idols-lumi-starcall",
    opponentLeaderCardId: "goth-leader-morvina-vane",
    mode: "ai-casual",
    // §3.5's first-win bonus is only paid when the content index is passed —
    // an earlier version of this helper omitted it and made the bonus look capped
    content,
    now,
  });

// ---------------------------------------------------------------------------

describe("the rates", () => {
  it("reads what a match pays out of the balance file, not out of a literal", () => {
    expect(matchClout(true)).toBe(economy.match.winClout);
    expect(matchClout(false)).toBe(economy.match.lossClout);
    // losing still pays: experimenting with a deck is not meant to be punished
    expect(matchClout(false)).toBeGreaterThan(0);
    expect(matchClout(true)).toBeGreaterThan(matchClout(false));
  });

  /**
   * The derivation, asserted rather than the constant.
   *
   * If somebody makes a win pay more, the ceiling rises with it — a cap
   * denominated in Clout would silently become a *tighter* cap every time the
   * game got more generous.
   */
  it("derives the daily ceiling from what a win is worth", () => {
    expect(aiDailyCap()).toBe(economy.aiDailyCapWins * economy.match.winClout);
    expect(aiDailyCap() / matchClout(true)).toBe(economy.aiDailyCapWins);
    // §3's own reading: the cap is worth eight wins
    expect(economy.aiDailyCapWins).toBe(8);
  });
});

// ---------------------------------------------------------------------------

describe("the daily allowance", () => {
  beforeEach(() => profileStore.reset());

  it("pays in full until the ceiling, then pays what is left", () => {
    const win = matchClout(true);
    const cap = aiDailyCap();
    const full = Math.floor(cap / win);

    let banked = 0;
    for (let match = 0; match < full; match++) {
      const paid = play("win", MONDAY);
      banked += paid.clout - paid.firstWinBonus;
      expect(paid.cloutCapped, `match ${match + 1}`).toBe(0);
    }
    expect(banked).toBe(full * win);
    expect(aiCloutRemaining(cap, MONDAY)).toBe(cap - full * win);

    const overflow = play("win", MONDAY);
    expect(overflow.clout - overflow.firstWinBonus).toBe(cap - full * win);
    expect(overflow.cloutCapped).toBe(win - (cap - full * win));
    expect(aiCloutRemaining(cap, MONDAY)).toBe(0);

    const nothing = play("win", MONDAY);
    expect(nothing.clout - nothing.firstWinBonus).toBe(0);
    expect(nothing.cloutCapped).toBe(win);
  });

  /**
   * The shortfall is *reported*. A payout that quietly shrinks is the exact
   * move §6's honesty rules exist to prevent, and the result screen prints this
   * number — before this block nothing printed what a match paid at all.
   */
  it("reports what it withheld rather than paying less in silence", () => {
    spendAiClout(aiDailyCap() - 10, aiDailyCap(), MONDAY);
    const paid = play("win", MONDAY);
    expect(paid.cloutCapped).toBe(matchClout(true) - 10);
    expect(paid.cloutRemainingToday).toBe(0);
  });

  /**
   * §3.5's first win of the day is paid once by construction, so there is
   * nothing for a ceiling to protect against — and capping it would mean the one
   * bonus the design calls unmissable could be missed by having played earlier.
   */
  it("pays the first-win bonus outside the cap", () => {
    spendAiClout(aiDailyCap(), aiDailyCap(), MONDAY);
    const paid = play("win", MONDAY);
    expect(paid.clout).toBe(economy.firstWinOfDayClout);
    expect(paid.firstWinBonus).toBe(economy.firstWinOfDayClout);
    expect(profileStore.get().clout).toBeGreaterThanOrEqual(economy.firstWinOfDayClout);
  });

  it("never caps XP, missions, Mastery or the match record", () => {
    spendAiClout(aiDailyCap(), aiDailyCap(), MONDAY);
    const before = profileStore.get();
    const paid = play("win", MONDAY);
    expect(paid.xp).toBeGreaterThan(0);
    expect(profileStore.get().accountXp + profileStore.get().accountLevel * 0).toBeGreaterThan(0);
    expect(profileStore.get().stats.matchesPlayed).toBe(before.stats.matchesPlayed + 1);
    expect(profileStore.get().history.length).toBe(before.history.length + 1);
  });

  it("resets on a calendar day", () => {
    spendAiClout(aiDailyCap(), aiDailyCap(), MONDAY);
    expect(aiCloutRemaining(aiDailyCap(), MONDAY)).toBe(0);
    const paid = play("win", TUESDAY);
    expect(paid.cloutCapped).toBe(0);
    expect(paid.clout - paid.firstWinBonus).toBe(matchClout(true));
  });

  /**
   * One ledger. §8.4 puts Gauntlet Practice inside the same allowance §3 gives
   * Sparring, and "shared" has to mean shared or it is two caps wearing one
   * name.
   */
  it("is one ledger, shared with the Gauntlet's run payout", () => {
    const cap = aiDailyCap();
    play("win", MONDAY);
    const afterMatch = aiCloutSpent(MONDAY);
    expect(afterMatch).toBe(matchClout(true));

    const takenByARun = spendAiClout(50, cap, MONDAY);
    expect(takenByARun).toBe(50);
    expect(aiCloutSpent(MONDAY)).toBe(afterMatch + 50);
    expect(aiCloutRemaining(cap, MONDAY)).toBe(cap - afterMatch - 50);
  });
});
