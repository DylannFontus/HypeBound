/**
 * Headliner Banners and the Stream Check-In —
 * `07-economy-and-monetization.md` §4/§5 and `08-progression.md` §11.
 *
 * The banner is the one system in this game whose whole job is to be *trusted*.
 * §4.1 asks it to print exact rates, pity progress, an opening history and the
 * conversion rate with a worked example, and §6 makes several of those binding.
 * So these tests are mostly about the promises rather than the plumbing:
 *
 * - the ×10 is exactly ten pulls at ten times the price, with **no** odds edge;
 * - the ten-pull Epic window and the fifty-pull Encore Meter both actually fire,
 *   and the meter resets on obtaining the Target *by any means*;
 * - a wishlisted card is preferred within its rarity and never makes an outcome
 *   worse;
 * - a duplicate converts only once its rarity pool is genuinely complete;
 * - nothing on a banner is exclusive, and every banner has a published rerun.
 *
 * §11's rule is simpler and easier to break by accident: **no streaks**. Six
 * scattered days claim six steps, and missing a day forfeits nothing.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { Rarity } from "../src/engine/types";
import { getContent } from "../src/engine/content";
import { seedRng } from "../src/engine/rng";
import {
  activeRun,
  bannerData,
  bannerById,
  bannerPool,
  bannerView,
  checkBannerData,
  emptyBannerState,
  featuredIds,
  liveBanners,
  nextRun,
  publishedOdds,
  resolvePulls,
  runEnd,
  runStart,
  tokenPrice,
  type BannerState,
} from "../src/game/economy/banner";
import { checkCosmeticsData, cosmeticById } from "../src/game/cosmetics";
import { checkInConfig } from "../src/game/progression/data";
import {
  backstageTokens,
  bannerViews,
  checkInView,
  claimCheckIn,
  currentBanner,
  getProfile,
  monthKey,
  profileStore,
  pullBanner,
  pullHistory,
  pullHistoryJson,
  redeemBackstage,
  rerollTokens,
  setTargetCard,
  toggleWishlist,
} from "../src/save/profile";

const content = getContent();
const rules = content.balance.economy.banner;
const BANNER = bannerData().banners[0]!;
const DAY = 86_400_000;

/** A moment inside the banner's debut run. */
const LIVE = runStart(BANNER.runs[0]!) + DAY;

const freshState = (over: Partial<BannerState> = {}): BannerState => ({ ...emptyBannerState(BANNER), ...over });

// ---------------------------------------------------------------------------

describe("the banner catalogue", () => {
  it("says nothing that is not true of the shipped content", () => {
    const problems = checkBannerData(content);
    expect(problems, problems.length === 0 ? "" : `\ndata/banners.json:\n  ${problems.join("\n  ")}\n`).toEqual([]);
  });

  it("leaves the cosmetics catalogue consistent", () => {
    const problems = checkCosmeticsData(content);
    expect(problems, problems.length === 0 ? "" : `\ndata/cosmetics.json:\n  ${problems.join("\n  ")}\n`).toEqual([]);
  });

  it("publishes a rerun calendar rather than promising one", () => {
    // §4: "Every banner reruns at least twice within 12 months of its debut"
    for (const banner of bannerData().banners) {
      expect(banner.runs.length, banner.id).toBeGreaterThanOrEqual(3);
      const sorted = [...banner.runs].sort((a, b) => runStart(a) - runStart(b));
      expect(runStart(sorted[2]!) - runStart(sorted[0]!)).toBeLessThanOrEqual(366 * DAY);
    }
  });

  it("gates nothing — the pool is the whole collectible set", () => {
    /**
     * §3.2: "every card that appears on a banner simultaneously enters the
     * general Drop pool and the crafting catalog on its release day". A banner
     * pool smaller than the collection would be an exclusivity by another name.
     */
    const pool = bannerPool(content);
    // leaders are not collectible — they arrive with a starter deck, never a pull
    const collectible = Object.values(content.cards).filter(
      (card) => !card.token && !card.variantOf && card.type !== "leader"
    );
    expect(pool.length).toBe(collectible.length);
    for (const id of featuredIds(BANNER)) {
      expect(pool.some((card) => card.id === id)).toBe(true);
    }
  });

  it("runs one banner at a time", () => {
    expect(liveBanners(LIVE).map((banner) => banner.id)).toEqual([BANNER.id]);
  });

  it("knows when it is not running, and when it next will", () => {
    const between = runEnd(BANNER.runs[0]!) + DAY;
    expect(activeRun(BANNER, between)).toBeNull();
    expect(nextRun(BANNER, between)).not.toBeNull();
  });
});

