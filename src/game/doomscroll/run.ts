/**
 * Doomscroll run state.
 *
 * Every function here is pure: run in, run out, no DOM, no storage, no clock.
 * That is what lets the whole mode be tested headlessly — a hundred runs played
 * to completion in a unit test is worth more than any amount of clicking, and it
 * is the only way to be confident a branching map with shops and events never
 * strands the player with nothing to do.
 *
 * The other reason is the run seed. The design promises that the same seed and
 * the same choices reproduce the same map, events, shops and offers. Every roll
 * below is seeded from (run seed, node id, what is being rolled), so a node's
 * offer depends on where it is rather than on the order things were opened in.
 */

import type { AiDifficulty, CardPatch, ContentIndex, DeckList, EncounterSetup, SetupOp } from "../../engine/types";
import { nextInt, pickMany, seedRng } from "../../engine/rng";
import { autoBuildDeck, legalCardPool } from "../../engine/deck";
import { mergeCardPatches } from "../../engine/content";
import { findNode, generateActMap, nextNodeIds, subSeed, type MapNode, type RunMap } from "./map";
import {
  artifactById,
  eventById,
  remasteredIdOf,
  runLeaderById,
  upgradeFor,
  type ArtifactEffectKind,
  type EventOutcome,
  type RoguelikeData,
} from "./data";

export const RUN_VERSION = 1;

/**
 * One card in the run deck.
 *
 * A per-copy record rather than a bare id because two copies of the same card
 * are not interchangeable: a Collab recruit cannot be removed, and a normally
 * drafted copy of that same card can. Tracking it by card id would either let
 * you cycle recruits or wrongly lock a card you drafted yourself.
 */
export interface RunCard {
  cardId: string;
  /** true for Collab Call recruits, which cannot be removed */
  recruit?: true;
  /**
   * "Remastered": this copy, and only this copy, is upgraded.
   *
   * The per-copy record earns its keep here. An upgrade is a `CardPatch`, and a
   * patch is keyed by card id — so with two copies of a card in the deck,
   * patching the id would upgrade both and the player would get two upgrades for
   * the price of one. At battle time an upgraded copy is dealt as a *variant*
   * card id instead, which is a different card and can be patched alone.
   */
  upgraded?: true;
}

export type RunPrompt =
  | { kind: "cardPick"; title: string; detail: string; cards: string[]; skippable: boolean; asRecruit?: true }
  | { kind: "artifactPick"; title: string; artifacts: string[] }
  | {
      kind: "cardRemove";
      title: string;
      /**
       * Charged on success, never on cancel. A Merch Table removal is paid for
       * when a card is actually cut, so backing out of the picker costs nothing
       * — taking the money and then letting the player close the list is the
       * kind of small theft that is very hard to notice and impossible to undo.
       */
      cost: number;
      /** cancelling puts the Touch Grass Break back, so the node is not wasted */
      cancelTo?: "rest";
    }
  | {
      kind: "cardUpgrade";
      title: string;
      /** charged on success only, exactly like a removal */
      cost: number;
      /** cancelling puts the Touch Grass Break back, so the node is not wasted */
      cancelTo?: "rest";
      /** opened from a Merch Table, whose one upgrade is spent only on success */
      fromShop?: true;
    }
  | {
      kind: "shop";
      cards: { cardId: string; price: number }[];
      artifactId: string | null;
      artifactPrice: number;
      soldCards: string[];
      artifactSold: boolean;
      upgradePrice: number;
      upgradeSold: boolean;
    }
  | { kind: "rest"; heal: number }
  | { kind: "event"; eventId: string }
  | { kind: "treasure"; artifactId: string | null; clout: number };

export type RunChoice =
  | { kind: "pickCard"; cardId: string }
  | { kind: "skip" }
  | { kind: "pickArtifact"; artifactId: string }
  | { kind: "removeCardAt"; index: number }
  | { kind: "upgradeCardAt"; index: number }
  | { kind: "buyCard"; cardId: string }
  | { kind: "buyRemoval" }
  | { kind: "buyUpgrade" }
  | { kind: "buyArtifact" }
  | { kind: "leaveShop" }
  | { kind: "rest"; option: "heal" | "remove" | "upgrade" }
  | { kind: "eventChoice"; index: number };

export type RunStatus = "map" | "node" | "battle" | "won" | "dead";

