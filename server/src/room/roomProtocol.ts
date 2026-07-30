/**
 * Frames in, frames out. The half of the server that speaks §7.
 *
 * This was inside the Durable Object, which was the obvious place for it and the
 * wrong one. A conformance suite that drives `WsTransport` against a fake socket
 * needs a server on the other end, and a *test-written* server would prove only
 * that the client agrees with the test — the exact mistake §15's rule 4 is trying
 * to prevent when it asks for "the same script, same assertions" against both
 * transports. So the frame handling lives here, `matchRoom.ts` calls it, and the
 * loopback harness calls the same code the real room runs.
 *
 * Pure, like `Room` and for the same reason: time is an argument, and the result
 * is a list of frames somebody else delivers.
 */

import { PROTOCOL_VERSION, WIRE_LIMITS, parseClientFrame, type ServerEnvelope } from "../shared/wire";
import type { Seat } from "../shared/engine";
import { Room, type Addressed, type RoomFrame } from "./room";

export interface Outgoing {
  readonly seat: Seat;
  readonly frame: ServerEnvelope;
}

/** Net tunables the client is told about in `welcome` (§16). */
export interface NetConfigValues {
  heartbeatSeconds: number;
  resumeGraceSeconds: number;
  seatHoldSeconds: number;
}

export const DEFAULT_NET_CONFIG: NetConfigValues = {
  heartbeatSeconds: 5,
  resumeGraceSeconds: 60,
  seatHoldSeconds: 90,
};

export class RoomProtocol {
  constructor(
    readonly room: Room,
    private readonly net: NetConfigValues = DEFAULT_NET_CONFIG
  ) {}

  /**
   * The frame that answers a socket opening.
   *
   * Always carries a full snapshot, which is also how a resume is answered:
   * §4.6 makes snapshots the truth for state, so a reconnecting client adopts
   * this and is correct, whatever it missed. What it does *not* do is replay the
   * backlog of batches, so the animations of anything that happened while the
   * socket was down are lost. §8.3 specifies that backlog; it is not built, and
   * this comment is the record of that rather than a silent gap.
   */
  welcome(seat: Seat, sessionId: string, resumeToken: string, nowMs: number, role: "player" | "spectator" = "player"): ServerEnvelope {
    return {
      t: "welcome",
      v: PROTOCOL_VERSION,
      ts: nowMs,
      sessionId,
      resumeToken,
      seat,
      role,
      matchId: this.room.matchId,
      netConfig: {
        heartbeatSeconds: this.net.heartbeatSeconds,
        resumeGraceSeconds: this.net.resumeGraceSeconds,
        seatHoldSeconds: this.net.seatHoldSeconds,
        maxFrameBytes: WIRE_LIMITS.maxFrameBytes,
        turnSeconds: Math.round(this.room.timer.turnMs / 1000),
        ropeSeconds: Math.round(this.room.timer.ropeMs / 1000),
      },
      snapshot: this.room.snapshotFor(seat, nowMs),
    };
  }

