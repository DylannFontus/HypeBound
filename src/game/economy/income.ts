/**
 * What playing pays, and the ceiling on how much of it a day can hold.
 *
 * Both numbers used to be literals inside `recordMatch` — the last corner of the
 * economy the architecture contract's data-driven mandate did not reach, and an
 * awkward one, because every other figure in `economy.*` is calibrated against
 * them.
 */

import { getContent } from "../../engine/content";

const income = (): ReturnType<typeof getContent>["balance"]["economy"]["missions"] =>
  getContent().balance.economy.missions;

/** What finishing a match pays. Participation, not victory — losing still pays. */
export const matchClout = (won: boolean): number => {
  const { match } = income();
  return won ? match.winClout : match.lossClout;
};

/**
 * 09 §3's daily ceiling on Clout from AI play, **derived rather than copied**.
 *
 * §3 writes it as "capped at 200 Clout/day from AI play" against its own
 * schedule of "20 Clout per win vs Beginner/Casual, 30 vs Intermediate+" — so
 * the cap is worth eight wins at the top of that schedule, and eight wins is
 * the rule the sentence is actually expressing.
 *
 * This build pays more per match than §3 assumes (it pays for losing too, so
 * that experimenting with a new deck is never punished). Copying the 200 across
 * would therefore have shipped the same *number* and a different *rule*: the cap
 * would have bitten after three matches instead of eight. `aiDailyCapWins` holds
 * the eight, and this multiplies it by what a win is actually worth — the same
 * reason the Hype Wave's pacing is re-derived from shipped XP rather than
 * carrying the design's published tier count as a constant.
 *
 * One consequence worth stating: because this is a multiple of the win rate,
 * raising what a match pays raises the ceiling with it. That is deliberate. A
 * cap denominated in Clout would silently become a *tighter* cap every time
 * somebody made the game more generous.
 */
export const aiDailyCap = (): number => {
  const { aiDailyCapWins, match } = income();
  return aiDailyCapWins * match.winClout;
};
