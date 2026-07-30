/**
 * The transport seam — `docs/tech/03-multiplayer-architecture.md` §6 and §15
 * phase 1.
 *
 * These tests exist to defend one claim: that the offline build now exercises
 * every online code path except the socket. A batch counter that skips, a view
 * hash that cannot tell two seats apart, or a `legality()` that quietly
 * disagrees with the engine would each make that claim false while the game
 * still looked fine — so each one is checked against an independent oracle
 * rather than against itself.
 */

import { describe, expect, it } from "vitest";
import { getContent } from "../src/engine/content";
import { autoBuildDeck } from "../src/engine/deck";
import {
  attackableBy,
  canActivateLocation,
  canUseFixation,
  checkPlayable,
  enumerateLegalIntents,
} from "../src/engine/intents";
import { nextInt, seedRng } from "../src/engine/rng";
import { getAiProfile } from "../src/ai/profiles";
import { LocalTransport, viewHash } from "../src/net/localTransport";
import { EMPTY_LEGALITY, isYourTurn, type EventBatch, type MatchTransport } from "../src/net/transport";
import type { Seat } from "../src/engine/types";

const content = getContent();

function makeTransport(options: { seed?: number; hotseat?: boolean } = {}): LocalTransport {
  return new LocalTransport({
    content,
    playerDeck: autoBuildDeck(content, "idols-lumi-starcall", "P1"),
    aiDeck: autoBuildDeck(content, "idols-dj-kilowatt", "P2"),
    aiProfile: getAiProfile("intermediate"),
    seed: options.seed ?? 24601,
    playerSeat: 0,
    firstSeat: 0,
    ...(options.hotseat ? { opponent: "human" as const } : {}),
  });
}

/** Get past the mulligan so the match is in a normal main phase. */
async function openMatch(transport: LocalTransport): Promise<void> {
  await transport.connect();
  await transport.submit({ type: "mulligan", seat: transport.seat, replaceInstanceIds: [] });
}

describe("LocalTransport satisfies MatchTransport", () => {
  it("is assignable to the interface, with no extra required surface", () => {
    // A compile-time assertion that also runs: if LocalTransport ever stops
    // implementing the interface, this file stops typechecking.
    const transport: MatchTransport = makeTransport();
    expect(transport.seat).toBe(0);
    expect(transport.content).toBe(transport.content);
  });

  it("reports a live, zero-latency connection rather than pretending to connect", async () => {
    const transport = makeTransport();
    const seen: string[] = [];
    transport.onStatus((status) => seen.push(status.kind));
    await transport.connect();
    // An in-process match genuinely cannot be unstable. "live" is the truth
    // here, not a placeholder for a state machine that was never built.
    expect(seen).toContain("live");
  });

  it("offers hotseat controls only when the other seat is a person", () => {
    expect(makeTransport().hotseat).toBeUndefined();
    expect(makeTransport({ hotseat: true }).hotseat).toBeDefined();
  });
});

describe("batches", () => {
  it("numbers every batch gap-free and strictly increasing", async () => {
    const transport = makeTransport();
    const seqs: number[] = [];
    transport.onBatch((batch) => {
      seqs.push(batch.seq);
    });

    await openMatch(transport);
    // a few turns of real play, whatever the AI does with them
    for (let i = 0; i < 4; i++) {
      await transport.submit({ type: "endTurn", seat: transport.seat });
    }

    expect(seqs.length).toBeGreaterThan(0);
    // The property that matters online: a client seeing a gap must resync, so
    // a transport that produces one is producing a false alarm at best.
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
  });

  it("attaches a corrective snapshot on turn boundaries, as the online build will", async () => {
    const transport = makeTransport();
    const batches: EventBatch[] = [];
    transport.onBatch((batch) => {
      batches.push(batch);
    });

    await openMatch(transport);
    await transport.submit({ type: "endTurn", seat: transport.seat });

    const withTurnStart = batches.filter((b) => b.events.some((e) => e.e === "turnStarted"));
    expect(withTurnStart.length).toBeGreaterThan(0);
    for (const batch of withTurnStart) {
      expect(batch.snapshot).toBeDefined();
      expect(batch.snapshot?.view.seat).toBe(transport.seat);
    }
  });

  it("awaits an async listener before letting the match move on", async () => {
    /**
     * The reason `onBatch` may return a promise. If the transport did not wait,
     * the AI would take its turn on top of the animation of the player's — the
     * bug this signature exists to prevent.
     */
    const transport = makeTransport();
    let inFlight = 0;
    let overlapped = false;

    transport.onBatch(async () => {
      inFlight += 1;
      if (inFlight > 1) overlapped = true;
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
    });

    await openMatch(transport);
    await transport.submit({ type: "endTurn", seat: transport.seat });

    expect(overlapped).toBe(false);
  });
});

