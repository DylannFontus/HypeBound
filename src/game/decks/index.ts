/**
 * Deck comparison and deck-building assistance — `03-screens-and-navigation.md`
 * §4.3.2, and `14-ai-design.md`'s rule for the builder's auto-generate.
 *
 * Two things the deck builder has never had: *"Compare versions (diff against
 * last saved)"* and *"suggested cards and replacements-for-missing"*.
 *
 * Pure, like every other analysis module here: decks in, answers out. No DOM, no
 * storage, no clock. The collection is passed in rather than read, so the same
 * functions answer "what should I add" for a player, for a test, and for a
 * hypothetical collection nobody owns.
 *
 * ## The rule that shapes all of it
 *
 * `14-ai-design.md`: *"Deck builder 'Auto-generate' runs live from the player's
 * **collection** (pool restricted to owned cards), then reports which suggested
 * cards the player is missing."*
 *
 * That is not a nicety. The builder's card pool already refuses to let you add a
 * card you do not own — and **`autoBuildDeck` ignores the collection entirely**,
 * so pressing Auto-Build handed you a thirty-card list you could not have built
 * by hand, which then validated as "✓ Legal deck — ready to play" and could be
 * saved and played. Ownership deliberately is not enforced in `validateDeck`
 * (the Grand Tour's loaner decks, starter decks, Doomscroll and Gauntlet decks
 * all legitimately contain cards you do not own), so the fix belongs here, where
 * the builder can ask for it.
 */

import { z } from "zod";
import type { CardDef, ConfluenceId, ContentIndex, CurrentId, DeckList, LeaderCardDef } from "../../engine/types";
import type { MatchHistoryEntry } from "../../save/profile";
import { curveBucket, curveNeed, legalCardPool, payoffTags, validateDeck } from "../../engine/deck";
import { deckPureCurrent } from "../../engine/currents";
import { selectableLeaders } from "../../engine/content";
import { buildDashboard } from "../stats/dashboard";
import rawTools from "../../../data/deck-tools.json";

const note = z.array(z.string()).optional();

const toolsSchema = z
  .object({
    _readme: note,
    weights: z
      .object({
        _note: note,
        curve: z.number(),
        tag: z.number(),
        synergy: z.number(),
        current: z.number(),
        resonance: z.number(),
      })
      .strict(),
    suggestions: z
      .object({
        _note: note,
        show: z.number().int().positive(),
        craftTargets: z.number().int().nonnegative(),
        minScoreToShow: z.number().min(0),
      })
      .strict(),
    replacements: z
      .object({ _note: note, sameCostBonus: z.number(), adjacentCostBonus: z.number() })
      .strict(),
  })
  .strict();

let toolsCache: z.infer<typeof toolsSchema> | null = null;

/** `data/deck-tools.json`, parsed once. */
export function deckToolsData(): z.infer<typeof toolsSchema> {
  if (!toolsCache) toolsCache = toolsSchema.parse(rawTools);
  return toolsCache;
}

/** How many copies of a card an account may run: the lesser of the rule and what it owns. */
export function playableCopies(content: ContentIndex, card: CardDef, owned: number): number {
  const limit =
    card.rarity === "legendary" ? content.balance.deck.maxCopiesLegendary : content.balance.deck.maxCopies;
  return Math.max(0, Math.min(limit, owned));
}

export type Collection = Readonly<Record<string, number>>;

const countCards = (cards: readonly string[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const id of cards) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
};

// ---------------------------------------------------------------------------
// Compare versions — §4.3.2
// ---------------------------------------------------------------------------

export interface DeckDiffRow {
  cardId: string;
  name: string;
  cost: number;
  /** copies in the saved deck */
  before: number;
  /** copies in the working draft */
  after: number;
  /** after − before; positive is added, negative is cut */
  delta: number;
}

export interface DeckDiff {
  /** true when the draft is identical to what was saved */
  identical: boolean;
  /** true when there is nothing saved to compare against yet */
  unsaved: boolean;
  leaderChanged: boolean;
  nameChanged: boolean;
  /** §4.3.2's identity picks, which are saved and so must be compared */
  coverChanged: boolean;
  cardBackChanged: boolean;
  beforeLeaderCardId: string | null;
  afterLeaderCardId: string;
  /** every card whose count moved, cuts and additions together, cost order */
  rows: DeckDiffRow[];
  added: number;
  removed: number;
  /** size of each side, so "28 → 30" can be stated rather than implied */
  beforeSize: number;
  afterSize: number;
}

