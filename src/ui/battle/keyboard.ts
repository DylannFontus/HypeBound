/**
 * Playing the board without a pointer — `13-accessibility.md` §13.2 and §13.3.
 *
 * A pure reducer: `(state, key, context) → { state, action?, say? }`. No DOM, no
 * engine calls, no clock. The battle screen feeds it a key and a snapshot of
 * what the engine says is legal, and executes whatever action comes back.
 *
 * ## Why it is a reducer and not a pile of listeners
 *
 * §13.3 draws this as a state machine with seven modes and named transitions,
 * and every one of them has a failure mode that only shows up in an unlikely
 * order: cancelling out of targeting back into a selection that no longer
 * exists, tabbing while placing a character, a card becoming unplayable while it
 * is selected. A reducer can be driven through those orders in a test at a
 * thousand a second. A pile of listeners can only be clicked at.
 *
 * ## What it deliberately does not do
 *
 * It does not decide legality — `Legality` arrives from `checkPlayable`,
 * `attackableBy` and `availableConfluences`, the same functions the pointer
 * path uses. And it does not build the multi-target and choose-one flows: those
 * already exist as a **list of buttons** in `openChooser`, which a keyboard can
 * already drive. Reimplementing them here would be a second definition of what
 * playing a card means, and the two would eventually disagree.
 */

import type { ContentIndex, PlayerView, TargetRef } from "../../engine/types";
import {
  ZONE_ORDER,
  ZONE_LABEL,
  boardZones,
  describeTarget,
  type BoardSlot,
  type Legality,
  type ZoneId,
} from "./boardModel";

/** §13.3's modes. */
export type KeyboardMode = "browsing" | "cardSelected" | "slotPicking" | "attackSelect";

export interface KeyboardState {
  mode: KeyboardMode;
  zone: ZoneId;
  /** index within the current zone's focusable slots */
  index: number;
  /** the hand card being played, in `cardSelected` / `slotPicking` */
  cardInstanceId: string | null;
  /** the attacker, in `attackSelect` */
  attackerInstanceId: string | null;
  /** legal attack targets, cycled with Left/Right or T */
  targets: TargetRef[];
  targetIndex: number;
}

export const initialKeyboardState = (): KeyboardState => ({
  mode: "browsing",
  zone: "hand",
  index: 0,
  cardInstanceId: null,
  attackerInstanceId: null,
  targets: [],
  targetIndex: 0,
});

/** What the screen should do. Everything else is navigation. */
export type KeyboardAction =
  | { kind: "playCard"; instanceId: string; slot?: number }
  | { kind: "attack"; attackerInstanceId: string; target: TargetRef }
  | { kind: "endTurn" }
  | { kind: "fixation"; ultimate: boolean }
  | { kind: "confluence"; confluenceId: string }
  | { kind: "activateLocation" }
  | { kind: "inspect"; slot: BoardSlot }
  | { kind: "rulesLens"; slot: BoardSlot }
  | { kind: "openHistory" }
  | { kind: "openMenu" }
  | { kind: "openShortcuts" }
  | { kind: "focusMirror" }
  | { kind: "fastForward" };

export interface KeyboardContext {
  content: ContentIndex;
  view: PlayerView;
  legality: Legality;
  /** legal attack targets for a given attacker — the engine's answer, not ours */
  attackTargets: (attackerInstanceId: string) => TargetRef[];
  /** true while the presenter is still playing events out */
  animating: boolean;
}

export interface KeyboardResult {
  state: KeyboardState;
  action?: KeyboardAction;
  /** what to announce and show in the mode banner */
  say?: string;
  /** true when the key was ours; false lets the browser have it */
  handled: boolean;
}

