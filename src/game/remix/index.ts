/**
 * The Remix Queue — `09-game-modes.md` §12, "This Week's Meta".
 *
 * *"A rotating queue where one global rule modifier applies to both players for
 * the week. Modifiers are data-driven event configs (`data/events.json`),
 * displayed on the queue tile and in the mulligan screen. Remix never touches
 * Ranked."*
 *
 * ## Nothing here is a new engine concept
 *
 * §12's ship status is Hybrid — *"Remix vs AI (same modifier against AI)
 * offline-now; the PvP queue online-later"* — so what ships is the solo half,
 * and it is assembled entirely out of levers the engine already had:
 *
 * - **`balanceOverrides`**, whose comment in `types.ts` has read *"balance
 *   overrides for boss battles / weekly modifiers"* since long before this mode
 *   existed. The engine was built expecting it.
 * - **`cardOverrides[leaderId].passive`**, described there as *"appended to a
 *   leader's passive list — how an artifact attaches to a player"*. A Doomscroll
 *   artifact attaches a passive to one player; a Remix modifier attaches the same
 *   shape to **both**. That is the only difference between a run reward and a
 *   global rule.
 * - **a cost ceiling**, expanded into ordinary per-card `cardOverrides`.
 *
 * The Weekly Boss reached the same conclusion from the other side: *"a boss's
 * rule twist is a passive on its leader card, expressed in the ordinary effect
 * DSL. Nothing here special-cases a boss."* Nothing here special-cases a week.
 *
 * ## Six of ten, and the four that say why not
 *
 * §12.1 publishes a ten-modifier launch rotation. Six are expressible with the
 * mechanisms above and ship. Four need engine work that a data-driven modifier
 * cannot add — a timed banish, a confluence *counter* where the engine keeps a
 * boolean, a new player-initiated action, and a deck-building rule that is
 * enforced at save time rather than at match time. All ten stay in the data,
 * because the table is content and quietly dropping four would rewrite the spec;
 * the four carry a `deferred` reason instead, and `checkRemixData` refuses a
 * deferred modifier that also carries rules, or a rule that carries no reason.
 */

import type { CardPatch, ContentIndex, MatchConfig } from "../../engine/types";
import { collectibleCards } from "../../engine/content";
import { eventsData, type RemixModifierDef } from "../events/data";
import { weekIndex } from "../weeklyBoss";

export type { RemixModifierDef } from "../events/data";

/** `data/events.json`'s `remix` block. */
export const remixData = () => eventsData().remix;

/** Every modifier in §12.1's launch table, playable or not. */
export const allModifiers = (): RemixModifierDef[] => remixData().modifiers;

/** The ones the rotation can actually deal. */
export const playableModifiers = (): RemixModifierDef[] =>
  allModifiers().filter((modifier) => !modifier.deferred);

/**
 * This week's modifier.
 *
 * Derived from the same `weekIndex` the Weekly Boss rotates on, so the two
 * rotations tick over on the same boundary and a player never sees a new boss
 * and last week's Remix rule on the same day. Deriving rather than storing also
 * means every client agrees without a server telling them, and will keep
 * agreeing once one exists.
 *
 * It rotates over the **playable** list, not the whole table: a week whose rule
 * is "nothing happens, this one is not built" is not a week of content.
 */
export function modifierForWeek(now: number): RemixModifierDef {
  const playable = playableModifiers();
  return playable[weekIndex(now) % playable.length]!;
}

/**
 * A specific modifier by id, falling back to this week's.
 *
 * The rotation is the product feature; this is how anything that needs to reach
 * a *particular* modifier gets there. Without it, verification could only ever
 * exercise whichever rule the calendar happened to land on — one in six — so the
 * other five would go untested until their week came round.
 */
export function modifierById(id: string | null | undefined, now: number): RemixModifierDef {
  return playableModifiers().find((modifier) => modifier.id === id) ?? modifierForWeek(now);
}

/** When this week's rule gives way to the next one. */
export const weekEnd = (now: number): number => (weekIndex(now) + 1) * 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Turning a modifier into a match
// ---------------------------------------------------------------------------

/**
 * The cost ceiling, as ordinary per-card patches.
 *
 * `CardPatch.cost` is *added* to the printed cost and clamped by the schema, so
 * a ceiling is expressed as a negative delta per card rather than as a new rule
 * the engine has to learn. Only cards above the ceiling are patched — patching
 * every card with a zero delta would put the entire collection in the config for
 * no reason, and `replay()` rebuilds from that config.
 */
function ceilingPatches(content: ContentIndex, ceiling: number): Record<string, CardPatch> {
  const patches: Record<string, CardPatch> = {};
  for (const card of collectibleCards(content)) {
    if (card.cost > ceiling) patches[card.id] = { cost: ceiling - card.cost };
  }
  return patches;
}

/**
 * Everything a Remix match needs, assembled — the same shape `bossMatchConfig`
 * returns, for the same reason: the battle route should be handed a config, not
 * a set of instructions about how to build one.
 *
 * `leaderCardIds` is both seats' leaders, because the rule applies to **both
 * players**. Patching one leader would be a house rule that only one side plays
 * by, which is the single most important thing about this mode to get right.
 */
