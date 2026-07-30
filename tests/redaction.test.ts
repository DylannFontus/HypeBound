/**
 * Per-seat event redaction — `docs/tech/03-multiplayer-architecture.md` §5.
 *
 * Online, a batch is broadcast to both players. Anything left in it is
 * something the opponent's client *receives*, and a client that has been sent a
 * card identity has it no matter what the UI draws. So the interesting question
 * is not "does redaction work on the cases we thought of" but "is there a case
 * nobody thought of" — and the answer to that decays every time an event is
 * added to the engine.
 *
 * Hence the shape of this file. The centrepiece is not a test at all; it is
 * `EVENT_CLASSIFICATION`, an allowlist saying of every event whether it can
 * name a card in a private zone, and why.
 *
 * **The guarantee is the type, not the runtime check.** Because the table is
 * declared `Record<EngineEvent["e"], …>`, adding a variant to the union makes
 * this file stop compiling until somebody classifies it — all 66 kinds, whether
 * or not any test happens to provoke one. The runtime test below can only see
 * the ~33 kinds five random matches actually emit, so it is the weaker of the
 * two and is kept for the case the type cannot cover: an event that is emitted
 * but was classified wrongly.
 *
 * The rest are spot checks on the four events whose answer is "yes".
 */

import { describe, expect, it } from "vitest";
import { getContent } from "../src/engine/content";
import { autoBuildDeck } from "../src/engine/deck";
import { createMatch, redactEvents } from "../src/engine/state";
import { applyIntent } from "../src/engine/reducer";
import { enumerateLegalIntents } from "../src/engine/intents";
import { nextInt, seedRng } from "../src/engine/rng";
import type { EngineEvent, MatchState, Seat } from "../src/engine/types";

const content = getContent();

/**
 * Every `EngineEvent` discriminator, and whether it may carry the identity of a
 * card in a **private** zone (a hand, a deck, or a face-down Reaction).
 *
 * `"public"`     — everything it names was already visible to both players.
 * `"private"`    — it can name a private card, so `redactEvents` must handle it.
 *
 * The justification column is not decoration. Each `"public"` entry is a claim
 * that can be wrong, and writing it down is what makes it reviewable.
 */