describe("viewHash", () => {
  it("is stable for the same view", async () => {
    const transport = makeTransport();
    await openMatch(transport);
    expect(viewHash(transport.view())).toBe(viewHash(transport.view()));
  });

  it("differs between the two seats of the same match", async () => {
    /**
     * The whole point of a per-seat hash: the two sides of one match are
     * looking at different information, so a hash that agreed would be hashing
     * something neither client actually holds.
     */
    const transport = makeTransport({ hotseat: true });
    await openMatch(transport);
    const first = viewHash(transport.view());

    transport.hotseat?.setViewingSeat(1);
    const second = viewHash(transport.view());

    expect(first).not.toBe(second);
  });

  it("changes when the board changes", async () => {
    const transport = makeTransport();
    await openMatch(transport);
    const before = viewHash(transport.view());
    await transport.submit({ type: "endTurn", seat: transport.seat });
    expect(viewHash(transport.view())).not.toBe(before);
  });
});

describe("the view is sanitized, offline too", () => {
  /**
   * §5.2. `PlayerView.you` is the full `PlayerState`, deck order included —
   * correct when the local process is the authority, a real leak when it is
   * not, because a modified client would know its own next draw.
   *
   * Applied offline on purpose (§15 phase 2): the UI is then built against the
   * information a networked client actually has, so anything depending on
   * knowing its own deck breaks in a test rather than in a real match. It found
   * two such places in the verify scripts immediately.
   */
  it("hides the seat's own deck order while keeping the count", async () => {
    const transport = makeTransport();
    await openMatch(transport);

    const real = transport.authoritativeState().players[transport.seat].deck;
    const shown = transport.view().you.deck;

    expect(shown).toHaveLength(real.length);
    expect(shown.length).toBeGreaterThan(0);
    for (const instance of shown) expect(instance.cardId).toBe("hidden");
    // instanceIds survive, so bookkeeping that tracks a specific card still works
    expect(shown.map((c) => c.instanceId)).toEqual(real.map((c) => c.instanceId));
  });

  it("leaves the hand alone — it is yours and you may read it", async () => {
    const transport = makeTransport();
    await openMatch(transport);
    const hand = transport.view().you.hand;
    expect(hand.length).toBeGreaterThan(0);
    for (const card of hand) expect(card.cardId).not.toBe("hidden");
  });

  it("does not mutate the real deck", async () => {
    /**
     * The trap this guards. `redact()` returns `you` as a live reference into
     * the match state, so sanitizing in place would not hide the deck from the
     * client — it would delete the deck from the game.
     */
    const transport = makeTransport();
    await openMatch(transport);

    const before = transport.authoritativeState().players[transport.seat].deck.map((c) => c.cardId);
    transport.view();
    transport.view();
    const after = transport.authoritativeState().players[transport.seat].deck.map((c) => c.cardId);

    expect(after).toEqual(before);
    expect(after.some((id) => id === "hidden")).toBe(false);
  });

  it("still deals a playable match through the sanitized view", async () => {
    // the end-to-end check: if sanitizing had broken the draw pipeline, the
    // hand would stop refilling and this would run out of legal intents fast
    const transport = makeTransport();
    await openMatch(transport);
    for (let i = 0; i < 5; i++) {
      const result = await transport.submit({ type: "endTurn", seat: transport.seat });
      expect(result.ok).toBe(true);
    }
    expect(transport.view().you.hand.length).toBeGreaterThan(0);
  });
});

describe("batches reaching the UI are redacted", () => {
  it("never names a card the AI drew", async () => {
    /**
     * The offline player has no more right to the AI's draws than an online
     * player has to a human opponent's, and running one redaction path in both
     * builds is what makes that true by construction rather than by the UI
     * choosing not to draw it.
     */
    const transport = makeTransport();
    const batches: EventBatch[] = [];
    transport.onBatch((batch) => {
      batches.push(batch);
    });

    await openMatch(transport);
    for (let i = 0; i < 4; i++) await transport.submit({ type: "endTurn", seat: transport.seat });

    const opponentDraws = batches
      .flatMap((b) => b.events)
      .filter((e) => e.e === "cardDrawn" && e.seat !== transport.seat);

    expect(opponentDraws.length, "the AI never drew, so this proves nothing").toBeGreaterThan(0);
    for (const event of opponentDraws) {
      expect(event.e === "cardDrawn" && event.cardId).toBeNull();
    }
  });

  it("still names the cards this seat drew", async () => {
    const transport = makeTransport();
    const batches: EventBatch[] = [];
    transport.onBatch((batch) => {
      batches.push(batch);
    });

    await openMatch(transport);
    for (let i = 0; i < 4; i++) await transport.submit({ type: "endTurn", seat: transport.seat });

    const myDraws = batches
      .flatMap((b) => b.events)
      .filter((e) => e.e === "cardDrawn" && e.seat === transport.seat);

    expect(myDraws.length).toBeGreaterThan(0);
    for (const event of myDraws) {
      expect(event.e === "cardDrawn" && event.cardId).not.toBeNull();
    }
  });
});

