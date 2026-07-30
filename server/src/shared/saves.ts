/**
 * The save sections, shared rather than restated.
 *
 * Same reasoning as `wire.ts`: the client and the server have to agree on this
 * list exactly, and two copies of a list agree right up until one of them is
 * edited. `src/save/cloudSync.ts` is pure — no DOM, no `import.meta`, no
 * storage layer — so it crosses the boundary the same way the engine does, and
 * `tests/server-portability.test.ts` walks the graph to keep it that way.
 *
 * The list matters on this side for a reason it does not on the client: it is
 * the cap. Five sections at 512 KB is 2.5 MB an account can occupy, and without
 * an allowlist a client could invent section names until the free plan's 5 GB
 * was somebody else's problem.
 */

export { SAVE_SECTIONS, isSaveSection } from "../../../src/save/cloudSync";
export type { SaveSection } from "../../../src/save/cloudSync";