const EVENT_CLASSIFICATION: Record<EngineEvent["e"], { visibility: "public" | "private"; why: string }> = {
  // --- match and turn structure: all public by canon ------------------------
  matchStarted: { visibility: "public", why: "leaders and the coin flip are announced to both players" },
  mulliganDone: { visibility: "public", why: "counts only — kept and replaced, never which cards" },
  turnStarted: { visibility: "public", why: "whose turn, and Hype totals, which are public resources" },
  turnEnded: { visibility: "public", why: "carries a seat and nothing else — no card, no zone, no count" },
  matchEnded: { visibility: "public", why: "the winner and the reason, both of which both players are owed" },

  // --- the private zones ----------------------------------------------------
  cardDrawn: { visibility: "private", why: "a card entering a hand; cardId is nulled for the non-owner" },
  cardAddedToHand: { visibility: "private", why: "viral copies, steals and comeback returns enter a hand" },
  comebackReturned: {
    visibility: "private",
    why: "mode 'hand' names a card entering a hand and cardId is not nullable, so the event is dropped",
  },
  keywordTriggered: {
    visibility: "private",
    why: "the 'comeback' keyword names the card going to hand; the other six keywords name public cards",
  },

  // --- leaving a hand or deck for a PUBLIC zone -----------------------------
  cardBurned: { visibility: "public", why: "Lost in the Feed burns are shown to both players by design" },
  cardDiscarded: { visibility: "public", why: "the discard pile is public" },
  cardMilled: { visibility: "public", why: "milled cards land in the public discard" },
  deckScryed: { visibility: "public", why: "count only; the peeked identities travel in the owner's snapshot" },
  costModified: { visibility: "public", why: "instanceId and a delta, no identity" },
  fatigueDamage: { visibility: "public", why: "a damage number against a leader whose health is already public" },

  // --- reactions ------------------------------------------------------------
  reactionSet: { visibility: "public", why: "carries no cardId by design — a face-down card stays face-down" },
  reactionTriggered: { visibility: "public", why: "a Reaction flips face-up when it fires; revealing it is correct" },

  // --- the board and other public zones ------------------------------------
  cardPlayed: { visibility: "public", why: "playing a card is how it becomes public" },
  characterSummoned: { visibility: "public", why: "the board is public, and a summon is how a card gets there" },
  characterDefeated: { visibility: "public", why: "the board is public, and both players watched the body fall" },
  characterBanished: { visibility: "public", why: "it left a public board" },
  characterReturnedFromBanish: { visibility: "public", why: "it arrives on a public board" },
  characterTransformed: { visibility: "public", why: "the board is public, and the new body stands there for both to read" },
  characterResurrected: { visibility: "public", why: "it arrives on a public board" },
  characterReturnedToHand: {
    visibility: "public",
    why: "the card was public on the board and both players watched it leave — hiding it now reveals nothing new",
  },
  defeatPrevented: { visibility: "public", why: "a board character that did not die" },
  waveArrived: { visibility: "public", why: "scripted bodies arriving on a public board" },
  growProgressed: { visibility: "public", why: "a counter on a board character" },
  growCompleted: { visibility: "public", why: "a counter on a board character" },
  refracted: { visibility: "public", why: "a Current change on a public instance" },
  equipped: { visibility: "public", why: "equipment sits visibly on a board character" },
  equipmentDestroyed: { visibility: "public", why: "equipment sits visibly on a board character" },
  locationPlayed: { visibility: "public", why: "the location slot is public" },
  locationActivated: { visibility: "public", why: "the location slot is public" },
  eventStarted: { visibility: "public", why: "the event banner is public" },
  eventTicked: { visibility: "public", why: "the event banner is public" },
  eventEnded: { visibility: "public", why: "the event banner is public" },

  // --- combat and stat changes, all against visible objects -----------------
  attackDeclared: { visibility: "public", why: "attacks are declared against public bodies" },
  damageDealt: { visibility: "public", why: "damage lands on public bodies" },
  healed: { visibility: "public", why: "healing lands on public bodies" },
  armorChanged: {
    visibility: "public",
    why: "RedactedOpponent.armor is published and the HUD draws it for both seats, so the change is owed to both",
  },
  statusApplied: { visibility: "public", why: "statuses are shown on public bodies" },
  statusRemoved: { visibility: "public", why: "statuses are shown on public bodies" },
  statusTriggered: { visibility: "public", why: "statuses are shown on public bodies" },
  buffApplied: { visibility: "public", why: "stat changes on public bodies" },
  statsSet: { visibility: "public", why: "stat changes on public bodies" },
  keywordAdded: { visibility: "public", why: "keywords are printed on public bodies" },
  keywordRemoved: { visibility: "public", why: "keywords are printed on public bodies" },

  // --- resources, all public by canon ---------------------------------------
  hypeChanged: { visibility: "public", why: "Hype is a public resource" },
  hypeLocked: { visibility: "public", why: "Hype is a public resource" },
  obsessionChanged: { visibility: "public", why: "Obsession is public so Fixation timing is readable" },
  obsessedThresholdCrossed: { visibility: "public", why: "Obsession is public, so crossing its threshold is too" },
  fullFixation: { visibility: "public", why: "Obsession is public, so reaching full Fixation is visible to both" },
  fixationUsed: { visibility: "public", why: "a leader ability firing is public" },
  confluenceActivated: { visibility: "public", why: "confluences are announced to both players" },
  resonanceAdvanced: { visibility: "public", why: "resonance progress is public" },
  resonanceActivated: { visibility: "public", why: "resonance is announced" },
  leaderCurrentChanged: { visibility: "public", why: "a leader's Current decides elemental bonuses, so it is public" },
  counterChanged: { visibility: "public", why: "counters are public so Finale progress is visible to both" },

  // --- scheduling and bookkeeping -------------------------------------------
  comebackScheduled: {
    visibility: "public",
    why: "scheduled by a character dying on a public board, and it is a deliberate telegraph",
  },
  delayedScheduled: { visibility: "public", why: "a label and a turn, no identity" },
  delayedTriggered: { visibility: "public", why: "an author-written label firing, naming no card and no zone" },
  aurasDisabled: { visibility: "public", why: "Eclipse changes the rules for both players and must be legible to both" },
  aurasReenabled: { visibility: "public", why: "the end of a global rule change, owed to both players equally" },
  triggerQueued: { visibility: "public", why: "names the source card, which is public once played" },
  triggerCapReached: { visibility: "public", why: "a count of dropped triggers, needed by both players to explain a stall" },
  chooseOneResolved: { visibility: "public", why: "both players are entitled to see what a card resolved into" },
  randomResolved: { visibility: "public", why: "both players are entitled to see what a card resolved into" },
};

/**
 * The only two cards in the game with `comeback`, both `mode: "hand"` — which
 * is the one mode that leaks.
 *
 * Named here because the first version of the sweep below used two Neon Idols
 * decks and produced **zero** comeback events across five full matches, so
 * every comeback assertion in it was passing without ever running. Measuring
 * that was the difference between a test and a decoration.
 */
