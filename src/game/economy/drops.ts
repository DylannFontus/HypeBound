/**
 * Merch Drops — five-card packs, and the duplicate-protection algorithm behind
 * every random card grant.
 *
 * `docs/design/07-economy-and-monetization.md` §5 writes this out as normative
 * and says so: *"written here as the normative algorithm; implemented in the
 * economy module and unit-tested"*. This is that module, and it is deliberately
 * **pure** — state in, result out, randomness from a seeded PRNG passed in by
 * the caller. Nothing here touches storage, the DOM, or the clock.
 *
 * That purity is what lets the tests assert the promises the spec makes to the
 * player rather than the shape of the code:
 *
 *   - you can never open a useless duplicate while any unowned card of that
 *     rarity exists in the pool;
 *   - conversion happens only once a rarity pool is complete, and always at the
 *     bonus rate;
 *   - no card id appears twice in one Drop while another candidate exists.
 *
 * The published odds come from `balance.economy.pack`, the same object the shop
 * panel prints, so the numbers a player is shown and the numbers that are rolled
 * cannot drift apart.
 */

import type { CardDef, ContentIndex, Rarity } from "../../engine/types";
import type { RngState } from "../../engine/rng";
import { nextInt, nextU32 } from "../../engine/rng";
import { collectibleCards } from "../../engine/content";

/** Rarities in ascending order — the order the floor guarantee upgrades along. */
const RARITY_ORDER: Rarity[] = ["common", "rare", "epic", "legendary"];

/** What the player holds, as much of it as a Drop needs to know. */
export interface CollectionView {
  /** owned copies by card id */
  owned: Readonly<Record<string, number>>;
  /** Drops opened since the last Legendary, for pity */
  sinceLegendary: number;
}

export interface DropCard {
  cardId: string;
  rarity: Rarity;
  /** true when this copy was the player's first of that card */
  isNew: boolean;
  /**
   * Set when the copy could not be kept — the player is at the playable cap and
   * the rarity pool is complete — and was converted to Signal instead.
   */
  convertedToSignal?: number;
  /** which override, if any, decided this card's rarity */
  path: "base" | "pity" | "floor";
}

export interface DropResult {
  cards: DropCard[];
  /** total Signal from conversions in this Drop */
  signal: number;
  /** the pity counter after this Drop */
  sinceLegendary: number;
}

/** How many playable copies of a card a deck may hold — the collection cap too. */
export function playableCap(content: ContentIndex, card: CardDef): number {
  return card.rarity === "legendary" ? content.balance.deck.maxCopiesLegendary : content.balance.deck.maxCopies;
}

/**
 * Roll a rarity from the published table.
 *
 * Walks the cumulative distribution in a fixed order so the same PRNG draw always
 * produces the same rarity — the table is data, and reordering it in the JSON
 * must not silently change what a given seed opens.
 */
function rollRarity(rng: RngState, rates: Record<Rarity, number>): Rarity {
  const total = RARITY_ORDER.reduce((sum, rarity) => sum + (rates[rarity] ?? 0), 0);
  // a u32 divided by 2^32 gives [0,1) without floating-point luck deciding a tier
  const roll = (nextU32(rng) / 0x1_0000_0000) * total;
  let seen = 0;
  for (const rarity of RARITY_ORDER) {
    seen += rates[rarity] ?? 0;
    if (roll < seen) return rarity;
  }
  return "common";
}

/**
 * Pick one card of a rarity, preferring cards the player has room for.
 *
 * The tiering is the whole promise: unowned first, and only when every card of
 * that rarity is already at the cap does the pool fall back to "anything", which
 * is the one path that can produce a conversion. `excluded` carries the ids
 * already granted in this same Drop, which are skipped while other candidates
 * remain — spec step 7.
 */
function pick(
  rng: RngState,
  pool: CardDef[],
  content: ContentIndex,
  owned: Readonly<Record<string, number>>,
  excluded: ReadonlySet<string>
): { card: CardDef; poolComplete: boolean } | null {
  if (pool.length === 0) return null;

  const roomFor = (card: CardDef): boolean => (owned[card.id] ?? 0) < playableCap(content, card);
  const unowned = pool.filter(roomFor);
  const poolComplete = unowned.length === 0;

  const fresh = unowned.filter((card) => !excluded.has(card.id));
  const tier = fresh.length > 0 ? fresh : unowned.length > 0 ? unowned : pool.filter((card) => !excluded.has(card.id));
  const candidates = tier.length > 0 ? tier : pool;

  return { card: candidates[nextInt(rng, candidates.length)]!, poolComplete };
}

export interface DropOptions {
  /**
   * Restrict the pool this Drop draws from.
   *
   * A **Faction Pack** — Faction Mastery ranks 2, 5, 8, 14 and 17 — is "5 cards,
   * all from this faction" (§4.2), which is the whole point of the reward: it
   * feeds the faction you are mastering. Everything else about the Drop is
   * unchanged, including the duplicate protection, the Rare floor and pity.
   */
  pool?: (card: CardDef) => boolean;
}

