/**
 * Headliner Banners — `07-economy-and-monetization.md` §3.2, §4 and §5.
 *
 * A three-week featured run built around one Legendary, two Epics and four
 * spotlighted Rares. It concentrates odds and adds pity and targeting, and it
 * **never gates**: every card on a banner is simultaneously in the Drop pool and
 * the crafting catalogue, which is why the pool here is the whole collectible
 * set and the featured list is only a rate-up.
 *
 * Pure, exactly as `drops.ts` is — state in, result out, randomness from a
 * seeded PRNG the caller owns. Nothing here touches storage, the DOM or the
 * clock, which is what lets the tests assert the *promises the page prints*
 * rather than the shape of the code.
 *
 * ## The four guarantees, in the order §5 resolves them
 *
 * 1. **Encore Meter hard pity.** On the 50th pull since the meter last reset,
 *    the Target Card is granted outright and the meter resets. The Target is any
 *    card in the pool, not just the featured Legendary.
 * 2. **Epic-or-better within every ten pulls.** A rolling counter, shared by ×1
 *    and ×10 — which is why the ×10 carries *no* odds advantage and costs
 *    exactly ten pulls (§6, F2).
 * 3. **Wishlist first.** Within the rolled rarity, unowned wishlisted cards are
 *    selected before anything else. Ten slots, and it is the only targeting that
 *    costs nothing.
 * 4. **Duplicate protection.** The same §5 algorithm Drops use: unowned before
 *    owned, and conversion only once the rarity pool is genuinely complete.
 *
 * Every pull also grants a Backstage Token, so fifty pulls both fill the meter
 * *and* bank enough tokens to buy a second Legendary outright. §4.4 says that
 * double guarantee is intentional — cards are not the profit centre.
 */

import type { CardDef, ContentIndex, Rarity } from "../../../engine/types";
import type { RngState } from "../../../engine/rng";
import { nextInt, nextU32 } from "../../../engine/rng";
import { collectibleCards } from "../../../engine/content";
import { playableCap } from "../drops";
import { bannerData, type BannerDef, type BannerRun } from "./data";

export { bannerData, resetBannerData, BannerDataError } from "./data";
export type { BannerDef, BannerRun } from "./data";

const RARITY_ORDER: Rarity[] = ["common", "rare", "epic", "legendary"];
const WEEK_MS = 604_800_000;

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

export const runStart = (run: BannerRun): number => Date.parse(run.startAt);
export const runEnd = (run: BannerRun): number => runStart(run) + run.weeks * WEEK_MS;

/** The run this banner is inside at `now`, or null when it is between runs. */
export function activeRun(banner: BannerDef, now: number): BannerRun | null {
  return banner.runs.find((run) => now >= runStart(run) && now < runEnd(run)) ?? null;
}

/** Every banner running at `now`, in schedule order. */
export function liveBanners(now: number): BannerDef[] {
  return bannerData()
    .banners.filter((banner) => activeRun(banner, now) !== null)
    .sort((a, b) => runStart(activeRun(a, now)!) - runStart(activeRun(b, now)!));
}

export const bannerById = (id: string): BannerDef | null =>
  bannerData().banners.find((banner) => banner.id === id) ?? null;

/** The next run of this banner after `now`, for the published rerun calendar. */
export function nextRun(banner: BannerDef, now: number): BannerRun | null {
  return (
    banner.runs
      .filter((run) => runStart(run) > now)
      .sort((a, b) => runStart(a) - runStart(b))[0] ?? null
  );
}

// ---------------------------------------------------------------------------
// The pool
// ---------------------------------------------------------------------------

/**
 * Every card a banner can produce — the whole collectible set.
 *
 * Sorted by id so a seed pulls the same card whatever order the card files
 * happened to load in, the same guarantee `openDrop` makes.
 */