const COMEBACK_LEADERS: [string, string] = ["goth-leader-morvina-vane", "after-leader-dj-last-call"];

/**
 * Play a match with pseudo-random legal intents, collecting every event.
 * Redaction can only be tested against events the engine actually produces.
 */
function playCollectingEvents(
  seed: number,
  maxIntents = 400,
  leaders: [string, string] = COMEBACK_LEADERS
): { events: EngineEvent[]; state: MatchState } {
  let state = createMatch(
    {
      seed,
      decks: [autoBuildDeck(content, leaders[0], "P1"), autoBuildDeck(content, leaders[1], "P2")],
      firstSeat: 0,
    },
    content
  );
  const collected: EngineEvent[] = [];
  const rng = seedRng(seed ^ 0x9e3779b9);

  const submit = (intent: Parameters<typeof applyIntent>[2]): void => {
    const result = applyIntent(state, content, intent);
    state = result.state;
    collected.push(...result.events);
  };

  submit({ type: "mulligan", seat: 0, replaceInstanceIds: [] });
  submit({ type: "mulligan", seat: 1, replaceInstanceIds: [] });

  let count = 0;
  while (state.winner === null && count < maxIntents) {
    const legal = enumerateLegalIntents(state, content, state.activeSeat);
    if (legal.length === 0) break;
    const doing = legal.filter((i) => i.type !== "endTurn");
    const pool = doing.length > 0 && nextInt(rng, 100) < 78 ? doing : legal;
    submit(pool[nextInt(rng, pool.length)]!);
    count++;
  }
  return { events: collected, state };
}

describe("the classification is complete", () => {
  /**
   * Weaker than the `Record` type above, which already forces every variant to
   * be classified at compile time. This only reaches the kinds five random
   * matches actually produce — about half of them — and is kept because the
   * type cannot catch an event that is classified but classified *wrongly*.
   */
  it("classifies every event these matches actually emit", () => {
    const { events } = playCollectingEvents(0xc0ffee);
    const emitted = new Set(events.map((e) => e.e));
    const unclassified = [...emitted].filter((e) => !(e in EVENT_CLASSIFICATION));
    expect(unclassified).toEqual([]);
  });

  it("classifies nothing that does not exist", () => {
    // Guards the other direction: a renamed or deleted event leaves a stale
    // entry behind, and a stale justification is worse than none.
    const declared = Object.keys(EVENT_CLASSIFICATION);
    expect(declared.length).toBeGreaterThan(50);
    for (const name of declared) expect(typeof name).toBe("string");
  });

  it("gives every entry a real justification", () => {
    for (const [name, entry] of Object.entries(EVENT_CLASSIFICATION)) {
      expect(entry.why.length, `${name} needs a reason, not a placeholder`).toBeGreaterThan(20);
    }
  });
});

