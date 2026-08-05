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
  countUp,
  crestMark,
  disposeBag,
  enter,
  esc,
  fadeOnScroll,
  icon,
  artAttr,
  logStamp,
  modeName,
  quantify,
  paintArt,
  rankMark,
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

  /**
   * With nothing on record, the two-pane workbench is not the screen.
   *
   * A 300px sidebar holding one sentence beside an 1150×740 panel holding
   * another is what the recon measured, and it reads as content that failed to
   * load rather than as a state anybody designed. §2 calls an unresolved
   * composition exactly that. So the split only exists once there is something to
   * split: before the first match, the route is one plate, centred, on the key
   * art the rest of the domain uses, with the action that fixes it on it.
   */
  const virgin = history.length === 0;

  root.innerHTML = `
    <div class="ambient-bg"></div>
    <header class="sub-header">
      <button class="btn btn-ghost" id="replay-back">${icon("arrow-left", 16)} Lobby</button>
      <h1 class="title">Match History</h1>
      <div class="sub-header-meta">${quantify(history.length, "match", "matches")} on record</div>
    </header>
    ${virgin ? "" : '<div class="replay-filters d-chips" id="replay-filters"></div>'}
    <div class="replay-body ${virgin ? "is-virgin" : ""}">
      ${virgin ? "" : '<aside class="replay-list" id="replay-list"></aside>'}
      <section class="replay-stage mat-panel ${virgin ? "is-virgin" : ""}" id="replay-stage"></section>
    </div>`;

  if (virgin) {
    const stagePlate = root.querySelector("#replay-stage")!;
    stagePlate.innerHTML = `
      <div class="d-key replay-virgin-key" ${artAttr("ladder", [1280, 420, "#b56cff"])}
           style="--key-aspect:3/1" aria-hidden="true">
        <div class="d-key-scrim"></div>
      </div>
      <div class="empty d-enter replay-virgin-text">
        ${icon("mode-replays", 44)}
        <h3 class="t-heading">No matches on record</h3>
        <p class="t-body">
          Every match this device plays is written down here — the deck, the opponent, the length and
          the result. The most recent ${REPLAYABLE_HISTORY} keep a full replay you can scrub turn by turn,
          and nothing is ever sent anywhere.
        </p>
        <button type="button" class="mat-hero act r-chip" id="replay-play">${icon("play", 16)} Play a match</button>
      </div>`;
    root.querySelector("#replay-play")?.addEventListener("click", () => {
      audio.play("sfx.ui.confirm");
      callbacks.onBack();
    });
    root.querySelector("#replay-back")!.addEventListener("click", () => callbacks.onBack());
    enter(root, ".d-enter", 40);
    return { root, dispose: () => bag.run() };
  }

  const list = root.querySelector("#replay-list")!;
  const stage = root.querySelector("#replay-stage")!;

  /**
   * The one empty the workbench can still reach: every filter excludes everything.
   *
   * "No matches on record" now owns the whole route before the first match (see
   * `virgin` above) and never appears here. This one is only ever true because
   * the player asked for it, so it names the cause and the cure.
   */
  const showFilteredOut = (): void => {
    stage.innerHTML = `
      <div class="empty d-enter replay-empty">
        ${icon("filter", 40)}
        <h3 class="t-heading">No match fits</h3>
        <p class="t-body">Every match on record is filtered out. Loosen one of the filters above and the board comes back.</p>
      </div>`;
  };

  const open = (entry: MatchHistoryEntry): void => {
    const { frames, error } = buildFrames(entry, content);

    let index = Math.max(0, frames.length - 1);

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
        ${rankMark(
          { tier: entry.result === "win" ? 4 : entry.result === "draw" ? 2 : 1, tiers: 5, colour: accent },
          56
        )}
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
      ${
        error && frames.length > 0
          ? `<div class="replay-warning">${icon("warning", 15)} Replay stopped early: ${esc(error)}</div>`
          : ""
      }
      ${
        /*
         * A match with no record still has a match in it.
         *
         * Older entries drop their replay to keep the save small, and the old
         * screen answered that by disabling the row outright — so the majority of
         * a long history could not be *clicked*, and the stage beside it stayed
         * an 1100×730 rectangle with one grey sentence in it. The result, the
         * deck, the opponent, the length and the Obsession peak all survive
         * whether or not the intents do, and those are most of what somebody
         * opens this screen for. So every row opens, the header above is always
         * drawn, and only the board and the scrubber are replaced by a state that
         * says which part is missing and why.
         */
        frames.length === 0
          ? /*
             * What is left of a match whose intents have been dropped.
             *
             * The old answer was one 460px plate floating in the middle of a
             * 1030×740 stage, captioned "the result above is the whole of what
             * this match left behind" — and that sentence was **not true**. A
             * `MatchSummary` survives the record: cards played, characters
             * defeated, damage to the enemy leader, Confluences, perfect
             * Resonances and the Obsession peak. Six real numbers about the
             * match, discarded, while the screen said there was nothing left and
             * left two-thirds of its largest object empty. §2 reads an
             * unresolved lower half as content that failed to load; here it was
             * content that had loaded and was not being drawn.
             *
             * Only the entries with no summary at all — the oldest, from before
             * the deriver existed — reach the bare empty state now.
             */
            `${
              entry.summary
                ? `<div class="replay-recap d-enter">
                     <h3 class="t-label">What this match left behind</h3>
                     <dl class="d-stats replay-recap-stats">
                       <div class="d-stat"><dt>Cards played</dt><dd class="num" data-count="${
                         entry.summary.cardsPlayed
                       }" data-digits="3">0</dd></div>
                       <div class="d-stat"><dt>Characters defeated</dt><dd class="num" data-count="${
                         entry.summary.charactersDefeated
                       }" data-digits="3">0</dd></div>
                       <div class="d-stat"><dt>Damage to their leader</dt><dd class="num" data-count="${
                         entry.summary.damageToEnemyLeader
                       }" data-digits="3">0</dd></div>
                       <div class="d-stat"><dt>Peak Obsession</dt><dd class="num" data-count="${
                         entry.summary.peakObsession
                       }" data-digits="2">0</dd></div>
                       <div class="d-stat"><dt>Confluences</dt><dd class="num" data-count="${
                         entry.summary.confluencesActivated
                       }" data-digits="2">0</dd></div>
                       <div class="d-stat"><dt>Perfect Resonances</dt><dd class="num" data-count="${
                         entry.summary.perfectResonances
                       }" data-digits="2">0</dd></div>
                     </dl>
                   </div>`
                : ""
            }
            <div class="replay-noboard">
               <div class="d-key replay-noboard-key" ${artAttr("ladder", [1100, 340, accent])}
                    style="--key-aspect:3.4/1" aria-hidden="true">
                 <div class="d-key-scrim"></div>
               </div>
               <div class="empty d-enter replay-noreplay">
                 ${icon("mode-replays", 40)}
                 <h3 class="t-heading">The board is not kept for this one</h3>
                 <p class="t-body">Only the ${quantify(
                   REPLAYABLE_HISTORY,
                   "most recent match",
                   "most recent matches"
                 )} keep the full turn-by-turn record${
                   entry.summary ? ", so there is no board to scrub — the figures above are what survives" : ""
                 }.</p>
               </div>
             </div>`
          : `<div class="replay-board" id="replay-board"></div>
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
             </div>`
      }`;

    // The detail pane is written straight into `stage` rather than through the
    // screen's own render, so it never passes `enter()` — and `enter()` is where
    // the deferred pictures are kicked off. Without this the result crest in the
    // header would sit in its empty socket forever. `countUp` for the same
    // reason: the recap's six figures would print as a row of zeroes.
    paintArt(stage);
    enter(stage, ".d-enter", 34);
    countUp(stage);

    stage.querySelector("#replay-rematch")?.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      callbacks.onRematch(rematchDifficulty!);
    });

    if (frames.length === 0) return;

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
            <b class="num">${count(c!.attack)}/${count(c!.health)}</b>
          </span>`;
        })
        .join("");
      return `
        <div class="replay-side">
          <div class="replay-side-head">
            <span class="replay-leader">${leader?.name ?? "—"}</span>
            <span class="replay-hp"><span class="num">${count(player.leaderHealth)}</span> HP</span>
            <span class="muted"><span class="num">${count(player.hype)}</span>/<span class="num">${count(
              player.hypeMax
            )}</span> Hype · <span class="num">${count(player.obsession)}</span> Obs · <span class="num">${count(
              player.hand.length
            )}</span> in hand</span>
          </div>
          <div class="replay-units">${units || '<span class="muted">empty board</span>'}</div>
        </div>`;
    };

    const render = (): void => {
      const frame = frames[index]!;
      board.innerHTML = side(frame.state, 1) + '<div class="replay-divider"></div>' + side(frame.state, 0);
      caption.textContent = frame.label;
      counter.textContent = `${count(index)} / ${count(frames.length - 1)}`;
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
      empty.innerHTML = `${icon(
        "filter",
        32
      )}<h3 class="t-heading">No match fits</h3><p class="t-body">Loosen a filter above.</p>`;
      list.appendChild(empty);
      showFilteredOut();
      return;
    }

    shown.forEach((entry, i) => {
      const button = document.createElement("button");
      button.className = `replay-entry mat-panel act d-enter replay-${entry.result}${
        entry.record ? "" : " is-recordless"
      }`;
      button.type = "button";
      const replayable = Boolean(entry.record);
      const opponent = content.leaders[entry.opponentLeaderCardId]?.name ?? "—";
      const faction = content.leaders[entry.leaderCardId]?.faction ?? "neutral";
      button.style.setProperty("--row-accent", colourFor(faction));
      // the Obsession peak §4.5.5 asks for, on the matches that recorded it
      const obsession = entry.summary ? ` · Obs <span class="num">${count(entry.summary.peakObsession)}</span>` : "";
      /*
       * The Obsession peak moves to the *third* line, not the second.
       *
       * Both meta lines are `text-overflow: ellipsis` on one line. Line two is
       * the longest thing on the row — "vs Prioress Juniper Vale · 12 turns" is
       * already 35 characters — so appending "· Obs 5" to it ellipsised the
       * *opponent's name*, which is the one thing on the row a player is
       * scanning for. Line three is a mode and a short date and has room.
       */
      button.innerHTML = `
        ${crestMark(faction, 34)}
        <span class="replay-entry-body">
          <span class="replay-entry-deck">${esc(entry.deckName)}</span>
          <span class="replay-entry-meta">vs ${esc(opponent)} · ${quantify(entry.turns, "turn")}</span>
          <span class="replay-entry-meta">${esc(modeName(entry.mode))} · ${esc(
            logStamp(entry.playedAt)
          )}${obsession}</span>
        </span>
        ${
          /*
           * "Not replayable" is a *tag*, not the tail of a sentence.
           *
           * It used to be appended to the mode-and-date line, which is
           * `text-overflow: ellipsis` on one line — so on 8 of 9 visible rows at
           * 1600×900 it ellipsised to "not…" or "not re…", hiding the only
           * qualifier on the row that changes what clicking it does. A tag in
           * its own column cannot be truncated by the line beside it.
           */
          replayable
            ? ""
            : `<span class="replay-entry-tag">${icon("lock", 12)}<span>No replay</span></span>`
        }
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
      /*
       * Always open the newest row, replayable or not.
       *
       * The old guard was `if (i === 0 && replayable)`, and since only the eight
       * newest matches keep a record, any filter that landed on an older match
       * left the stage holding an empty prompt beside a full list — which reads
       * as a broken screen rather than as a choice. Every row opens now, so the
       * stage always has the match the list says is selected.
       */
      if (i === 0) button.click();
    });

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