/**
 * The draft against the last saved version of the same slot.
 *
 * Counts rather than lists: a deck is a multiset, and "you cut one of your two
 * Foam Knights" is the useful sentence. Reporting it as one removal from a list
 * of thirty ids would be technically true and useless.
 *
 * A slot with nothing saved in it is `unsaved`, not "everything added" — the
 * screen says *"nothing saved in this slot yet"* rather than showing thirty
 * green rows, because there is no version to compare to.
 */
export function diffDecks(content: ContentIndex, saved: DeckList | null, draft: DeckList): DeckDiff {
  const before = countCards(saved?.cards ?? []);
  const after = countCards(draft.cards);
  const ids = new Set([...before.keys(), ...after.keys()]);

  const rows: DeckDiffRow[] = [];
  for (const cardId of ids) {
    const beforeCount = before.get(cardId) ?? 0;
    const afterCount = after.get(cardId) ?? 0;
    if (beforeCount === afterCount) continue;
    const card = content.cards[cardId];
    rows.push({
      cardId,
      name: card?.name ?? cardId,
      cost: card?.cost ?? 0,
      before: beforeCount,
      after: afterCount,
      delta: afterCount - beforeCount,
    });
  }
  rows.sort((a, b) => a.cost - b.cost || (a.name < b.name ? -1 : 1));

  const leaderChanged = saved !== null && saved.leaderCardId !== draft.leaderCardId;
  const nameChanged = saved !== null && saved.name !== draft.name;
  /**
   * The cover and the card back are **saved fields**, so they are changes.
   *
   * `identical` drives the Compare button's label, which is the builder's only
   * unsaved-changes indicator. Leaving these two out of it meant picking a new
   * cover left the button reading "Compare — saved" and the panel saying
   * "Unchanged since you last saved" — over an edit that would be lost by
   * walking away from the screen. They are compared through `?? null` because
   * "never chosen" and "chosen nothing" are the same state to a player.
   */
  const coverChanged = saved !== null && (saved.coverCardId ?? null) !== (draft.coverCardId ?? null);
  const cardBackChanged = saved !== null && (saved.cardBackId ?? null) !== (draft.cardBackId ?? null);

  return {
    unsaved: saved === null,
    identical:
      saved !== null && rows.length === 0 && !leaderChanged && !nameChanged && !coverChanged && !cardBackChanged,
    leaderChanged,
    nameChanged,
    coverChanged,
    cardBackChanged,
    beforeLeaderCardId: saved?.leaderCardId ?? null,
    afterLeaderCardId: draft.leaderCardId,
    rows,
    added: rows.reduce((sum, row) => sum + Math.max(0, row.delta), 0),
    removed: rows.reduce((sum, row) => sum + Math.max(0, -row.delta), 0),
    beforeSize: saved?.cards.length ?? 0,
    afterSize: draft.cards.length,
  };
}

// ---------------------------------------------------------------------------
// What a deck is short of
// ---------------------------------------------------------------------------

export interface DeckNeed {
  /** cards short of the deck size */
  short: number;
  /** per cost bucket, how many the target curve still wants */
  curve: Record<number, number>;
  /** the bucket furthest from target, or null when the curve is full */
  worstBucket: number | null;
  /** the Current a pure deck is committed to, or null when it is not pure */
  pureCurrent: string | null;
}

/**
 * What the draft is missing, measured against `TARGET_CURVE`.
 *
 * The same curve `autoBuildDeck` fills and the Gauntlet's pick assist steers
 * toward — imported rather than restated, so a deck the builder recommends and a
 * deck the game builds for you are aiming at the same shape.
 */
export function deckNeeds(content: ContentIndex, deck: DeckList): DeckNeed {
  // the engine's one copy, shared with autoBuildDeck and the Gauntlet's assist
  const curve = curveNeed(content, deck.cards);
  let worstBucket: number | null = null;
  for (const [bucket, gap] of Object.entries(curve)) {
    if (gap > 0 && (worstBucket === null || gap > (curve[worstBucket] ?? 0))) worstBucket = Number(bucket);
  }

  return {
    short: Math.max(0, content.balance.deck.size - deck.cards.length),
    curve,
    worstBucket,
    pureCurrent: purityOf(content, deck),
  };
}

