/**
 * The engine surface the server depends on — one module, deliberately.
 *
 * Multiplayer §15, sequencing rule 1: *"`src/engine` is never forked. Client and
 * server import the same files, built from the same commit."* This module is
 * where that rule is enforceable rather than merely stated. Every reach back
 * into the shared tree happens here, so:
 *
 * - the dependency is a **list you can read**, not a property of forty scattered
 *   import lines;
 * - `tests/server-portability.test.ts` has one entry point to walk from when it
 *   proves nothing the server touches uses a Vite feature or a browser global;
 * - adding to the surface is a visible edit to a small file, which is the point
 *   at which someone should be asked whether the server really needs it.
 *
 * **[DECISION — deviates from §15]** The design says the engine stays shared
 * "via a path alias". These are relative paths instead. A path alias has to be
 * taught to three tools that resolve modules differently (tsc, wrangler's
 * esbuild, vitest), and the failure when one of them disagrees is a bundle that
 * builds and then cannot find the engine at runtime. Confining the ugliness to
 * one file costs nothing and cannot misresolve.
 */

export {
  createMatch,
  redact,
  redactEvents,
  cloneState,
  otherSeat,
  SCHEMA_VERSION,
} from "../../../src/engine/state";

export { applyIntent } from "../../../src/engine/reducer";

export { startRecord, recordIntent, replay, stateHash } from "../../../src/engine/replay";

export { getContent, contentHash, resolveMatchContent, ContentError } from "../../../src/engine/content";

export { validateDeck, isDeckLegal, autoBuildDeck } from "../../../src/engine/deck";

export { RulesError, enumerateLegalIntents } from "../../../src/engine/intents";

export type {
  CardDef,
  ContentIndex,
  DeckList,
  EngineEvent,
  MatchConfig,
  MatchRecord,
  MatchState,
  PlayerIntent,
  PlayerView,
  RulesErrorShape,
  Seat,
} from "../../../src/engine/types";