describe("submit", () => {
  it("returns a canonical code, not just a message, when an intent is refused", async () => {
    const transport = makeTransport();
    await openMatch(transport);

    // seat 1 is not this client's seat
    const result = await transport.submit({ type: "endTurn", seat: 1 as Seat });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("notYourTurn");
    expect(result.error.message.length).toBeGreaterThan(0);
  });

  it("reports success with the batch sequence the intent produced", async () => {
    const transport = makeTransport();
    await openMatch(transport);
    const result = await transport.submit({ type: "endTurn", seat: transport.seat });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.seq).toBeGreaterThan(0);
  });
});

describe("legality", () => {
  /**
   * The oracle: ask the engine directly, using the authoritative state, and
   * require the transport's answer to match exactly.
   *
   * This is the assertion that makes moving `legality()` out of the battle
   * screen safe. If the move had changed a single answer, a card would grey out
   * that should not have — invisible in a screenshot, obvious to a player.
   *
   * **It samples a whole developing match, and then checks that it saw
   * variety.** The first version of this compared one opening position and
   * passed happily with `canFixation` hardcoded to `false` — because on turn one
   * it is false anyway, so the lie and the truth agreed. An oracle test that
   * only ever observes one value is not testing a comparison, it is asserting a
   * constant. The coverage block at the end is what makes that failure mode
   * impossible: a hardcoded answer now fails either the comparison or the proof
   * that the field ever moved.
   */
  it("agrees with the engine at every step of a real match, having seen each answer vary", async () => {
    const transport = makeTransport();
    await transport.connect();
    await transport.submit({ type: "mulligan", seat: transport.seat, replaceInstanceIds: [] });

    const seen = {
      samples: 0,
      fixationTrue: 0,
      fixationFalse: 0,
      ultimateTrue: 0,
      withAttackers: 0,
      withPlayables: 0,
      noPlayables: 0,
    };

    const compare = (): void => {
      const state = transport.authoritativeState();
      const view = transport.view();
      const seat = view.seat;
      const legality = transport.legality();

      expect(legality.yourTurn).toBe(isYourTurn(view));
      if (!legality.yourTurn) return;

      seen.samples += 1;

      expect([...legality.playable].sort()).toEqual(
        view.you.hand
          .filter((card) => checkPlayable(state, content, seat, card.instanceId).ok)
          .map((card) => card.instanceId)
          .sort()
      );
      expect([...legality.canAttack].sort()).toEqual(
        attackableBy(state, content, seat)
          .map((c) => c.instanceId)
          .sort()
      );
      expect(legality.canFixation).toBe(canUseFixation(state, content, seat, "fixation"));
      expect(legality.canUltimate).toBe(canUseFixation(state, content, seat, "ultimate"));
      expect(legality.canActivateLocation).toBe(canActivateLocation(state, content, seat));

      if (legality.canFixation) seen.fixationTrue += 1;
      else seen.fixationFalse += 1;
      if (legality.canUltimate) seen.ultimateTrue += 1;
      if (legality.canAttack.size > 0) seen.withAttackers += 1;
      if (legality.playable.size > 0) seen.withPlayables += 1;
      else seen.noPlayables += 1;
    };

    // Drive our own seat with real legal intents so the board actually
    // develops — the AI plays the other seat by itself. Deterministic pick, so
    // a failure here is reproducible rather than a coin flip.
    const rng = seedRng(0x51ee7);
    for (let step = 0; step < 220; step++) {
      if (transport.view().winner !== null) break;
      compare();
      if (!isYourTurn(transport.view())) break;

      const legal = enumerateLegalIntents(transport.authoritativeState(), content, transport.seat);
      if (legal.length === 0) break;
      // bias away from endTurn so turns build a board instead of skipping past one
      const doing = legal.filter((i) => i.type !== "endTurn");
      const pool = doing.length > 0 && nextInt(rng, 100) < 80 ? doing : legal;
      const intent = pool[nextInt(rng, pool.length)]!;
      const result = await transport.submit(intent);
      expect(result.ok).toBe(true);
    }

    // The proof that the comparisons above were comparing something.
    expect(seen.samples).toBeGreaterThan(15);
    expect(seen.withPlayables).toBeGreaterThan(0);
    expect(seen.noPlayables).toBeGreaterThan(0);
    expect(seen.withAttackers).toBeGreaterThan(0);
    expect(seen.fixationTrue).toBeGreaterThan(0);
    expect(seen.fixationFalse).toBeGreaterThan(0);
  });

  it("reports nothing playable when it is not your turn, but still lists confluences", async () => {
    const transport = makeTransport();
    await openMatch(transport);
    await transport.submit({ type: "endTurn", seat: transport.seat });

    if (isYourTurn(transport.view())) return; // the AI passed straight back
    const legality = transport.legality();
    expect(legality.yourTurn).toBe(false);
    expect(legality.playable.size).toBe(0);
    expect(legality.canAttack.size).toBe(0);
    // The confluence bar reads these to show what *would* be available, so an
    // empty list here would blank the bar on the opponent's turn.
    expect(legality.confluences).toEqual(transport.confluences());
  });

  it("EMPTY_LEGALITY permits nothing", () => {
    expect(EMPTY_LEGALITY.playable.size).toBe(0);
    expect(EMPTY_LEGALITY.canAttack.size).toBe(0);
    expect(EMPTY_LEGALITY.yourTurn).toBe(false);
    expect(EMPTY_LEGALITY.canFixation).toBe(false);
    expect(EMPTY_LEGALITY.canUltimate).toBe(false);
    expect(EMPTY_LEGALITY.canActivateLocation).toBe(false);
  });
});

