/**
 * The Board Mirror — `13-accessibility.md` §16.2, and the announcements of
 * §16.3.
 *
 * *"The three.js canvas is opaque to assistive technology, so `hud.ts` renders a
 * visually-hidden, always-current DOM tree describing the entire visible match
 * state. It is built from the same `EngineEvent` stream and redacted
 * `PlayerView` the presenter consumes — so it can never drift from the board."*
 *
 * That last clause is the whole design, and it is why the mirror is a render of
 * `mirrorLines(view)` rather than something maintained by hand as events arrive.
 * A hand-maintained mirror is a second copy of the game state, and a second copy
 * is a thing that goes wrong quietly: it would describe a board that used to be
 * there, and the player relying on it most is the one least able to notice.
 *
 * Announcements are the other half. They are the *deltas* — what just happened —
 * and they do come from the event stream, because "Chatstorm Piper was defeated"
 * is not visible in a snapshot of a board that no longer contains it.
 */

import type { ContentIndex, EngineEvent, PlayerView } from "../../engine/types";
import { mirrorLines, type Legality } from "./boardModel";

// ---------------------------------------------------------------------------
// §16.3 — announcements
// ---------------------------------------------------------------------------

export type Politeness = "polite" | "assertive";

export interface Announcement {
  text: string;
  politeness: Politeness;
  /** §16.3 marks some rows ★ — those survive the "Key events" verbosity level */
  key: boolean;
}

const nameOf = (content: ContentIndex, cardId: string): string => content.cards[cardId]?.name ?? cardId;

function targetName(content: ContentIndex, view: PlayerView, target: { kind: string; instanceId?: string; seat?: number }): string {
  if (target.kind === "leader") {
    const player = target.seat === view.seat ? view.you : view.opponent;
    return target.seat === view.seat ? "your leader" : `${nameOf(content, player.leaderCardId)}`;
  }
  const character =
    view.you.board.find((entry) => entry?.instanceId === target.instanceId) ??
    view.opponent.board.find((entry) => entry?.instanceId === target.instanceId);
  return character ? nameOf(content, character.cardId) : "a character";
}

/**
 * One event, as a sentence — §16.3's template table.
 *
 * Returns null for events with nothing to say. Most of the engine's forty-odd
 * event kinds are bookkeeping the player never needs read aloud, and a mirror
 * that narrates every one of them is one nobody can listen to.
 */
export function announce(content: ContentIndex, view: PlayerView, event: EngineEvent): Announcement | null {
  const yours = (seat: number): boolean => seat === view.seat;

  switch (event.e) {
    case "turnStarted":
      return {
        text: yours(event.seat)
          ? `Your turn. Turn ${event.turn}. Hype ${view.you.hype} of ${view.you.hypeMax}.`
          : `Opponent's turn. Turn ${event.turn}.`,
        politeness: "assertive",
        key: true,
      };
    case "cardPlayed":
      return {
        text: `${yours(event.seat) ? "You" : "Opponent"} played ${nameOf(content, event.cardId)}, ${event.cost} Hype.`,
        politeness: "polite",
        key: true,
      };
    case "characterSummoned":
      return {
        text: `${nameOf(content, event.instance.cardId)} summoned to slot ${event.instance.slot + 1}, ${
          event.instance.attack
        } attack ${event.instance.health} health.`,
        politeness: "polite",
        key: false,
      };
    case "damageDealt": {
      if (event.amount <= 0 && !event.absorbedByShield) return null;
      const bits = [`${targetName(content, view, event.target)} took ${event.amount}`];
      if (event.elementalBonus) bits.push("including a Current bonus");
      if (event.absorbedByArmor > 0) bits.push(`${event.absorbedByArmor} absorbed by armor`);
      if (event.absorbedByShield) bits.push("shield broken");
      return { text: `${bits.join(", ")}.`, politeness: "polite", key: true };
    }
    case "healed":
      if (event.amount <= 0) return null;
      return {
        text: `${targetName(content, view, event.target)} healed ${event.amount}${event.blocked ? " — healing blocked" : ""}.`,
        politeness: "polite",
        key: false,
      };
    case "statusApplied":
      return {
        text: `${targetName(content, view, event.target)} is now ${content.statuses[event.status.id]?.name ?? event.status.id}.`,
        politeness: "polite",
        key: false,
      };
    case "characterDefeated":
      return { text: `${nameOf(content, event.instance.cardId)} was defeated.`, politeness: "polite", key: true };
    case "confluenceActivated": {
      const definition = content.confluences[event.confluence];
      return {
        text: `${definition?.name ?? event.confluence} activated: ${event.currents
          .map((current) => content.currents[current]?.name ?? current)
          .join(" plus ")}.`,
        politeness: "assertive",
        key: true,
      };
    }
    case "resonanceActivated":
      return {
        text: `Perfect Resonance: ${content.currents[event.current]?.name ?? event.current}.`,
        politeness: "assertive",
        key: true,
      };
    case "obsessedThresholdCrossed":
      if (!event.nowObsessed) return null;
      return {
        text: `${yours(event.seat) ? "You are" : "Opponent is"} Obsessed. Their leader takes 1 extra damage from all sources.`,
        politeness: "assertive",
        key: true,
      };
    case "fullFixation":
      return { text: "Full Fixation. Your Ultimate costs zero this turn.", politeness: "assertive", key: true };
    case "cardDrawn":
      if (!yours(event.seat) || !event.cardId) return null;
      return { text: `Drew ${nameOf(content, event.cardId)}.`, politeness: "polite", key: false };
    case "cardBurned":
      return {
        text: `Hand full. ${nameOf(content, event.cardId)} was destroyed — lost in the Feed.`,
        politeness: "assertive",
        key: true,
      };
    case "fatigueDamage":
      return {
        text: `Burnout: ${event.amount} damage to ${yours(event.seat) ? "your" : "the opponent's"} leader.`,
        politeness: "assertive",
        key: true,
      };
    case "reactionTriggered":
      return { text: `Reaction: ${nameOf(content, event.cardId)} triggered.`, politeness: "assertive", key: true };
    case "characterBanished":
      return {
        text: `${nameOf(content, event.cardId)} banished${event.returnsOnTurn ? `, returns on turn ${event.returnsOnTurn}` : ""}.`,
        politeness: "polite",
        key: false,
      };
    case "matchEnded":
      return {
        text: event.winner === "draw" ? "Draw." : event.winner === view.seat ? "Victory." : "Defeat.",
        politeness: "assertive",
        key: true,
      };
    default:
      return null;
  }
}

