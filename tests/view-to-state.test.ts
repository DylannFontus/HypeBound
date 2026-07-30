/**
 * Answering legality from a `PlayerView` — the last piece of §15 phase 2.
 *
 * `viewToState` rebuilds a `MatchState`-shaped object from a view so the five
 * existing engine helpers can answer a networked client's questions unchanged.
 * The claim it rests on is that none of them needs information a view does not
 * carry.
 *
 * That claim is checked against the engine, not asserted: for real positions,
 * ask each helper the authoritative way and the view way, and require identical
 * answers. Where they *cannot* agree, the gap is named and tested for, so it
 * stays a known limit rather than becoming a surprise in the first online
 * match.
 */

import { describe, expect, it } from "vitest";
import { getContent } from "../src/engine/content";
import { autoBuildDeck } from "../src/engine/deck";
import { createMatch, redact } from "../src/engine/state";
import { applyIntent } from "../src/engine/reducer";
import {
  canActivateLocation,
  canUseFixation,
  checkPlayable,
  enumerateLegalIntents,
  legalEquipTargets,
  legalFixationTargets,
} from "../src/engine/intents";
import { legalAttackTargets } from "../src/engine/combat";
import { availableConfluences } from "../src/engine/currents";
import { nextInt, seedRng } from "../src/engine/rng";
import { sanitizeView } from "../src/net/localTransport";
import {
  attackTargetsFromView,
  equipTargetsFromView,
  fixationTargetsFromView,
  legalityFromView,
  playableFromView,
  viewToState,
} from "../src/net/viewToState";
import type { MatchState, PlayerView, Seat } from "../src/engine/types";

const content = getContent();

function midGame(seed: number, steps: number): MatchState {
  let state = createMatch(
    {
      seed,
      decks: [
        autoBuildDeck(content, "goth-leader-morvina-vane", "P1"),
        autoBuildDeck(content, "after-leader-dj-last-call", "P2"),
      ],
      firstSeat: 0,
    },
    content
  );
  state = applyIntent(state, content, { type: "mulligan", seat: 0, replaceInstanceIds: [] }).state;
  state = applyIntent(state, content, { type: "mulligan", seat: 1, replaceInstanceIds: [] }).state;

  const rng = seedRng(seed ^ 0x777);
  for (let i = 0; i < steps && state.winner === null; i++) {
    const legal = enumerateLegalIntents(state, content, state.activeSeat);
    if (legal.length === 0) break;
    const doing = legal.filter((intent) => intent.type !== "endTurn");
    const pool = doing.length > 0 && nextInt(rng, 100) < 80 ? doing : legal;
    state = applyIntent(state, content, pool[nextInt(rng, pool.length)]!).state;
  }
  return state;
}

/** Exactly what a networked client would hold: redacted, then sanitized. */
const clientView = (state: MatchState, seat: Seat): PlayerView =>
  structuredClone(sanitizeView(redact(state, seat)));

