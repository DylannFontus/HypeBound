/**
 * One script, both transports — §15's sequencing rule 4.
 *
 * *"New tests per phase: transport conformance suite run against **both**
 * implementations (same script, same assertions)."* This is that file, and it
 * could not be written until phase 4 because until now there was only one
 * implementation to run it against.
 *
 * The whole premise of `src/net/` is that everything above it — the driver, the
 * HUD, the presenter, the 3D board — is written once against `MatchTransport`
 * and never learns which implementation it got. That claim is only worth
 * anything if the two behave the same, and "the same" has to mean a shared list
 * of assertions rather than two test files that happen to agree.
 *
 * ## What is deliberately not in here
 *
 * The two transports front genuinely different situations, and pretending
 * otherwise would weaken the suite rather than strengthen it:
 *
 * - **`finishRecord()`** is a `MatchRecord` offline and `null` online, because a
 *   client holds neither the seed nor either decklist and cannot assemble one.
 *   Asserted as a documented difference, below, rather than skipped.
 * - **`hotseat`** exists only offline. Two people cannot share one socket.
 * - **Who moves next.** `LocalTransport` runs an opponent in-process; the
 *   offline case uses the "idle" Practice Bot so the script is not racing an AI
 *   that plays at its own pace.
 *
 * Everything else below is a property of the *interface*, and both must have it.
 */

import { describe, expect, it } from "vitest";
import { getContent } from "../src/engine/content";
import { autoBuildDeck } from "../src/engine/deck";
import { getAiProfile } from "../src/ai/profiles";
import { LocalTransport } from "../src/net/localTransport";
import { WsTransport } from "../src/net/wsTransport";
import { legalityFromView } from "../src/net/viewToState";
import { viewHash } from "../src/net/view";
import { Loopback, settle } from "./helpers/loopback";
import type { MatchTransport } from "../src/net/transport";
import type { PlayerIntent } from "../src/engine/types";

const content = getContent();
const SEED = 4242;

const decks = () => [
  autoBuildDeck(content, "goth-leader-morvina-vane", "P1"),
  autoBuildDeck(content, "after-leader-dj-last-call", "P2"),
];

interface Subject {
  transport: MatchTransport;
  /** Lets the online case pump its microtask queue; a no-op offline. */
  settle: () => Promise<void>;
  /** True where a replay record can exist at all. */
  ownsRecord: boolean;
}

type Factory = () => Promise<Subject>;

const IMPLEMENTATIONS: { name: string; make: Factory }[] = [
  {
    name: "LocalTransport",
    make: async () => {
      const [playerDeck, aiDeck] = decks();
      const transport = new LocalTransport({
        content,
        playerDeck: playerDeck!,
        aiDeck: aiDeck!,
        aiProfile: getAiProfile("casual"),
        seed: SEED,
        firstSeat: 0,
        // The Practice Bot, so the script is not racing a real AI's turn.
        opponent: "idle",
      });
      await transport.connect();
      return { transport, settle: async () => {}, ownsRecord: true };
    },
  },
  {
    name: "WsTransport",
    make: async () => {
      const [one, two] = decks();
      const loop = new Loopback({
        content,
        room: {
          matchId: "conformance",
          build: "test",
          contentHash: "abcdef01",
          match: { seed: SEED, decks: [one!, two!], firstSeat: 0 },
        },
      });
      const transport = new WsTransport({
        url: "wss://example.invalid/match/conformance/socket?access_token=t0",
        content,
        connect: loop.socketFor(0),
        now: () => loop.now(),
        heartbeatMs: 0,
      });
      await transport.connect();
      return { transport, settle: () => settle(), ownsRecord: false };
    },
  },
];

const mulligan = (seat: 0 | 1): PlayerIntent => ({ type: "mulligan", seat, replaceInstanceIds: [] });

