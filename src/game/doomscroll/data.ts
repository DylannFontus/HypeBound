/**
 * Doomscroll content: `data/roguelike.json`, parsed and cross-checked.
 *
 * Same contract as card and encounter data — the file is the content, this is
 * only the schema and the referential checks. The shape checks catch typos; the
 * referential ones catch the failures that actually happen, like an act naming
 * an enemy leader that was renamed three commits ago, or a starting deck listing
 * a token. Both would parse fine and then blow up mid-run, several minutes of
 * play after the mistake was made.
 */

import { z } from "zod";
import type { AiDifficulty, CardPatch, ContentIndex } from "../../engine/types";
import { collectibleCards, resolveMatchContent } from "../../engine/content";
import { zCardPatch } from "../../engine/validation";
import raw from "../../../data/roguelike.json";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/**
 * What an artifact does, as data.
 *
 * Every kind here is resolved by the run itself — health, prices, rewards. None
 * of them reach into a match, which is exactly why they can all be built today;
 * see the `_artifactComment` in the data file for the ones that cannot.
 */
export type ArtifactEffect =
  /**
   * A patch applied to the run leader's card for every battle this run.
   *
   * This is the one kind that reaches into a match, and it can only exist
   * because `MatchConfig.cardOverrides` is per-card: the run leader belongs to
   * exactly one seat, so patching it changes the battle for the player alone.
   * A balance override could not — "your Fixation costs 2" would discount the
   * opponent's too.
   */
  | { kind: "battlePatch"; patch: CardPatch }
  | { kind: "maxHealth"; amount: number }
  | { kind: "healAfterVictory"; amount: number }
  | { kind: "shopDiscountPercent"; amount: number }
  | { kind: "cheatDeathOnce" }
  | { kind: "bonusBattleClout"; amount: number }
  | { kind: "bonusRestHeal"; amount: number }
  | { kind: "fixedRemovalPrice" }
  | { kind: "extraCardChoice"; amount: number };

export type ArtifactEffectKind = ArtifactEffect["kind"];

export interface ArtifactDef {
  id: string;
  name: string;
  text: string;
  effect: ArtifactEffect;
}

/** What choosing an event option does. Applied in array order. */
export type EventOutcome =
  | { kind: "heal"; amount: number }
  | { kind: "damage"; amount: number }
  | { kind: "clout"; amount: number }
  | { kind: "maxHealth"; amount: number }
  | { kind: "gainArtifact" }
  | { kind: "gainCard" }
  | { kind: "removeCard" }
  | { kind: "upgradeCard" };

export interface EventChoiceDef {
  label: string;
  detail: string;
  outcomes: EventOutcome[];
}

export interface EventDef {
  id: string;
  title: string;
  text: string;
  choices: EventChoiceDef[];
}

