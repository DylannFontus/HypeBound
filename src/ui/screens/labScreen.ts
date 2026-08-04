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
      <button class="btn btn-ghost" id="lab-back">← Lobby</button>
      <h1 class="title">The Lab</h1>
      <div class="sub-header-meta muted">Deterministic sandbox · you control both seats</div>
    </header>
    <div class="lab-body data-body">
      <aside class="lab-editor scroll">
        <section class="lab-group">
          <div class="eyebrow">Match</div>
          <label class="lab-field">Seed <input type="number" id="lab-seed" value="${seed}" /></label>
          <label class="lab-field">Leader A <select id="lab-leader-a"></select></label>
          <label class="lab-field">Leader B <select id="lab-leader-b"></select></label>
        </section>

        <section class="lab-group">
          <div class="eyebrow">Add a character</div>
          <label class="lab-field">Card <select id="lab-card"></select></label>
          <label class="lab-field">Side
            <select id="lab-side"><option value="0">A (you)</option><option value="1">B (rival)</option></select>
          </label>
          <label class="lab-field lab-inline">
            <span>Ready</span><input type="checkbox" id="lab-ready" checked />
          </label>
          <button class="btn btn-primary" id="lab-add">Add to board</button>
        </section>

        <section class="lab-group">
          <div class="eyebrow">Set a value</div>
          <label class="lab-field">What
            <select id="lab-what">
              <option value="leaderHealth">Leader health</option>
              <option value="obsession">Obsession</option>
              <option value="armor">Armor</option>
              <option value="turn">Turn (sets Hype)</option>
            </select>
          </label>
          <label class="lab-field">Side
            <select id="lab-vside"><option value="0">A (you)</option><option value="1">B (rival)</option></select>
          </label>
          <label class="lab-field">Value <input type="number" id="lab-value" value="10" /></label>
          <button class="btn" id="lab-set">Apply</button>
        </section>

        <section class="lab-group">
          <div class="eyebrow">Scenario</div>
          <div class="lab-ops scroll" id="lab-ops"></div>
          <div class="row">
            <button class="btn btn-ghost" id="lab-undo-op">Remove last</button>
            <button class="btn btn-ghost" id="lab-clear">Clear all</button>
          </div>
          <button class="btn btn-primary" id="lab-export">Copy encounter JSON</button>
          <p class="muted lab-hint" id="lab-hint">Paste straight into <code>data/encounters/</code>.</p>
        </section>
      </aside>

      <section class="lab-stage panel">
        <div class="lab-board" id="lab-board"></div>
        <div class="lab-log-head">
          <span class="eyebrow">Intent log</span>
          <div class="row">
            <button class="btn btn-ghost" id="lab-undo">Undo</button>
            <button class="btn btn-ghost" id="lab-reset">Reset</button>
          </div>
        </div>
        <div class="lab-log scroll" id="lab-log"></div>
        <div class="lab-moves">
          <div class="eyebrow">Legal moves — <span id="lab-turn-owner"></span></div>
          <div class="lab-move-list scroll" id="lab-moves"></div>
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

  const renderSide = (seat: Seat): string => {
    const player = state.players[seat];
    const leader = content.leaders[player.leaderCardId];
    const units = player.board
      .filter((c) => c !== null)
      .map(
        (c) =>
          `<span class="lab-unit" style="--c:${CURRENT_PALETTE[c!.current].key}">${
            content.cards[c!.cardId]?.name ?? c!.cardId
          } <b>${c!.attack}/${c!.health}</b></span>`
      )
      .join("");
    return `
      <div class="lab-side${state.activeSeat === seat ? " active" : ""}">
        <div class="lab-side-head">
          <span><b>${seat === 0 ? "A" : "B"}</b> ${leader?.name ?? "—"}</span>
          <span class="lab-hp">${player.leaderHealth} HP</span>
          <span class="muted">${player.hype}/${player.hypeMax} Hype · ${player.obsession} Obs${
            player.armor > 0 ? ` · ${player.armor} Armor` : ""
          }</span>
        </div>
        <div class="lab-units">${units || '<span class="muted">empty</span>'}</div>
      </div>`;
  };

  const render = (): void => {
    $("lab-board").innerHTML = renderSide(1) + '<div class="lab-divider"></div>' + renderSide(0);

    $("lab-ops").innerHTML =
      setup.map((op) => `<div class="lab-op">${describeOp(op)}</div>`).join("") ||
      '<div class="muted">No setup yet.</div>';

    $("lab-log").innerHTML =
      intents.map((i, n) => `<div class="lab-log-line">${n + 1}. ${describeIntent(i)}</div>`).join("") ||
      '<div class="muted">No moves yet.</div>';

    const owner = state.winner !== null ? "match over" : `seat ${state.activeSeat === 0 ? "A" : "B"} to act`;
    $("lab-turn-owner").textContent = owner;

    const moves = state.winner === null
      ? enumerateLegalIntents(state, content, state.activeSeat, { maxPerCard: 3 }).slice(0, 40)
      : [];
    const list = $("lab-moves");
    list.innerHTML = "";
    for (const intent of moves) {
      const button = document.createElement("button");
      button.className = "btn btn-ghost lab-move";
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

  // automation handle: the Lab's whole contract is that what you see is what
  // the exported scenario deals
  (window as unknown as { hypeboundLab?: unknown }).hypeboundLab = {
    state: () => state,
    setup: () => setup,
    intents: () => intents,
    exportScenario: () => buildConfig(),
  };

  return { root };
}