describe("isYourTurn", () => {
  /**
   * `isYourTurn(view)` replaced `LocalMatch.isPlayerTurn()`. The refactor is
   * only safe if the two agree in every phase, so drive a match and compare
   * them at each step rather than at one convenient moment.
   */
  it("agrees with the driver it replaced, at every step of a match", async () => {
    const transport = makeTransport();
    await transport.connect();

    const agrees = (): boolean => {
      const state = transport.authoritativeState();
      const driverAnswer =
        state.activeSeat === transport.seat && state.phase === "main" && state.winner === null;
      return isYourTurn(transport.view()) === driverAnswer;
    };

    expect(agrees()).toBe(true); // mulligan phase
    await transport.submit({ type: "mulligan", seat: transport.seat, replaceInstanceIds: [] });
    expect(agrees()).toBe(true); // main phase, your turn

    for (let i = 0; i < 6; i++) {
      await transport.submit({ type: "endTurn", seat: transport.seat });
      expect(agrees()).toBe(true);
    }
  });
});

describe("record", () => {
  it("is present offline, because the local process is the authority", async () => {
    const transport = makeTransport();
    await openMatch(transport);
    const record = transport.finishRecord();
    expect(record).not.toBeNull();
    // The seed and both decklists are in the record — which is precisely why a
    // networked client cannot build one, and why the return type is nullable.
    expect(record?.config.seed).toBe(24601);
    expect(record?.config.decks).toHaveLength(2);
  });
});

describe("clocks", () => {
  it("reports real remaining time from balance.timer, not a placeholder", async () => {
    const transport = makeTransport();
    const batches: EventBatch[] = [];
    transport.onBatch((batch) => {
      batches.push(batch);
    });
    await openMatch(transport);

    const clocks = batches.at(-1)?.clocks;
    expect(clocks).toBeDefined();
    const turnMs = content.balance.timer.turnSeconds * 1000;
    expect(clocks!.turnMsRemaining).toBeGreaterThan(0);
    expect(clocks!.turnMsRemaining).toBeLessThanOrEqual(turnMs);
    expect(clocks!.activeSeat).toBe(transport.authoritativeState().activeSeat);
  });
});

describe("close", () => {
  it("stops delivering batches and reports why", async () => {
    const transport = makeTransport();
    let batches = 0;
    let closedReason: string | null = null;
    transport.onBatch(() => {
      batches += 1;
    });
    transport.onStatus((status) => {
      if (status.kind === "closed") closedReason = status.reason;
    });

    await openMatch(transport);
    const before = batches;
    transport.close("test");

    expect(closedReason).toBe("test");
    await transport.submit({ type: "endTurn", seat: transport.seat });
    expect(batches).toBe(before);
  });
});