describe.each(IMPLEMENTATIONS)("$name satisfies the transport contract", ({ make }) => {
  it("connects to a view of its own seat", async () => {
    const { transport } = await make();
    const view = transport.view();
    expect(view.seat).toBe(transport.seat);
    expect(view.winner).toBeNull();
    expect(transport.content).toBe(content);
  });

  it("never shows the seat its own deck order", async () => {
    /**
     * §5.2, and the reason it is enforced offline as well: a seat that can read
     * its own deck knows its next draw. Offline that is only a modding
     * opportunity; online it is the game.
     */
    const { transport } = await make();
    const view = transport.view();
    expect(view.you.deck.length).toBeGreaterThan(10);
    expect(view.you.deck.every((card) => card.cardId === "hidden")).toBe(true);
    expect(view.you.hand.every((card) => card.cardId !== "hidden")).toBe(true);
    expect(view.opponent.handCount).toBeGreaterThan(0);
  });

  it("hands out a copy, so a caller cannot corrupt the transport", async () => {
    // Offline this was a real defect: `redact()` returns `you` as a live
    // reference into the match state, so writing to the "view" wrote to the
    // game. Online it is impossible by construction — the view arrives as
    // deserialized JSON — which made the offline build the less safe of the two.
    const { transport } = await make();
    const first = transport.view();
    first.you.leaderHealth = -999;
    first.you.hand.length = 0;
    expect(transport.view().you.leaderHealth).toBeGreaterThan(0);
    expect(transport.view().you.hand.length).toBeGreaterThan(0);
  });

  it("agrees with the view about what is legal", async () => {
    const { transport } = await make();
    const fromView = legalityFromView(transport.view(), content);
    const reported = transport.legality();

    expect([...reported.playable].sort()).toEqual([...fromView.playable].sort());
    expect([...reported.canAttack].sort()).toEqual([...fromView.canAttack].sort());
    expect(reported.yourTurn).toBe(fromView.yourTurn);
    expect(reported.canFixation).toBe(fromView.canFixation);
    expect(reported.canUltimate).toBe(fromView.canUltimate);
    expect(reported.canActivateLocation).toBe(fromView.canActivateLocation);
    expect(JSON.stringify(reported.confluences)).toBe(JSON.stringify(transport.confluences()));
  });

  it("answers a legal intent with a sequence number and a batch that matches the view", async () => {
    const { transport, settle: pump } = await make();
    const seen: { seq: number; viewHash: string }[] = [];
    transport.onBatch((batch) => void seen.push({ seq: batch.seq, viewHash: batch.viewHash }));

    expect(transport.isBusy()).toBe(false);
    const result = await transport.submit(mulligan(transport.seat));
    await pump();

    expect(result.ok, result.ok ? "" : `${result.error.code}: ${result.error.message}`).toBe(true);
    expect(result.ok === true && result.seq).toBeGreaterThanOrEqual(1);
    expect(transport.isBusy()).toBe(false);

    expect(seen.length, "no batch was delivered for an accepted intent").toBeGreaterThan(0);
    // §4.6: the hash the batch carries is the hash of the view the client now holds.
    expect(seen.at(-1)!.viewHash).toBe(viewHash(transport.view()));
  });

  it("refuses an illegal intent with a canonical code, and changes nothing", async () => {
    const { transport, settle: pump } = await make();
    const before = viewHash(transport.view());

    const result = await transport.submit({ type: "endTurn", seat: transport.seat });
    await pump();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The code comes from the engine's `RulesError`, on both paths. A transport
    // that invented its own would be a second rulebook.
    expect(result.error.code).toBe("wrongPhase");
    expect(result.error.message.length).toBeGreaterThan(0);
    expect(viewHash(transport.view())).toBe(before);
  });

  it("stops delivering to a listener that unsubscribed", async () => {
    const { transport, settle: pump } = await make();
    let count = 0;
    const off = transport.onBatch(() => void count++);
    off();

    await transport.submit(mulligan(transport.seat));
    await pump();
    expect(count).toBe(0);
  });

  it("reports a status, and reports being closed", async () => {
    const { transport } = await make();
    const statuses: string[] = [];
    transport.onStatus((status) => void statuses.push(status.kind));

    // Attaching late must still yield the current status, or a HUD that
    // subscribes after connect() sits on "connecting" for ever.
    expect(statuses.length, "a late subscriber was told nothing").toBeGreaterThan(0);

    transport.close("test over");
    expect(statuses.at(-1)).toBe("closed");
  });
});

describe("the two differ only where they must", () => {
  it("owns a replay record offline and cannot online", async () => {
    /**
     * Not a gap — an impossibility, and typed as one since phase 1 so callers
     * confront it at compile time. `MatchRecord` is `{ seed, decks, intents }`
     * and a `PlayerView` carries none of the three, because any of them would
     * tell the client what it is about to draw.
     */
    for (const { name, make } of IMPLEMENTATIONS) {
      const { transport, ownsRecord } = await make();
      const record = transport.finishRecord();
      if (ownsRecord) expect(record, `${name} should own a record`).not.toBeNull();
      else expect(record, `${name} cannot own a record`).toBeNull();
    }
  });

  it("offers hotseat controls only where two people share a device", async () => {
    /**
     * `hotseat` is a question about the *match*, not about the class. A
     * `LocalTransport` playing the Practice Bot has no more use for it than a
     * `WsTransport` does — which is why the interface makes it optional rather
     * than making `LocalTransport` the hotseat type. Only `opponent: "human"`
     * produces controls.
     */
    const [playerDeck, aiDeck] = decks();
    const shared = {
      content,
      playerDeck: playerDeck!,
      aiDeck: aiDeck!,
      aiProfile: getAiProfile("casual"),
      seed: SEED,
      firstSeat: 0 as const,
    };

    const hotseat = new LocalTransport({ ...shared, opponent: "human" });
    await hotseat.connect();
    expect(typeof hotseat.hotseat).toBe("object");
    expect(hotseat.hotseat!.setViewingSeat(1)).toBe(true);

    const versusBot = new LocalTransport({ ...shared, opponent: "idle" });
    await versusBot.connect();
    expect(versusBot.hotseat, "a bot match is not a hotseat").toBeUndefined();

    const [, ws] = IMPLEMENTATIONS;
    expect((await ws!.make()).transport.hotseat, "a socket cannot be a hotseat").toBeUndefined();
  });
});