export function remixMatchConfig(
  content: ContentIndex,
  modifier: RemixModifierDef,
  leaderCardIds: readonly string[]
): Pick<MatchConfig, "balanceOverrides" | "cardOverrides"> {
  const cardOverrides: Record<string, CardPatch> = modifier.costCeiling
    ? ceilingPatches(content, modifier.costCeiling)
    : {};

  if (modifier.passive && modifier.passive.length > 0) {
    for (const leaderCardId of new Set(leaderCardIds)) {
      const existing = cardOverrides[leaderCardId];
      cardOverrides[leaderCardId] = {
        ...existing,
        passive: [...(existing?.passive ?? []), ...modifier.passive],
        textSuffix: modifier.text,
      };
    }
  }

  return {
    ...(modifier.balance ? { balanceOverrides: { ...modifier.balance } } : {}),
    ...(Object.keys(cardOverrides).length > 0 ? { cardOverrides } : {}),
  };
}

// ---------------------------------------------------------------------------
// The weekly quest
// ---------------------------------------------------------------------------

/** The mode string `recordMatch` stamps on a Remix match. */
export const REMIX_MODE = "remix";

/** §12's *"weekly Remix quest ('Win 3 Remix matches': 150 Clout…)"*. */
export interface RemixQuest {
  /** the week the wins were counted in */
  week: number;
  wins: number;
  required: number;
  clout: number;
  complete: boolean;
  claimed: boolean;
}

export function remixQuest(wins: number, claimedWeek: number, now: number): RemixQuest {
  const { questWinsRequired, questClout } = remixData();
  const week = weekIndex(now);
  return {
    week,
    wins,
    required: questWinsRequired,
    clout: questClout,
    complete: wins >= questWinsRequired,
    claimed: claimedWeek === week,
  };
}

// ---------------------------------------------------------------------------
// Deferred
// ---------------------------------------------------------------------------

/**
 * The launch-table modifiers that are not playable, with the reason each is not.
 *
 * **Derived from the data** rather than restated here, so the reason a player
 * reads on the screen and the reason a developer reads in the allowlist are the
 * same string. Every other `DEFERRED_*` in this codebase is a literal because it
 * has nowhere else to live; this one does.
 */
export const deferredModifiers = (): ReadonlyMap<string, string> =>
  new Map(
    allModifiers()
      .filter((modifier) => modifier.deferred)
      .map((modifier) => [modifier.name, modifier.deferred!])
  );

/**
 * What §12 asks for beyond the modifiers themselves, and why it is not here.
 */
export const DEFERRED_REMIX: ReadonlyMap<string, string> = new Map([
  [
    "The Remix PvP queue",
    "§12's ship status is explicit that the queue is online-later and only 'Remix vs AI (same modifier against AI)' is offline-now; a queue with one player in it is a menu that never resolves",
  ],
  [
    "The weekly-exclusive emote",
    "§12's quest pays Clout and a weekly-exclusive emote, and an emote is a phrase plus a slot in a rotation nobody has authored — the Clout pays, and inventing an emote per week would be ten cosmetics a year with no design behind them",
  ],
  [
    "Seasonal rotation growth",
    "§12 says the rotation 'repeats seasonally with new entries added'; adding entries is a data edit by design, but which entries a later season adds is a content decision nobody has made",
  ],
]);

// ---------------------------------------------------------------------------
// Check
// ---------------------------------------------------------------------------

/** Everything wrong with the `remix` block of `data/events.json`. */
export function checkRemixData(content: ContentIndex): string[] {
  const problems: string[] = [];
  const data = remixData();
  const seen = new Set<string>();

  for (const modifier of data.modifiers) {
    const where = `remix.${modifier.id}`;
    if (seen.has(modifier.id)) problems.push(`${where}: duplicate modifier id`);
    seen.add(modifier.id);

    const hasRules =
      Boolean(modifier.balance) || Boolean(modifier.passive?.length) || modifier.costCeiling !== undefined;

    /**
     * The two halves of the honesty rule, which is the whole reason the deferred
     * modifiers stay in the file: a deferral must not hide a half-built rule,
     * and a rule must not ship without being announced as playable.
     */
    if (modifier.deferred && hasRules) {
      problems.push(`${where}: deferred, but still carries rules — it would apply while claiming not to`);
    }
    if (!modifier.deferred && !hasRules) {
      problems.push(`${where}: playable, but carries no balance, passive or costCeiling — it would be a week where nothing happens`);
    }
    if (modifier.deferred && modifier.deferred.trim().length < 40) {
      problems.push(`${where}: deferred without a real reason`);
    }

    for (const key of Object.keys(modifier.balance ?? {})) {
      if (!key.includes(".")) problems.push(`${where}: balance key "${key}" is not a dotted balance path`);
    }

    if (modifier.costCeiling !== undefined) {
      const above = collectibleCards(content).filter((card) => card.cost > modifier.costCeiling!).length;
      if (above === 0) {
        problems.push(`${where}: costCeiling ${modifier.costCeiling} is above every printed card, so it changes nothing`);
      }
    }
  }

  if (playableModifiers().length === 0) {
    problems.push("remix: every modifier is deferred, so the rotation has nothing to deal");
  }
  if (data.questWinsRequired <= 0) problems.push("remix: the weekly quest asks for no wins");

  for (const [name, reason] of DEFERRED_REMIX) {
    if (reason.trim().length < 40) problems.push(`DEFERRED_REMIX "${name}": deferred without a real reason`);
  }

  return problems;
}
