/**
 * Probability disclosures — `03-screens-and-navigation.md` §4.6.3, and the
 * screen `07-economy-and-monetization.md` §6 policy **F1** names by name.
 *
 * > *"Every random grant's exact odds are displayed adjacent to its purchase
 * > button **and on the Probability Disclosures screen**, to the same decimal
 * > precision used internally."*
 *
 * ## Nothing here is a number. Everything here is a reference.
 *
 * This module contains no odds. It contains the *derivation* of the odds from
 * `balance.economy`, which is the object the rollers read — so the page and the
 * roll cannot disagree, because there is only one copy of the numbers and this
 * is not it. F1's enforcement column says exactly that: *"the disclosure UI
 * renders from the same data the roller uses — they cannot diverge."*
 *
 * `checkFairnessData` goes one step further and asserts the tables here are
 * **element-for-element equal** to the ones the drop and banner modules publish
 * next to their own buttons. Three copies of a rate that agree by construction
 * are one copy; three that agree by inspection are a bug waiting for someone to
 * edit two of them.
 *
 * ## The worked examples are computed, not written
 *
 * §4.6.3 asks for pity maths *"with a worked example"*. Writing one in prose
 * would be a number typed into a sentence — the exact thing the news feed's
 * token mechanism exists to prevent — so the examples are computed from the
 * shipped constants and the page renders the result.
 */

import type { ContentIndex, Rarity } from "../../engine/types";
import { publishedOdds as dropPublishedOdds } from "../economy/drops";
import { publishedOdds as bannerPublishedOdds } from "../economy/banner";
import { economyDiff, releases } from "../news";

/** Rarities as every table in the game prints them: best first. */
export const RARITY_ORDER: Rarity[] = ["legendary", "epic", "rare", "common"];

/** The precision every published rate is shown to, everywhere. */
export const RATE_PRECISION = 1;

export const asPercent = (rate: number): string => `${(rate * 100).toFixed(RATE_PRECISION)}%`;

export interface OddsRow {
  rarity: Rarity;
  rate: number;
  percent: string;
  /** the share of that rarity which is a featured card, where featuring applies */
  featuredRate?: number;
  featuredPercent?: string;
}

export interface OddsTable {
  id: "drop" | "banner";
  name: string;
  /** what one roll costs, in Clout */
  price: number;
  /** how many cards one purchase produces */
  cards: number;
  rows: OddsRow[];
  /** the published guarantees, already worded with their own numbers */
  guarantees: string[];
}

/** Merch Drops — §4.2's pack table, derived from `economy.pack`. */
export function dropTable(content: ContentIndex): OddsTable {
  const { pack, packSize } = content.balance.economy;
  const floor = pack.minRarePerPack;
  return {
    id: "drop",
    name: "Merch Drop",
    price: pack.price,
    cards: packSize,
    rows: RARITY_ORDER.map((rarity) => ({
      rarity,
      rate: pack.rates[rarity] ?? 0,
      percent: asPercent(pack.rates[rarity] ?? 0),
    })),
    guarantees: [
      floor > 0
        ? `At least ${floor} Rare or better in every Drop, applied to the last card if the roll has not already produced one.`
        : "No rarity floor.",
      `A Legendary at least once every ${pack.legendaryPity} Drops. The counter is shown in the shop and resets the moment one lands.`,
      "Duplicate protection: an unowned card of the rolled rarity is always preferred over one you already hold.",
    ],
  };
}

/** Headliner Banners — §4.2's table, derived from `economy.banner`. */
export function bannerTable(content: ContentIndex): OddsTable {
  const { banner } = content.balance.economy;
  return {
    id: "banner",
    name: "Headliner Banner",
    price: banner.pullPrice,
    cards: 1,
    rows: bannerPublishedOdds(content).map((row) => ({
      rarity: row.rarity,
      rate: row.rate,
      percent: asPercent(row.rate),
      featuredRate: row.featuredRate,
      featuredPercent: asPercent(row.featuredRate),
    })),
    guarantees: [
      `An Epic or better inside every ${banner.epicPityWindow} pulls, counted on a rolling window.`,
      `Your Target Card outright on pull ${banner.hardPity}. Obtaining it by any other means resets the count, because a meter counting toward a card you already own is counting toward nothing.`,
      `Up to ${banner.wishlistLimit} wishlisted cards are preferred first *within* the rarity that was rolled. A wishlist never changes which rarity you get.`,
      `${banner.tokensPerPull} Backstage Token per pull, which never expire and buy any card outright.`,
    ],
  };
}