export function bannerPool(content: ContentIndex): CardDef[] {
  return collectibleCards(content).sort((a, b) => (a.id < b.id ? -1 : 1));
}

export const featuredIds = (banner: BannerDef): string[] => [banner.featuredLegendary, ...banner.featuredEpics];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** What one banner remembers about one account. */
export interface BannerState {
  bannerId: string;
  /** pulls made on this banner, across all of its runs */
  pulls: number;
  /** pulls since the last Epic-or-better — the rolling ten-window */
  sinceEpic: number;
  /** pulls since the Encore Meter last reset */
  sinceTarget: number;
  /** the card the Encore Meter is counting toward; empty means "not chosen yet" */
  targetCardId: string;
  /** up to ten card ids, picked first within their rolled rarity */
  wishlist: string[];
  /** §4.1's first-time rewards, both once per banner and kept across reruns */
  freePullUsed: boolean;
  firstTenRewarded: boolean;
}

export const emptyBannerState = (banner: BannerDef): BannerState => ({
  bannerId: banner.id,
  pulls: 0,
  sinceEpic: 0,
  sinceTarget: 0,
  // §4.3: the default Target is the featured Legendary, and it can be changed
  targetCardId: banner.featuredLegendary,
  wishlist: [],
  freePullUsed: false,
  firstTenRewarded: false,
});

/** What the player holds, as much of it as a pull needs to know. */
export interface BannerCollection {
  owned: Readonly<Record<string, number>>;
}

export type PullPath = "base" | "epic-window" | "hard-pity";

export interface PullCard {
  cardId: string;
  rarity: Rarity;
  isNew: boolean;
  /** whether this card was one the banner features */
  featured: boolean;
  /** whether it came off the wishlist */
  wishlisted: boolean;
  /** set when the copy could not be kept and converted to Signal instead */
  convertedToSignal?: number;
  /** which override, if any, decided this card */
  path: PullPath;
}

export interface PullResult {
  cards: PullCard[];
  /** total Signal from conversions */
  signal: number;
  /** Backstage Tokens granted */
  tokens: number;
  /** the banner state after the pull */
  state: BannerState;
  /** true when this pull filled the Encore Meter and needs a new Target chosen */
  targetGranted: boolean;
}

// ---------------------------------------------------------------------------
// Rolling
// ---------------------------------------------------------------------------

/** Roll a rarity from the published table, exactly as `openDrop` does. */
function rollRarity(rng: RngState, rates: Record<Rarity, number>): Rarity {
  const total = RARITY_ORDER.reduce((sum, rarity) => sum + (rates[rarity] ?? 0), 0);
  const roll = (nextU32(rng) / 0x1_0000_0000) * total;
  let seen = 0;
  for (const rarity of RARITY_ORDER) {
    seen += rates[rarity] ?? 0;
    if (roll < seen) return rarity;
  }
  return "common";
}

/**
 * Pick one card of a rolled rarity.
 *
 * §5 step 3's candidate tiers, plus §4.2's rate-up. The featured split happens
 * *inside* the rarity rather than as a separate roll, which is what makes
 * "1.0% featured Legendary / 1.0% all other Legendaries" true rather than
 * approximately true: half of every Legendary roll goes to a featured one.
 *
 * Tier order is wishlisted-and-unowned, then unowned, then anything — so a
 * wishlist can never make an outcome worse, only more specific. A featured card
 * already held at the cap does not consume its own rate-up either: the roll
 * falls through to the ordinary tiers rather than converting, because a rate-up
 * that turned into Signal would be the worst reading of "concentrated odds".
 */
