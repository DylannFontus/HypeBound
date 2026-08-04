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
import { CURRENT_PALETTE, FACTION_COLOR } from "../cardRenderer/palette";
import { audio } from "../../audio/audio";
import {
  chip,
  colourFor,
  count,
  crestMark,
  disposeBag,
  enter,
  esc,
  fadeOnScroll,
  icon,
  logStamp,
  modeName,
  quantify,
  rankCrest,
  RANK_PX,
  rovingList,
} from "./data/kit";

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
  const bag = disposeBag();

  root.innerHTML = `
    <div class="ambient-bg"></div>
    <header class="sub-header">
      <button class="btn btn-ghost" id="replay-back">${icon("arrow-left", 16)} Lobby</button>
      <h1 class="title">Match History</h1>
      <div class="sub-header-meta">${quantify(history.length, "match", "matches")} on record</div>
    </header>
    <div class="replay-filters d-chips" id="replay-filters"></div>
    <div class="replay-body">
      <aside class="replay-list" id="replay-list"></aside>
      <section class="replay-stage panel" id="replay-stage"></section>
    </div>`;

  const list = root.querySelector("#replay-list")!;
  const stage = root.querySelector("#replay-stage")!;

  /**
   * Two empty states, both designed, both saying something different.
   *
   * The old pair were bare sentences dropped into an 1100×730 void: "Play a
   * match and it will appear here." on the left in 12px grey with no plate
   * behind it, and "Pick a match on the left." centred in the stage. §5 asks for
   * a designed empty, and a screen with two of them worded differently is also
   * §7's consistency complaint.
   */
  const showNoHistory = (): void => {
    stage.innerHTML = `
      <div class="empty d-enter replay-empty">
        ${icon("mode-replays", 40)}
        <h3 class="t-heading">No matches on record</h3>
        <p class="t-body">Every match this device plays is recorded here, and the most recent ${REPLAYABLE_HISTORY} keep a full replay you can scrub turn by turn.</p>
      </div>`;
  };

  const showEmptyPrompt = (): void => {
    stage.innerHTML = `
      <div class="empty d-enter replay-empty">
        ${icon("crosshair", 40)}
        <h3 class="t-heading">Pick a match</h3>
        <p class="t-body">Choose one on the left and the board it was played on rebuilds here, intent by intent.</p>
      </div>`;
  };

  if (history.length === 0) showNoHistory();
  else showEmptyPrompt();

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

    const myFaction = content.leaders[entry.leaderCardId]?.faction ?? "neutral";
    const accent = FACTION_COLOR[myFaction as never] ?? "#b56cff";

    /**
     * The scrubber, drawn rather than inherited.
     *
     * It was a bare `<input type="range">` whose only rule was `flex: 1 1 auto`,
     * so it rendered as Chrome's #007AFF track and blue knob — a colour that
     * appears nowhere else in the palette, 900px wide, and therefore the most
     * saturated object on a magenta-and-violet screen. §7 calls an OS scrollbar
     * in a fantasy card game a tear in the world; an OS slider is the same sin
     * and louder.
     *
     * `.slider` is module A's control, so this now shares its groove, its
     * chamfered thumb and all six of its states with the settings audio rail.
     * `--slider-fill` is the property that module A's track reads to paint the
     * filled portion, and it is kept in step by the `input` handler below.
     * `--ticks` puts a mark at every turn boundary, so the timeline reads as
     * turns rather than as a volume control.
     */
    stage.innerHTML = `
      <div class="replay-head">
        <span class="d-rank replay-head-crest" style="--rank-size:56px;--rank-art:url('${rankCrest({
          size: RANK_PX,
          tier: entry.result === "win" ? 4 : entry.result === "draw" ? 2 : 1,
          tiers: 5,
          colour: accent,
        })}')" aria-hidden="true"></span>
        <div class="replay-head-text">
          <div class="t-label">${esc(modeName(entry.mode))} · ${esc(logStamp(entry.playedAt))}</div>
          <h2 class="title t-display">${esc(entry.deckName)}</h2>
          <div class="replay-head-meta">
            vs ${esc(opponentName)} · ${quantify(entry.turns, "turn")}${
              entry.summary
                ? ` · peak Obsession <span class="num">${count(entry.summary.peakObsession)}</span> · <span class="num">${count(
                    entry.summary.cardsPlayed
                  )}</span> cards played`
                : ""
            }
          </div>
        </div>
        <div class="replay-head-actions">
          ${
            rematchDifficulty
              ? `<button type="button" class="mat-chip act r-chip" id="replay-rematch">${icon(
                  "refresh",
                  14
                )} Run it back</button>`
              : ""
          }
          <div class="replay-result replay-${entry.result}">${entry.result.toUpperCase()}</div>
        </div>
      </div>
      ${error ? `<div class="replay-warning">${icon("warning", 15)} Replay stopped early: ${esc(error)}</div>` : ""}
      <div class="replay-board" id="replay-board"></div>
      <div class="replay-caption" id="replay-caption"></div>
      <div class="replay-controls">
        <button type="button" class="mat-chip act r-chip replay-step" id="replay-first" aria-label="First frame">${icon(
          "skip-start",
          16
        )}</button>
        <button type="button" class="mat-chip act r-chip replay-step" id="replay-prev" aria-label="Previous frame">${icon(
          "chevron-left",
          16
        )}</button>
        <input class="slider replay-scrub" type="range" id="replay-scrub" min="0" max="${frames.length - 1}"
               value="${index}" aria-label="Timeline"
               style="--ticks:${Math.max(1, frames.length - 1)}" />
        <button type="button" class="mat-chip act r-chip replay-step" id="replay-next" aria-label="Next frame">${icon(
          "chevron-right",
          16
        )}</button>
        <button type="button" class="mat-chip act r-chip replay-step" id="replay-last" aria-label="Last frame">${icon(
          "skip-end",
          16
        )}</button>
        <span class="replay-counter num" id="replay-counter"></span>
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
      /*
       * `shell.ts` syncs `--slider-fill` on `input`, which covers a drag and
       * does not cover the four step buttons — they set `.value` from script and
       * no event fires. Without this line the track's filled portion stays where
       * the last drag left it while the thumb walks away from it.
       */
      const span = frames.length - 1;
      scrub.style.setProperty("--slider-fill", `${span > 0 ? ((index / span) * 100).toFixed(2) : "0"}%`);
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

    /**
     * One chip component, one active state.
     *
     * The result group used to render its selection as a solid filled pill and
     * the mode group two centimetres away rendered its selection as an outline —
     * two answers to "what does selected look like" in the same 40px row, which
     * means a player cannot learn either. And the mode chips printed the raw
     * engine ids, so this screen said "ai" while the statistics screen one click
     * away said "Practice" about the same matches.
     */
    const group = (
      key: keyof HistoryFilter,
      label: string,
      options: { id: string; label: string; accent?: string }[]
    ): string => `
      <div class="replay-filter-group" role="radiogroup" aria-label="${esc(label)}">
        <span class="t-label replay-filter-label">${esc(label)}</span>
        ${options
          .map((option) =>
            chip({
              label: option.label,
              value: option.id,
              active: filter[key] === option.id,
              key: "value",
              accent: option.accent,
            }).replace("<button ", `<button data-filter="${key}" `)
          )
          .join("")}
      </div>`;

    filterBar.innerHTML = `
      ${group("result", "Result", [
        { id: "all", label: "All" },
        { id: "win", label: "Wins" },
        { id: "loss", label: "Losses" },
      ])}
      ${group("mode", "Mode", [
        { id: "all", label: "All modes" },
        ...modes.map((id) => ({ id, label: modeName(id) })),
      ])}
      ${
        factions.length > 1
          ? group("factionId", "Faction", [
              { id: "all", label: "All factions" },
              ...factions.map((id) => ({
                id,
                label: content.factions[id as keyof typeof content.factions]?.name ?? id,
                accent: colourFor(id),
              })),
            ])
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
    bag.run();
    list.innerHTML = "";
    const shown = matching();

    if (shown.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty d-enter replay-list-empty";
      empty.innerHTML =
        history.length === 0
          ? `${icon("campfire", 32)}<h3 class="t-heading">Nothing yet</h3><p class="t-body">Your first match lands at the top of this list.</p>`
          : `${icon("filter", 32)}<h3 class="t-heading">No match fits</h3><p class="t-body">Loosen a filter above.</p>`;
      list.appendChild(empty);
      if (history.length === 0) showNoHistory();
      else showEmptyPrompt();
      return;
    }

    shown.forEach((entry, i) => {
      const button = document.createElement("button");
      button.className = `replay-entry mat-panel act d-enter replay-${entry.result}`;
      button.type = "button";
      const replayable = Boolean(entry.record);
      button.disabled = !replayable;
      const opponent = content.leaders[entry.opponentLeaderCardId]?.name ?? "—";
      const faction = content.leaders[entry.leaderCardId]?.faction ?? "neutral";
      button.style.setProperty("--row-accent", colourFor(faction));
      // the Obsession peak §4.5.5 asks for, on the matches that recorded it
      const obsession = entry.summary ? ` · Obs ${count(entry.summary.peakObsession)}` : "";
      button.innerHTML = `
        ${crestMark(faction, 34)}
        <span class="replay-entry-body">
          <span class="replay-entry-deck">${esc(entry.deckName)}</span>
          <span class="replay-entry-meta">vs ${esc(opponent)} · ${quantify(entry.turns, "turn")}${obsession}</span>
          <span class="replay-entry-meta">${esc(modeName(entry.mode))} · ${esc(logStamp(entry.playedAt))}${
            replayable ? "" : " · not replayable"
          }</span>
        </span>
        <span class="replay-entry-result" aria-label="${entry.result}">${entry.result[0]!.toUpperCase()}</span>`;
      button.addEventListener("click", () => {
        audio.play("sfx.ui.click");
        list.querySelectorAll(".replay-entry").forEach((n) => {
          n.classList.remove("selected");
          n.removeAttribute("aria-current");
        });
        button.classList.add("selected");
        button.setAttribute("aria-current", "true");
        open(entry);
      });
      list.appendChild(button);
      if (i === 0 && replayable) button.click();
    });

    if (history.length > REPLAYABLE_HISTORY) {
      const note = document.createElement("p");
      note.className = "replay-note";
      note.textContent = `Only the ${REPLAYABLE_HISTORY} most recent matches keep a full replay.`;
      list.appendChild(note);
    }

    enter(list, ".d-enter", 26);
    bag.add(rovingList(list as HTMLElement, ".replay-entry"));
  }

  renderFilters();
  renderList();
  bag.add(fadeOnScroll(list as HTMLElement));

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

  return { root, dispose: () => bag.run() };
}
