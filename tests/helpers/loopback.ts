/**
 * A whole match server, in-process, on the other end of a fake socket.
 *
 * The point is what it is *not*: it is not a test-written implementation of §7.
 * It holds a real `Room` and calls the real `RoomProtocol` — the same class the
 * Durable Object calls — so a `WsTransport` driven against it is talking to the
 * server's actual frame handling. A hand-rolled fake would let the client and
 * the test agree with each other while both disagreed with the room, which is
 * the exact failure §15's rule 4 asks for a conformance suite to prevent.
 *
 * What it fakes is only the transport underneath: no network, no workerd, no
 * sockets. Delivery is a microtask, so ordering is realistic (a frame never
 * arrives synchronously inside `send`) without anything being timing-dependent.
 *
 * Time is a counter this harness owns, which is what makes the turn clock and
 * the rope testable at all — `Room` and `RoomProtocol` both take `nowMs` as an
 * argument precisely so a test can decide it.
 */

import { Room, type RoomOptions } from "../../server/src/room/room";
import { RoomProtocol } from "../../server/src/room/roomProtocol";
import type { Socket, SocketFactory, SocketHandlers } from "../../src/net/wsTransport";
import type { ContentIndex, Seat } from "../../src/engine/types";

interface Connection {
  seat: Seat;
  handlers: SocketHandlers;
  open: boolean;
}

export interface LoopbackOptions {
  content: ContentIndex;
  room: RoomOptions;
  startAtMs?: number;
  /** Frames the harness dropped on the floor, for a test that wants to lose one. */
  dropOutgoing?: (seat: Seat, frame: { t: string; seq?: number }) => boolean;
}

export class Loopback {
  readonly protocol: RoomProtocol;
  private readonly connections = new Set<Connection>();
  private clock: number;
  private readonly dropOutgoing: (seat: Seat, frame: { t: string; seq?: number }) => boolean;
  /** Every frame the server sent, for assertions about what the wire carried. */
  readonly sent: { seat: Seat; frame: { t: string; [key: string]: unknown } }[] = [];
  /** Every frame a client sent, same reason. */
  readonly received: { seat: Seat; frame: { t: string; [key: string]: unknown } }[] = [];

  constructor(options: LoopbackOptions) {
    this.clock = options.startAtMs ?? 1_700_000_000_000;
    this.protocol = new RoomProtocol(new Room(options.content, options.room, this.clock));
    this.dropOutgoing = options.dropOutgoing ?? (() => false);
  }

  get room(): Room {
    return this.protocol.room;
  }

  now(): number {
    return this.clock;
  }

  /** Move the clock. Does not itself fire the turn timer — call `tick()` for that. */
  advance(ms: number): void {
    this.clock += ms;
  }

  /** What the Durable Object's alarm does. */
  tick(): void {
    for (const { seat, frame } of this.protocol.tick(this.clock)) this.deliver(seat, frame);
  }

  /**
   * A `SocketFactory` for one seat.
   *
   * Mirrors the Durable Object: `welcome` goes out when the socket opens, not in
   * reply to `hello`. That ordering matters — a client that waited for a reply
   * to `hello` would hang against the real server.
   */
  socketFor(seat: Seat): SocketFactory {
    return (_url, handlers) => {
      const connection: Connection = { seat, handlers, open: true };
      this.connections.add(connection);

      const socket: Socket = {
        send: (text) => {
          if (!connection.open) return;
          queueMicrotask(() => this.handleClientFrame(connection, text));
        },
        close: () => {
          if (!connection.open) return;
          connection.open = false;
          this.connections.delete(connection);
          queueMicrotask(() => handlers.onClose(1000, "client closed"));
        },
      };

      queueMicrotask(() => {
        if (!connection.open) return;
        handlers.onOpen();
        this.deliver(
          seat,
          this.protocol.welcome(seat, `session-${seat}-${this.connections.size}`, resumeToken(seat, this.clock), this.clock)
        );
      });

      return socket;
    };
  }

  /** Kill a socket the way a network does: no close frame, no warning. */
  drop(seat: Seat, code = 1006, reason = "connection lost"): void {
    for (const connection of [...this.connections]) {
      if (connection.seat !== seat) continue;
      connection.open = false;
      this.connections.delete(connection);
      queueMicrotask(() => connection.handlers.onClose(code, reason));
    }
  }

  /** True while at least one socket for that seat is up. */
  connected(seat: Seat): boolean {
    return [...this.connections].some((c) => c.seat === seat && c.open);
  }

  private handleClientFrame(connection: Connection, text: string): void {
    if (!connection.open) return;
    try {
      this.received.push({ seat: connection.seat, frame: JSON.parse(text) as { t: string } });
    } catch {
      this.received.push({ seat: connection.seat, frame: { t: "unparseable" } });
    }

    const { out, fatal } = this.protocol.handle(connection.seat, text, this.clock);
    for (const { seat, frame } of out) this.deliver(seat, frame);
    if (fatal) {
      connection.open = false;
      this.connections.delete(connection);
      queueMicrotask(() => connection.handlers.onClose(1008, "protocol"));
    }
  }

  private deliver(seat: Seat, frame: { t: string; [key: string]: unknown }): void {
    if (this.dropOutgoing(seat, frame as { t: string; seq?: number })) return;
    this.sent.push({ seat, frame });
    const text = JSON.stringify(frame);
    for (const connection of this.connections) {
      if (connection.seat !== seat || !connection.open) continue;
      queueMicrotask(() => {
        if (connection.open) connection.handlers.onMessage(text);
      });
    }
  }
}

/** 43 base64url characters, which is what §7.5 and the schema require. */
function resumeToken(seat: Seat, nowMs: number): string {
  const seed = `${seat}-${nowMs}-hypebound-loopback-resume-token-padding`;
  return seed.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 43).padEnd(43, "x");
}

/**
 * Let everything queued actually run — microtasks *and* timers.
 *
 * Delivery is a chain of `queueMicrotask` hops (client send, server handle,
 * server deliver, client receive) and `WsTransport` adds more by serializing
 * inbound frames on a promise chain. One `await` is nowhere near enough, and a
 * test that guessed the number of hops would break the first time either side
 * added one.
 *
 * The `setTimeout` is not decoration and cost an hour: reconnection is scheduled
 * on a timer, which is a **macrotask**. A loop of `await Promise.resolve()` runs
 * the microtask queue to exhaustion without ever yielding to it, so the client
 * never reconnected and three tests failed with symptoms — a stale view, a
 * changed hash — that pointed at the transport rather than at the harness.
 */
export async function settle(rounds = 12): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