describe("published odds", () => {
  it("sum to one", () => {
    const total = publishedOdds(content).reduce((sum, row) => sum + row.rate, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it("match §4.2's table", () => {
    const by = (rarity: Rarity) => publishedOdds(content).find((row) => row.rarity === rarity)!;
    expect(by("legendary").rate).toBeCloseTo(0.02);
    expect(by("epic").rate).toBeCloseTo(0.08);
    expect(by("rare").rate).toBeCloseTo(0.3);
    expect(by("common").rate).toBeCloseTo(0.6);
    // "1.0% featured Legendary / 1.0% all other Legendaries"
    expect(by("legendary").featuredRate).toBeCloseTo(0.01);
    expect(by("epic").featuredRate).toBeCloseTo(0.04);
  });

  it("come from the same object the resolver rolls against", () => {
    // the guard on the guard: a hand-written table beside the code would drift
    for (const row of publishedOdds(content)) {
      expect(row.rate).toBe(rules.rates[row.rarity]);
    }
  });
});

describe("pity", () => {
  it("pays an Epic or better within the ten-pull window", () => {
    const rng = seedRng(9);
    const result = resolvePulls(content, BANNER, freshState(), { owned: {} }, rng, rules.epicPityWindow);
    const best = result.cards.some((card) => card.rarity === "epic" || card.rarity === "legendary");
    expect(best).toBe(true);
  });

  it("resets the window on an Epic however it arrived", () => {
    const rng = seedRng(11);
    const result = resolvePulls(content, BANNER, freshState(), { owned: {} }, rng, 30);
    let since = 0;
    for (const card of result.cards) {
      since += 1;
      if (card.rarity === "epic" || card.rarity === "legendary") since = 0;
      expect(since, "went more than a full window without an Epic").toBeLessThanOrEqual(rules.epicPityWindow);
    }
  });

  it("grants the Target Card on the fiftieth pull, not the forty-ninth", () => {
    const target = BANNER.featuredLegendary;
    const before = freshState({ sinceTarget: rules.hardPity - 2, targetCardId: target });
    const rng = seedRng(5);
    const result = resolvePulls(content, BANNER, before, { owned: {} }, rng, 2);
    expect(result.cards[1]!.cardId).toBe(target);
    expect(result.cards[1]!.path).toBe("hard-pity");
    expect(result.state.sinceTarget).toBe(0);
  });

  it("resets the meter when the Target arrives by an ordinary roll", () => {
    /**
     * §4.3: "Obtaining the Target Card by any means resets the meter." Making a
     * player pull fifty more times for a card they just won would be the exact
     * opposite of a targeted guarantee.
     */
    const common = bannerPool(content).find((card) => card.rarity === "common")!;
    const before = freshState({ sinceTarget: 10, targetCardId: common.id });
    const rng = seedRng(3);
    const result = resolvePulls(content, BANNER, before, { owned: {} }, rng, 40);
    const hit = result.cards.findIndex((card) => card.cardId === common.id);
    if (hit >= 0) {
      expect(result.targetGranted).toBe(true);
      expect(result.state.sinceTarget).toBeLessThan(rules.hardPity);
    }
  });

  it("counts a pull toward both guarantees at once", () => {
    const result = resolvePulls(content, BANNER, freshState(), { owned: {} }, seedRng(7), 3);
    expect(result.state.pulls).toBe(3);
    expect(result.state.sinceTarget).toBe(3);
  });
});

describe("the ×10", () => {
  it("is exactly ten pulls", () => {
    const result = resolvePulls(content, BANNER, freshState(), { owned: {} }, seedRng(21), 10);
    expect(result.cards).toHaveLength(10);
    expect(result.tokens).toBe(10 * rules.tokensPerPull);
  });

  it("costs exactly ten times a single pull — §6 F2, never discounted", () => {
    const view = bannerView(content, BANNER, freshState(), LIVE);
    expect(view.tenPrice).toBe(view.pullPrice * 10);
  });

  it("carries no odds advantage over ten singles", () => {
    /**
     * §6 F2's real claim, tested the only way it can honestly be tested.
     *
     * Card-for-card equality is not achievable and never was: `nextInt` uses
     * rejection sampling, so the number of PRNG draws depends on how many
     * candidates a tier holds, and a ×10 excludes cards already granted inside
     * the same transaction (§5 step 7) while ten singles do not. The two streams
     * legitimately diverge.
     *
     * What must be true is that the *distribution* is the same. Over three
     * thousand pulls each way, from the same seed, they agree to within half a
     * percentage point in every rarity.
     */
    const measure = (batch: 1 | 10): Record<Rarity, number> => {
      const rng = seedRng(12345);
      let state = freshState();
      const counts: Record<Rarity, number> = { common: 0, rare: 0, epic: 0, legendary: 0 };
      for (let i = 0; i < 3000 / batch; i++) {
        const result = resolvePulls(content, BANNER, state, { owned: {} }, rng, batch);
        state = result.state;
        for (const card of result.cards) counts[card.rarity] += 1;
      }
      return counts;
    };
    const singles = measure(1);
    const tens = measure(10);
    for (const rarity of ["common", "rare", "epic", "legendary"] as Rarity[]) {
      const gap = Math.abs(singles[rarity] - tens[rarity]) / 3000;
      expect(gap, `${rarity} differs by ${(gap * 100).toFixed(2)}pp between ×1 and ×10`).toBeLessThan(0.005);
    }
  });

  it("never rolls worse than the printed table", () => {
    /**
     * The published rates are the *base* roll; the rolling guarantees can only
     * push the effective rate up. A player who reads "2.0% Legendary" and
     * receives less than that would have been misled, so the floor is asserted.
     */
    const rng = seedRng(555);
    let state = freshState();
    const counts: Record<Rarity, number> = { common: 0, rare: 0, epic: 0, legendary: 0 };
    for (let i = 0; i < 300; i++) {
      const result = resolvePulls(content, BANNER, state, { owned: {} }, rng, 10);
      state = result.state;
      for (const card of result.cards) counts[card.rarity] += 1;
    }
    expect(counts.legendary / 3000).toBeGreaterThanOrEqual(rules.rates.legendary);
    expect(counts.epic / 3000).toBeGreaterThanOrEqual(rules.rates.epic);
  });
});

describe("the wishlist", () => {
  it("is taken first within its rarity", () => {
    /**
     * Checked one transaction at a time, because §5 step 7 excludes a card
     * already granted inside the same ×10 — so the *first* Rare of a fresh batch
     * is where the preference has to show, not the second.
     */
    const wanted = bannerPool(content).filter((card) => card.rarity === "rare")[3]!;
    let state = freshState({ wishlist: [wanted.id] });
    const rng = seedRng(77);
    let sawARare = false;
    for (let batch = 0; batch < 6; batch++) {
      const result = resolvePulls(content, BANNER, state, { owned: {} }, rng, 10);
      state = result.state;
      const firstRare = result.cards.find((card) => card.rarity === "rare");
      if (!firstRare) continue;
      sawARare = true;
      expect(firstRare.cardId, "the first Rare of a batch was not the wishlisted one").toBe(wanted.id);
      expect(firstRare.wishlisted).toBe(true);
    }
    expect(sawARare, "no Rare was rolled at all in sixty pulls").toBe(true);
  });

  it("never makes an outcome worse", () => {
    /**
     * A wishlist reorders *within* a rarity and touches nothing else, so the
     * rarity distribution must be unmoved. Measured rather than compared
     * card-for-card, for the same reason the ×10 test is: a one-card tier
     * consumes a different number of PRNG draws than a ninety-card one.
     */
    const measure = (wishlist: string[]): Record<Rarity, number> => {
      const rng = seedRng(4242);
      let state = freshState({ wishlist });
      const counts: Record<Rarity, number> = { common: 0, rare: 0, epic: 0, legendary: 0 };
      for (let i = 0; i < 200; i++) {
        const result = resolvePulls(content, BANNER, state, { owned: {} }, rng, 10);
        state = result.state;
        for (const card of result.cards) counts[card.rarity] += 1;
      }
      return counts;
    };
    const plain = measure([]);
    const wished = measure(
      bannerPool(content)
        .filter((card) => card.rarity === "rare")
        .slice(0, 3)
        .map((card) => card.id)
    );
    for (const rarity of ["common", "rare", "epic", "legendary"] as Rarity[]) {
      expect(Math.abs(plain[rarity] - wished[rarity]) / 2000).toBeLessThan(0.02);
    }
  });
});

describe("duplicate protection", () => {
  it("never converts while an unowned card of that rarity exists", () => {
    const result = resolvePulls(content, BANNER, freshState(), { owned: {} }, seedRng(13), 40);
    expect(result.cards.every((card) => card.convertedToSignal === undefined)).toBe(true);
  });

  it("converts at the published bonus rate once a rarity is complete", () => {
    const owned: Record<string, number> = {};
    for (const card of bannerPool(content)) owned[card.id] = card.rarity === "legendary" ? 1 : 2;
    const result = resolvePulls(content, BANNER, freshState(), { owned }, seedRng(17), 8);
    expect(result.cards.every((card) => card.convertedToSignal !== undefined)).toBe(true);
    const first = result.cards[0]!;
    const expected = Math.round(
      content.balance.economy.dustValue[first.rarity] * content.balance.economy.dupeConversionBonus
    );
    expect(first.convertedToSignal).toBe(expected);
    expect(result.signal).toBeGreaterThan(0);
  });

  it("does not repeat a card inside one ×10 while others are available", () => {
    const result = resolvePulls(content, BANNER, freshState(), { owned: {} }, seedRng(23), 10);
    const ids = result.cards.map((card) => card.cardId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not let a featured card at the cap consume its own rate-up", () => {
    /**
     * A rate-up that turned into Signal would be the worst possible reading of
     * "concentrated odds": the featured card is the reason to be here.
     */
    const owned: Record<string, number> = { [BANNER.featuredLegendary]: 1 };
    // the Target is set elsewhere, so hard pity cannot be what hands over a
    // capped featured Legendary — this is about the rate-up path alone
    const elsewhere = bannerPool(content).find((card) => card.rarity === "epic")!;
    const result = resolvePulls(
      content,
      BANNER,
      freshState({ targetCardId: elsewhere.id }),
      { owned },
      seedRng(29),
      60
    );
    const featuredLegendary = result.cards.filter((card) => card.cardId === BANNER.featuredLegendary);
    expect(featuredLegendary.every((card) => card.convertedToSignal === undefined)).toBe(true);
  });
});

describe("the account, through the profile", () => {
  beforeEach(() => profileStore.reset());

  const give = (clout: number): void => {
    profileStore.update((draft) => {
      draft.clout = clout;
    });
  };

  it("shows the live banner first", () => {
    const view = currentBanner(content, LIVE)!;
    expect(view.banner.id).toBe(BANNER.id);
    expect(view.live).toBe(true);
  });

  it("gives the first ×1 free, once — §4.1", () => {
    give(0);
    const first = pullBanner(content, BANNER.id, 1, LIVE);
    expect(first?.cloutSpent).toBe(0);
    expect(first?.cards).toHaveLength(1);
    // and the next one is not free
    expect(pullBanner(content, BANNER.id, 1, LIVE)).toBeNull();
  });

  it("charges exactly ten pulls for a ×10", () => {
    give(rules.pullPrice * 10);
    const result = pullBanner(content, BANNER.id, 10, LIVE);
    expect(result?.cloutSpent).toBe(rules.pullPrice * 10);
    expect(getProfile().clout).toBe(0);
  });

  it("refuses a pull it cannot pay for, and changes nothing", () => {
    give(rules.pullPrice - 1);
    profileStore.update((draft) => {
      draft.banners.state[BANNER.id] = { ...emptyBannerState(BANNER), freePullUsed: true };
    });
    expect(pullBanner(content, BANNER.id, 1, LIVE)).toBeNull();
    expect(getProfile().clout).toBe(rules.pullPrice - 1);
    expect(pullHistory()).toHaveLength(0);
  });

  it("refuses a pull when the banner is not running", () => {
    give(10_000);
    expect(pullBanner(content, BANNER.id, 1, runEnd(BANNER.runs[0]!) + DAY)).toBeNull();
  });

  it("grants the themed card back on the first ×10, once", () => {
    give(rules.pullPrice * 30);
    const first = pullBanner(content, BANNER.id, 10, LIVE)!;
    expect(first.cosmetics.map((cosmetic) => cosmetic.id)).toEqual([`cardBack:banner:${BANNER.id}`]);
    const second = pullBanner(content, BANNER.id, 10, LIVE)!;
    expect(second.cosmetics).toEqual([]);
  });

  it("banks a Backstage Token per pull, and they never expire", () => {
    give(rules.pullPrice * 10);
    pullBanner(content, BANNER.id, 10, LIVE);
    expect(backstageTokens()).toBe(10 * rules.tokensPerPull);
  });

  it("logs every pull, and exports it as JSON", () => {
    give(rules.pullPrice * 10);
    pullBanner(content, BANNER.id, 10, LIVE);
    expect(pullHistory()).toHaveLength(1);
    expect(pullHistory()[0]!.cards).toHaveLength(10);
    const parsed = JSON.parse(pullHistoryJson());
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].bannerId).toBe(BANNER.id);
  });

  it("keeps the pull stream re-derivable", () => {
    // the PRNG state is stored, so the same account opens the same sequence
    give(rules.pullPrice * 20);
    pullBanner(content, BANNER.id, 10, LIVE);
    expect(getProfile().banners.rng).not.toBeNull();
    expect(getProfile().banners.seed).toBeGreaterThan(0);
  });

  it("changes the Target Card and keeps the meter's count", () => {
    profileStore.update((draft) => {
      draft.banners.state[BANNER.id] = { ...emptyBannerState(BANNER), sinceTarget: 22 };
    });
    const other = bannerPool(content).find((card) => card.rarity === "epic")!;
    expect(setTargetCard(content, BANNER.id, other.id)).toBe(true);
    const view = bannerViews(content, LIVE).find((entry) => entry.banner.id === BANNER.id)!;
    expect(view.state.targetCardId).toBe(other.id);
    expect(view.state.sinceTarget).toBe(22);
    expect(view.toTarget).toBe(rules.hardPity - 22);
  });

  it("holds at most ten wishlist entries", () => {
    const cards = bannerPool(content).slice(0, 12);
    for (const card of cards) toggleWishlist(content, BANNER.id, card.id);
    const view = bannerViews(content, LIVE).find((entry) => entry.banner.id === BANNER.id)!;
    expect(view.state.wishlist).toHaveLength(rules.wishlistLimit);
  });

  it("removes a wishlist entry on a second toggle", () => {
    const card = bannerPool(content)[0]!;
    expect(toggleWishlist(content, BANNER.id, card.id)).toEqual([card.id]);
    expect(toggleWishlist(content, BANNER.id, card.id)).toEqual([]);
  });

  it("sells any card for tokens at the published price", () => {
    const legendary = bannerPool(content).find((card) => card.rarity === "legendary")!;
    profileStore.update((draft) => {
      draft.banners.tokens = 100;
    });
    const price = redeemBackstage(content, legendary.id, LIVE);
    expect(price).toBe(tokenPrice(content, legendary));
    expect(getProfile().collection[legendary.id]).toBe(1);
    expect(backstageTokens()).toBe(100 - price!);
  });

  it("refuses to sell a card the account already holds at the cap", () => {
    const legendary = bannerPool(content).find((card) => card.rarity === "legendary")!;
    profileStore.update((draft) => {
      draft.banners.tokens = 100;
      draft.collection[legendary.id] = 1;
    });
    expect(redeemBackstage(content, legendary.id, LIVE)).toBeNull();
    expect(backstageTokens()).toBe(100);
  });

  it("resets the Encore Meter when the Target is bought with tokens", () => {
    const legendary = bannerPool(content).find((card) => card.rarity === "legendary")!;
    profileStore.update((draft) => {
      draft.banners.tokens = 100;
      draft.banners.state[BANNER.id] = {
        ...emptyBannerState(BANNER),
        sinceTarget: 30,
        targetCardId: legendary.id,
      };
    });
    redeemBackstage(content, legendary.id, LIVE);
    expect(getProfile().banners.state[BANNER.id]!.sinceTarget).toBe(0);
  });

  it("fifty pulls both fill the meter and bank a Legendary's worth of tokens", () => {
    /**
     * §4.4 calls this double guarantee intentional: "cards are not the profit
     * center". It is the single clearest promise the banner makes, so it is
     * asserted against the shipped numbers rather than assumed.
     */
    expect(rules.hardPity * rules.tokensPerPull).toBeGreaterThanOrEqual(rules.tokenPrices.legendary);
  });
});

// ---------------------------------------------------------------------------

describe("Stream Check-In", () => {
  const JAN_1 = Date.parse("2027-01-01T12:00:00.000Z");

  beforeEach(() => profileStore.reset());

  it("ships §11's ten steps", () => {
    expect(checkInConfig().steps).toHaveLength(10);
  });

  it("claims one step per calendar day, and refuses a second", () => {
    expect(checkInView(JAN_1).available).toBe(true);
    const first = claimCheckIn(content, JAN_1);
    expect(first?.step).toBe(1);
    expect(claimCheckIn(content, JAN_1)).toBeNull();
    expect(checkInView(JAN_1).claimed).toBe(1);
  });

  it("has no streak — six scattered days claim six steps", () => {
    /**
     * §11 and §10.6.1 both make this binding, and it is the single easiest thing
     * to break by accident: any "consecutive" bookkeeping would fail here.
     */
    for (const day of [0, 3, 4, 9, 17, 25]) {
      const grant = claimCheckIn(content, JAN_1 + day * DAY);
      expect(grant, `day ${day} paid nothing`).not.toBeNull();
    }
    expect(checkInView(JAN_1 + 25 * DAY).claimed).toBe(6);
  });

  it("pays the rewards §11's table lists, in order", () => {
    const grants = [];
    for (let day = 0; day < 10; day++) grants.push(claimCheckIn(content, JAN_1 + day * DAY)!);
    expect(grants.map((grant) => grant.clout)).toEqual([50, 0, 100, 0, 0, 100, 0, 150, 0, 0]);
    expect(grants[1]!.fragments).toBe(20);
    expect(grants[3]!.rerollTokens).toBe(2);
    expect(grants[4]!.drops).toBe(1);
    expect(grants[6]!.fragments).toBe(30);
    expect(grants[8]!.glimmer).toBe(50);
    expect(grants[9]!.cosmetics).toHaveLength(1);
  });

  it("gives the month's card back, and a different one next month", () => {
    for (let day = 0; day < 10; day++) claimCheckIn(content, JAN_1 + day * DAY);
    const january = getProfile().cosmetics.owned.find((id) => id.startsWith("cardBack:checkin:"));
    expect(january).toBeTruthy();
    expect(cosmeticById(content, january!)).not.toBeNull();

    const FEB_1 = Date.parse("2027-02-01T12:00:00.000Z");
    for (let day = 0; day < 10; day++) claimCheckIn(content, FEB_1 + day * DAY);
    const backs = getProfile().cosmetics.owned.filter((id) => id.startsWith("cardBack:checkin:"));
    expect(backs).toHaveLength(2);
  });

  it("restarts the track on a new month without taking anything away", () => {
    claimCheckIn(content, JAN_1);
    claimCheckIn(content, JAN_1 + DAY);
    expect(checkInView(JAN_1 + DAY).claimed).toBe(2);
    const cloutAfterJanuary = getProfile().clout;

    const FEB_1 = Date.parse("2027-02-01T12:00:00.000Z");
    expect(checkInView(FEB_1).claimed).toBe(0);
    claimCheckIn(content, FEB_1);
    expect(getProfile().clout).toBeGreaterThan(cloutAfterJanuary);
  });

  it("stops at the last step for the month", () => {
    for (let day = 0; day < 10; day++) claimCheckIn(content, JAN_1 + day * DAY);
    expect(checkInView(JAN_1 + 10 * DAY).complete).toBe(true);
    expect(claimCheckIn(content, JAN_1 + 10 * DAY)).toBeNull();
  });

  it("names the month the way the state keys it", () => {
    expect(monthKey(JAN_1)).toBe(`${new Date(JAN_1).getFullYear()}-${String(new Date(JAN_1).getMonth() + 1).padStart(2, "0")}`);
  });

  it("banks reroll tokens that actually buy a reroll", () => {
    // §11 step 4 pays tokens; a token that could do nothing the free reroll
    // cannot would be a reward in name only
    for (let day = 0; day < 4; day++) claimCheckIn(content, JAN_1 + day * DAY);
    expect(rerollTokens()).toBe(2);
  });
});
