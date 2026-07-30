/**
 * The active Gauntlet run, the mode's lifetime record, and the one place its
 * money is paid.
 *
 * A run spans a draft and up to fifteen matches, so it cannot live in a screen.
 * It is stored whole — the drafted deck, the record, the fight in progress — so
 * a reload during a draft puts you back on the same pick rather than back at the
 * start with twenty-nine choices undone.
 *
 * The payout lives here rather than in `profile.ts` because a Gauntlet run pays
 * five different things at once (Clout against a daily cap, Signal, card-back
 * progress, cosmetics, and a row that may pay none of them) and splitting that
 * across two files would mean two places to check when somebody asks what a run
 * is worth.
 */

import { createStore } from "./storage";
import type { ContentIndex } from "../engine/types";
import { gauntletData } from "../game/gauntlet/data";
import { aiDailyCap } from "../game/economy/income";
import { practiceReward, type GauntletRun } from "../game/gauntlet";
import { cosmeticById } from "../game/cosmetics";
import { aiCloutRemaining, profileStore, spendAiClout } from "./profile";

export interface GauntletSave {
  /** the run in progress, or null */
  run: GauntletRun | null;
  runsStarted: number;
  runsFinished: number;
  /** most wins in any single run, for the mode-select blurb */
  bestWins: number;
  /** lifetime Clout this mode has paid into the account */
  lifetimeClout: number;
  /**
   * Progress toward the Gauntlet card back (§8.3's rows 10 and 11).
   *
   * Kept even after the back is owned. It is the record of how it was earned,
   * and zeroing it on the grant would make a re-earned token look like progress
   * toward something the account already has.
   */
  cardBackProgress: number;
}

export const gauntletStore = createStore<GauntletSave>({
  key: "gauntlet",
  version: 1,
  defaults: () => ({
    run: null,
    runsStarted: 0,
    runsFinished: 0,
    bestWins: 0,
    lifetimeClout: 0,
    cardBackProgress: 0,
  }),
});

export const activeGauntlet = (): GauntletRun | null => gauntletStore.get().run;

export function saveGauntlet(run: GauntletRun): void {
  gauntletStore.set({ run });
}

export function beginGauntlet(run: GauntletRun): void {
  gauntletStore.update((draft) => {
    draft.run = run;
    draft.runsStarted += 1;
  });
}

/** What a finished run paid, itemised — this is what the summary screen prints. */
export interface GauntletPayout {
  wins: number;
  clout: number;
  /** Clout the day's AI cap withheld; shown rather than silently subtracted */
  cloutCapped: number;
  signal: number;
  cardBackProgress: number;
  /** cosmetics granted now, newly owned ones only */
  cosmetics: string[];
  /** true when the card back was earned by reaching the progress threshold */
  cardBackEarned: boolean;
}

/**
 * What a run *would* pay, without paying it.
 *
 * The summary shows this before the player presses Collect, and `claimGauntlet`
 * pays the same numbers — so the screen cannot promise one figure and bank
 * another. The cap is read here too, which is why a run that will be capped says
 * so before you collect rather than after.
 */
export function previewGauntlet(content: ContentIndex, run: GauntletRun): GauntletPayout {
  const reward = practiceReward(run.wins);
  const cap = aiDailyCap();
  const state = gauntletStore.get();
  const profile = profileStore.get();

  const clout = Math.min(reward.clout, aiCloutRemaining(cap));

  const progress = state.cardBackProgress + reward.cardBackProgress;
  const { cosmeticId, progressRequired } = gauntletData().cardBack;
  const earned = progress >= progressRequired && !profile.cosmetics.owned.includes(cosmeticId);

  const cosmetics = [...reward.cosmetics, ...(earned ? [cosmeticId] : [])].filter(
    (id, index, all) => all.indexOf(id) === index && !profile.cosmetics.owned.includes(id) && cosmeticById(content, id)
  );

  return {
    wins: run.wins,
    clout,
    cloutCapped: reward.clout - clout,
    signal: reward.signal,
    cardBackProgress: reward.cardBackProgress,
    cosmetics,
    cardBackEarned: earned,
  };
}

/**
 * Pay out a finished run and clear it.
 *
 * The run is cleared here rather than when the summary is dismissed, so a player
 * who closes the tab on the summary does not come back to a corpse they can
 * neither play nor cash in — the same rule the Doomscroll settled on, for the
 * same reason.
 *
 * Paying happens inside one `profileStore.update`, so a crash cannot leave an
 * account with the Clout and not the cosmetic.
 */
export function claimGauntlet(content: ContentIndex, run: GauntletRun): GauntletPayout {
  const payout = previewGauntlet(content, run);
  const cap = aiDailyCap();

  // the ledger is the authority on how much was actually available
  const clout = spendAiClout(payout.clout, cap);
  const reward = practiceReward(run.wins);

  profileStore.update((draft) => {
    draft.clout += clout;
    draft.shards += payout.signal;
    for (const id of payout.cosmetics) {
      if (!draft.cosmetics.owned.includes(id)) draft.cosmetics.owned.push(id);
    }
  });

  gauntletStore.update((draft) => {
    draft.run = null;
    draft.runsFinished += 1;
    draft.bestWins = Math.max(draft.bestWins, run.wins);
    draft.lifetimeClout += clout;
    draft.cardBackProgress += reward.cardBackProgress;
  });

  return { ...payout, clout, cloutCapped: reward.clout - clout };
}

/** Abandon a run without collecting. Used by the summary's "discard" path only. */
export function clearGauntlet(): void {
  gauntletStore.set({ run: null });
}