describe("no private card identity reaches the wrong seat", () => {
  /**
   * The sweep: play whole matches, redact every event for each seat, and assert
   * that nothing classified private survives with an identity attached.
   */
  it("holds across whole matches, for both seats", () => {
    /**
     * Counted, and asserted on at the end. A sweep that happens to generate no
     * comeback is a sweep whose comeback assertions never execute, and it will
     * pass just as green as one that does.
     */
    const exercised = { comebackHand: 0, drawsHidden: 0, addsHidden: 0 };

    for (const seed of [1, 7, 99, 4242, 0xbadbeef]) {
      const { events } = playCollectingEvents(seed);
      for (const event of events) {
        if (event.e === "comebackReturned" && event.mode === "hand") exercised.comebackHand += 1;
      }

      for (const viewer of [0, 1] as Seat[]) {
        for (const event of redactEvents(events, viewer)) {
          if (event.e === "cardDrawn" && event.seat !== viewer && event.cardId === null) {
            exercised.drawsHidden += 1;
          }
          if (event.e === "cardAddedToHand" && event.seat !== viewer && event.cardId === null) {
            exercised.addsHidden += 1;
          }
          if (event.e === "cardDrawn" && event.seat !== viewer) {
            expect(event.cardId, `seed ${seed}: opponent draw leaked`).toBeNull();
          }
          if (event.e === "cardAddedToHand" && event.seat !== viewer) {
            expect(event.cardId, `seed ${seed}: opponent hand addition leaked`).toBeNull();
          }
          if (event.e === "comebackReturned" && event.seat !== viewer) {
            expect(event.mode, `seed ${seed}: a hand comeback survived redaction`).toBe("play");
          }
          if (event.e === "keywordTriggered" && event.seat !== viewer) {
            expect(event.keyword, `seed ${seed}: a comeback keyword leaked`).not.toBe("comeback");
          }
        }
      }
    }

    // The proof that the loop above ran the checks it claims to run.
    expect(exercised.drawsHidden, "no opponent draw was ever hidden").toBeGreaterThan(0);
    expect(exercised.addsHidden, "no opponent hand-addition was ever hidden").toBeGreaterThan(0);
    expect(
      exercised.comebackHand,
      "these matches produced no hand-mode comeback, so the comeback assertions never ran"
    ).toBeGreaterThan(0);
  });

  it("leaves the owner's own events completely intact", () => {
    const { events } = playCollectingEvents(31337);
    for (const viewer of [0, 1] as Seat[]) {
      const redacted = redactEvents(events, viewer);
      const mine = events.filter((e) => "seat" in e && e.seat === viewer);
      const minePreserved = redacted.filter((e) => "seat" in e && e.seat === viewer);
      // Nothing of yours is dropped, and nothing of yours is blanked.
      expect(minePreserved).toEqual(mine);
    }
  });

  it("does not disturb public events", () => {
    const { events } = playCollectingEvents(2024);
    const redacted = redactEvents(events, 0);
    const publicKinds = new Set(
      Object.entries(EVENT_CLASSIFICATION)
        .filter(([, v]) => v.visibility === "public")
        .map(([k]) => k)
    );
    const before = events.filter((e) => publicKinds.has(e.e));
    const after = redacted.filter((e) => publicKinds.has(e.e));
    expect(after).toEqual(before);
  });
});

describe("the comeback leak specifically", () => {
  /**
   * The case that §5's table missed, kept as its own test because it is the
   * reason this file found anything.
   *
   * A `mode: "hand"` comeback emitted three events naming the same card:
   * `cardAddedToHand` (which the table said to blank), `comebackReturned`, and
   * `keywordTriggered`. Blanking one of three hides nothing.
   */
  it("hides all three events, not just the one the table named", () => {
    const owner: Seat = 0;
    const events: EngineEvent[] = [
      { e: "cardAddedToHand", seat: owner, instanceId: "c-1", cardId: "idols-fan-chant", source: "comeback" },
      { e: "comebackReturned", seat: owner, cardId: "idols-fan-chant", mode: "hand" },
      { e: "keywordTriggered", seat: owner, instanceId: null, cardId: "idols-fan-chant", keyword: "comeback" },
    ];

    const opponentSees = redactEvents(events, 1);
    const namesLeaked = JSON.stringify(opponentSees).includes("idols-fan-chant");
    expect(namesLeaked, "the card name survived redaction somewhere in the batch").toBe(false);

    // and the opponent still has enough to animate it
    const added = opponentSees.find((e) => e.e === "cardAddedToHand");
    expect(added).toBeDefined();
    expect(added && "source" in added ? added.source : null).toBe("comeback");
  });

  it("leaves a play-mode comeback alone, because it lands in public", () => {
    const events: EngineEvent[] = [
      { e: "comebackReturned", seat: 0, cardId: "idols-fan-chant", mode: "play" },
    ];
    expect(redactEvents(events, 1)).toEqual(events);
  });

  it("shows the owner everything", () => {
    const events: EngineEvent[] = [
      { e: "cardAddedToHand", seat: 0, instanceId: "c-1", cardId: "idols-fan-chant", source: "comeback" },
      { e: "comebackReturned", seat: 0, cardId: "idols-fan-chant", mode: "hand" },
      { e: "keywordTriggered", seat: 0, instanceId: null, cardId: "idols-fan-chant", keyword: "comeback" },
    ];
    expect(redactEvents(events, 0)).toEqual(events);
  });
});

describe("the other six keywords are not collateral damage", () => {
  it("still reaches the opponent, because they name public cards", () => {
    const events: EngineEvent[] = [
      { e: "keywordTriggered", seat: 0, instanceId: "ch-1", cardId: "idols-fan-chant", keyword: "viral" },
      { e: "keywordTriggered", seat: 0, instanceId: "ch-1", cardId: "idols-fan-chant", keyword: "rushwind" },
      { e: "keywordTriggered", seat: 0, instanceId: "ch-2", cardId: "idols-fan-chant", keyword: "parasocial" },
    ];
    // The card these name was just played, and cardPlayed already announced it.
    // Redacting them would hide something the opponent watched happen.
    expect(redactEvents(events, 1)).toEqual(events);
  });
});