function pickCard(
  rng: RngState,
  ofRarity: CardDef[],
  rarity: Rarity,
  banner: BannerDef,
  content: ContentIndex,
  owned: Readonly<Record<string, number>>,
  wishlist: readonly string[],
  excluded: ReadonlySet<string>,
  featuredShare: { legendary: number; epic: number }
): { card: CardDef; wishlisted: boolean; poolComplete: boolean } | null {
  if (ofRarity.length === 0) return null;

  const roomFor = (card: CardDef): boolean => (owned[card.id] ?? 0) < playableCap(content, card);
  const poolComplete = ofRarity.every((card) => !roomFor(card));

  const featuredHere =
    rarity === "legendary" ? [banner.featuredLegendary] : rarity === "epic" ? banner.featuredEpics : [];
  const featuredAvailable = featuredHere
    .map((id) => ofRarity.find((card) => card.id === id))
    .filter((card): card is CardDef => card !== undefined && roomFor(card) && !excluded.has(card.id));

  const share = rarity === "legendary" ? featuredShare.legendary : rarity === "epic" ? featuredShare.epic : 0;
  if (featuredAvailable.length > 0 && share > 0 && nextU32(rng) / 0x1_0000_0000 < share) {
    const card = featuredAvailable[nextInt(rng, featuredAvailable.length)]!;
    return { card, wishlisted: wishlist.includes(card.id), poolComplete };
  }

  const unowned = ofRarity.filter(roomFor);
  const wanted = unowned.filter((card) => wishlist.includes(card.id) && !excluded.has(card.id));
  const fresh = unowned.filter((card) => !excluded.has(card.id));

  // §5 step 3: the first non-empty tier wins
  const tier = wanted.length > 0 ? wanted : fresh.length > 0 ? fresh : unowned.length > 0 ? unowned : ofRarity;
  const card = tier[nextInt(rng, tier.length)]!;
  return { card, wishlisted: wanted.length > 0 && wishlist.includes(card.id), poolComplete };
}

/**
 * Resolve `count` pulls on one banner.
 *
 * `rng` and the returned state are the account's, so a pull history can be
 * re-derived rather than merely believed — the same contract `openDrop` keeps.
 *
 * The overrides resolve in §5 step 1's stated priority: hard pity first, then
 * the ten-pull Epic window, then the base roll. Hard pity outranks the window
 * because a pull that owes the Target Card should not have that debt paid off by
 * an ordinary Epic.
 */