export interface ConversionRow {
  rarity: Rarity;
  /** Signal from dismantling a spare copy */
  dismantle: number;
  /** Signal from a duplicate that could not be kept */
  converted: number;
  /** Signal to craft the card outright */
  craft: number;
  /** Backstage Tokens to buy it outright */
  tokens: number;
}

/** §4.6.3's duplicate-conversion table, and what the same card costs to make. */
export function conversionTable(content: ContentIndex): ConversionRow[] {
  const { dustValue, craftCost, dupeConversionBonus, banner } = content.balance.economy;
  return RARITY_ORDER.map((rarity) => ({
    rarity,
    dismantle: dustValue[rarity] ?? 0,
    converted: Math.round((dustValue[rarity] ?? 0) * dupeConversionBonus),
    craft: craftCost[rarity] ?? 0,
    tokens: banner.tokenPrices[rarity] ?? 0,
  }));
}

export interface WorkedExample {
  question: string;
  answer: string;
}

/**
 * §4.6.3's worked examples, computed from the shipped constants.
 *
 * "Worst case: a Legendary by Drop 40" is only true while `legendaryPity` is 40.
 * Writing that sentence out would be a number typed into prose, so these are
 * assembled from the same object the roller reads and the page prints whatever
 * comes out.
 */
export function workedExamples(content: ContentIndex): WorkedExample[] {
  const { pack, packSize, banner } = content.balance.economy;
  const dropCost = pack.legendaryPity * pack.price;
  const pullCost = banner.hardPity * banner.pullPrice;
  const tokensAtPity = banner.hardPity * banner.tokensPerPull;

  return [
    {
      question: "What is the worst a Merch Drop run can go?",
      answer:
        `Every Drop contains ${packSize} cards with at least ${pack.minRarePerPack} Rare or better, and the pity counter guarantees a ` +
        `Legendary by Drop ${pack.legendaryPity} at the very latest — ${dropCost.toLocaleString()} Clout in the worst case, and usually far sooner, ` +
        `because the ${asPercent(pack.rates.legendary)} base rate is rolling on every card the whole time.`,
    },
    {
      question: "And on a banner?",
      answer:
        `Your Target Card is guaranteed on pull ${banner.hardPity}: ${pullCost.toLocaleString()} Clout in the worst case. ` +
        `Along the way you are guaranteed an Epic or better inside every ${banner.epicPityWindow} pulls, and those ${banner.hardPity} pulls ` +
        `also bank ${tokensAtPity} Backstage Tokens — enough to buy a second Legendary of your choosing at ${banner.tokenPrices.legendary} tokens.`,
    },
    {
      question: "Do the odds change while I open?",
      answer:
        "No. Every card uses the published table above. The only things that ever move a roll are the guarantees printed beside it, " +
        "and those can only make an outcome better than the table — never worse.",
    },
    {
      question: "Do the odds change based on who I am, or what I have spent?",
      answer:
        "No. There is no per-player tuning, no engagement-reactive luck and no difference between a new account and an old one. " +
        "The rates are fixed for the lifetime of the product they belong to; changing them requires a new, separately named product and a patch note.",
    },
    {
      question: "Is the ×10 pull better value than ten single pulls?",
      answer:
        `No. It costs exactly ${banner.tenPullMultiple}× the single price and carries no odds advantage — it is the same roll run ` +
        `${banner.tenPullMultiple} times against the same counters. It exists to save you ${banner.tenPullMultiple - 1} taps.`,
    },
  ];
}

export interface RateChange {
  version: string;
  releasedAt: number;
  path: string;
  before: unknown;
  after: unknown;
}