/** Node kinds a floor can hold. `boss` and `treasure` are placed, not rolled. */
export const NODE_KINDS = ["battle", "elite", "event", "shop", "rest", "recruit", "treasure", "boss"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

/** The kinds the weight table rolls between; the rest are placed by the plan. */
export const ROLLED_NODE_KINDS = ["battle", "elite", "event", "shop", "rest", "recruit"] as const;
export type RolledNodeKind = (typeof ROLLED_NODE_KINDS)[number];

export interface ActBossDef {
  leaderCardId: string;
  deckLeaderCardId: string;
  name: string;
  twistName: string;
  twistText: string;
}

export interface ActDef {
  id: string;
  name: string;
  blurb: string;
  /**
   * Signal Fragments needed to enter this act at all.
   *
   * The true finale is optional by design: you earn it by beating an Elite in
   * each earlier act, which costs you the harder fight rather than a currency.
   * Held in data rather than code so "which act is the optional one" stays an
   * authoring decision.
   */
  requiresFragments?: number;
  /** one entry per floor: a forced node kind, or null to roll from `weights` */
  floorPlan: (RolledNodeKind | "boss" | null)[];
  /** floors one of which is converted to the act's single Sponsor Drop */
  treasureFloors: number[];
  /** nodes per floor */
  widths: number[];
  weights: Record<RolledNodeKind, number>;
  enemyLeaders: string[];
  difficulty: { battle: AiDifficulty; elite: AiDifficulty; boss: AiDifficulty };
  eliteBonusHealth: number;
  bossBonusHealth: number;
  boss: ActBossDef;
}

export interface RunLeaderDef {
  leaderCardId: string;
  name: string;
  blurb: string;
  deckName: string;
  deck: string[];
}

export interface RoguelikeData {
  version: number;
  run: {
    startingHealth: number;
    cloutConversion: number;
    cardRewardChoices: number;
    recruitChoices: number;
    artifactRewardChoices: number;
  };
  shop: {
    cardPrice: Record<string, number>;
    cardsOffered: number;
    removalPrice: number;
    removalIncrement: number;
    artifactPrice: number;
    upgradePrice: number;
  };
  rest: { heal: number };
  treasure: { clout: number };
  rewards: { battle: { clout: number }; elite: { clout: number }; boss: { clout: number } };
  leaders: RunLeaderDef[];
  acts: ActDef[];
  artifacts: ArtifactDef[];
  recruits: string[];
  events: EventDef[];
  /**
   * Hand-authored "Remastered" upgrades, by card id. Everything not listed here
   * takes the default from `upgradeFor` below.
   */
  upgrades: Record<string, CardPatch>;
}

/** Suffix appended to a card id to name its upgraded copy. */
export const REMASTERED = "-remastered";

export const remasteredIdOf = (cardId: string): string => `${cardId}${REMASTERED}`;
export const isRemasteredId = (cardId: string): boolean => cardId.endsWith(REMASTERED);
export const baseIdOf = (cardId: string): string =>
  isRemasteredId(cardId) ? cardId.slice(0, -REMASTERED.length) : cardId;

/**
 * Every card a run could end up holding.
 *
 * The reward pool, the shop, the recruits and the starting decks all draw from
 * the collectible set, so upgrading is checked against all of it rather than
 * against the cards this particular run happens to have seen.
 */
export function upgradableCardIds(content: ContentIndex): string[] {
  return collectibleCards(content).map((card) => card.id);
}

/**
 * What "Remastered" does to a card.
 *
 * The design asks for one authored upgrade per card. Authoring 195 of them up
 * front is how a feature ships with a half-empty table and cards that silently
 * upgrade into themselves, so this is a stated default with a per-card override:
 * characters get +1/+1, everything else costs (1) less. Both are real changes on
 * every card they apply to, and `parseRoguelikeData` proves that at load rather
 * than trusting it — a card whose upgrade would change nothing is a validation
 * error, not a disappointment discovered mid-run.
 */
export function upgradeFor(data: RoguelikeData, content: ContentIndex, cardId: string): CardPatch | null {
  const authored = data.upgrades[cardId];
  if (authored) return authored;
  const card = content.cards[cardId];
  if (!card) return null;
  if (card.type === "character") return { attack: 1, health: 1 };
  return card.cost > 0 ? { cost: -1 } : null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const AI_DIFFICULTIES = ["beginner", "casual", "intermediate", "advanced", "expert", "boss"] as const;
const zDifficulty = z.enum(AI_DIFFICULTIES);
const nonNegative = z.number().int().min(0);
const positive = z.number().int().positive();

const zArtifactEffect = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("battlePatch"), patch: zCardPatch }).strict(),
  z.object({ kind: z.literal("maxHealth"), amount: positive }).strict(),
  z.object({ kind: z.literal("healAfterVictory"), amount: positive }).strict(),
  z.object({ kind: z.literal("shopDiscountPercent"), amount: z.number().int().min(1).max(90) }).strict(),
  z.object({ kind: z.literal("cheatDeathOnce") }).strict(),
  z.object({ kind: z.literal("bonusBattleClout"), amount: positive }).strict(),
  z.object({ kind: z.literal("bonusRestHeal"), amount: positive }).strict(),
  z.object({ kind: z.literal("fixedRemovalPrice") }).strict(),
  z.object({ kind: z.literal("extraCardChoice"), amount: positive }).strict(),
]);