/**
 * Open one Drop.
 *
 * `rng` is mutated, so a caller that wants a reproducible sequence keeps one
 * state and opens through it — which is what the save layer does, and what lets
 * an opening history be re-derived rather than merely trusted.
 */
export function openDrop(
  content: ContentIndex,
  view: CollectionView,
  rng: RngState,
  options: DropOptions = {}
): DropResult {
  const { pack, dustValue, dupeConversionBonus, packSize } = content.balance.economy;
  const byRarity = new Map<Rarity, CardDef[]>();
  for (const card of collectibleCards(content)) {
    if (options.pool && !options.pool(card)) continue;
    const list = byRarity.get(card.rarity) ?? [];
    list.push(card);
    byRarity.set(card.rarity, list);
  }

  /**
   * The nearest rarity that actually has cards in this pool.
   *
   * The full collection has every rarity, so this never fires for an ordinary
   * Drop. A restricted pool can be missing one — a faction with no Epic, say —
   * and the alternative is a pack that silently arrives four cards short, which
   * is exactly the class of bug this project keeps finding. Down first, because
   * a substituted Common is a smaller lie than a substituted Legendary.
   */
  const nearestStocked = (wanted: Rarity): Rarity | null => {
    const start = RARITY_ORDER.indexOf(wanted);
    for (let step = 0; step < RARITY_ORDER.length; step++) {
      const down = RARITY_ORDER[start - step];
      if (down && (byRarity.get(down)?.length ?? 0) > 0) return down;
      const up = RARITY_ORDER[start + step];
      if (up && (byRarity.get(up)?.length ?? 0) > 0) return up;
    }
    return null;
  };
  // a stable pool order, so a seed opens the same Drop whatever order the card
  // files happened to load in
  for (const list of byRarity.values()) list.sort((a, b) => (a.id < b.id ? -1 : 1));

  const owned: Record<string, number> = { ...view.owned };
  const grantedThisDrop = new Set<string>();
  const cards: DropCard[] = [];
  let signal = 0;
  let bestSoFar = -1;

  for (let slot = 0; slot < packSize; slot++) {
    const isLastSlot = slot === packSize - 1;
    let path: DropCard["path"] = "base";
    let rarity: Rarity;

    /**
     * Overrides in the spec's priority order. Pity outranks the floor, because a
     * Drop that owes a Legendary should not have that debt paid off by a Rare.
     *
     * The counter is read at its value on entry: the pity is a promise about
     * Drops, so opening one cannot move the threshold underneath itself.
     */
    if (view.sinceLegendary + 1 >= pack.legendaryPity && !cards.some((c) => c.rarity === "legendary")) {
      rarity = "legendary";
      path = "pity";
    } else {
      rarity = rollRarity(rng, pack.rates);
      const floorIndex = RARITY_ORDER.indexOf("rare");
      if (isLastSlot && pack.minRarePerPack > 0 && bestSoFar < floorIndex && RARITY_ORDER.indexOf(rarity) < floorIndex) {
        rarity = "rare";
        path = "floor";
      }
    }
    // a restricted pool may not stock the rolled rarity; substitute rather than
    // deliver a short pack
    if ((byRarity.get(rarity)?.length ?? 0) === 0) {
      const substitute = nearestStocked(rarity);
      if (!substitute) break;
      rarity = substitute;
    }
    bestSoFar = Math.max(bestSoFar, RARITY_ORDER.indexOf(rarity));

    const chosen = pick(rng, byRarity.get(rarity) ?? [], content, owned, grantedThisDrop);
    if (!chosen) continue;
    const { card, poolComplete } = chosen;
    grantedThisDrop.add(card.id);

    const held = owned[card.id] ?? 0;
    if (poolComplete && held >= playableCap(content, card)) {
      // spec step 6 — the only path that converts, and always at the bonus rate
      const value = Math.round((dustValue[card.rarity] ?? 0) * dupeConversionBonus);
      signal += value;
      cards.push({ cardId: card.id, rarity: card.rarity, isNew: false, convertedToSignal: value, path });
    } else {
      owned[card.id] = held + 1;
      cards.push({ cardId: card.id, rarity: card.rarity, isNew: held === 0, path });
    }
  }

  /**
   * Pity counts Drops, not cards. A Drop containing a Legendary resets it; any
   * other Drop is one step closer, whether it held one card or five.
   */
  const sinceLegendary = cards.some((c) => c.rarity === "legendary") ? 0 : view.sinceLegendary + 1;

  return { cards, signal, sinceLegendary };
}

/** The published odds, as the shop panel prints them. */
export function publishedOdds(content: ContentIndex): { rarity: Rarity; percent: string }[] {
  const rates = content.balance.economy.pack.rates;
  return RARITY_ORDER.map((rarity) => ({
    rarity,
    percent: `${((rates[rarity] ?? 0) * 100).toFixed(1)}%`,
  })).reverse();
}