export interface RunState {
  version: number;
  seed: number;
  leaderCardId: string;
  actIndex: number;
  map: RunMap;
  /** the node being resolved, or null while standing at the act entrance */
  nodeId: string | null;
  /** node ids taken this act, in order */
  path: string[];
  deck: RunCard[];
  artifacts: string[];
  /**
   * Ids of acts that have given up their Signal Fragment — one per act, from the
   * first Elite you beat in it.
   *
   * Stored as act ids rather than a count so it cannot double-count: an act that
   * somehow offered two Elites still yields one fragment, and the set is
   * self-describing when you read a saved run.
   */
  fragments: string[];
  /** recruit card ids already offered, so no Collab repeats within a run */
  recruitsOffered: string[];
  health: number;
  maxHealth: number;
  clout: number;
  removalsBought: number;
  cheatDeathUsed: boolean;
  eventsSeen: string[];
  /** interaction queue; the head is what the player is looking at */
  prompts: RunPrompt[];
  status: RunStatus;
  log: string[];
  startedAt: number;
  /** battles won, for the post-run summary */
  battlesWon: number;
  /**
   * How many times a fight has been started this run.
   *
   * Nothing stops an offline player from navigating away from a losing board and
   * walking back onto the same node — there is no server to tell them not to, and
   * refusing to re-enter would punish a browser crash far more often than it
   * would catch anyone. So this is counted rather than prevented: the battle seed
   * mixes it in, which at least means a restart is a different game instead of a
   * reroll of the same opening hand, and the run summary reports fights entered
   * next to battles won so the number is visible rather than quietly swallowed.
   */
  fightStarts: number;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function edit(run: RunState, fn: (draft: RunState) => void): RunState {
  const draft = structuredClone(run);
  fn(draft);
  return draft;
}

function note(run: RunState, line: string): void {
  run.log.push(line);
  if (run.log.length > 60) run.log = run.log.slice(-60);
}

export const hasArtifact = (run: RunState, id: string): boolean => run.artifacts.includes(id);

/** Total of every owned artifact whose effect is `kind`. Stacking is additive. */
export function artifactTotal(data: RoguelikeData, run: RunState, kind: ArtifactEffectKind): number {
  let total = 0;
  for (const id of run.artifacts) {
    const artifact = artifactById(data, id);
    if (!artifact || artifact.effect.kind !== kind) continue;
    total += "amount" in artifact.effect ? artifact.effect.amount : 1;
  }
  return total;
}

export const artifactActive = (data: RoguelikeData, run: RunState, kind: ArtifactEffectKind): boolean =>
  artifactTotal(data, run, kind) > 0;

export function actOf(data: RoguelikeData, run: RunState) {
  return data.acts[run.actIndex]!;
}

export function currentNode(run: RunState): MapNode | null {
  return run.nodeId ? findNode(run.map, run.nodeId) : null;
}

/** The deck list a battle is dealt from. Run decks ignore constructed deck rules by design. */
export function deckListFor(data: RoguelikeData, run: RunState): DeckList {
  const leader = runLeaderById(data, run.leaderCardId);
  return {
    name: leader?.deckName ?? "Run Deck",
    leaderCardId: run.leaderCardId,
    // an upgraded copy is dealt as its own card, so the copy beside it stays put
    cards: run.deck.map((card) => (card.upgraded ? remasteredIdOf(card.cardId) : card.cardId)),
  };
}

/**
 * The variant cards this run's deck needs, and the patch that upgrades each.
 *
 * One entry per distinct upgraded card rather than per copy: two Remastered
 * copies of the same card are the same card as each other, and only differ from
 * the un-upgraded copy sitting next to them.
 */
export function battleCardVariants(
  data: RoguelikeData,
  content: ContentIndex,
  run: RunState
): { variants: Record<string, string>; patches: Record<string, CardPatch> } {
  const variants: Record<string, string> = {};
  const patches: Record<string, CardPatch> = {};
  for (const card of run.deck) {
    if (!card.upgraded) continue;
    const variantId = remasteredIdOf(card.cardId);
    if (variants[variantId]) continue;
    const patch = upgradeFor(data, content, card.cardId);
    if (!patch) continue; // validated at load; a run cannot reach this
    variants[variantId] = card.cardId;
    patches[variantId] = patch;
  }
  return { variants, patches };
}

/** Can this copy be upgraded? Recruits arrive pre-upgraded, per the design. */
export const canUpgrade = (card: RunCard): boolean => !card.upgraded;

/** Indexes of run-deck copies that could still be Remastered. */
export const upgradableIndexes = (run: RunState): number[] =>
  run.deck.map((card, index) => (canUpgrade(card) ? index : -1)).filter((index) => index >= 0);

/** Node ids the player may move to right now. */
export function reachableNodeIds(run: RunState): string[] {
  if (run.status !== "map") return [];
  const node = currentNode(run);
  if (!node) return (run.map.floors[0] ?? []).map((n) => n.id);
  return nextNodeIds(run.map, node);
}

// ---------------------------------------------------------------------------
// Offers — all derived from (seed, node id, salt)
// ---------------------------------------------------------------------------

function cardPool(content: ContentIndex, run: RunState): string[] {
  const leader = content.leaders[run.leaderCardId];
  if (!leader) return [];
  return legalCardPool(content, leader)
    .map((card) => card.id)
    .sort(); // stable order in, deterministic sample out
}

function rollCards(content: ContentIndex, run: RunState, salt: string, count: number): string[] {
  const rng = seedRng(subSeed(run.seed, run.nodeId ?? "entry", salt));
  return pickMany(rng, cardPool(content, run), count);
}

function cardRewardCount(data: RoguelikeData, run: RunState): number {
  return data.run.cardRewardChoices + artifactTotal(data, run, "extraCardChoice");
}

function unownedArtifacts(data: RoguelikeData, run: RunState): string[] {
  return data.artifacts.filter((a) => !run.artifacts.includes(a.id)).map((a) => a.id);
}

function rollArtifacts(data: RoguelikeData, run: RunState, salt: string, count: number): string[] {
  const rng = seedRng(subSeed(run.seed, run.nodeId ?? "entry", salt));
  return pickMany(rng, unownedArtifacts(data, run), count);
}

/** Shop price for a card, after the Golden Play Button. */
export function shopCardPrice(data: RoguelikeData, run: RunState, content: ContentIndex, cardId: string): number {
  const rarity = content.cards[cardId]?.rarity ?? "common";
  return discounted(data, run, data.shop.cardPrice[rarity] ?? data.shop.cardPrice["common"] ?? 50);
}

function discounted(data: RoguelikeData, run: RunState, price: number): number {
  const percent = Math.min(90, artifactTotal(data, run, "shopDiscountPercent"));
  return Math.max(0, Math.round((price * (100 - percent)) / 100));
}

/**
 * What removing one more card costs.
 *
 * The price climbs each time so that a shop-heavy run cannot thin a 15-card deck
 * down to five and draw the same opener every fight. Extended Warranty freezes
 * it, which is the artifact's whole point.
 */
export function removalPrice(data: RoguelikeData, run: RunState): number {
  const steps = artifactActive(data, run, "fixedRemovalPrice") ? 0 : run.removalsBought;
  return discounted(data, run, data.shop.removalPrice + steps * data.shop.removalIncrement);
}

// ---------------------------------------------------------------------------
// Starting a run
// ---------------------------------------------------------------------------

export function startRun(
  data: RoguelikeData,
  leaderCardId: string,
  seed: number,
  startedAt: number
): RunState {
  const leader = runLeaderById(data, leaderCardId);
  if (!leader) throw new Error(`Unknown Doomscroll leader: ${leaderCardId}`);

  const run: RunState = {
    version: RUN_VERSION,
    seed: seed >>> 0,
    leaderCardId,
    actIndex: 0,
    map: generateActMap(data.acts[0]!, 0, seed >>> 0),
    nodeId: null,
    path: [],
    deck: leader.deck.map((cardId) => ({ cardId })),
    artifacts: [],
    fragments: [],
    recruitsOffered: [],
    health: data.run.startingHealth,
    maxHealth: data.run.startingHealth,
    clout: 0,
    removalsBought: 0,
    cheatDeathUsed: false,
    eventsSeen: [],
    prompts: [],
    status: "map",
    log: [],
    startedAt,
    battlesWon: 0,
    fightStarts: 0,
  };
  note(run, `${data.acts[0]!.name} — the feed opens.`);
  return run;
}

// ---------------------------------------------------------------------------
// Moving through the map
// ---------------------------------------------------------------------------

/** Step onto a node. Returns the run unchanged if that node is not reachable. */
export function enterNode(data: RoguelikeData, content: ContentIndex, run: RunState, id: string): RunState {
  if (!reachableNodeIds(run).includes(id)) return run;

  return edit(run, (draft) => {
    draft.nodeId = id;
    draft.path.push(id);
    const node = findNode(draft.map, id)!;

    switch (node.kind) {
      case "battle":
      case "elite":
      case "boss":
        draft.status = "battle";
        break;
      case "shop":
        draft.status = "node";
        draft.prompts = [buildShop(data, content, draft)];
        break;
      case "rest":
        draft.status = "node";
        draft.prompts = [{ kind: "rest", heal: data.rest.heal + artifactTotal(data, draft, "bonusRestHeal") }];
        break;
      case "recruit":
        draft.status = "node";
        draft.prompts = [buildRecruit(data, draft)];
        break;
      case "event":
        draft.status = "node";
        draft.prompts = [{ kind: "event", eventId: rollEvent(data, draft) }];
        break;
      case "treasure": {
        draft.status = "node";
        const artifact = rollArtifacts(data, draft, "treasure", 1)[0] ?? null;
        // an artifact pool the run has exhausted pays double rather than
        // offering a choice with one empty side
        draft.prompts = [
          { kind: "treasure", artifactId: artifact, clout: artifact ? data.treasure.clout : data.treasure.clout * 2 },
        ];
        break;
      }
    }
  });
}

function rollEvent(data: RoguelikeData, run: RunState): string {
  const unseen = data.events.filter((e) => !run.eventsSeen.includes(e.id));
  const pool = unseen.length > 0 ? unseen : data.events;
  const rng = seedRng(subSeed(run.seed, run.nodeId ?? "entry", "event"));
  return pool[nextInt(rng, pool.length)]!.id;
}

function buildShop(data: RoguelikeData, content: ContentIndex, run: RunState): RunPrompt {
  const cards = rollCards(content, run, "shop", data.shop.cardsOffered).map((cardId) => ({
    cardId,
    price: shopCardPrice(data, run, content, cardId),
  }));
  return {
    kind: "shop",
    cards,
    artifactId: rollArtifacts(data, run, "shopArtifact", 1)[0] ?? null,
    artifactPrice: discounted(data, run, data.shop.artifactPrice),
    soldCards: [],
    artifactSold: false,
    upgradePrice: upgradePrice(data, run),
    upgradeSold: false,
  };
}

/** Merch Table price for Remastering one card. Discounts apply, as everywhere. */
export function upgradePrice(data: RoguelikeData, run: RunState): number {
  return discounted(data, run, data.shop.upgradePrice);
}

function buildRecruit(data: RoguelikeData, run: RunState): RunPrompt {
  const pool = data.recruits.filter((id) => !run.recruitsOffered.includes(id));
  const rng = seedRng(subSeed(run.seed, run.nodeId ?? "entry", "recruit"));
  const choices = pickMany(rng, pool.length > 0 ? pool : data.recruits, data.run.recruitChoices);
  return {
    kind: "cardPick",
    title: "Collab Call",
    detail: "Somebody from another scene wants in. They cannot be cut later.",
    cards: choices,
    skippable: true,
    asRecruit: true,
  };
}

// ---------------------------------------------------------------------------
// Battles
// ---------------------------------------------------------------------------

/**
 * The card patches the run's artifacts impose on this battle.
 *
 * Every one lands on the run leader, which is what makes them the player's
 * alone. Returns undefined when no artifact bends a battle, so an ordinary run
 * carries no overrides at all.
 */
export function battleCardOverrides(data: RoguelikeData, run: RunState): Record<string, CardPatch> | undefined {
  const patches: CardPatch[] = [];
  for (const id of run.artifacts) {
    const effect = artifactById(data, id)?.effect;
    if (effect?.kind === "battlePatch") patches.push(effect.patch);
  }
  if (patches.length === 0) return undefined;
  return { [run.leaderCardId]: mergeCardPatches(patches) };
}

export interface RunBattle {
  kind: "battle" | "elite" | "boss";
  title: string;
  subtitle: string;
  seed: number;
  playerDeck: DeckList;
  enemyDeck: DeckList;
  difficulty: AiDifficulty;
  scenario: EncounterSetup;
  enemyLeaderCardId: string;
  /** artifact patches on the run leader, and the patch for each Remastered card */
  cardOverrides?: Record<string, CardPatch>;
  /** Remastered card ids, each cloned from the card it upgrades */
  cardVariants?: Record<string, string>;
}

/**
 * Everything the battle route needs for the node the run is standing on.
 *
 * Leader health is carried in as a `leaderHealth` setup op rather than a balance
 * override, for the same reason the Weekly Boss does it: `leader.startingHealth`
 * is one number shared by both seats, so overriding it would hand the enemy your
 * run health too.
 */
export function battleFor(data: RoguelikeData, content: ContentIndex, run: RunState): RunBattle | null {
  const node = currentNode(run);
  if (!node || (node.kind !== "battle" && node.kind !== "elite" && node.kind !== "boss")) return null;
  const act = actOf(data, run);
  const battleSeed = subSeed(run.seed, node.id, "battle", run.fightStarts);

  /**
   * Artifact patches bend the run leader; upgrade patches bend the Remastered
   * clones. They share one `cardOverrides` map because they never collide — an
   * artifact patches a leader card, an upgrade patches a variant id that cannot
   * be a leader — and merging them keeps the battle route to one lever.
   */
  const artifactPatches = battleCardOverrides(data, run);
  const upgrades = battleCardVariants(data, content, run);
  const overrides =
    artifactPatches || Object.keys(upgrades.patches).length > 0
      ? { ...(artifactPatches ?? {}), ...upgrades.patches }
      : undefined;
  const variants = Object.keys(upgrades.variants).length > 0 ? upgrades.variants : undefined;

  const setup: SetupOp[] = [
    { op: "leaderHealth", seat: 0, value: run.health, max: run.maxHealth },
  ];

  if (node.kind === "boss") {
    const bossHealth = (content.leaders[act.boss.leaderCardId]?.health ?? 30) + act.bossBonusHealth;
    setup.push({ op: "leaderHealth", seat: 1, value: bossHealth, max: bossHealth });
    return {
      kind: "boss",
      title: act.boss.name,
      subtitle: `${act.boss.twistName} — ${act.boss.twistText}`,
      seed: battleSeed,
      playerDeck: deckListFor(data, run),
      enemyDeck: { ...autoBuildDeck(content, act.boss.deckLeaderCardId, act.boss.name), leaderCardId: act.boss.leaderCardId },
      difficulty: act.difficulty.boss,
      scenario: { setup },
      enemyLeaderCardId: act.boss.leaderCardId,
      ...(overrides ? { cardOverrides: overrides } : {}),
      ...(variants ? { cardVariants: variants } : {}),
    };
  }

  const rng = seedRng(subSeed(run.seed, node.id, "enemy"));
  const enemyLeaderId = act.enemyLeaders[nextInt(rng, act.enemyLeaders.length)]!;
  const enemyLeader = content.leaders[enemyLeaderId]!;
  if (node.kind === "elite") {
    const health = enemyLeader.health + act.eliteBonusHealth;
    setup.push({ op: "leaderHealth", seat: 1, value: health, max: health });
  }

  return {
    kind: node.kind,
    title: node.kind === "elite" ? `Elite — ${enemyLeader.name}` : enemyLeader.name,
    subtitle:
      node.kind === "elite"
        ? `Tougher opponent, ${act.eliteBonusHealth} extra leader health, and an artifact for winning.`
        : enemyLeader.title,
    seed: battleSeed,
    playerDeck: deckListFor(data, run),
    enemyDeck: autoBuildDeck(content, enemyLeaderId, enemyLeader.name),
    difficulty: node.kind === "elite" ? act.difficulty.elite : act.difficulty.battle,
    enemyLeaderCardId: enemyLeaderId,
    scenario: { setup },
    ...(overrides ? { cardOverrides: overrides } : {}),
    ...(variants ? { cardVariants: variants } : {}),
  };
}

/**
 * Mark that a fight is starting. Call this before `battleFor`, because the
 * battle seed mixes the count in — see `fightStarts`.
 */
export function startFight(run: RunState): RunState {
  if (run.status !== "battle") return run;
  return edit(run, (draft) => {
    draft.fightStarts += 1;
  });
}

/**
 * Fold a finished battle back into the run.
 *
 * `leaderHealth` is the player's health at the final event of the match — the
 * run carries damage forward, which is the whole shape of the mode.
 */
export function resolveBattle(
  data: RoguelikeData,
  content: ContentIndex,
  run: RunState,
  result: { won: boolean; leaderHealth: number }
): RunState {
  const node = currentNode(run);
  if (!node || run.status !== "battle") return run;

  return edit(run, (draft) => {
    if (!result.won) {
      /**
       * Clip of Your Lowest Moment. It fires on the run's first defeat and then
       * breaks. The node still counts as visited and pays nothing: surviving is
       * not winning, and letting the fight be retried would turn the artifact
       * into an infinite-retry token.
       */
      if (hasArtifact(draft, "lowest-moment-clip") && !draft.cheatDeathUsed) {
        draft.cheatDeathUsed = true;
        draft.artifacts = draft.artifacts.filter((id) => id !== "lowest-moment-clip");
        draft.health = 1;
        draft.status = "map";
        note(draft, "The clip resurfaces. You survive at 1 health, and it breaks.");
        return;
      }
      draft.health = 0;
      draft.status = "dead";
      note(draft, "The feed closes over you. Run over.");
      return;
    }

    draft.battlesWon += 1;
    draft.health = Math.max(1, Math.min(result.leaderHealth, draft.maxHealth));
    const heal = artifactTotal(data, draft, "healAfterVictory");
    if (heal > 0) {
      draft.health = Math.min(draft.maxHealth, draft.health + heal);
      note(draft, `Sponsored Hydration Bot heals ${heal}.`);
    }

    const act = actOf(data, draft);
    const kind = node.kind;
    const reward =
      kind === "boss" ? data.rewards.boss.clout : kind === "elite" ? data.rewards.elite.clout : data.rewards.battle.clout;
    const bonus = kind === "boss" ? 0 : artifactTotal(data, draft, "bonusBattleClout");
    draft.clout += reward + bonus;
    note(draft, `Cleared ${node.kind === "battle" ? "a fight" : node.kind === "elite" ? "an Elite" : act.boss.name} for ${reward + bonus} Clout.`);

    /**
     * The act's Signal Fragment, from the first Elite you beat in it.
     *
     * Awarded here rather than offered as a choice, because it is not a reward
     * you weigh against another — it is a record that you took the harder route.
     * The cost was paid on the map, when you walked into an Elite instead of
     * around it, and that is the only decision the true finale asks for.
     */
    if (kind === "elite" && !draft.fragments.includes(act.id)) {
      draft.fragments.push(act.id);
      const finale = data.acts.find((a) => a.requiresFragments !== undefined);
      const needed = finale?.requiresFragments ?? 0;
      note(
        draft,
        draft.fragments.length >= needed
          ? `Signal Fragment recovered (${draft.fragments.length}/${needed}). Something below the feed is listening.`
          : `Signal Fragment recovered (${draft.fragments.length}/${needed}).`
      );
    }

    const prompts: RunPrompt[] = [];
    if (kind === "elite" || kind === "boss") {
      const artifacts = rollArtifacts(data, draft, "reward", data.run.artifactRewardChoices);
      if (artifacts.length > 0) {
        prompts.push({ kind: "artifactPick", title: kind === "boss" ? "Main Event spoils" : "Elite spoils", artifacts });
      }
    }
    prompts.push({
      kind: "cardPick",
      title: "Pick a card",
      detail: "It joins this run's deck only. Your collection is untouched.",
      cards: rollCards(content, draft, "reward", cardRewardCount(data, draft)),
      skippable: true,
    });

    draft.prompts = prompts;
    draft.status = "node";
  });
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

/** Apply the player's answer to the head prompt. Unrecognised answers are ignored. */
export function resolvePrompt(
  data: RoguelikeData,
  content: ContentIndex,
  run: RunState,
  choice: RunChoice
): RunState {
  const prompt = run.prompts[0];
  if (!prompt) return run;

  return edit(run, (draft) => {
    const head = draft.prompts[0]!;

    switch (head.kind) {
      case "cardPick": {
        if (choice.kind === "pickCard" && head.cards.includes(choice.cardId)) {
          // recruits arrive Remastered, per the design's "pre-upgraded" —
          // which is also why they never appear in an upgrade picker
          draft.deck.push(
            head.asRecruit ? { cardId: choice.cardId, recruit: true, upgraded: true } : { cardId: choice.cardId }
          );
          if (head.asRecruit) draft.recruitsOffered.push(...head.cards);
          note(draft, `Added ${content.cards[choice.cardId]?.name ?? choice.cardId}.`);
        } else if (choice.kind === "skip" && head.skippable) {
          if (head.asRecruit) draft.recruitsOffered.push(...head.cards);
          note(draft, "Passed on the offer.");
        } else {
          return; // not an answer to this prompt
        }
        draft.prompts.shift();
        break;
      }

      case "artifactPick": {
        if (choice.kind !== "pickArtifact" || !head.artifacts.includes(choice.artifactId)) return;
        grantArtifact(data, draft, choice.artifactId);
        draft.prompts.shift();
        break;
      }

      case "cardRemove": {
        if (choice.kind === "skip") {
          draft.prompts.shift();
          if (head.cancelTo === "rest") {
            draft.prompts.unshift({ kind: "rest", heal: data.rest.heal + artifactTotal(data, draft, "bonusRestHeal") });
          }
          break;
        }
        if (choice.kind !== "removeCardAt") return;
        if (draft.clout < head.cost) return;
        if (!removeCardAt(content, draft, choice.index)) return;
        if (head.cost > 0) {
          draft.clout -= head.cost;
          draft.removalsBought += 1;
        }
        draft.prompts.shift();
        break;
      }

      case "cardUpgrade": {
        if (choice.kind === "skip") {
          draft.prompts.shift();
          if (head.cancelTo === "rest") {
            draft.prompts.unshift({ kind: "rest", heal: data.rest.heal + artifactTotal(data, draft, "bonusRestHeal") });
          }
          break;
        }
        if (choice.kind !== "upgradeCardAt") return;
        if (draft.clout < head.cost) return;
        const card = draft.deck[choice.index];
        // already-Remastered copies are refused rather than charged again
        if (!card || !canUpgrade(card)) return;
        card.upgraded = true;
        if (head.cost > 0) draft.clout -= head.cost;
        note(draft, `Remastered ${content.cards[card.cardId]?.name ?? card.cardId}.`);
        draft.prompts.shift();
        // now that it happened, the Merch Table's single upgrade is spent
        const shop = draft.prompts[0];
        if (head.fromShop && shop?.kind === "shop") shop.upgradeSold = true;
        break;
      }

      case "rest": {
        if (choice.kind !== "rest") return;
        if (choice.option === "heal") {
          const before = draft.health;
          draft.health = Math.min(draft.maxHealth, draft.health + head.heal);
          note(draft, `Touched grass. Healed ${draft.health - before}.`);
          draft.prompts.shift();
        } else if (choice.option === "upgrade") {
          draft.prompts.shift();
          draft.prompts.unshift({ kind: "cardUpgrade", title: "Remaster a card", cost: 0, cancelTo: "rest" });
        } else {
          draft.prompts.shift();
          draft.prompts.unshift({ kind: "cardRemove", title: "Cut a card from the run deck", cost: 0, cancelTo: "rest" });
        }
        break;
      }

      case "treasure": {
        if (choice.kind === "pickArtifact" && head.artifactId === choice.artifactId) {
          grantArtifact(data, draft, choice.artifactId);
        } else if (choice.kind === "skip") {
          draft.clout += head.clout;
          note(draft, `Took the ${head.clout} Clout instead.`);
        } else {
          return;
        }
        draft.prompts.shift();
        break;
      }

      case "shop": {
        if (choice.kind === "leaveShop") {
          draft.prompts.shift();
          break;
        }
        if (choice.kind === "buyCard") {
          const entry = head.cards.find((c) => c.cardId === choice.cardId);
          if (!entry || head.soldCards.includes(choice.cardId) || draft.clout < entry.price) return;
          draft.clout -= entry.price;
          head.soldCards.push(choice.cardId);
          draft.deck.push({ cardId: choice.cardId });
          note(draft, `Bought ${content.cards[choice.cardId]?.name ?? choice.cardId} for ${entry.price}.`);
          return;
        }
        if (choice.kind === "buyArtifact") {
          if (!head.artifactId || head.artifactSold || draft.clout < head.artifactPrice) return;
          draft.clout -= head.artifactPrice;
          head.artifactSold = true;
          grantArtifact(data, draft, head.artifactId);
          return;
        }
        if (choice.kind === "buyRemoval") {
          const price = removalPrice(data, draft);
          if (draft.clout < price) return;
          draft.prompts.unshift({ kind: "cardRemove", title: "Cut a card from the run deck", cost: price });
          return;
        }
        if (choice.kind === "buyUpgrade") {
          if (head.upgradeSold || draft.clout < head.upgradePrice) return;
          if (upgradableIndexes(draft).length === 0) return;
          /**
           * Marked sold when the upgrade actually happens, not when the picker
           * opens. Setting it here would mean backing out of the list costs you
           * the Merch Table's one upgrade without charging you for it — the same
           * quiet theft the removal path already refuses to commit, wearing a
           * different hat.
           */
          draft.prompts.unshift({ kind: "cardUpgrade", title: "Remaster a card", cost: head.upgradePrice, fromShop: true });
          return;
        }
        return;
      }

      case "event": {
        if (choice.kind !== "eventChoice") return;
        const event = eventById(data, head.eventId);
        const option = event?.choices[choice.index];
        if (!event || !option) return;
        if (!draft.eventsSeen.includes(event.id)) draft.eventsSeen.push(event.id);
        note(draft, `${event.title}: ${option.label}.`);
        draft.prompts.shift();
        // outcomes may queue further prompts, which must land in front of
        // whatever the node had left
        const queued = applyOutcomes(data, content, draft, option.outcomes);
        draft.prompts.unshift(...queued);
        break;
      }
    }

    settle(data, draft);
  });
}

function grantArtifact(data: RoguelikeData, run: RunState, artifactId: string): void {
  const artifact = artifactById(data, artifactId);
  if (!artifact || run.artifacts.includes(artifactId)) return;
  run.artifacts.push(artifactId);
  if (artifact.effect.kind === "maxHealth") {
    run.maxHealth += artifact.effect.amount;
    run.health += artifact.effect.amount;
  }
  note(run, `Picked up ${artifact.name}.`);
}

function removeCardAt(content: ContentIndex, run: RunState, index: number): boolean {
  const card = run.deck[index];
  // one card must always remain, or the next battle deals an empty deck
  if (!card || card.recruit || run.deck.length <= 1) return false;
  run.deck.splice(index, 1);
  note(run, `Cut ${content.cards[card.cardId]?.name ?? card.cardId}.`);
  return true;
}

function applyOutcomes(
  data: RoguelikeData,
  content: ContentIndex,
  run: RunState,
  outcomes: EventOutcome[]
): RunPrompt[] {
  const queued: RunPrompt[] = [];
  for (const outcome of outcomes) {
    switch (outcome.kind) {
      case "heal":
        run.health = Math.min(run.maxHealth, run.health + outcome.amount);
        break;
      case "damage":
        run.health -= outcome.amount;
        break;
      case "clout":
        run.clout = Math.max(0, run.clout + outcome.amount);
        break;
      case "maxHealth":
        run.maxHealth += outcome.amount;
        run.health += outcome.amount;
        break;
      case "gainArtifact": {
        // a find, not a choice — the Notification already was the choice
        const found = rollArtifacts(data, run, "eventArtifact", 1)[0];
        if (found) grantArtifact(data, run, found);
        else {
          run.clout += data.treasure.clout;
          note(run, `Nothing left to find. Took ${data.treasure.clout} Clout instead.`);
        }
        break;
      }
      case "gainCard":
        queued.push({
          kind: "cardPick",
          title: "Pick a card",
          detail: "It joins this run's deck only.",
          cards: rollCards(content, run, "eventCard", cardRewardCount(data, run)),
          skippable: true,
        });
        break;
      case "removeCard":
        queued.push({ kind: "cardRemove", title: "Cut a card from the run deck", cost: 0 });
        break;
      case "upgradeCard":
        queued.push({ kind: "cardUpgrade", title: "Remaster a card", cost: 0 });
        break;
    }
  }
  return queued;
}

/**
 * Decide where the run stands once a prompt has been answered.
 *
 * Health can go to zero inside an event, so this is also the one place a run
 * dies outside a battle — and Clip of Your Lowest Moment has to catch that too,
 * or the artifact would read as "the first time you lose a fight" instead of
 * what it says.
 */
function settle(data: RoguelikeData, run: RunState): void {
  if (run.health <= 0) {
    if (hasArtifact(run, "lowest-moment-clip") && !run.cheatDeathUsed) {
      run.cheatDeathUsed = true;
      run.artifacts = run.artifacts.filter((id) => id !== "lowest-moment-clip");
      run.health = 1;
      note(run, "The clip resurfaces. You survive at 1 health, and it breaks.");
    } else {
      run.health = 0;
      run.prompts = [];
      run.status = "dead";
      note(run, "The feed closes over you. Run over.");
      return;
    }
  }
  if (run.prompts.length > 0) {
    run.status = "node";
    return;
  }
  // the node is finished: either the act ends here or the map opens again
  const node = currentNode(run);
  if (node?.kind === "boss") {
    advanceAct(data, run);
    return;
  }
  run.status = "map";
}

function advanceAct(data: RoguelikeData, run: RunState): void {
  const next = run.actIndex + 1;
  const nextAct = data.acts[next];

  if (!nextAct) {
    run.status = "won";
    note(run, "You reach the end of the feed. There is nothing below it.");
    return;
  }

  /**
   * A gated act you have not earned ends the run as a win, rather than barring
   * the way.
   *
   * The design calls act 4 an *optional* true finale, and optional has to mean
   * that finishing without it is finishing — not a run held one screen short of
   * its ending by a door it can no longer open. The player is told what they
   * missed and how close they were, because "you needed three and had two" is
   * the sentence that makes the next run's routing decision.
   */
  const needed = nextAct.requiresFragments;
  if (needed !== undefined && run.fragments.length < needed) {
    run.status = "won";
    note(
      run,
      `You reach the end of the feed with ${run.fragments.length} of ${needed} Signal Fragments. ${nextAct.name} stays closed. Beat an Elite in every act to open it.`
    );
    return;
  }

  run.actIndex = next;
  run.map = generateActMap(nextAct, next, run.seed);
  run.nodeId = null;
  run.path = [];
  run.status = "map";
  note(run, needed !== undefined ? `${nextAct.name} — the fragments pull towards each other.` : `${nextAct.name} — deeper.`);
}

// ---------------------------------------------------------------------------
// Ending a run
// ---------------------------------------------------------------------------

export interface RunSummary {
  cleared: boolean;
  actsCleared: number;
  battlesWon: number;
  /** fights entered — higher than battlesWon means fights were restarted */
  fightsEntered: number;
  runClout: number;
  /** account Clout, converted at the rate in data */
  accountClout: number;
  deckSize: number;
  artifacts: number;
  /** Signal Fragments held, and how many the optional finale wants */
  fragments: number;
  fragmentsNeeded: number;
  /** true only if the run actually reached and cleared the gated final act */
  reachedFinale: boolean;
}

export function summarize(data: RoguelikeData, run: RunState): RunSummary {
  const finaleIndex = data.acts.findIndex((a) => a.requiresFragments !== undefined);
  const won = run.status === "won";
  return {
    cleared: won,
    /**
     * Acts you actually finished, which is not the same as "all of them".
     *
     * This used to report `data.acts.length` for any win, and that was true
     * while every act was mandatory. With an optional finale a run can win by
     * clearing act 3 and being turned away at act 4, and claiming four would
     * both lie in the summary and inflate the saved `bestActsCleared`.
     */
    actsCleared: won ? run.actIndex + 1 : run.actIndex,
    battlesWon: run.battlesWon,
    fightsEntered: run.fightStarts,
    runClout: run.clout,
    accountClout: Math.floor(run.clout / data.run.cloutConversion),
    deckSize: run.deck.length,
    artifacts: run.artifacts.length,
    fragments: run.fragments.length,
    fragmentsNeeded: (finaleIndex >= 0 ? data.acts[finaleIndex]!.requiresFragments : 0) ?? 0,
    reachedFinale: won && finaleIndex >= 0 && run.actIndex >= finaleIndex,
  };
}

/** Abandon: the run is over and pays what it earned, exactly as a death would. */
export function abandonRun(run: RunState): RunState {
  return edit(run, (draft) => {
    draft.status = "dead";
    draft.prompts = [];
    note(draft, "You closed the app. It counts.");
  });
}

export const runOver = (run: RunState): boolean => run.status === "won" || run.status === "dead";