const zOutcome = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("heal"), amount: positive }).strict(),
  z.object({ kind: z.literal("damage"), amount: positive }).strict(),
  // the only signed one: an event may cost you run-Clout
  z.object({ kind: z.literal("clout"), amount: z.number().int() }).strict(),
  z.object({ kind: z.literal("maxHealth"), amount: positive }).strict(),
  z.object({ kind: z.literal("gainArtifact") }).strict(),
  z.object({ kind: z.literal("gainCard") }).strict(),
  z.object({ kind: z.literal("removeCard") }).strict(),
  z.object({ kind: z.literal("upgradeCard") }).strict(),
]);

const zAct = z
  .object({
    id: z.string(),
    name: z.string(),
    blurb: z.string(),
    requiresFragments: positive.optional(),
    floorPlan: z.array(z.union([z.enum(ROLLED_NODE_KINDS), z.literal("boss"), z.null()])),
    treasureFloors: z.array(nonNegative),
    widths: z.array(positive),
    weights: z.object({
      battle: nonNegative,
      elite: nonNegative,
      event: nonNegative,
      shop: nonNegative,
      rest: nonNegative,
      recruit: nonNegative,
    }).strict(),
    // may be empty: an act that is a single boss fight has nothing to draw from.
    // A cross-check below insists on a pool for any act that rolls floors.
    enemyLeaders: z.array(z.string()),
    difficulty: z.object({ battle: zDifficulty, elite: zDifficulty, boss: zDifficulty }).strict(),
    eliteBonusHealth: nonNegative,
    bossBonusHealth: nonNegative,
    boss: z
      .object({
        leaderCardId: z.string(),
        deckLeaderCardId: z.string(),
        name: z.string(),
        twistName: z.string(),
        twistText: z.string(),
      })
      .strict(),
  })
  .strict();

const zData = z
  .object({
    version: positive,
    run: z
      .object({
        startingHealth: positive,
        cloutConversion: positive,
        cardRewardChoices: positive,
        recruitChoices: positive,
        artifactRewardChoices: positive,
      })
      .strict(),
    shop: z
      .object({
        cardPrice: z.record(z.string(), nonNegative),
        cardsOffered: positive,
        removalPrice: nonNegative,
        removalIncrement: nonNegative,
        artifactPrice: nonNegative,
        upgradePrice: nonNegative,
      })
      .strict(),
    rest: z.object({ heal: positive }).strict(),
    treasure: z.object({ clout: nonNegative }).strict(),
    rewards: z
      .object({
        battle: z.object({ clout: nonNegative }).strict(),
        elite: z.object({ clout: nonNegative }).strict(),
        boss: z.object({ clout: nonNegative }).strict(),
      })
      .strict(),
    leaders: z
      .array(
        z
          .object({
            leaderCardId: z.string(),
            name: z.string(),
            blurb: z.string(),
            deckName: z.string(),
            deck: z.array(z.string()).min(1),
          })
          .strict()
      )
      .min(1),
    acts: z.array(zAct).min(1),
    artifacts: z
      .array(z.object({ id: z.string(), name: z.string(), text: z.string(), effect: zArtifactEffect }).strict())
      .min(1),
    recruits: z.array(z.string()).min(1),
    // absent is fine: every card then takes the default from `upgradeFor`
    upgrades: z.record(z.string(), zCardPatch).default({}),
    events: z
      .array(
        z
          .object({
            id: z.string(),
            title: z.string(),
            text: z.string(),
            choices: z
              .array(z.object({ label: z.string(), detail: z.string(), outcomes: z.array(zOutcome).min(1) }).strict())
              .min(2),
          })
          .strict()
      )
      .min(1),
  })
  .strict();

