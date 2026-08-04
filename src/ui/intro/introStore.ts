/**
 * The one fact the opening sequence has to remember: has the long one played?
 *
 * The natural signal is already in the save — a profile with no `starterFaction`
 * has never been played, which is exactly what `needsStarterChoice()` reports
 * and exactly the condition the app already uses to route a new account to the
 * picker. That is the *right* signal and it is not sufficient on its own, for
 * one narrow reason: a player who watches the title, lands on the starter picker
 * and then reloads before choosing a faction still has no `starterFaction`, and
 * would get the whole five seconds again. Do that twice and the sequence has
 * gone from a title to an obstacle.
 *
 * So this records the fact separately, and it records it the moment the sequence
 * *starts* rather than when it finishes. "Never show the first-run sequence
 * twice" is a hard requirement and the failure modes are asymmetric: showing a
 * player who has already seen it a five-second title they cannot avoid is much
 * worse than a player who reloaded during the first two seconds getting the
 * short sting from then on. The short sting is a perfectly good thing to get.
 *
 * It is its own store rather than a field on the profile because the profile is
 * synced to the cloud and this is a property of *this browser having seen a
 * video*, not of the account. Signing in on a new machine should still play the
 * title; the account's progress has nothing to do with it.
 */

import { createStore } from "../../save/storage";

interface IntroSave {
  /** Set the moment the first-run cinematic begins, not when it ends. */
  titlePlayed: boolean;
}

const store = createStore<IntroSave>({
  key: "intro",
  version: 1,
  defaults: () => ({ titlePlayed: false }),
});

export function titleAlreadyPlayed(): boolean {
  return store.get().titlePlayed;
}

/**
 * Remember it, and write it through immediately rather than on the store's
 * 250ms debounce. The whole point of this flag is to survive a reload that may
 * happen in the next second.
 */
export function markTitlePlayed(): void {
  if (store.get().titlePlayed) return;
  store.set({ titlePlayed: true });
  store.flush();
}

/** Test and tooling seam: put the browser back to never-having-played. */
export function forgetTitle(): void {
  store.reset();
  store.flush();
}
