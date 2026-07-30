/**
 * The wire surface, re-exported for the same reason as `engine.ts`.
 *
 * `src/net/` is shared by both ends on purpose (§7: "shared verbatim by client
 * and server and validated on both ends"), but only *part* of it is —
 * `localTransport.ts` imports the client's match driver and the AI, and a room
 * that pulled those in would be importing an opponent into the referee.
 *
 * So the shared part is listed and the rest is not, and
 * `tests/server-portability.test.ts` walks the graph to prove the line held.
 */

export {
  PROTOCOL_VERSION,
  WIRE_LIMITS,
  parseClientFrame,
  parseLobbyFrame,
  zServerEnvelope,
} from "../../../src/net/protocol";

export type {
  ClientEnvelope,
  ServerEnvelope,
  LobbyClientEnvelope,
  LobbyServerEnvelope,
} from "../../../src/net/protocol";

export { sanitizeView, viewHash } from "../../../src/net/view";

export type { EventBatch, EventCause, MatchClocks, MatchSnapshot } from "../../../src/net/transport";
