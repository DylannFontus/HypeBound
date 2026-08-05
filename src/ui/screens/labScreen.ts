/**
 * The Lab — deterministic scenario sandbox.
 *
 * The whole screen rests on one idea: an edit is not a mutation. Adding a
 * character, changing a leader's health, moving to a later turn — each appends
 * a `SetupOp` to the scenario and re-simulates from scratch. `applyIntent`
 * stays the only thing that ever mutates a match, undo is just "drop the last
 * intent and rebuild", and what you export is exactly what the game will deal.
 *
 * That last part is the point. Puzzle arithmetic is unforgiving — a Current
 * bonus you forgot turns a one-answer puzzle into a two-answer one — so the Lab
 * exports the scenario block ready to paste into `data/encounters/`, having
 * proven it deals what you think it deals.
 *
 * ## Why the surfaces changed, and why the stage grew a second row
 *
 * This screen is two clicks from PLAY and it was the pre-overhaul game intact:
 * zero `mat-*` surfaces, five flat `rgba(28,20,48,.62)` fills over 120×60px —
 * §1 bans a solid fill on anything larger than an icon — and a legacy
 * `base.css` `.panel` around the stage. It scored 0 materials in the census
 * that finally visited it. The fills are gone; every surface here is now one of
 * module A's four, at the rank the thing actually is: the editor groups and the
 * stage are panels, the board seats are wells because a board is *recessed*
 * ground, and the units, the ops and the legal moves are chips.
 *
 * The Scenario group moved out of the left rail and into the stage, and that is
 * a layout fix rather than a decorative one. At 1280×720 the rail held four
 * groups totalling ~1,160px inside a 630px column, which put the "Add to board"
 * hero exactly across the cut — a primary action sliced in half at rest, with
 * nothing to say the column scrolled. Three groups fit (270 + 296 + gap = 582 <
 * 630), so the hero is whole, the cut now falls on a group boundary, and the
 * stage — 780×735 with 300px of content in it — has something to hold.
 */

import type {
  CardDef,
  ContentIndex,
  MatchConfig,
  MatchState,
  PlayerIntent,
  Seat,
  SetupOp,
} from "../../engine/types";
import type { Screen } from "../shell";
import { createMatch } from "../../engine/state";
import { applyIntent, beginScriptedMatch } from "../../engine/reducer";
import { enumerateLegalIntents } from "../../engine/intents";
import { selectableLeaders } from "../../engine/content";
import { CURRENT_PALETTE } from "../cardRenderer/palette";
import { audio } from "../../audio/audio";
import { count, disposeBag, enter, fadeOnScroll, icon } from "./data/kit";
import "./sideDoors.css";

export interface LabCallbacks {
  onBack: () => void;
}