/**
 * Purity, as **the engine** reckons it.
 *
 * This module used to answer the question itself — "one non-Prism Current in the
 * list" — and that answer was wrong in a way no test caught, because it is the
 * *legality* rule rather than the *resonance* rule. `validateDeck` is happy to
 * let a Halo deck splash three Prism; `deckPureCurrent` (`engine/currents.ts`)
 * returns null the moment it sees **any** Prism card, so `advanceResonance` can
 * never fire for that deck. The builder was therefore printing "Pure Halo —
 * Perfect Resonance enabled after 7 Halo cards" over a deck the engine would
 * never grant Resonance to, and paying a `resonance` scoring bonus to chase a
 * mechanic that was already off.
 *
 * So it asks the engine. The only thing added is a tolerance the engine does not
 * need: `deckPureCurrent` throws on an id it does not know, and a *draft* may
 * legitimately hold one — an imported deck code, or a card cut from the build
 * since it was saved. Every other read in this module skips unknown ids rather
 * than exploding, so the deck is filtered to what exists and the rule itself is
 * still asked exactly once, in one place.
 */
function purityOf(content: ContentIndex, deck: DeckList): CurrentId | null {
  const known = deck.cards.filter((cardId) => content.cards[cardId]);
  return deckPureCurrent(content, { ...deck, cards: known });
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

export type SuggestionReason = "curve" | "tag" | "synergy" | "current" | "resonance" | "any";

export interface Suggestion {
  cardId: string;
  name: string;
  cost: number;
  rarity: string;
  /** how many more copies could go in right now */
  copies: number;
  score: number;
  /** the term that dominated the score */
  reason: SuggestionReason;
  /** that term, said in a sentence */
  why: string;
  /** copies you would have to own before this could be added */
  needToOwn: number;
}

interface Scored {
  card: CardDef;
  total: number;
  terms: { reason: SuggestionReason; value: number; why: string }[];
}

/**
 * Score one candidate, and remember what each term contributed.
 *
 * The terms are kept separate rather than blended because the largest one is
 * what the suggestion says out loud — and a suggestion that cannot explain
 * itself is one nobody can act on, or argue with.
 */
function scoreCard(
  content: ContentIndex,
  leader: LeaderCardDef,
  card: CardDef,
  need: DeckNeed,
  payoff: Map<string, number>,
  deckTags: Map<string, number>
): Scored {
  const { weights } = deckToolsData();
  const bucket = curveBucket(card.cost);
  const gap = need.curve[bucket] ?? 0;

  const tagPayoff = card.tags.reduce((sum, tag) => sum + (payoff.get(tag) ?? 0), 0);
  const shared = card.tags.reduce((sum, tag) => sum + (deckTags.get(tag) ?? 0), 0);
  const onCurrent = card.current === leader.primaryCurrent ? 1 : 0;
  const keepsResonance = need.pureCurrent !== null && card.current === need.pureCurrent ? 1 : 0;

  const costLabel = bucket === 7 ? "7 or more" : String(bucket);
  const terms: Scored["terms"] = ([
    { reason: "curve", value: weights.curve * gap, why: `your curve is ${gap} short at ${costLabel} Hype` },
    {
      reason: "tag",
      value: weights.tag * tagPayoff,
      why: `this faction pays off ${card.tags.join(" and ") || "cards like it"}`,
    },
    {
      reason: "synergy",
      value: weights.synergy * shared,
      why: `${shared} card${shared === 1 ? "" : "s"} already in the deck share a tag with it`,
    },
    {
      reason: "current",
      value: weights.current * onCurrent,
      why: `it is ${content.currents[card.current]?.name ?? card.current}, your Primary Current`,
    },
    {
      reason: "resonance",
      value: weights.resonance * keepsResonance,
      why: "it keeps the deck pure, so Perfect Resonance stays reachable",
    },
  ] as Scored["terms"]).filter((term) => term.value > 0);

  return { card, total: terms.reduce((sum, term) => sum + term.value, 0), terms };
}

const tagCensus = (content: ContentIndex, deck: DeckList): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const cardId of deck.cards) {
    for (const tag of content.cards[cardId]?.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return counts;
};

const countOf = (deck: DeckList, cardId: string): number => deck.cards.filter((id) => id === cardId).length;

const problemCounts = (problems: readonly { code: string }[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const problem of problems) counts.set(problem.code, (counts.get(problem.code) ?? 0) + 1);
  return counts;
};

/**
 * Could this card go into the draft right now?
 *
 * Two gates, and **both are somebody else's answer**:
 *
 * 1. Ownership — you have a spare copy, at the copy limit the rules allow.
 * 2. Legality — adding it makes nothing worse by `validateDeck`'s reckoning.
 *
 * The second gate exists because the first is not enough, and finding that out
 * was the whole point of checking. Suggestions originally filtered on ownership
 * alone, which is exactly the mistake this block set out to fix, one level down:
 * `autoCompleteDeck` for **Skree Nine-Tabs** returned a thirty-card deck holding
 * *six Prism cards against a splash limit of three*. Every one of them was owned
 * and under its copy limit; the deck was simply illegal. The old tests missed it
 * because they filled a deck for one leader, and Neon Idols have one Prism card
 * to their name.
 *
 * The comparison is a **delta**, not an absolute. A deck that is already illegal
 * — an imported code, or one whose cards were dismantled — should still be
 * offered help, and demanding a clean bill of health first would leave the
 * player staring at a broken list with an empty suggestions panel. `wrongSize`
 * is exempt: an incomplete deck is the normal state of the thing being helped.
 */
function admissible(content: ContentIndex, deck: DeckList, collection: Collection, card: CardDef): boolean {
  if (playableCopies(content, card, collection[card.id] ?? 0) <= countOf(deck, card.id)) return false;

  const next = { ...deck, cards: [...deck.cards, card.id] };
  const before = problemCounts(validateDeck(content, deck));
  const after = validateDeck(content, next).filter((problem) => problem.code !== "wrongSize");

  // a problem that names this card is this card's fault, however many there were
  if (after.some((problem) => problem.cardId === card.id)) return false;

  const counts = problemCounts(after);
  for (const [code, count] of counts) {
    if (count > (before.get(code) ?? 0)) return false;
  }

  /**
   * The Prism splash needs a clause of its own, and this is why.
   *
   * `tooManyPrism` is **one** problem however far over the limit a deck is — so
   * a deck already holding five Prism against a limit of three still reports
   * exactly one problem after a sixth is added, and a count-based delta lets it
   * through forever. Every other rule `validateDeck` enforces is either per-card
   * (and caught by the `cardId` check above) or all-or-nothing.
   *
   * The limit is read from the same `balance.deck.prismSplashLimit` the engine
   * reads, so this is not a second opinion about the rule — it is the same
   * number, asked a question the problem list cannot answer.
   */
  if (card.current === "prism") {
    const leader = content.leaders[deck.leaderCardId];
    const prismIsHome =
      leader?.primaryCurrent === "prism" || leader?.secondaryCurrent === "prism";
    if (!prismIsHome) {
      const splashed = next.cards.filter((id) => content.cards[id]?.current === "prism").length;
      if (splashed > content.balance.deck.prismSplashLimit) return false;
    }
  }

  return true;
}

const copyLimit = (content: ContentIndex, card: CardDef): number =>
  card.rarity === "legendary" ? content.balance.deck.maxCopiesLegendary : content.balance.deck.maxCopies;

function rank(content: ContentIndex, deck: DeckList, candidates: readonly CardDef[]): Scored[] {
  const leader = content.leaders[deck.leaderCardId];
  if (!leader) return [];
  const need = deckNeeds(content, deck);
  const payoff = payoffTags(content, leader);
  const deckTags = tagCensus(content, deck);

  return candidates
    .map((card) => scoreCard(content, leader, card, need, payoff, deckTags))
    .sort((a, b) => b.total - a.total || (a.card.id < b.card.id ? -1 : 1));
}

const toSuggestion = (entry: Scored, copies: number, needToOwn: number): Suggestion => {
  const best = entry.terms.reduce((top, term) => (term.value > top.value ? term : top), {
    reason: "any" as SuggestionReason,
    value: 0,
    why: "it is legal for this leader",
  });
  return {
    cardId: entry.card.id,
    name: entry.card.name,
    cost: entry.card.cost,
    rarity: entry.card.rarity,
    copies,
    score: Math.round(entry.total * 100) / 100,
    reason: best.reason,
    why: best.why,
    needToOwn,
  };
};

/**
 * What to add next, **from cards the account owns**.
 *
 * `14-ai-design.md` requires the pool be restricted to owned cards, and it is
 * the rule the shipped Auto-Build button broke: it built from every printed card
 * in the game, so a brand-new account could press it and be handed thirty
 * Legendaries it had never seen — a deck the pool beside it would have refused
 * to let that same player assemble one card at a time.
 */
/**
 * Every card that could go in right now, best first — before the display floor.
 *
 * Split out because `minScoreToShow` is a **presentation** rule ("do not clutter
 * the panel with a card that barely helps") and it had leaked into a decision
 * rule. `autoCompleteDeck` asked `suggestCards` for one card, inherited the
 * floor, and stopped short of thirty while the player still owned legal cards
 * that would have fit — then the screen advised them to *"Craft or open Drops
 * for the rest"* for cards already in their collection. A weak card is a fine
 * thirtieth card; it is a bad thing to put at the top of a list of five.
 */
function addable(content: ContentIndex, deck: DeckList, collection: Collection): Scored[] {
  const leader = content.leaders[deck.leaderCardId];
  if (!leader) return [];
  if (content.balance.deck.size - deck.cards.length <= 0) return [];
  return rank(
    content,
    deck,
    legalCardPool(content, leader).filter((card) => admissible(content, deck, collection, card))
  );
}

/**
 * Everything the account could legally add to this draft right now, best first.
 *
 * The panel's `suggestCards` is this with a display floor and a length limit on
 * top. Exported separately because "is there anything left to add?" is a real
 * question with a different answer from "what should I show the player?" — and
 * conflating them is what stopped `autoCompleteDeck` at twenty-nine cards while
 * the player still owned something that fit.
 */
export function addableCards(content: ContentIndex, deck: DeckList, collection: Collection): Suggestion[] {
  return addable(content, deck, collection).map((entry) =>
    toSuggestion(
      entry,
      playableCopies(content, entry.card, collection[entry.card.id] ?? 0) - countOf(deck, entry.card.id),
      0
    )
  );
}

export function suggestCards(
  content: ContentIndex,
  deck: DeckList,
  collection: Collection,
  limit = deckToolsData().suggestions.show
): Suggestion[] {
  return addable(content, deck, collection)
    .filter((entry) => entry.total >= deckToolsData().suggestions.minScoreToShow)
    .slice(0, limit)
    .map((entry) =>
      toSuggestion(
        entry,
        playableCopies(content, entry.card, collection[entry.card.id] ?? 0) - countOf(deck, entry.card.id),
        0
      )
    );
}

/**
 * What it would have suggested if you owned it — §14's *"reports which suggested
 * cards the player is missing"*.
 *
 * A short list on purpose. It is a reason to visit the crafting workshop, not a
 * shopping list as long as the card pool.
 */
export function craftTargets(
  content: ContentIndex,
  deck: DeckList,
  collection: Collection,
  limit = deckToolsData().suggestions.craftTargets
): Suggestion[] {
  const leader = content.leaders[deck.leaderCardId];
  if (!leader) return [];
  // a full deck has nothing to add, so it has nothing worth crafting either —
  // the same guard `suggestCards` has, and its absence here meant a complete,
  // legal 30/30 deck still displayed a "Worth crafting" list
  if (content.balance.deck.size - deck.cards.length <= 0) return [];

  const candidates = legalCardPool(content, leader).filter((card) => {
    const owned = collection[card.id] ?? 0;
    // it cannot be added, and owning more would change that
    const blockedByOwnership =
      playableCopies(content, card, owned) <= countOf(deck, card.id) && owned < copyLimit(content, card);
    if (!blockedByOwnership) return false;

    /**
     * And crafting it would actually let you play it.
     *
     * Ownership is not the only thing that can refuse a card, so "you cannot add
     * this, and owning more would fix that" is only half the test. A deck at the
     * three-Prism splash limit was being told to craft a fourth Prism card —
     * money spent on a card the deck could still never legally hold. Asked with
     * a hypothetical collection, because the real one is precisely what the row
     * is proposing to change.
     */
    return admissible(content, deck, { ...collection, [card.id]: copyLimit(content, card) }, card);
  });

  return rank(content, deck, candidates)
    .filter((entry) => entry.total >= deckToolsData().suggestions.minScoreToShow)
    .slice(0, limit)
    .map((entry) => toSuggestion(entry, 0, (collection[entry.card.id] ?? 0) + 1));
}

// ---------------------------------------------------------------------------
// Replacements for cards you cannot run
// ---------------------------------------------------------------------------

export interface Replacement {
  cardId: string;
  name: string;
  /** copies in the list the account cannot legally field */
  excess: number;
  /** the closest owned substitute, or null when there is nothing to offer */
  with: Suggestion | null;
}

/**
 * Every card in the list the account cannot actually field, with a substitute.
 *
 * This happens for real: a deck code imported from somebody else, or a deck
 * saved before its cards were dismantled. Without it the builder shows a
 * thirty-card list that validates perfectly and that this account cannot field,
 * and nothing anywhere says which card is the problem.
 *
 * A replacement scores on the same terms as a suggestion **plus a large bonus
 * for landing in the same cost bucket**, because a replacement that changes the
 * curve is not a replacement.
 */
export function replacementsFor(content: ContentIndex, deck: DeckList, collection: Collection): Replacement[] {
  const leader = content.leaders[deck.leaderCardId];
  if (!leader) return [];
  const { sameCostBonus, adjacentCostBonus } = deckToolsData().replacements;

  const counts = new Map<string, number>();
  for (const cardId of deck.cards) counts.set(cardId, (counts.get(cardId) ?? 0) + 1);

  const out: Replacement[] = [];
  for (const [cardId, inDeck] of counts) {
    const card = content.cards[cardId];
    if (!card) continue;
    if (playableCopies(content, card, collection[cardId] ?? 0) >= inDeck) continue;

    const alternatives = legalCardPool(content, leader).filter(
      (other) => other.id !== cardId && admissible(content, deck, collection, other)
    );

    const best = rank(content, deck, alternatives)
      .map((entry) => {
        const distance = Math.abs(curveBucket(entry.card.cost) - curveBucket(card.cost));
        return { ...entry, total: entry.total + (distance === 0 ? sameCostBonus : distance === 1 ? adjacentCostBonus : 0) };
      })
      .sort((a, b) => b.total - a.total || (a.card.id < b.card.id ? -1 : 1))[0];

    out.push({
      cardId,
      name: card.name,
      excess: inDeck - playableCopies(content, card, collection[cardId] ?? 0),
      with: best
        ? toSuggestion(
            best,
            playableCopies(content, best.card, collection[best.card.id] ?? 0) - countOf(deck, best.card.id),
            0
          )
        : null,
    });
  }

  return out.sort((a, b) => (a.name < b.name ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Auto-complete, and build-around
// ---------------------------------------------------------------------------

/**
 * Fill the draft to a legal size **from the collection**, keeping what is there.
 *
 * The replacement for the Auto-Build button, and different in three ways that
 * matter: it never adds a card you do not own, it never throws away what you
 * have already chosen, and it stops honestly short rather than inventing cards
 * when the collection cannot fill thirty.
 */
export function autoCompleteDeck(content: ContentIndex, deck: DeckList, collection: Collection): DeckList {
  const filled: DeckList = { ...deck, cards: [...deck.cards] };
  const size = content.balance.deck.size;

  /**
   * One at a time, re-ranking each pass: the curve and the tag census both move
   * with every card added, and a batch would ignore its own effect.
   *
   * `addable` rather than `suggestCards`, so the panel's display floor cannot
   * decide the deck's size — see `addable`.
   */
  for (let guard = 0; filled.cards.length < size && guard < size * 2; guard++) {
    const next = addable(content, filled, collection)[0];
    if (!next) break;
    filled.cards.push(next.card.id);
  }
  return filled;
}

/**
 * §4.3.2's *"build around this card"*.
 *
 * Picks the leader whose legal pool both contains the card and pays its tags off
 * hardest, seeds the deck with every copy the account owns, and completes from
 * the collection.
 *
 * Returns null when no selectable leader can legally run the card, **and when
 * the account owns none of it**. The second case was a bug for one revision:
 * the seed was `Math.max(1, playableCopies(...))`, so building around a card you
 * did not own put an uncollected copy in the list — which is precisely the
 * failure this whole module exists to stop, reintroduced one corner over. The
 * pool only offers the control on a card you own, and this refuses it anyway,
 * because a rule enforced in one place is a rule waiting to be walked around.
 */
export function buildAround(
  content: ContentIndex,
  cardId: string,
  collection: Collection,
  name = "Built around"
): DeckList | null {
  const card = content.cards[cardId];
  if (!card || card.token || card.type === "leader" || card.variantOf) return null;
  const seed = playableCopies(content, card, collection[cardId] ?? 0);
  if (seed <= 0) return null;

  const chosen = selectableLeaders(content)
    .filter((leader) => legalCardPool(content, leader).some((entry) => entry.id === cardId))
    .map((leader) => {
      const payoff = payoffTags(content, leader);
      return { leader, payoff: card.tags.reduce((sum, tag) => sum + (payoff.get(tag) ?? 0), 0) };
    })
    .sort((a, b) => b.payoff - a.payoff || (a.leader.id < b.leader.id ? -1 : 1))[0]?.leader;

  if (!chosen) return null;

  const seeded: DeckList = {
    name: `${name}: ${card.name}`,
    leaderCardId: chosen.id,
    cards: new Array(seed).fill(cardId),
  };
  return autoCompleteDeck(content, seeded, collection);
}

// ---------------------------------------------------------------------------
// Check
// ---------------------------------------------------------------------------

/** Everything wrong with `data/deck-tools.json`. */
export function checkDeckToolsData(): string[] {
  const problems: string[] = [];
  const data = deckToolsData();

  for (const [name, weight] of Object.entries(data.weights)) {
    if (typeof weight === "number" && weight < 0) problems.push(`weights.${name} is negative`);
  }
  if (data.weights.curve <= 0) problems.push("weights.curve is zero, so a half-built deck gets no curve help at all");
  if (data.suggestions.show <= 0) problems.push("suggestions.show is zero, so the panel would never offer anything");
  if (data.replacements.sameCostBonus < data.replacements.adjacentCostBonus) {
    problems.push("replacements: an adjacent-cost swap outranks a same-cost one, which is not a replacement");
  }
  return problems;
}

// ---------------------------------------------------------------------------
// The Current split — §4.3.2's donut and its verdict line
// ---------------------------------------------------------------------------

export interface CurrentSlice {
  current: string;
  name: string;
  count: number;
  /** share of the non-Prism cards, 0..1, for the donut */
  share: number;
}

export interface CurrentSplit {
  slices: CurrentSlice[];
  prism: number;
  /** the Current a pure deck is committed to, or null */
  pureCurrent: string | null;
  /** the Confluence a two-Current deck unlocks, or null */
  confluenceId: string | null;
  /**
   * §4.3.2's own wording: *"Pure Halo — Perfect Resonance enabled"* /
   * *"Halo+Pulse — Confluence: …"*. One sentence, and it is the reason the donut
   * is worth drawing at all — the picture says what the split *is*, and this says
   * what it **means**.
   */
  verdict: string;
}

/**
 * What Currents the draft is made of, and what that buys.
 *
 * Prism is counted separately from the **slices**, because it is the splash: a
 * deck of twenty-seven Halo and three Prism is a Halo deck with a splash, not a
 * two-Current deck, and that is how `validateDeck` counts it.
 *
 * It is emphatically **not** separated from the **purity** question, and the
 * belief that it was is where this function went wrong. Legality and Resonance
 * are two different rules: a splash is legal, and it still breaks purity. See
 * `purityOf` — the engine gets the last word on which.
 */
export function currentSplit(content: ContentIndex, deck: DeckList): CurrentSplit {
  const counts = new Map<string, number>();
  let prism = 0;
  for (const cardId of deck.cards) {
    const card = content.cards[cardId];
    if (!card) continue;
    if (card.current === "prism") prism += 1;
    else counts.set(card.current, (counts.get(card.current) ?? 0) + 1);
  }

  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const slices: CurrentSlice[] = [...counts.entries()]
    .map(([current, count]) => ({
      current,
      name: content.currents[current as CurrentId]?.name ?? current,
      count,
      share: total > 0 ? count / total : 0,
    }))
    .sort((a, b) => b.count - a.count || (a.current < b.current ? -1 : 1));

  const pureCurrent = purityOf(content, deck);

  /**
   * The Confluence a two-Current deck unlocks, found by asking the content
   * index rather than by pairing names. A Confluence is defined by its pair, and
   * two Currents that happen to be in a deck may not have one.
   */
  let confluenceId: string | null = null;
  if (slices.length === 2) {
    const pair = new Set([slices[0]!.current, slices[1]!.current]);
    for (const definition of Object.values(content.confluences)) {
      // Refraction has no pair — it is Prism plus anything — so it is skipped
      // rather than matched. `currents: null` is how the data says so.
      if (!definition.currents) continue;
      const [a, b] = definition.currents;
      if (pair.has(a) && pair.has(b)) {
        confluenceId = definition.id;
        break;
      }
    }
  }

  /**
   * The sentence, and the trade it has to be honest about.
   *
   * A Prism splash is not free and it is not fatal — it is an **exchange**, and
   * for a long time this line reported only the half that flattered the deck.
   * Any Prism card costs Perfect Resonance outright (`deckPureCurrent` returns
   * null on sight of one). In return, Prism plus any other Current played in the
   * same turn opens **Refraction** (`availableConfluences`). Both halves are
   * stated, because a player who splashes three Prism without being told has
   * silently given up the pure-deck payoff for a Confluence nobody mentioned.
   *
   * The Prism count used to be appended by a clause guarded on `leader &&` — a
   * lookup this function otherwise never used — so a deck whose leader id had
   * fallen out of the build lost the splash sentence for no reason at all.
   */
  const threshold = content.balance.resonance.threshold;
  const splash = prism > 0 ? ` ${prism} Prism` : "";
  let verdict: string;
  if (slices.length === 0) {
    verdict =
      prism > 0
        ? `${prism} Prism and nothing else — Prism cards never count toward Perfect Resonance, and Refraction needs a second Current to pair with.`
        : "No cards yet.";
  } else if (pureCurrent) {
    const name = slices[0]!.name;
    verdict =
      total >= threshold
        ? `Pure ${name} — Perfect Resonance enabled after ${threshold} ${name} cards.`
        : `Pure ${name} — ${threshold - total} more ${name} card${threshold - total === 1 ? "" : "s"} for Perfect Resonance.`;
  } else if (slices.length === 1) {
    // one Current and a splash: legal, but no longer pure
    verdict = `${slices[0]!.name} with${splash} — the splash trades Perfect Resonance for Refraction.`;
  } else if (slices.length === 2) {
    const pair = `${slices[0]!.name}+${slices[1]!.name}`;
    const named = confluenceId
      ? `${pair} — Confluence: ${content.confluences[confluenceId as ConfluenceId]?.name ?? confluenceId}.`
      : `${pair} — no Confluence for that pair, and no Perfect Resonance.`;
    verdict = prism > 0 ? `${named}${splash} splashed, which also opens Refraction.` : named;
  } else {
    verdict = `${slices.length} Currents — a Leader allows two, so this will not validate.`;
    if (prism > 0) verdict += `${splash} splashed.`;
  }

  return { slices, prism, pureCurrent, confluenceId, verdict };
}

// ---------------------------------------------------------------------------
// Cover art
// ---------------------------------------------------------------------------

/**
 * The cards a deck may use as its cover.
 *
 * Only cards actually in the list. A cover is meant to be the deck's face, and
 * choosing one you cut two edits ago would leave a picture of a card the deck
 * does not contain — which is exactly the kind of quiet inconsistency the
 * `coverCardId` field has been sitting unused long enough to acquire.
 */
export function coverOptions(content: ContentIndex, deck: DeckList): CardDef[] {
  const seen = new Set<string>();
  const out: CardDef[] = [];
  for (const cardId of deck.cards) {
    if (seen.has(cardId)) continue;
    seen.add(cardId);
    const card = content.cards[cardId];
    if (card) out.push(card);
  }
  return out.sort((a, b) => b.cost - a.cost || (a.name < b.name ? -1 : 1));
}

/** The cover a deck should show: its pick, else its costliest card, else null. */
export function coverCard(content: ContentIndex, deck: DeckList): CardDef | null {
  const chosen = deck.coverCardId ? content.cards[deck.coverCardId] : undefined;
  if (chosen && deck.cards.includes(chosen.id)) return chosen;
  return coverOptions(content, deck)[0] ?? null;
}

// ---------------------------------------------------------------------------
// Per-deck record — §4.3.2's stats tab
// ---------------------------------------------------------------------------

export interface DeckRecord {
  played: number;
  won: number;
  lost: number;
  drawn: number;
  /** 0..1 */
  winRate: number;
  /** true when the sample is too small to mean anything */
  thin: boolean;
  averageTurns: number;
}

/**
 * A deck's record, from local match history.
 *
 * Keyed by **name**, because that is what `recordMatch` stamps on a history
 * entry — there is no deck id in this game. So renaming a deck starts its record
 * over, and two decks sharing a name share a record. Both are stated on the
 * screen rather than hidden, because the alternative is a win rate that is
 * quietly about a different deck.
 *
 * `thin` comes straight from the dashboard's own `MIN_SAMPLE` rule, so a record
 * of three games says so instead of reporting 33%.
 */
export function deckRecord(
  content: ContentIndex,
  history: readonly MatchHistoryEntry[],
  deckName: string
): DeckRecord {
  const row = buildDashboard(content, history).byDeck.find((entry) => entry.id === deckName);
  if (!row) return { played: 0, won: 0, lost: 0, drawn: 0, winRate: 0, thin: true, averageTurns: 0 };
  return {
    played: row.played,
    won: row.won,
    lost: row.lost,
    drawn: row.drawn,
    winRate: row.winRate,
    thin: row.thin,
    averageTurns: row.averageTurns,
  };
}