  /**
   * Handle one raw frame from one seat.
   *
   * Returns `{ out, fatal }` rather than throwing: at a trust boundary a bad
   * frame is the expected input, and `fatal` tells the delivery layer to close
   * the socket after sending — a decision only it can carry out.
   */
  handle(seat: Seat, raw: string, nowMs: number): { out: Outgoing[]; fatal: boolean } {
    const parsed = parseClientFrame(raw);
    if (!parsed.ok) {
      const code = parsed.code === "tooLarge" ? "streamOverflow" : "rateLimited";
      return { out: [{ seat, frame: { t: "fatal", v: PROTOCOL_VERSION, ts: nowMs, code, message: parsed.detail.slice(0, 512) } }], fatal: true };
    }

    const frame = parsed.frame;
    if (frame.v !== PROTOCOL_VERSION) {
      return {
        out: [{ seat, frame: { t: "fatal", v: PROTOCOL_VERSION, ts: nowMs, code: "protocolVersion", message: `server speaks v${PROTOCOL_VERSION}` } }],
        fatal: true,
      };
    }

    switch (frame.t) {
      case "ping":
        return { out: [{ seat, frame: { t: "pong", v: PROTOCOL_VERSION, ts: nowMs, clientTs: frame.ts, serverTs: nowMs } }], fatal: false };

      case "resync":
        return { out: [{ seat, frame: { t: "snapshot", v: PROTOCOL_VERSION, ts: nowMs, ...this.room.snapshotFor(seat, nowMs) } }], fatal: false };

      case "intent":
        return { out: this.envelope(this.room.submit(seat, frame.id, frame.intent, nowMs), nowMs), fatal: false };

      case "leave":
        /**
         * Not a concede — §8.2 makes leaving the menu and closing the tab both
         * start the **grace window**, not end the match. So this does exactly
         * what a dropped socket does, and no more.
         *
         * It used to do nothing at all, on the reasoning that the room should
         * react to the socket going away rather than to the word. The word
         * turned out to be the more reliable of the two: a browser tearing down
         * a page does not always deliver a close the runtime reports promptly,
         * and the opponent was intermittently never told. Acting on both is not
         * redundant — `setConnected` ignores a repeat, so whichever arrives
         * first wins and the second is free.
         */
        return { out: this.envelope(this.room.setConnected(seat, false, nowMs), nowMs), fatal: false };

      case "hello": {
        /**
         * The `welcome` already went out on the upgrade, carrying the snapshot
         * that makes this client correct. What `hello` adds is `lastAckSeq` —
         * the only thing the server cannot know until the client says it — and
         * therefore the only moment the backlog can be assembled.
         *
         * §8.3 has the welcome follow the hello. Keeping the welcome on the
         * upgrade and answering the hello with the backlog gets the same two
         * deliveries in the same order, without a handshake in which a socket
         * is open and told nothing.
         */
        if (!frame.resume) return { out: [], fatal: false };
        return { out: this.envelope(this.room.backlogFor(seat, frame.resume.lastAckSeq), nowMs), fatal: false };
      }

      case "ack":
      case "emote":
        // `ack` feeds backpressure accounting that does not exist yet; `emote`
        // needs the entitlement lookup of C4. Accepted and ignored, so a client
        // implementing the whole protocol is not punished for it.
        return { out: [], fatal: false };
    }
  }

  /** Presence as it stands, for a socket that has just arrived (§8.2). */
  presenceNow(nowMs: number): Outgoing[] {
    return this.envelope(this.room.presenceNow(nowMs), nowMs);
  }

  /** A socket for a seat arrived or went away (§8.2). */
  setConnected(seat: Seat, connected: boolean, nowMs: number): Outgoing[] {
    return this.envelope(this.room.setConnected(seat, connected, nowMs), nowMs);
  }

  /** Advance the clock; returns whatever the expiry caused (usually nothing). */
  tick(nowMs: number): Outgoing[] {
    return this.envelope(this.room.tick(nowMs), nowMs);
  }

  /** End the match on a seat's behalf — the disconnect and leave paths. */
  concede(seat: Seat, nowMs: number): Outgoing[] {
    return this.envelope(this.room.concede(seat, nowMs), nowMs);
  }

  private envelope(addressed: Addressed[], nowMs: number): Outgoing[] {
    return addressed.map(({ seat, frame }) => ({ seat, frame: envelopeFor(frame, nowMs) }));
  }
}

/** Put the envelope round a room frame. The room has no clock, so `ts` comes from here. */
export function envelopeFor(frame: RoomFrame, nowMs: number): ServerEnvelope {
  if (frame.t === "snapshot") {
    return { t: "snapshot", v: PROTOCOL_VERSION, ts: nowMs, ...frame.snapshot };
  }
  return { ...frame, v: PROTOCOL_VERSION, ts: nowMs } as ServerEnvelope;
}