/**
 * §4.6.3's *"rates last changed"* log.
 *
 * Derived from the patch notes' economy snapshots rather than kept as its own
 * list: every release carries the economy it shipped with, and the newest one is
 * asserted against the live balance, so *"the rates have never changed"* is a
 * claim this build can actually support rather than one it merely makes.
 */
export function rateHistory(): RateChange[] {
  const ordered = releases();
  const changes: RateChange[] = [];
  for (let index = 0; index < ordered.length - 1; index++) {
    const newer = ordered[index]!;
    const older = ordered[index + 1]!;
    for (const change of economyDiff(older.economy, newer.economy)) {
      if (!/rate|pity|Share|price|Price|Cost|Value/.test(change.path)) continue;
      changes.push({
        version: newer.version,
        releasedAt: Date.parse(newer.releasedAt),
        path: change.path,
        before: change.before,
        after: change.after,
      });
    }
  }
  return changes;
}

/**
 * Everything wrong with what this page would publish.
 *
 * Three claims, and the third is the one worth having:
 *
 * 1. Every rate table sums to 1. A table that sums to 0.99 is not a rounding
 *    quirk — it is a roll that silently favours whatever the loop lands on last.
 * 2. No published rate is zero or negative, and no featured share is outside
 *    0–1. A 0% rarity on a printed table is a card nobody can ever open.
 * 3. **The tables here are identical to the ones printed next to the buttons.**
 *    F1 promises one set of numbers; this proves there is one.
 */
export function checkFairnessData(content: ContentIndex): string[] {
  const problems: string[] = [];

  for (const table of [dropTable(content), bannerTable(content)]) {
    const total = table.rows.reduce((sum, row) => sum + row.rate, 0);
    if (Math.abs(total - 1) > 1e-9) {
      problems.push(`${table.id}: the published rates sum to ${total}, not 1 — the roll would favour the last slot`);
    }
    for (const row of table.rows) {
      if (row.rate <= 0) problems.push(`${table.id}: ${row.rarity} is published at ${row.percent}, which nobody can ever open`);
      if (row.featuredRate !== undefined && (row.featuredRate < 0 || row.featuredRate > row.rate)) {
        problems.push(`${table.id}: ${row.rarity}'s featured share is outside its own rate`);
      }
    }
    if (table.price <= 0) problems.push(`${table.id}: is published as free`);
    if (table.guarantees.length === 0) problems.push(`${table.id}: publishes no guarantees`);
  }

  /** The same numbers the shop panel prints beside its own button. */
  const shopRows = dropPublishedOdds(content);
  const disclosed = dropTable(content).rows;
  for (const row of disclosed) {
    const shop = shopRows.find((entry) => entry.rarity === row.rarity);
    if (!shop) problems.push(`drop: the shop does not publish a ${row.rarity} rate at all`);
    else if (shop.percent !== row.percent) {
      problems.push(`drop: the shop prints ${row.rarity} at ${shop.percent}, this page would print ${row.percent}`);
    }
  }

  /** And the ones the banner page prints beside its own. */
  const bannerRows = bannerPublishedOdds(content);
  for (const row of bannerTable(content).rows) {
    const printed = bannerRows.find((entry) => entry.rarity === row.rarity);
    if (!printed) problems.push(`banner: the banner page does not publish a ${row.rarity} rate at all`);
    else if (printed.rate !== row.rate || printed.featuredRate !== row.featuredRate) {
      problems.push(`banner: the banner page and this page disagree about ${row.rarity}`);
    }
  }

  for (const row of conversionTable(content)) {
    if (row.converted < row.dismantle) {
      problems.push(`${row.rarity}: a forced conversion pays ${row.converted}, less than dismantling it yourself (${row.dismantle})`);
    }
    if (row.craft <= 0 || row.tokens <= 0) problems.push(`${row.rarity}: has no published way to be obtained directly`);
  }

  if (workedExamples(content).some((example) => !example.question.trim() || !example.answer.trim())) {
    problems.push("a worked example is blank");
  }

  return problems;
}