/** The mode banner text — §13.3 requires the player never be in an unlabelled state. */
export function modeBanner(state: KeyboardState): string {
  switch (state.mode) {
    case "cardSelected":
      return "CARD SELECTED — Enter to play, Esc to cancel";
    case "slotPicking":
      return "CHOOSING A SLOT — Left and Right to move, Enter to place, Esc to cancel";
    case "attackSelect":
      return "CHOOSING A TARGET — Left and Right to cycle, Enter to attack, Esc to cancel";
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------

const zonesWithSlots = (context: KeyboardContext, placing: boolean): Map<ZoneId, BoardSlot[]> => {
  const map = new Map<ZoneId, BoardSlot[]>();
  for (const zone of boardZones(context.content, context.view, context.legality, { placing })) {
    map.set(zone.id, zone.slots);
  }
  return map;
};

const slotsOf = (context: KeyboardContext, zone: ZoneId, placing = false): BoardSlot[] =>
  zonesWithSlots(context, placing).get(zone) ?? [];

/** The slot the cursor is on, or null when the zone emptied under it. */
export function focusedSlot(state: KeyboardState, context: KeyboardContext): BoardSlot | null {
  const slots = slotsOf(context, state.zone, state.mode === "slotPicking");
  return slots[Math.min(state.index, slots.length - 1)] ?? null;
}

/**
 * Move `step` zones, skipping empty ones.
 *
 * Empty zones are skipped rather than reordered: §13.1's order is fixed so it can
 * be learned, and a zone that vanishes when your last character dies would move
 * every zone after it.
 */
function moveZone(state: KeyboardState, context: KeyboardContext, step: number): KeyboardState {
  const placing = state.mode === "slotPicking";
  const zones = zonesWithSlots(context, placing);
  const start = ZONE_ORDER.indexOf(state.zone);
  for (let hop = 1; hop <= ZONE_ORDER.length; hop++) {
    const next = ZONE_ORDER[(start + step * hop + ZONE_ORDER.length * hop) % ZONE_ORDER.length]!;
    if ((zones.get(next) ?? []).length > 0) return { ...state, zone: next, index: 0 };
  }
  return state;
}

/**
 * §13.1's Up/Down: jump between your row, the seam controls and the enemy row.
 *
 * A convenience across zones rather than within one, because the board reads as
 * three horizontal bands and tabbing through eleven zones to cross one is not
 * how anybody thinks about it.
 */
const ROWS: ZoneId[][] = [["hand"], ["yourBoard"], ["yourLeader", "yourLocation", "confluence"], ["enemyBoard"], ["enemyLeader", "enemyLocation"]];

function moveRow(state: KeyboardState, context: KeyboardContext, step: number): KeyboardState {
  const zones = zonesWithSlots(context, state.mode === "slotPicking");
  const current = ROWS.findIndex((row) => row.includes(state.zone));
  if (current < 0) return moveZone(state, context, step);
  for (let hop = 1; hop <= ROWS.length; hop++) {
    const row = ROWS[(current + step * hop + ROWS.length * hop) % ROWS.length]!;
    const zone = row.find((id) => (zones.get(id) ?? []).length > 0);
    if (zone) return { ...state, zone, index: 0 };
  }
  return state;
}

const announceSlot = (slot: BoardSlot | null, zone: ZoneId, total: number): string =>
  slot ? `${ZONE_LABEL[zone]}, ${slot.index + 1} of ${total}. ${slot.label}` : `${ZONE_LABEL[zone]}, empty.`;

// ---------------------------------------------------------------------------

/**
 * One key press.
 *
 * `key` is `KeyboardEvent.key`; `shift` is the modifier. Anything unrecognised
 * comes back `handled: false` so the browser keeps its own shortcuts — a game
 * that swallows Ctrl+W or the screen reader's own navigation keys is worse than
 * one with no shortcuts at all.
 */
export function handleKey(
  state: KeyboardState,
  key: string,
  context: KeyboardContext,
  shift = false
): KeyboardResult {
  const placing = state.mode === "slotPicking";
  const slots = slotsOf(context, state.zone, placing);
  const slot = slots[Math.min(state.index, slots.length - 1)] ?? null;
  const nothing = { state, handled: false };

  // ---- fast-forward -------------------------------------------------------
  if (key === " " && context.animating) {
    return { state, action: { kind: "fastForward" }, handled: true };
  }

  // ---- always available ---------------------------------------------------
  switch (key) {
    case "?":
      return { state, action: { kind: "openShortcuts" }, handled: true };
    case "`":
      return { state, action: { kind: "focusMirror" }, say: "Board state.", handled: true };
    case "Tab": {
      const next = moveZone(state, context, shift ? -1 : 1);
      const nextSlots = slotsOf(context, next.zone, placing);
      return { state: next, say: announceSlot(nextSlots[0] ?? null, next.zone, nextSlots.length), handled: true };
    }
  }

  // ---- targeting an attack ------------------------------------------------
  if (state.mode === "attackSelect") {
    if (key === "Escape") {
      return { state: { ...state, mode: "browsing", attackerInstanceId: null, targets: [] }, say: "Attack cancelled.", handled: true };
    }
    if (key === "ArrowLeft" || key === "ArrowRight" || key === "t" || key === "T") {
      if (state.targets.length === 0) return { state, handled: true };
      const step = key === "ArrowLeft" ? -1 : 1;
      const targetIndex = (state.targetIndex + step + state.targets.length) % state.targets.length;
      return {
        state: { ...state, targetIndex },
        say: describeTarget(context.content, context.view, context.legality, state.targets[targetIndex]!, targetIndex, state.targets.length),
        handled: true,
      };
    }
    if (key === "Enter") {
      const target = state.targets[state.targetIndex];
      if (!target || !state.attackerInstanceId) return { state, handled: true };
      return {
        state: { ...initialKeyboardState(), zone: state.zone, index: state.index },
        action: { kind: "attack", attackerInstanceId: state.attackerInstanceId, target },
        handled: true,
      };
    }
    return nothing;
  }

  // ---- placing a character ------------------------------------------------
  if (state.mode === "slotPicking") {
    if (key === "Escape") {
      return { state: { ...state, mode: "cardSelected" }, say: "Slot cancelled.", handled: true };
    }
    if (key === "ArrowLeft" || key === "ArrowRight") {
      const step = key === "ArrowLeft" ? -1 : 1;
      const empties = slots.filter((entry) => entry.ref.kind === "emptySlot");
      if (empties.length === 0) return { state, handled: true };
      const at = Math.max(0, empties.findIndex((entry) => entry.index === state.index));
      const next = empties[(at + step + empties.length) % empties.length]!;
      return {
        state: { ...state, index: next.index },
        say: `${next.label} ${empties.length} legal slot${empties.length === 1 ? "" : "s"} remain.`,
        handled: true,
      };
    }
    if (key === "Enter" || key === "p" || key === "P") {
      const target = slots[state.index];
      if (!target || target.ref.kind !== "emptySlot" || !state.cardInstanceId) {
        return { state, say: "That slot is taken.", handled: true };
      }
      return {
        state: initialKeyboardState(),
        action: { kind: "playCard", instanceId: state.cardInstanceId, slot: target.ref.slot },
        handled: true,
      };
    }
    return nothing;
  }

  // ---- a hand card is selected --------------------------------------------
  if (state.mode === "cardSelected") {
    if (key === "Escape") {
      return { state: { ...initialKeyboardState(), zone: state.zone, index: state.index }, say: "Selection cancelled.", handled: true };
    }
    if (key === "Enter" || key === "p" || key === "P") {
      const instanceId = state.cardInstanceId;
      if (!instanceId) return { state: initialKeyboardState(), handled: true };
      const card = context.view.you.hand.find((entry) => entry.instanceId === instanceId);
      const definition = card ? context.content.cards[card.cardId] : undefined;
      if (definition?.type === "character") {
        const empties = slotsOf(context, "yourBoard", true).filter((entry) => entry.ref.kind === "emptySlot");
        if (empties.length === 0) return { state, say: "Your board is full.", handled: true };
        return {
          state: { ...state, mode: "slotPicking", zone: "yourBoard", index: empties[0]!.index },
          say: `${empties[0]!.label} ${empties.length} legal slot${empties.length === 1 ? "" : "s"} remain.`,
          handled: true,
        };
      }
      // everything else goes straight to the existing play flow, which opens the
      // chooser for targets and branches — the same one the pointer opens
      return { state: initialKeyboardState(), action: { kind: "playCard", instanceId }, handled: true };
    }
  }

  // ---- browsing -----------------------------------------------------------
  switch (key) {
    case "ArrowLeft":
    case "ArrowRight": {
      if (slots.length === 0) return { state, handled: true };
      const step = key === "ArrowLeft" ? -1 : 1;
      const index = (state.index + step + slots.length) % slots.length;
      return { state: { ...state, index }, say: announceSlot(slots[index]!, state.zone, slots.length), handled: true };
    }
    case "ArrowUp":
    case "ArrowDown": {
      const next = moveRow(state, context, key === "ArrowUp" ? -1 : 1);
      const nextSlots = slotsOf(context, next.zone);
      return { state: next, say: announceSlot(nextSlots[0] ?? null, next.zone, nextSlots.length), handled: true };
    }
    case "Escape":
      return { state: initialKeyboardState(), action: { kind: "openMenu" }, handled: true };
    case "x":
    case "X":
      return { state, action: { kind: "endTurn" }, handled: true };
    case "f":
    case "F":
      return { state, action: { kind: "fixation", ultimate: shift }, handled: true };
    case "c":
    case "C": {
      const available = context.legality.confluences.filter((entry) => entry.available);
      if (available.length === 0) {
        const blocked = context.legality.confluences[0];
        return {
          state,
          say: blocked
            ? `No Confluence available. ${context.content.confluences[blocked.confluence]?.name ?? blocked.confluence}: ${blocked.reasonUnavailable ?? "not ready"}.`
            : "No Confluence available.",
          handled: true,
        };
      }
      return { state, action: { kind: "confluence", confluenceId: available[0]!.confluence }, handled: true };
    }
    case "l":
    case "L":
      if (!context.legality.canActivateLocation) return { state, say: "No location to activate.", handled: true };
      return { state, action: { kind: "activateLocation" }, handled: true };
    case "h":
    case "H":
      return { state, action: { kind: "openHistory" }, handled: true };
    case "i":
    case "I":
      if (!slot) return { state, handled: true };
      return { state, action: shift ? { kind: "rulesLens", slot } : { kind: "inspect", slot }, handled: true };
    case "a":
    case "A": {
      return beginAttack(state, context, slot);
    }
    case "Enter": {
      if (!slot) return { state, handled: true };
      return activate(state, context, slot);
    }
  }

  // ---- 1-9 and 0 select a hand card by position ---------------------------
  if (/^[0-9]$/.test(key)) {
    const position = key === "0" ? 9 : Number(key) - 1;
    const hand = slotsOf(context, "hand");
    const target = hand[position];
    if (!target) return { state, say: `No card ${position + 1}.`, handled: true };
    return {
      state: { ...state, mode: "cardSelected", zone: "hand", index: position, cardInstanceId: idOf(target) },
      say: `${target.label} Enter to play.`,
      handled: true,
    };
  }

  return nothing;
}

const idOf = (slot: BoardSlot): string | null =>
  slot.ref.kind === "handCard" || slot.ref.kind === "character" ? slot.ref.instanceId : null;

/** `A`, or Enter on a ready friendly character. */
function beginAttack(state: KeyboardState, context: KeyboardContext, slot: BoardSlot | null): KeyboardResult {
  if (!slot || slot.ref.kind !== "character" || !context.legality.canAttack.has(slot.ref.instanceId)) {
    return { state, say: "Nothing there can attack.", handled: true };
  }
  const targets = context.attackTargets(slot.ref.instanceId);
  if (targets.length === 0) return { state, say: "No legal targets.", handled: true };
  return {
    state: { ...state, mode: "attackSelect", attackerInstanceId: slot.ref.instanceId, targets, targetIndex: 0 },
    say: describeTarget(context.content, context.view, context.legality, targets[0]!, 0, targets.length),
    handled: true,
  };
}

/** Enter, in `browsing` — whatever the focused thing does. */
function activate(state: KeyboardState, context: KeyboardContext, slot: BoardSlot): KeyboardResult {
  switch (slot.ref.kind) {
    case "handCard": {
      if (!context.legality.playable.has(slot.ref.instanceId)) {
        return { state, say: "That card can't be played right now.", handled: true };
      }
      return {
        state: { ...state, mode: "cardSelected", cardInstanceId: slot.ref.instanceId },
        say: `${slot.label} Enter to play.`,
        handled: true,
      };
    }
    case "character":
      return beginAttack(state, context, slot);
    case "leader":
      if (slot.ref.seat !== context.view.seat) return { state, say: slot.label, handled: true };
      if (context.legality.canFixation || context.legality.canUltimate) {
        return { state, action: { kind: "fixation", ultimate: !context.legality.canFixation }, handled: true };
      }
      return { state, say: slot.label, handled: true };
    case "location":
      if (slot.ref.seat !== context.view.seat || !context.legality.canActivateLocation) {
        return { state, say: slot.label, handled: true };
      }
      return { state, action: { kind: "activateLocation" }, handled: true };
    case "confluence":
      return { state, action: { kind: "confluence", confluenceId: slot.ref.confluenceId }, handled: true };
    case "button":
      return {
        state,
        action: slot.ref.id === "endTurn" ? { kind: "endTurn" } : { kind: "openHistory" },
        handled: true,
      };
    default:
      return { state, say: slot.label, handled: true };
  }
}

/**
 * §13.2's table, for the `?` sheet.
 *
 * Authored here rather than in the screen so the sheet and the reducer cannot
 * disagree about what a key does — a shortcut list that lies is worse than none.
 */
export const SHORTCUTS: readonly { keys: string; action: string }[] = [
  { keys: "1–9, 0", action: "Select hand card by position" },
  { keys: "← →", action: "Move within the current zone" },
  { keys: "↑ ↓", action: "Move between your row, the seam and the enemy row" },
  { keys: "Tab / Shift+Tab", action: "Next / previous zone" },
  { keys: "Enter", action: "Select, place, attack, or activate" },
  { keys: "P", action: "Play the selected card" },
  { keys: "A", action: "Attack with the selected character" },
  { keys: "T", action: "Cycle legal targets" },
  { keys: "F / Shift+F", action: "Fixation / Ultimate" },
  { keys: "C", action: "Confluence" },
  { keys: "L", action: "Activate your location" },
  { keys: "I / Shift+I", action: "Inspect the focused card / open the Rules Lens" },
  { keys: "H", action: "History rail" },
  { keys: "X", action: "End turn" },
  { keys: "Esc", action: "Cancel, or open the match menu" },
  { keys: "`", action: "Jump to the Board Mirror" },
  { keys: "Space", action: "Fast-forward the animation queue" },
  { keys: "?", action: "This sheet" },
];

/**
 * §13.2 entries this build does not bind, and why.
 *
 * Every one needs a system that does not exist rather than a key that was not
 * wired, which is the distinction worth writing down.
 */
export const DEFERRED_KEYS: ReadonlyMap<string, string> = new Map([
  ["R — inspect set Reactions", "Reactions are visible in the Board Mirror and on the board; a dedicated inspector is a panel that does not exist yet."],
  ["V — inspect active Events", "Same: the Mirror lists active events with their remaining turns, and there is no separate panel to open."],
  ["D — deck and discard piles", "The counts are in the Mirror; a browsable pile viewer is a screen of its own and would need its own keyboard model."],
  ["M — emote wheel", "Emotes are sent to an opponent over a transport that does not exist offline."],
  [
    "Shift+M — mute opponent emotes",
    "Nothing to mute, for the same reason: the only opponent offline is the AI, and it does not emote at you.",
  ],
  ["Remapping (§15)", "The default profile is the only profile; a remap editor needs a bindings store and a conflict checker, and an editor with nothing to remap would be a lie."],
]);