export function resolvePulls(
  content: ContentIndex,
  banner: BannerDef,
  before: BannerState,
  view: BannerCollection,
  rng: RngState,
  count: number
): PullResult {
  const { banner: rules, dustValue, dupeConversionBonus } = content.balance.economy;
  const byRarity = new Map<Rarity, CardDef[]>();
  for (const card of bannerPool(content)) {
    const list = byRarity.get(card.rarity) ?? [];
    list.push(card);
    byRarity.set(card.rarity, list);
  }

  const state: BannerState = { ...before, wishlist: [...before.wishlist] };
  const owned: Record<string, number> = { ...view.owned };
  const grantedThisPull = new Set<string>();
  const featured = new Set(featuredIds(banner));
  const cards: PullCard[] = [];
  let signal = 0;
  let targetGranted = false;

  for (let index = 0; index < count; index++) {
    state.pulls += 1;
    state.sinceEpic += 1;
    state.sinceTarget += 1;

    let path: PullPath = "base";
    let chosen: CardDef | undefined;
    let wishlisted = false;
    let poolComplete = false;

    /**
     * The Encore Meter, first. It grants the Target Card itself rather than a
     * rarity, which is the point of a *targeted* guarantee — and it resets even
     * when the card converts, because the promise was about the pull, not about
     * whether the copy happened to fit.
     */
    if (state.sinceTarget >= rules.hardPity && state.targetCardId) {
      const target = content.cards[state.targetCardId];
      if (target) {
        chosen = target;
        path = "hard-pity";
        poolComplete = (owned[target.id] ?? 0) >= playableCap(content, target);
      }
    }

    if (!chosen) {
      let rarity: Rarity;
      if (state.sinceEpic >= rules.epicPityWindow) {
        rarity = "epic";
        path = "epic-window";
      } else {
        rarity = rollRarity(rng, rules.rates);
      }
      const picked = pickCard(
        rng,
        byRarity.get(rarity) ?? [],
        rarity,
        banner,
        content,
        owned,
        state.wishlist,
        grantedThisPull,
        rules.featuredShare
      );
      if (!picked) continue;
      chosen = picked.card;
      wishlisted = picked.wishlisted;
      poolComplete = picked.poolComplete;
    }

    // an Epic or better closes the rolling window, however it was reached
    if (chosen.rarity === "epic" || chosen.rarity === "legendary") state.sinceEpic = 0;
    /**
     * §4.3: "Obtaining the Target Card by any means resets the meter and prompts
     * you to pick a new Target." By any means — so a lucky roll resets it just
     * as the guarantee does, and the player is not made to pull fifty more times
     * for a card they already have.
     */
    if (chosen.id === state.targetCardId) {
      state.sinceTarget = 0;
      targetGranted = true;
    }

    const held = owned[chosen.id] ?? 0;
    const atCap = held >= playableCap(content, chosen);
    const card: PullCard = {
      cardId: chosen.id,
      rarity: chosen.rarity,
      isNew: held === 0,
      featured: featured.has(chosen.id),
      wishlisted,
      path,
    };

    /**
     * §5 step 6: a duplicate converts only once the rarity pool is genuinely
     * complete — or when a guarantee handed over a card already at the cap,
     * which is the one other way to arrive here holding one too many.
     */
    if (atCap && (poolComplete || path === "hard-pity")) {
      const value = Math.round((dustValue[chosen.rarity] ?? 0) * dupeConversionBonus);
      card.convertedToSignal = value;
      signal += value;
    } else {
      owned[chosen.id] = held + 1;
      grantedThisPull.add(chosen.id);
    }
    cards.push(card);
  }

  return { cards, signal, tokens: count * rules.tokensPerPull, state, targetGranted };
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface BannerView {
  banner: BannerDef;
  /** the run it is inside now, or null between runs */
  run: BannerRun | null;
  live: boolean;
  /** when it next runs — the published rerun calendar's next entry */
  next: BannerRun | null;
  state: BannerState;
  /** pulls remaining until the Target Card is guaranteed, and the threshold */
  toTarget: number;
  hardPity: number;
  /** pulls remaining until the Epic-or-better window must pay out */
  toEpic: number;
  epicWindow: number;
  pullPrice: number;
  tenPrice: number;
  wishlistLimit: number;
  /** true when the next ×1 costs nothing — §4.1's first-time reward */
  freePull: boolean;
  /** true when a ×10 still owes this banner's themed card back */
  firstTenReward: boolean;
}

export function bannerView(content: ContentIndex, banner: BannerDef, state: BannerState, now: number): BannerView {
  const rules = content.balance.economy.banner;
  const run = activeRun(banner, now);
  return {
    banner,
    run,
    live: run !== null,
    next: nextRun(banner, now),
    state,
    toTarget: Math.max(0, rules.hardPity - state.sinceTarget),
    hardPity: rules.hardPity,
    toEpic: Math.max(0, rules.epicPityWindow - state.sinceEpic),
    epicWindow: rules.epicPityWindow,
    pullPrice: rules.pullPrice,
    // §6 F2: exactly ten pulls, never discounted
    tenPrice: rules.pullPrice * rules.tenPullMultiple,
    wishlistLimit: rules.wishlistLimit,
    freePull: !state.freePullUsed,
    firstTenReward: !state.firstTenRewarded,
  };
}

/**
 * The published odds, as the page prints them.
 *
 * Derived from the same object the resolver rolls against, so the table a player
 * reads and the distribution they are subject to cannot drift apart — the rule
 * `openDrop` already follows for the shop panel.
 */
export interface OddsRow {
  rarity: Rarity;
  rate: number;
  /** the share of that rate concentrated on this banner's featured cards */
  featuredRate: number;
}

export function publishedOdds(content: ContentIndex): OddsRow[] {
  const rules = content.balance.economy.banner;
  return RARITY_ORDER.slice()
    .reverse()
    .map((rarity) => {
      const rate = rules.rates[rarity] ?? 0;
      const share =
        rarity === "legendary" ? rules.featuredShare.legendary : rarity === "epic" ? rules.featuredShare.epic : 0;
      return { rarity, rate, featuredRate: rate * share };
    });
}

/** What a card costs in Backstage Tokens (§4.4). */
export const tokenPrice = (content: ContentIndex, card: CardDef): number =>
  content.balance.economy.banner.tokenPrices[card.rarity] ?? 0;

// ---------------------------------------------------------------------------
// Data checks
// ---------------------------------------------------------------------------

/**
 * Everything wrong with `data/banners.json`, checked against real content.
 *
 * The schema proves the file is well-formed. This proves it is *true*: that
 * every featured card exists and is the rarity it is featured as, that the runs
 * are a real schedule, and that §4's rerun promise is kept in data rather than
 * in prose.
 */
export function checkBannerData(content: ContentIndex): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const banner of bannerData().banners) {
    if (seen.has(banner.id)) problems.push(`${banner.id}: duplicate id`);
    seen.add(banner.id);

    const check = (cardId: string, rarity: Rarity, label: string): void => {
      const card = content.cards[cardId];
      if (!card) problems.push(`${banner.id}: ${label} "${cardId}" is not a card`);
      else if (card.token || card.variantOf) problems.push(`${banner.id}: ${label} "${cardId}" is not collectible`);
      else if (card.rarity !== rarity) problems.push(`${banner.id}: ${label} "${cardId}" is ${card.rarity}, not ${rarity}`);
    };
    check(banner.featuredLegendary, "legendary", "featured Legendary");
    for (const id of banner.featuredEpics) check(id, "epic", "featured Epic");
    for (const id of banner.spotlightedRares) check(id, "rare", "spotlighted Rare");

    const ids = [banner.featuredLegendary, ...banner.featuredEpics, ...banner.spotlightedRares];
    if (new Set(ids).size !== ids.length) problems.push(`${banner.id}: features the same card twice`);

    if (!content.factions[banner.factionId as never]) problems.push(`${banner.id}: no such faction "${banner.factionId}"`);

    /**
     * §4: "Every banner reruns at least twice within 12 months of its debut
     * (published rerun calendar on the banner page)." A banner with one run is a
     * limited-time exclusive by another name, which §4.5 forbids outright.
     */
    if (banner.runs.length < 3) problems.push(`${banner.id}: ${banner.runs.length} run(s); §4 promises a debut plus two reruns`);
    const sorted = [...banner.runs].sort((a, b) => runStart(a) - runStart(b));
    for (let i = 1; i < sorted.length; i++) {
      if (runStart(sorted[i]!) < runEnd(sorted[i - 1]!)) problems.push(`${banner.id}: two runs overlap`);
    }
    const debut = sorted[0];
    const secondRerun = sorted[2];
    if (debut && secondRerun && runStart(secondRerun) - runStart(debut) > 366 * 86_400_000) {
      problems.push(`${banner.id}: the second rerun is more than 12 months after the debut`);
    }
  }

  /** Two banners running at once would make "the banner page" ambiguous. */
  const runs = bannerData()
    .banners.flatMap((banner) => banner.runs.map((run) => ({ banner: banner.id, run })))
    .sort((a, b) => runStart(a.run) - runStart(b.run));
  for (let i = 1; i < runs.length; i++) {
    if (runStart(runs[i]!.run) < runEnd(runs[i - 1]!.run)) {
      problems.push(`${runs[i - 1]!.banner} and ${runs[i]!.banner} run at the same time`);
    }
  }

  return problems;
}