/**
 * §16.3: *"never more than one utterance per 400 ms, and identical repeated
 * events are batched."*
 *
 * Both halves matter and for different reasons. Un-throttled, a trigger cascade
 * produces a dozen utterances a screen reader will queue and read for the next
 * thirty seconds, long after the board has moved on. Un-batched, Scorched ticking
 * on three characters is the same sentence three times.
 */
export const COALESCE_MS = 400;

export function coalesce(announcements: readonly Announcement[]): Announcement[] {
  const out: Announcement[] = [];
  for (const item of announcements) {
    const last = out[out.length - 1];
    if (last && last.text === item.text) continue;
    out.push(item);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The DOM
// ---------------------------------------------------------------------------

export interface BoardMirror {
  root: HTMLElement;
  /** re-render the whole state tree from a view */
  sync: (view: PlayerView, legality: Legality) => void;
  /** say something now, through the right live region */
  say: (text: string, politeness?: Politeness) => void;
  /** queue an event's announcement, throttled and batched per §16.3 */
  report: (view: PlayerView, events: readonly EngineEvent[]) => void;
  focus: () => void;
  dispose: () => void;
}

export function createBoardMirror(content: ContentIndex): BoardMirror {
  const root = document.createElement("div");
  root.className = "board-mirror";
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", "Board state");
  root.tabIndex = -1;

  const list = document.createElement("ul");
  list.className = "board-mirror-list";
  root.appendChild(list);

  /**
   * Two live regions, because politeness is per-region and not per-message.
   * An assertive region interrupts whatever is being read; a polite one waits.
   * Putting "Victory." and "Drew Neon Nightcap." through the same one would make
   * both of them one or the other.
   */
  const polite = document.createElement("div");
  polite.className = "board-mirror-live";
  polite.setAttribute("aria-live", "polite");
  polite.setAttribute("aria-atomic", "true");

  const assertive = document.createElement("div");
  assertive.className = "board-mirror-live";
  assertive.setAttribute("aria-live", "assertive");
  assertive.setAttribute("aria-atomic", "true");
  root.append(polite, assertive);

  let queue: Announcement[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    timer = null;
    const next = queue.shift();
    if (!next) return;
    (next.politeness === "assertive" ? assertive : polite).textContent = next.text;
    if (queue.length > 0) timer = setTimeout(flush, COALESCE_MS);
  };

  const push = (announcement: Announcement): void => {
    queue.push(announcement);
    queue = coalesce(queue);
    if (timer === null) flush();
  };

  return {
    root,
    sync: (view, legality) => {
      const lines = mirrorLines(content, view, legality);
      list.replaceChildren(
        ...lines.map((line) => {
          const item = document.createElement("li");
          item.className = `board-mirror-line depth-${line.depth}`;
          item.dataset["depth"] = String(line.depth);
          item.textContent = line.text;
          return item;
        })
      );
    },
    say: (text, politeness = "polite") => push({ text, politeness, key: true }),
    report: (view, events) => {
      for (const event of events) {
        const announcement = announce(content, view, event);
        if (announcement) push(announcement);
      }
    },
    focus: () => root.focus(),
    dispose: () => {
      if (timer !== null) clearTimeout(timer);
      queue = [];
      root.remove();
    },
  };
}