export function createLabScreen(content: ContentIndex, callbacks: LabCallbacks): Screen {
  const leaders = selectableLeaders(content);
  const characters = Object.values(content.cards)
    .filter((c): c is CardDef => c.type === "character")
    .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));

  /** Everything the sandbox is, in two arrays. */
  let seed = 1;
  let leaderIds: [string, string] = [leaders[0]?.id ?? "", leaders[1]?.id ?? leaders[0]?.id ?? ""];
  let setup: SetupOp[] = [
    { op: "turn", seat: 0, value: 1 },
    { op: "leaderHealth", seat: 1, value: 30 },
  ];
  let intents: PlayerIntent[] = [];
  let state: MatchState;

  const buildConfig = (): MatchConfig => ({
    seed,
    decks: [
      { name: "Lab A", leaderCardId: leaderIds[0], cards: ["meme-first-poster"] },
      { name: "Lab B", leaderCardId: leaderIds[1], cards: ["meme-first-poster"] },
    ],
    firstSeat: 0,
    scenario: { shuffle: false, deal: false, borrowedClout: false, mulligan: "none", setup },
  });

  /**
   * Rebuild the whole match from config + the intent log.
   *
   * Intents that no longer apply after an edit are dropped rather than skipped:
   * silently keeping a log that half-applies would show a board that cannot be
   * reproduced from what the Lab exports.
   */
  const rebuild = (): { dropped: number } => {
    const config = buildConfig();
    let next = createMatch(config, content);
    beginScriptedMatch(next, content);
    let dropped = 0;
    const kept: PlayerIntent[] = [];
    for (const intent of intents) {
      try {
        next = applyIntent(next, content, intent).state;
        kept.push(intent);
      } catch {
        dropped += 1;
      }
    }
    intents = kept;
    state = next;
    return { dropped };
  };

  rebuild();

  // ---- DOM ------------------------------------------------------------------

  const root = document.createElement("div");
  root.className = "screen lab-screen";
  root.innerHTML = `
    <div class="ambient-bg"></div>
    <header class="sub-header">
      <button class="btn btn-ghost" id="lab-back">${icon("arrow-left", 16)} Lobby</button>
      <h1 class="title">The Lab</h1>
      <div class="sub-header-meta muted">Deterministic sandbox · you control both seats</div>
    </header>
    <div class="lab-body data-body">
      <aside class="lab-editor" id="lab-editor">
        ${/*
           * The form kit, rather than five bespoke controls.
           *
           * These were bare `<input>` and `<select>` under a `.lab-field` rule in
           * `screens.css` that gave them a flat `--bg-panel` fill and a 1px border
           * — §1 bans both — and no hover, press, focus or disabled state of any
           * kind. They are `field-group` / `t-label` / `.field` / `.select` /
           * `.checkbox` now, which is module A's kit, so the Lab's controls are
           * the same objects as the Custom Lobby's and the Settings rail's rather
           * than a third opinion. The class is dropped from the wrapper as well as
           * added to the control: `.lab-field input` is a more specific selector
           * than `.field`, so as long as a control was *inside* one, the old flat
           * fill won.
           */ ""}
        <section class="lab-plate mat-panel r-panel d-enter">
          <div class="lab-group-head">${icon("mode-lab", 15)}<span class="t-label">Match</span></div>
          <label class="field-group">
            <span class="t-label">Seed</span>
            <input class="field num" type="number" id="lab-seed" value="${seed}" />
          </label>
          <label class="field-group">
            <span class="t-label">Leader A</span>
            <select class="select" id="lab-leader-a"></select>
          </label>
          <label class="field-group">
            <span class="t-label">Leader B</span>
            <select class="select" id="lab-leader-b"></select>
          </label>
        </section>

        <section class="lab-plate mat-panel r-panel d-enter">
          <div class="lab-group-head">${icon("plus", 15)}<span class="t-label">Add a character</span></div>
          <label class="field-group">
            <span class="t-label">Card</span>
            <select class="select" id="lab-card"></select>
          </label>
          <label class="field-group">
            <span class="t-label">Side</span>
            <select class="select" id="lab-side"><option value="0">A (you)</option><option value="1">B (rival)</option></select>
          </label>
          <label class="field-row lab-check">
            <input class="checkbox" type="checkbox" id="lab-ready" checked />
            <span>Enters ready</span>
          </label>
          <button type="button" class="mat-panel act r-chip lab-action" id="lab-add">${icon("plus", 15)} Add to board</button>
        </section>

        <section class="lab-plate mat-panel r-panel d-enter">
          <div class="lab-group-head">${icon("settings", 15)}<span class="t-label">Set a value</span></div>
          <label class="field-group">
            <span class="t-label">What</span>
            <select class="select" id="lab-what">
              <option value="leaderHealth">Leader health</option>
              <option value="obsession">Obsession</option>
              <option value="armor">Armour</option>
              <option value="turn">Turn (sets Hype)</option>
            </select>
          </label>
          <label class="field-group">
            <span class="t-label">Side</span>
            <select class="select" id="lab-vside"><option value="0">A (you)</option><option value="1">B (rival)</option></select>
          </label>
          <label class="field-group">
            <span class="t-label">Value</span>
            <input class="field num" type="number" id="lab-value" value="10" />
          </label>
          <button type="button" class="mat-panel act r-chip lab-action" id="lab-set">Apply</button>
        </section>
      </aside>

      <section class="lab-stage mat-panel r-panel">
        <div class="lab-board mat-well r-tile" id="lab-board"></div>

        <div class="lab-desk">
          <section class="lab-desk-col d-enter">
            <div class="lab-group-head">
              ${icon("log", 15)}<span class="t-label">Intent log</span>
              <div class="lab-head-actions">
                <button type="button" class="mat-chip act r-chip lab-mini" id="lab-undo">${icon("back", 14)} Undo</button>
                <button type="button" class="mat-chip act r-chip lab-mini" id="lab-reset">${icon("refresh", 14)} Reset</button>
              </div>
            </div>
            <div class="lab-log-pane mat-well r-tile" id="lab-log"></div>
          </section>

          <section class="lab-desk-col d-enter">
            <div class="lab-group-head">
              ${icon("deck", 15)}<span class="t-label">Scenario</span>
              <div class="lab-head-actions">
                <button type="button" class="mat-chip act r-chip lab-mini" id="lab-undo-op">Remove last</button>
                <button type="button" class="mat-chip act r-chip lab-mini" id="lab-clear">Clear all</button>
              </div>
            </div>
            <div class="lab-op-pane mat-well r-tile" id="lab-ops"></div>
            <button type="button" class="mat-hero act r-chip lab-action" id="lab-export">
              ${icon("edit", 15)} Copy encounter JSON
            </button>
            <p class="t-body lab-hint" id="lab-hint">Paste straight into <code>data/encounters/</code>.</p>
          </section>
        </div>

        <div class="lab-moves">
          <div class="lab-group-head">
            ${icon("crosshair", 15)}<span class="t-label">Legal moves</span>
            <span class="lab-turn t-label" id="lab-turn-owner"></span>
          </div>
          <div class="lab-move-list" id="lab-moves"></div>
        </div>
      </section>
    </div>`;

  const $ = <T extends HTMLElement>(id: string): T => root.querySelector<T>(`#${id}`)!;

  for (const select of [$("lab-leader-a") as HTMLSelectElement, $("lab-leader-b") as HTMLSelectElement]) {
    for (const leader of leaders) {
      const option = document.createElement("option");
      option.value = leader.id;
      option.textContent = `${leader.name} (${CURRENT_PALETTE[leader.current].label})`;
      select.appendChild(option);
    }
  }
  ($("lab-leader-a") as HTMLSelectElement).value = leaderIds[0];
  ($("lab-leader-b") as HTMLSelectElement).value = leaderIds[1];

  const cardSelect = $("lab-card") as HTMLSelectElement;
  for (const card of characters) {
    const option = document.createElement("option");
    option.value = card.id;
    const stats = "attack" in card ? `${(card as { attack: number }).attack}/${(card as { health: number }).health}` : "";
    option.textContent = `(${card.cost}) ${card.name} ${stats}`;
    cardSelect.appendChild(option);
  }

  // ---- rendering ------------------------------------------------------------

  const describeOp = (op: SetupOp): string => {
    const side = `${op.seat === 0 ? "A" : "B"}`;
    switch (op.op) {
      case "board":
        return `${side}: ${content.cards[op.cardId]?.name ?? op.cardId}${op.ready === false ? " (sick)" : ""}`;
      case "leaderHealth":
        return `${side}: leader health ${op.value}`;
      case "obsession":
        return `${side}: obsession ${op.value}`;
      case "armor":
        return `${side}: armor ${op.value}`;
      case "turn":
        return `${side}: turn ${op.value}`;
      case "hand":
        return `${side}: hand ${op.cards.length} card(s)`;
      case "reaction":
        return `${side}: reaction ${content.cards[op.cardId]?.name ?? op.cardId}`;
      default:
        return `${side}: ${op.op}`;
    }
  };

  const describeIntent = (intent: PlayerIntent): string => {
    const who = intent.seat === 0 ? "A" : "B";
    switch (intent.type) {
      case "playCard":
        return `${who} plays a card`;
      case "attack":
        return `${who} attacks ${intent.target.kind === "leader" ? "the leader" : "a character"}`;
      case "endTurn":
        return `${who} ends turn`;
      case "useFixation":
        return `${who} uses ${intent.kind}`;
      case "activateConfluence":
        return `${who} activates ${intent.confluence}`;
      default:
        return `${who}: ${intent.type}`;
    }
  };

  /**
   * One seat, as a recessed plate.
   *
   * `.num` on every figure here and not only on the health, because all four are
   * read while comparing two seats side by side — A4 calls that reading under
   * pressure, and a Hype total that shifts a pixel when it gains a digit is the
   * defect the role exists to prevent. The active seat is marked by a lit rim
   * and a left bar rather than by a fill, so "whose turn" is not carried by
   * colour alone (§6) and the two plates stay the same material.
   */
  const renderSide = (seat: Seat): string => {
    const player = state.players[seat];
    const leader = content.leaders[player.leaderCardId];
    const units = player.board
      .filter((c) => c !== null)
      .map(
        (c) =>
          `<span class="lab-tok mat-chip r-chip" style="--c:${CURRENT_PALETTE[c!.current].key}">${
            content.cards[c!.cardId]?.name ?? c!.cardId
          } <b class="num">${count(c!.attack)}/${count(c!.health)}</b></span>`
      )
      .join("");
    const active = state.activeSeat === seat;
    return `
      <div class="lab-seat mat-well r-tile${active ? " active" : ""}">
        <div class="lab-side-head">
          <span class="lab-seat-label t-label">${seat === 0 ? "A" : "B"}</span>
          <span class="lab-leader t-body">${leader?.name ?? "—"}</span>
          ${active ? '<span class="lab-active-tag t-label">to act</span>' : ""}
          <span class="lab-hp"><span class="num">${count(player.leaderHealth)}</span> HP</span>
          <span class="lab-vitals t-body">
            <span class="num">${count(player.hype)}</span>/<span class="num">${count(player.hypeMax)}</span> Hype
            · <span class="num">${count(player.obsession)}</span> Obs${
              player.armor > 0 ? ` · <span class="num">${count(player.armor)}</span> Armour` : ""
            }
          </span>
        </div>
        <div class="lab-units">${
          units ||
          `<span class="lab-none lab-none-board t-body">${icon(
            "plus",
            15
          )} No characters on this side — add one from the rail</span>`
        }</div>
      </div>`;
  };

  const render = (): void => {
    $("lab-board").innerHTML = renderSide(1) + '<div class="hairline lab-rule"></div>' + renderSide(0);

    $("lab-ops").innerHTML =
      setup.map((op) => `<div class="lab-op-row mat-chip r-chip">${describeOp(op)}</div>`).join("") ||
      '<div class="lab-none t-body">No setup yet — the board is whatever a fresh match deals.</div>';

    $("lab-log").innerHTML =
      intents
        .map(
          (i, n) =>
            `<div class="lab-log-line"><span class="lab-log-n num">${count(n + 1)}</span> ${describeIntent(i)}</div>`
        )
        .join("") || '<div class="lab-none t-body">No moves yet — play one below.</div>';

    const owner = state.winner !== null ? "match over" : `seat ${state.activeSeat === 0 ? "A" : "B"} to act`;
    $("lab-turn-owner").textContent = owner;

    const moves = state.winner === null
      ? enumerateLegalIntents(state, content, state.activeSeat, { maxPerCard: 3 }).slice(0, 40)
      : [];
    const list = $("lab-moves");
    list.innerHTML = "";
    for (const intent of moves) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "lab-move mat-chip act r-chip d-enter";
      button.textContent = describeIntent(intent);
      button.addEventListener("click", () => {
        try {
          state = applyIntent(state, content, intent).state;
          intents.push(intent);
          render();
        } catch (error) {
          $("lab-hint").textContent = error instanceof Error ? error.message : String(error);
        }
      });
      list.appendChild(button);
    }
    if (moves.length === 0) {
      list.innerHTML = `<div class="lab-none t-body">${
        state.winner !== null ? "The match is over. Undo a move, or reset." : "No legal move for this seat."
      }</div>`;
    }

    // §3a: the moves are a list, and a list arrives on a cascade rather than
    // all at once. `enter` is a no-op under reduced motion.
    enter(list, ".lab-move", 26);
  };

  // ---- editing --------------------------------------------------------------

  const edit = (mutate: () => void): void => {
    mutate();
    const { dropped } = rebuild();
    render();
    $("lab-hint").textContent = dropped
      ? `${dropped} move(s) no longer applied and were dropped.`
      : "Paste straight into data/encounters/.";
  };

  $("lab-seed").addEventListener("change", () =>
    edit(() => {
      seed = Number(($("lab-seed") as HTMLInputElement).value) || 1;
    })
  );
  $("lab-leader-a").addEventListener("change", () =>
    edit(() => {
      leaderIds = [($("lab-leader-a") as HTMLSelectElement).value, leaderIds[1]];
    })
  );
  $("lab-leader-b").addEventListener("change", () =>
    edit(() => {
      leaderIds = [leaderIds[0], ($("lab-leader-b") as HTMLSelectElement).value];
    })
  );

  $("lab-add").addEventListener("click", () => {
    audio.play("sfx.ui.click");
    const seat = Number(($("lab-side") as HTMLSelectElement).value) as Seat;
    const ready = ($("lab-ready") as HTMLInputElement).checked;
    const used = state.players[seat].board.filter((c) => c !== null).length;
    edit(() => {
      setup.push({
        op: "board",
        seat,
        slot: used,
        cardId: cardSelect.value,
        ...(ready ? { ready: true } : { ready: false }),
      });
    });
  });

  $("lab-set").addEventListener("click", () => {
    audio.play("sfx.ui.click");
    const what = ($("lab-what") as HTMLSelectElement).value as "leaderHealth" | "obsession" | "armor" | "turn";
    const seat = Number(($("lab-vside") as HTMLSelectElement).value) as Seat;
    const value = Number(($("lab-value") as HTMLInputElement).value) || 0;
    edit(() => {
      setup.push({ op: what, seat, value } as SetupOp);
    });
  });

  $("lab-undo-op").addEventListener("click", () => edit(() => void setup.pop()));
  $("lab-clear").addEventListener("click", () =>
    edit(() => {
      setup = [];
      intents = [];
    })
  );

  // Undo is re-simulation: drop the last intent and rebuild from the seed. It
  // is exact because the AI is a pure function of match state and setup ops
  // consume no randomness.
  $("lab-undo").addEventListener("click", () =>
    edit(() => {
      intents.pop();
    })
  );
  $("lab-reset").addEventListener("click", () =>
    edit(() => {
      intents = [];
    })
  );

  $("lab-export").addEventListener("click", async () => {
    const json = JSON.stringify(
      {
        seed,
        firstSeat: 0,
        scenario: { shuffle: false, deal: false, borrowedClout: false, mulligan: "none", setup },
      },
      null,
      2
    );
    try {
      await navigator.clipboard.writeText(json);
      $("lab-hint").textContent = "Copied. Paste into a stage in data/encounters/.";
    } catch {
      // clipboard is permission-gated; fall back to something selectable
      $("lab-hint").innerHTML = `<textarea class="lab-export" readonly rows="8">${json}</textarea>`;
    }
  });

  root.querySelector("#lab-back")!.addEventListener("click", () => callbacks.onBack());

  render();

  /**
   * The three things a shipped menu does that this one did not (§3a).
   *
   * `enter` gives the editor its cascade — panels arriving in reading order on a
   * 44ms step rather than the whole rail appearing in one frame. The two
   * `fadeOnScroll` calls put a ramp on the edge of anything that actually
   * overflows and, importantly, take it away again when it does not: a
   * permanent fade dims the last line of a list that has already ended and says
   * "there is more" when there is not. The rail is the one that matters — at
   * 1280×720 it is the column that scrolls.
   */
  const bag = disposeBag();
  bag.add(enter(root, ".lab-plate, .lab-desk-col", 44));
  bag.add(fadeOnScroll($("lab-editor")));
  bag.add(fadeOnScroll($("lab-log")));
  bag.add(fadeOnScroll($("lab-ops")));

  // automation handle: the Lab's whole contract is that what you see is what
  // the exported scenario deals
  (window as unknown as { hypeboundLab?: unknown }).hypeboundLab = {
    state: () => state,
    setup: () => setup,
    intents: () => intents,
    exportScenario: () => buildConfig(),
  };

  return {
    root,
    dispose: () => {
      bag.run();
      delete (window as unknown as { hypeboundLab?: unknown }).hypeboundLab;
    },
  };
}