export class RoguelikeDataError extends Error {}

/**
 * Drop `_`-prefixed keys before validating.
 *
 * The schemas are `.strict()` on purpose — an unknown key is nearly always a
 * typo'd one — but the data file carries long design notes explaining *why* its
 * numbers are what they are, and those notes belong next to the numbers rather
 * than in a doc nobody opens while editing. This is the same convention the
 * currents/factions loader uses.
 */
function stripComments(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripComments);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key.startsWith("_")) continue;
      out[key] = stripComments(child);
    }
    return out;
  }
  return value;
}

/** Parse and cross-check the roguelike data against real content. */
export function parseRoguelikeData(input: unknown, content: ContentIndex): RoguelikeData {
  const parsed = zData.safeParse(stripComments(input));
  if (!parsed.success) {
    throw new RoguelikeDataError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  const data = parsed.data as RoguelikeData;
  const errors: string[] = [];

  const knownLeader = (id: string): boolean => content.leaders[id] !== undefined;

  // --- leaders and their starting decks ------------------------------------
  const seenLeaders = new Set<string>();
  for (const leader of data.leaders) {
    if (!knownLeader(leader.leaderCardId)) {
      errors.push(`leader ${leader.leaderCardId}: not a leader card`);
    } else if (content.leaders[leader.leaderCardId]!.token) {
      // a scripted-encounter leader must never be a run leader — the boss cards
      // and the tutorial bot live in the same index
      errors.push(`leader ${leader.leaderCardId}: is a token leader and cannot be chosen for a run`);
    }
    if (seenLeaders.has(leader.leaderCardId)) errors.push(`duplicate run leader ${leader.leaderCardId}`);
    seenLeaders.add(leader.leaderCardId);

    for (const cardId of leader.deck) {
      const card = content.cards[cardId];
      if (!card) errors.push(`leader ${leader.leaderCardId}: unknown starting-deck card ${cardId}`);
      else if (card.token) errors.push(`leader ${leader.leaderCardId}: ${cardId} is a token and cannot be dealt`);
      else if (card.type === "leader") errors.push(`leader ${leader.leaderCardId}: ${cardId} is a leader card`);
    }
  }

  // --- acts -----------------------------------------------------------------
  const seenActs = new Set<string>();
  for (const act of data.acts) {
    const where = `act ${act.id}`;
    if (seenActs.has(act.id)) errors.push(`duplicate act id ${act.id}`);
    seenActs.add(act.id);

    if (act.floorPlan.length !== act.widths.length) {
      errors.push(`${where}: floorPlan has ${act.floorPlan.length} floors but widths has ${act.widths.length}`);
    }
    const lastFloor = act.floorPlan.length - 1;
    if (act.floorPlan[lastFloor] !== "boss") {
      errors.push(`${where}: the last floor must be the boss, or the act can never end`);
    }
    if (act.widths[lastFloor] !== 1) {
      errors.push(`${where}: the boss floor must have exactly one node (has ${act.widths[lastFloor]})`);
    }
    for (let floor = 0; floor < lastFloor; floor++) {
      if (act.floorPlan[floor] === "boss") errors.push(`${where}: floor ${floor} is a second boss floor`);
    }
    /**
     * An act with no rolled floors is a single scripted fight — the optional
     * finale — and has no map to put a Sponsor Drop on or enemies to draw from.
     * Both rules below therefore key off "does this act roll anything", instead
     * of assuming every act walks seven floors.
     */
    const rollsFloors = act.floorPlan.some((f) => f === null);

    /**
     * A Sponsor Drop replaces a rolled node, so its floor has to be a rolled
     * one. Pointing it at a fixed floor would silently overwrite that floor's
     * whole purpose — the pre-boss Touch Grass Break, most damagingly.
     */
    if (rollsFloors && act.treasureFloors.length === 0) {
      errors.push(`${where}: no treasureFloors, so the act has no Sponsor Drop`);
    }
    if (!rollsFloors && act.treasureFloors.length > 0) {
      errors.push(`${where}: treasureFloors on an act with no rolled floors — there is nothing to replace`);
    }
    for (const floor of act.treasureFloors) {
      if (floor < 0 || floor > lastFloor) errors.push(`${where}: treasure floor ${floor} is outside the map`);
      else if (act.floorPlan[floor] !== null) {
        errors.push(`${where}: treasure floor ${floor} is a fixed "${act.floorPlan[floor]}" floor`);
      }
    }
    const weightTotal = Object.values(act.weights).reduce((sum, w) => sum + w, 0);
    if (weightTotal <= 0 && rollsFloors) {
      errors.push(`${where}: every node weight is 0, so a rolled floor cannot be filled`);
    }

    /**
     * Battles and Elites draw their opponent from this pool, so an act that can
     * roll one needs a pool — otherwise the run walks onto a fight node and finds
     * nothing to fight.
     */
    const rollsFights = rollsFloors || act.floorPlan.some((f) => f === "battle" || f === "elite");
    if (rollsFights && act.enemyLeaders.length === 0) {
      errors.push(`${where}: rolls fight nodes but has no enemy leaders to fill them`);
    }
    for (const id of act.enemyLeaders) {
      if (!knownLeader(id)) errors.push(`${where}: unknown enemy leader ${id}`);
      else if (content.leaders[id]!.token) errors.push(`${where}: enemy leader ${id} is a token leader`);
    }
    if (!knownLeader(act.boss.leaderCardId)) errors.push(`${where}: unknown boss leader ${act.boss.leaderCardId}`);
    if (!knownLeader(act.boss.deckLeaderCardId)) {
      errors.push(`${where}: unknown boss deck leader ${act.boss.deckLeaderCardId}`);
    } else if (content.leaders[act.boss.deckLeaderCardId]!.token) {
      // the boss's DECK is built with autoBuildDeck, which needs a real card pool
      errors.push(`${where}: boss deck leader ${act.boss.deckLeaderCardId} is a token leader with no legal pool`);
    }
    /**
     * A boss whose twist exists only in its blurb reads as a shipped boss and
     * plays as a normal opponent. The twist IS the leader's passive, so an empty
     * one means the fight does not do what the map promised.
     */
    const bossLeader = content.leaders[act.boss.leaderCardId];
    if (bossLeader && bossLeader.passive.length === 0) {
      errors.push(`${where}: boss ${act.boss.leaderCardId} has no passive, so its twist "${act.boss.twistName}" does nothing`);
    }
  }

  /**
   * A fragment gate has to be reachable.
   *
   * Fragments come one per act, from that act's first Elite, so an act asking
   * for more of them than there are Elite-bearing acts in front of it can never
   * be entered — and it would fail silently, as a finale nobody ever sees rather
   * than as an error. `map.ts` also guarantees one Elite per act that weights
   * them, which is what makes "acts in front of it" the right count.
   */
  data.acts.forEach((act, index) => {
    if (act.requiresFragments === undefined) return;
    const suppliers = data.acts.slice(0, index).filter((earlier) => earlier.weights.elite > 0).length;
    if (act.requiresFragments > suppliers) {
      errors.push(
        `act ${act.id}: needs ${act.requiresFragments} Signal Fragments but only ${suppliers} earlier act(s) can award one, so it can never be entered`
      );
    }
  });

  // --- artifacts, recruits, events ------------------------------------------
  const seenArtifacts = new Set<string>();
  for (const artifact of data.artifacts) {
    if (seenArtifacts.has(artifact.id)) errors.push(`duplicate artifact id ${artifact.id}`);
    seenArtifacts.add(artifact.id);

    /**
     * A battle artifact is applied to whichever leader the player picked, so it
     * has to be legal against every one of them. Actually resolving it here is
     * the only check worth having: the patch could name a keyword that needs a
     * companion field, or push a stat out of the schema's range, and either way
     * the first sign would be a run dying at its first fight rather than an
     * error anyone can read.
     */
    if (artifact.effect.kind === "battlePatch") {
      for (const leader of data.leaders) {
        try {
          resolveMatchContent(content, undefined, { [leader.leaderCardId]: artifact.effect.patch });
        } catch (error) {
          errors.push(
            `artifact ${artifact.id}: cannot be applied to ${leader.leaderCardId} — ` +
              `${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }
  }

  for (const cardId of data.recruits) {
    const card = content.cards[cardId];
    if (!card) errors.push(`recruit ${cardId}: unknown card`);
    else if (card.token) errors.push(`recruit ${cardId}: is a token`);
    else if (card.type !== "character") errors.push(`recruit ${cardId}: recruits are characters (this is a ${card.type})`);
  }

  const seenEvents = new Set<string>();
  for (const event of data.events) {
    if (seenEvents.has(event.id)) errors.push(`duplicate event id ${event.id}`);
    seenEvents.add(event.id);
  }

  // --- shop pricing must cover every rarity it can be asked about -----------
  for (const rarity of ["common", "rare", "epic", "legendary"]) {
    if (data.shop.cardPrice[rarity] === undefined) errors.push(`shop.cardPrice is missing "${rarity}"`);
  }

  /**
   * Every card a run can hold must have an upgrade that does something.
   *
   * Two failures to catch, and both of them are quiet. An authored patch might
   * not apply at all — "+1/+1" on an Action — and would be refused at match
   * start, killing a run at its next fight rather than at load. And the default
   * rule has a hole: "cost −1" on a card that already costs 0 is a legal patch
   * that changes nothing, so the player would spend a Rest node or 75 Clout and
   * get a card back identical to the one they put in.
   *
   * Checked by actually building the variant, which is the same path a battle
   * takes, so a patch that survives this cannot fail in a fight.
   */
  for (const cardId of upgradableCardIds(content)) {
    const patch = upgradeFor(data, content, cardId);
    if (!patch) {
      errors.push(`upgrade for ${cardId}: nothing to upgrade — a 0-cost non-character needs an authored patch`);
      continue;
    }
    const variantId = remasteredIdOf(cardId);
    try {
      const resolved = resolveMatchContent(content, undefined, { [variantId]: patch }, { [variantId]: cardId });
      const before = content.cards[cardId]!;
      const after = resolved.cards[variantId]!;
      if (JSON.stringify({ ...after, id: cardId, variantOf: null }) === JSON.stringify({ ...before, variantOf: null })) {
        errors.push(`upgrade for ${cardId}: applies cleanly but changes nothing`);
      }
    } catch (error) {
      errors.push(`upgrade for ${cardId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const cardId of Object.keys(data.upgrades)) {
    if (!content.cards[cardId]) errors.push(`upgrade for ${cardId}: unknown card`);
  }

  if (errors.length) throw new RoguelikeDataError(errors.join("\n"));
  return data;
}

let cache: RoguelikeData | null = null;

/** The live roguelike data, validated once against the loaded content. */
export function getRoguelikeData(content: ContentIndex): RoguelikeData {
  if (cache) return cache;
  cache = parseRoguelikeData(raw, content);
  return cache;
}

/** Test hook: drop the memoised data so a fixture can be re-parsed. */
export function resetRoguelikeCache(): void {
  cache = null;
}

export const artifactById = (data: RoguelikeData, id: string): ArtifactDef | undefined =>
  data.artifacts.find((a) => a.id === id);

export const eventById = (data: RoguelikeData, id: string): EventDef | undefined =>
  data.events.find((e) => e.id === id);

export const runLeaderById = (data: RoguelikeData, id: string): RunLeaderDef | undefined =>
  data.leaders.find((l) => l.leaderCardId === id);
