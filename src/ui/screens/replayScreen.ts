/**
 * Replay Theater.
 *
 * A match record is `{config, intents[]}`, and the engine reproduces the whole
 * game from it — that determinism is load-bearing for the future server, so
 * this screen is mostly a window onto machinery that already existed. It
 * re-simulates the record intent by intent and lets you scrub the result.
 *
 * It deliberately shows the *board state* at each step rather than the 3D
 * battle: the battle screen owns a live driver and an animation queue, and
 * pointing it at a replay would mean teaching it a second lifecycle. A compact,
 * readable timeline is both honest about what this is and useful for the thing
 * replays are actually for — working out what happened.
 */

import type { ContentIndex, MatchState, PlayerIntent } from "../../engine/types";
import type { Screen } from "../shell";
import { replay } from "../../engine/replay";
import { createMatch } from "../../engine/state";
import { applyIntent, beginScriptedMatch } from "../../engine/reducer";
import { resolveMatchContent } from "../../engine/content";
import { getProfile, REPLAYABLE_HISTORY, type MatchHistoryEntry } from "../../save/profile";
import { CURRENT_PALETTE } from "../cardRenderer/palette";
import { audio } from "../../audio/audio";

export interface ReplayCallbacks {
  onBack: () => void;
  /** "run it back" — a fresh match against the same AI difficulty (§4.5.5) */
  onRematch: (difficulty: string) => void;
}

/** The filters §4.5.5 asks for: mode, faction and result. */
interface HistoryFilter {
  mode: string;
  factionId: string;
  result: string;
}

const DATE = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** One board snapshot per intent, plus the opening position. */
interface Frame {
  state: MatchState;
  label: string;
}

function describeIntent(intent: PlayerIntent, content: ContentIndex, state: MatchState): string {
  const who = intent.seat === 0 ? "You" : "Rival";
  const nameOf = (cardId: string) => content.cards[cardId]?.name ?? cardId;
  switch (intent.type) {
    case "playCard": {
      const card = state.players[intent.seat].hand.find((c) => c.instanceId === intent.instanceId);
      return `${who} played ${card ? nameOf(card.cardId) : "a card"}`;
    }
    case "attack": {
      const attacker = state.players[intent.seat].board.find(
        (c) => c?.instanceId === intent.attackerInstanceId
      );
      const targetRef = intent.target;
      const target =
        targetRef.kind === "leader"
          ? "the leader"
          : nameOf(
              state.players[0].board
                .concat(state.players[1].board)
                .find((c) => c?.instanceId === targetRef.instanceId)?.cardId ?? "a character"
            );
      return `${who} attacked ${target} with ${attacker ? nameOf(attacker.cardId) : "a character"}`;
    }
    case "useFixation":
      return `${who} used their ${intent.kind === "ultimate" ? "Ultimate" : "Fixation"}`;
    case "activateConfluence":
      return `${who} activated ${content.confluences[intent.confluence]?.name ?? intent.confluence}`;
    case "mulligan":
      return `${who} mulliganed ${intent.replaceInstanceIds.length} card(s)`;
    case "endTurn":
      return `${who} ended the turn`;
    case "concede":
      return `${who} conceded`;
    default:
      return `${who}: ${intent.type}`;
  }
}

/** Re-simulate a record into one frame per intent. */
function buildFrames(entry: MatchHistoryEntry, baseContent: ContentIndex): { frames: Frame[]; error: string | null } {
  const record = entry.record;
  if (!record) return { frames: [], error: "This match is too old to replay." };

  const content = resolveMatchContent(
    baseContent,
    record.config.balanceOverrides,
    record.config.cardOverrides,
    record.config.cardVariants
  );
  let state = createMatch(record.config, content);
  if (record.config.scenario?.mulligan === "none") beginScriptedMatch(state, content);

  const frames: Frame[] = [{ state, label: "Opening" }];
  for (const intent of record.intents) {
    const label = describeIntent(intent, content, state);
    try {
      state = applyIntent(state, content, intent).state;
    } catch (error) {
      return { frames, error: error instanceof Error ? error.message : String(error) };
    }
    frames.push({ state, label });
  }
  return { frames, error: null };
}