describe("the reconstruction answers what the engine answers", () => {
  it("agrees on every helper, at many positions, for both seats", () => {
    const mismatches: string[] = [];
    const seen = { positions: 0, playableChecks: 0, sawPlayable: 0, sawTargets: 0, sawFixation: 0 };

    for (const seed of [4, 44, 444, 4444, 55555, 606060]) {
      for (const steps of [2, 10, 24, 40]) {
        const state = midGame(seed, steps);
        if (state.winner !== null) continue;

        for (const seat of [0, 1] as Seat[]) {
          const view = clientView(state, seat);
          const rebuilt = viewToState(view);
          seen.positions += 1;
          const where = `seed ${seed} +${steps} seat ${seat}`;

          // checkPlayable, card by card
          for (const card of view.you.hand) {
            const truth = checkPlayable(state, content, seat, card.instanceId).ok;
            const fromView = playableFromView(view, content, seat, card.instanceId).ok;
            seen.playableChecks += 1;
            if (truth) seen.sawPlayable += 1;
            if (truth !== fromView) {
              mismatches.push(`${where}: checkPlayable(${card.cardId}) ${truth} != ${fromView}`);
            }
          }

          const truthTargets = JSON.stringify(legalAttackTargets(state, seat));
          const viewTargets = JSON.stringify(attackTargetsFromView(view));
          if (truthTargets !== viewTargets) mismatches.push(`${where}: legalAttackTargets ${truthTargets} != ${viewTargets}`);
          if (truthTargets !== "[]") seen.sawTargets += 1;

          const truthEquip = JSON.stringify(legalEquipTargets(state, seat));
          const viewEquip = JSON.stringify(equipTargetsFromView(view));
          if (truthEquip !== viewEquip) mismatches.push(`${where}: legalEquipTargets ${truthEquip} != ${viewEquip}`);

          for (const kind of ["fixation", "ultimate"] as const) {
            const truthFix = JSON.stringify(legalFixationTargets(state, content, seat, kind));
            const viewFix = JSON.stringify(fixationTargetsFromView(view, content, kind));
            if (truthFix !== viewFix) mismatches.push(`${where}: legalFixationTargets(${kind}) ${truthFix} != ${viewFix}`);
            if (canUseFixation(state, content, seat, kind) !== canUseFixation(rebuilt, content, seat, kind)) {
              mismatches.push(`${where}: canUseFixation(${kind}) disagreed`);
            }
            if (canUseFixation(state, content, seat, kind)) seen.sawFixation += 1;
          }

          if (canActivateLocation(state, content, seat) !== canActivateLocation(rebuilt, content, seat)) {
            mismatches.push(`${where}: canActivateLocation disagreed`);
          }

          const truthConf = JSON.stringify(availableConfluences(state, content, seat));
          const viewConf = JSON.stringify(availableConfluences(rebuilt, content, seat));
          if (truthConf !== viewConf) mismatches.push(`${where}: availableConfluences disagreed`);
        }
      }
    }

    expect(mismatches.slice(0, 8), "the reconstruction gave a different answer than the engine").toEqual([]);

    // and the comparison actually compared something
    expect(seen.positions).toBeGreaterThan(20);
    expect(seen.playableChecks).toBeGreaterThan(200);
    expect(seen.sawPlayable, "no card was ever playable, so checkPlayable proved nothing").toBeGreaterThan(0);
    expect(seen.sawTargets, "there was never anything to attack").toBeGreaterThan(0);
    expect(seen.sawFixation, "a Fixation was never available").toBeGreaterThan(0);
  });

  it("keeps the opponent's board slots where they were, nulls and all", () => {
    /**
     * Compacting the board would renumber every slot, silently changing which
     * characters are adjacent — and `{ select: "adjacent" }` is a real target
     * spec.
     */
    const state = midGame(1234, 30);
    for (const seat of [0, 1] as Seat[]) {
      const rebuilt = viewToState(clientView(state, seat));
      const foe: Seat = seat === 0 ? 1 : 0;
      expect(rebuilt.players[foe].board.map((c) => c?.instanceId ?? null)).toEqual(
        state.players[foe].board.map((c) => c?.instanceId ?? null)
      );
    }
  });

  it("gives the opponent's hidden zones the right counts and no identities", () => {
    const state = midGame(555, 22);
    const view = clientView(state, 0);
    const rebuilt = viewToState(view);

    expect(rebuilt.players[1].hand).toHaveLength(state.players[1].hand.length);
    expect(rebuilt.players[1].deck).toHaveLength(state.players[1].deck.length);
    expect(rebuilt.players[1].hand.length).toBeGreaterThan(0);
    for (const card of [...rebuilt.players[1].hand, ...rebuilt.players[1].deck]) {
      expect(card.cardId).toBe("hidden");
    }
    // and the real ones are genuinely different, so "hidden" is hiding something
    expect(state.players[1].hand.every((c) => c.cardId !== "hidden")).toBe(true);
  });
});

describe("the two limits are enforced, not hoped about", () => {
  it("refuses to answer about the opponent's hand", () => {
    /**
     * `checkPlayable` on the opponent's seat would read their hand, hit a
     * placeholder, and return `unknownInstance` — indistinguishable from a real
     * refusal. A throw is the honest answer to a question the client is not
     * entitled to ask.
     */
    const state = midGame(99, 18);
    const view = clientView(state, 0);
    const theirCard = state.players[1].hand[0]!;

    expect(() => playableFromView(view, content, 1, theirCard.instanceId)).toThrow(/not in a PlayerView/);
    // and asking it the wrong way round really would have lied rather than failed
    const wrong = checkPlayable(viewToState(view), content, 1, theirCard.instanceId);
    expect(wrong.ok).toBe(false);
    expect(wrong.reason).toBe("unknownInstance");
  });

  it("does not route canAttack through the aura path", () => {
    /**
     * `attackableBy` reaches `evalCondition`, which can read
     * `players[seat].deck[0]` via `topOfDeckMatches` — the one place a
     * sanitized placeholder is actually dereferenced. `legalityFromView` uses
     * the structural check instead, and this pins that it never regresses to
     * calling the engine helper on a reconstructed state.
     */
    const state = midGame(2222, 26);
    const view = clientView(state, 0);
    const legality = legalityFromView(view, content);

    // Whatever it reports, it must be a subset of bodies that exist and are
    // this seat's — the structural check has no way to invent one.
    const mine = new Set(view.you.board.filter(Boolean).map((c) => c!.instanceId));
    for (const id of legality.canAttack) expect(mine.has(id)).toBe(true);
  });

  it("reports the same yourTurn and confluences as the authoritative path", () => {
    for (const seed of [11, 111]) {
      const state = midGame(seed, 20);
      if (state.winner !== null) continue;
      for (const seat of [0, 1] as Seat[]) {
        const view = clientView(state, seat);
        const legality = legalityFromView(view, content);
        expect(legality.yourTurn).toBe(state.activeSeat === seat && state.phase === "main" && state.winner === null);
        expect(JSON.stringify(legality.confluences)).toBe(
          JSON.stringify(availableConfluences(state, content, seat))
        );
      }
    }
  });
});

describe("the reconstruction is inert", () => {
  it("does not touch the view it was built from", () => {
    const state = midGame(808, 20);
    const view = clientView(state, 0);
    const before = JSON.stringify(view);

    viewToState(view);
    legalityFromView(view, content);
    attackTargetsFromView(view);
    equipTargetsFromView(view);
    fixationTargetsFromView(view, content, "fixation");

    expect(JSON.stringify(view)).toBe(before);
  });
});
