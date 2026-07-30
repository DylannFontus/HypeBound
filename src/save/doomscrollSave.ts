/**
 * The active Doomscroll run, and the mode's lifetime record.
 *
 * A run spans many battles and many navigations, so it cannot live in a screen.
 * It is stored whole: the map, the deck, the artifacts and the prompt queue are
 * all plain JSON, which means a reload during a shop visit puts you back in that
 * shop rather than back on the map with the purchase silently undone.
 */

import { createStore } from "./storage";
import type { RunState } from "../game/doomscroll/run";

export interface DoomscrollSave {
  /** the run in progress, or null */
  run: RunState | null;
  runsStarted: number;
  runsCleared: number;
  /** most acts cleared in any single run, for the mode-select blurb */
  bestActsCleared: number;
  /** run-Clout converted to account Clout across every run */
  lifetimeClout: number;
}

export const doomscrollStore = createStore<DoomscrollSave>({
  key: "doomscroll",
  version: 1,
  defaults: () => ({ run: null, runsStarted: 0, runsCleared: 0, bestActsCleared: 0, lifetimeClout: 0 }),
});

export const activeRun = (): RunState | null => doomscrollStore.get().run;

export function saveRun(run: RunState): void {
  doomscrollStore.set({ run });
}

export function beginRun(run: RunState): void {
  doomscrollStore.update((draft) => {
    draft.run = run;
    draft.runsStarted += 1;
  });
}

/**
 * Close out a finished run.
 *
 * The run is cleared here rather than when the summary screen is dismissed, so
 * a player who closes the tab on the summary does not come back to a corpse
 * they can neither play nor cash in.
 */
export function finishRun(result: { cleared: boolean; actsCleared: number; accountClout: number }): void {
  doomscrollStore.update((draft) => {
    draft.run = null;
    if (result.cleared) draft.runsCleared += 1;
    draft.bestActsCleared = Math.max(draft.bestActsCleared, result.actsCleared);
    draft.lifetimeClout += result.accountClout;
  });
}