export function createReplayScreen(content: ContentIndex, callbacks: ReplayCallbacks): Screen {
  const history = getProfile().history;

  const root = document.createElement("div");
  root.className = "screen replay-screen";
  root.innerHTML = `
    <div class="ambient-bg"></div>
    <header class="sub-header">
      <button class="btn btn-ghost" id="replay-back">← Lobby</button>
      <h1 class="title">Match History</h1>
      <div class="sub-header-meta muted">${history.length} match${history.length === 1 ? "" : "es"} on record</div>
    </header>
    <div class="replay-filters" id="replay-filters"></div>
    <div class="replay-body">
      <aside class="replay-list scroll" id="replay-list"></aside>
      <section class="replay-stage panel" id="replay-stage"></section>
    </div>`;

  const list = root.querySelector("#replay-list")!;
  const stage = root.querySelector("#replay-stage")!;

  if (history.length === 0) {
    stage.innerHTML = `<div class="replay-empty muted">Play a match and it will appear here.</div>`;
  }

  const showEmptyPrompt = (): void => {
    stage.innerHTML = `<div class="replay-empty muted">Pick a match on the left.</div>`;
  };
  if (history.length > 0) showEmptyPrompt();

  const open = (entry: MatchHistoryEntry): void => {
    const { frames, error } = buildFrames(entry, content);

    if (frames.length === 0) {
      stage.innerHTML = `<div class="replay-empty muted">${error ?? "Nothing to show."}</div>`;
      return;
    }

    let index = frames.length - 1;

    /**
     * "Run it back" is offered only for practice matches, and that is not a
     * simplification. A story battle, a boss week, a Doomscroll fight and a tour
     * loaner all come with state around them — a chapter to be in, a run to be
     * on — and a button that dropped you into the same board without that state
     * would be a different match wearing the same name.
     */
    const rematchDifficulty = entry.mode.startsWith("ai-") ? entry.mode.slice(3) : null;
    const opponentName = content.leaders[entry.opponentLeaderCardId]?.name ?? "—";

    stage.innerHTML = `
      <div class="replay-head">
        <div>
          <div class="eyebrow">${entry.mode} · ${DATE.format(new Date(entry.playedAt))}</div>
          <h2 class="title">${entry.deckName}</h2>
          <div class="muted">vs ${opponentName} · ${entry.turns} turns${
            entry.summary
              ? ` · peak Obsession ${entry.summary.peakObsession} · ${entry.summary.cardsPlayed} cards played`
              : ""
          }</div>
        </div>
        <div class="replay-head-actions">
          ${rematchDifficulty ? `<button class="btn btn-ghost" id="replay-rematch">Run it back</button>` : ""}
          <div class="replay-result replay-${entry.result}">${entry.result.toUpperCase()}</div>
        </div>
      </div>
      ${error ? `<div class="replay-warning">Replay stopped early: ${error}</div>` : ""}
      <div class="replay-board" id="replay-board"></div>
      <div class="replay-caption" id="replay-caption"></div>
      <div class="replay-controls">
        <button class="btn btn-ghost" id="replay-first" aria-label="First">⏮</button>
        <button class="btn btn-ghost" id="replay-prev" aria-label="Previous">◀</button>
        <input type="range" id="replay-scrub" min="0" max="${frames.length - 1}" value="${index}"
               aria-label="Timeline" />
        <button class="btn btn-ghost" id="replay-next" aria-label="Next">▶</button>
        <button class="btn btn-ghost" id="replay-last" aria-label="Last">⏭</button>
        <span class="replay-counter muted" id="replay-counter"></span>
      </div>`;

    const board = stage.querySelector("#replay-board")!;
    const caption = stage.querySelector("#replay-caption")!;
    const counter = stage.querySelector("#replay-counter")!;
    const scrub = stage.querySelector<HTMLInputElement>("#replay-scrub")!;

    const side = (state: MatchState, seat: 0 | 1): string => {
      const player = state.players[seat];
      const leader = content.leaders[player.leaderCardId];
      const units = player.board
        .filter((c) => c !== null)
        .map((c) => {
          const palette = CURRENT_PALETTE[c!.current];
          return `<span class="replay-unit" style="--c:${palette.key}">
            ${content.cards[c!.cardId]?.name ?? c!.cardId}
            <b>${c!.attack}/${c!.health}</b>
          </span>`;
        })
        .join("");
      return `
        <div class="replay-side">
          <div class="replay-side-head">
            <span class="replay-leader">${leader?.name ?? "—"}</span>
            <span class="replay-hp">${player.leaderHealth} HP</span>
            <span class="muted">${player.hype}/${player.hypeMax} Hype · ${player.obsession} Obs · ${player.hand.length} in hand</span>
          </div>
          <div class="replay-units">${units || '<span class="muted">empty board</span>'}</div>
        </div>`;
    };

    const render = (): void => {
      const frame = frames[index]!;
      board.innerHTML = side(frame.state, 1) + '<div class="replay-divider"></div>' + side(frame.state, 0);
      caption.textContent = frame.label;
      counter.textContent = `${index} / ${frames.length - 1}`;
      scrub.value = String(index);
    };

    const go = (next: number): void => {
      index = Math.max(0, Math.min(frames.length - 1, next));
      render();
    };

    stage.querySelector("#replay-rematch")?.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      callbacks.onRematch(rematchDifficulty!);
    });
    stage.querySelector("#replay-first")!.addEventListener("click", () => go(0));
    stage.querySelector("#replay-prev")!.addEventListener("click", () => go(index - 1));
    stage.querySelector("#replay-next")!.addEventListener("click", () => go(index + 1));
    stage.querySelector("#replay-last")!.addEventListener("click", () => go(frames.length - 1));
    scrub.addEventListener("input", () => go(Number(scrub.value)));
    render();
  };

  /**
   * §4.5.5's filters. Kept as one object so `matching()` is the single place
   * that decides what a filtered history is — the list, the count in the header
   * and the automation hook all read the same answer.
   */
  const filter: HistoryFilter = { mode: "all", factionId: "all", result: "all" };
  const factionOf = (leaderCardId: string): string => content.leaders[leaderCardId]?.faction ?? "";
  const baseMode = (mode: string): string => mode.split("-")[0] ?? mode;

  const matching = (): MatchHistoryEntry[] =>
    history.filter((entry) => {
      if (filter.mode !== "all" && baseMode(entry.mode) !== filter.mode) return false;
      if (filter.factionId !== "all" && factionOf(entry.leaderCardId) !== filter.factionId) return false;
      if (filter.result !== "all" && entry.result !== filter.result) return false;
      return true;
    });

  const filterBar = root.querySelector("#replay-filters")!;

  const renderFilters = (): void => {
    const modes = [...new Set(history.map((entry) => baseMode(entry.mode)))].sort();
    const factions = [...new Set(history.map((entry) => factionOf(entry.leaderCardId)).filter(Boolean))].sort();
    const group = (key: keyof HistoryFilter, options: { id: string; label: string }[]): string =>
      options
        .map(
          (option) =>
            `<button class="btn mastery-tab ${filter[key] === option.id ? "active" : ""}"
                     data-filter="${key}" data-value="${option.id}">${option.label}</button>`
        )
        .join("");

    filterBar.innerHTML = `
      <div class="replay-filter-group">
        ${group("result", [
          { id: "all", label: "All" },
          { id: "win", label: "Wins" },
          { id: "loss", label: "Losses" },
        ])}
      </div>
      <div class="replay-filter-group">
        ${group("mode", [
          { id: "all", label: "All modes" },
          ...modes.map((id) => ({ id, label: id })),
        ])}
      </div>
      ${
        factions.length > 1
          ? `<div class="replay-filter-group">
               ${group("factionId", [
                 { id: "all", label: "All factions" },
                 ...factions.map((id) => ({
                   id,
                   label: content.factions[id as keyof typeof content.factions]?.name ?? id,
                 })),
               ])}
             </div>`
          : ""
      }`;

    for (const button of filterBar.querySelectorAll<HTMLElement>("[data-filter]")) {
      button.addEventListener("click", () => {
        const key = button.dataset["filter"] as keyof HistoryFilter;
        filter[key] = button.dataset["value"] ?? "all";
        audio.play("sfx.ui.hover");
        renderFilters();
        renderList();
      });
    }
  };

  function renderList(): void {
    list.innerHTML = "";
    const shown = matching();

    if (shown.length === 0) {
      const empty = document.createElement("p");
      empty.className = "muted replay-note";
      empty.textContent =
        history.length === 0 ? "Play a match and it will appear here." : "No matches match those filters.";
      list.appendChild(empty);
      showEmptyPrompt();
      return;
    }

    shown.forEach((entry, i) => {
      const button = document.createElement("button");
      button.className = `replay-entry replay-${entry.result}`;
      button.type = "button";
      const replayable = Boolean(entry.record);
      button.disabled = !replayable;
      const opponent = content.leaders[entry.opponentLeaderCardId]?.name ?? "—";
      // the Obsession peak §4.5.5 asks for, on the matches that recorded it
      const obsession = entry.summary ? ` · Obs ${entry.summary.peakObsession}` : "";
      button.innerHTML = `
        <span class="replay-entry-result">${entry.result[0]!.toUpperCase()}</span>
        <span class="replay-entry-body">
          <span class="replay-entry-deck">${entry.deckName}</span>
          <span class="replay-entry-meta muted">vs ${opponent} · ${entry.turns} turns${obsession}</span>
          <span class="replay-entry-meta muted">${entry.mode} · ${DATE.format(new Date(entry.playedAt))}${
            replayable ? "" : " · not replayable"
          }</span>
        </span>`;
      button.addEventListener("click", () => {
        audio.play("sfx.ui.click");
        list.querySelectorAll(".replay-entry").forEach((n) => n.classList.remove("selected"));
        button.classList.add("selected");
        open(entry);
      });
      list.appendChild(button);
      if (i === 0 && replayable) button.click();
    });

    if (history.length > REPLAYABLE_HISTORY) {
      const note = document.createElement("p");
      note.className = "muted replay-note";
      note.textContent = `Only the ${REPLAYABLE_HISTORY} most recent matches keep a full replay.`;
      list.appendChild(note);
    }
  }

  renderFilters();
  renderList();

  root.querySelector("#replay-back")!.addEventListener("click", () => callbacks.onBack());

  // exposed so automation can assert a replay reproduced the recorded result
  (window as unknown as { hypeboundReplay?: unknown }).hypeboundReplay = {
    entries: () => getProfile().history.map((h) => ({ id: h.id, result: h.result, replayable: Boolean(h.record) })),
    verify: (id: string) => {
      const entry = getProfile().history.find((h) => h.id === id);
      if (!entry?.record) return null;
      const result = replay(entry.record, content);
      return { errors: result.errors, winner: result.state.winner };
    },
  };

  return { root };
}
