/**
 * The Custom Lobby — `09-game-modes.md` §17.
 *
 * *"A lobby with explicit knobs, all clearly displayed to both seats before
 * start."* The emphasis is §17's and it shapes the screen: every setting is
 * visible at once, on one page, with its real value — no collapsed "advanced"
 * section, because in Hotseat the second player never gets to open one.
 *
 * The screen also prints, before anything starts, **whether this configuration
 * pays**. §17 makes flagged combinations pay zero to prevent farming, and a
 * reward rule the player discovers after the match is a rule they will
 * reasonably feel cheated by. `integrityFlags` returns the reasons in words, so
 * the lobby states them where the decision is being made.
 */

import type { AiDifficulty, ContentIndex } from "../../engine/types";
import type { Screen } from "../shell";
import {
  CUSTOM_LIMITS,
  DEFERRED_CUSTOM,
  bannedInDeck,
  checkCustomSettings,
  clampSettings,
  defaultSettings,
  integrityFlags,
  type CustomSettings,
} from "../../game/custom";
import { playableModifiers } from "../../game/remix";
import { getProfile } from "../../save/profile";
import { audio } from "../../audio/audio";
import { enter, icon, titleCase, unspec } from "./data/kit";

export interface CustomCallbacks {
  onBack: () => void;
  onStart: (settings: CustomSettings, deckIndex: number) => void;
}

const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const DIFFICULTIES: AiDifficulty[] = ["beginner", "casual", "intermediate", "advanced", "expert", "boss"];

export function createCustomScreen(content: ContentIndex, callbacks: CustomCallbacks): Screen {
  const root = document.createElement("div");
  root.className = "screen custom-screen";

  let settings = defaultSettings(content);
  let deckIndex = getProfile().activeDeckIndex;

  /**
   * One rule knob.
   *
   * The control itself is module A's `.field`, which is what stopped the five
   * white Windows boxes: `appearance: none`, a glass fill, a 315° rim and all six
   * interaction states. What is added here is the *label rhythm* — a tracked
   * caption over the field and the standard value under it — so four knobs in a
   * row read as a set rather than as four sentences that happen to contain
   * inputs.
   */
  const number = (id: string, label: string, value: number, min: number, max: number, note: string): string => `
    <label class="custom-knob field-group" for="${id}">
      <span class="custom-knob-label t-label">${esc(label)}</span>
      <input class="field input" type="number" id="${id}" value="${value}" min="${min}" max="${max}" />
      <span class="custom-knob-note field-note">${esc(note)}</span>
    </label>`;

  function render(): void {
    settings = clampSettings(content, settings);
    const profile = getProfile();
    const decks = profile.decks;
    const deck = decks[deckIndex];
    const flags = integrityFlags(content, settings);
    const problems = checkCustomSettings(content, settings);
    const banned = deck ? bannedInDeck(content, settings, deck) : [];
    const standard = defaultSettings(content);

    root.innerHTML = `
      <div class="ambient-bg"></div>
      <header class="screen-header">
        <button class="btn btn-ghost" id="custom-back">${icon("arrow-left", 16)} Back</button>
        <h1 class="title">Custom Lobby</h1>
        <span class="muted">Never touches Ranked</span>
      </header>

      <div class="custom-body data-body">
        <section class="panel custom-panel">
          <h2 class="t-heading custom-panel-title">Seats</h2>
          <div class="custom-seats" role="radiogroup" aria-label="Opponent">
            <button type="button" class="custom-seat ${
              settings.opponent === "ai" ? "mat-hero" : "mat-panel"
            } act r-tile" role="radio" aria-checked="${settings.opponent === "ai"}" data-opponent="ai">
              ${icon("mode-ai", 22)}
              <span>
                <strong>vs AI</strong>
                <em>One seat, one device, a difficulty you pick.</em>
              </span>
            </button>
            <button type="button" class="custom-seat ${
              settings.opponent === "hotseat" ? "mat-hero" : "mat-panel"
            } act r-tile" role="radio" aria-checked="${settings.opponent === "hotseat"}" data-opponent="hotseat">
              ${icon("emote", 22)}
              <span>
                <strong>Hotseat</strong>
                <em>Two players, one device, passed between turns.</em>
              </span>
            </button>
          </div>
          ${
            settings.opponent === "ai"
              ? `<label class="custom-knob field-group" for="custom-difficulty">
                   <span class="custom-knob-label t-label">AI difficulty</span>
                   <select class="select input" id="custom-difficulty">
                     ${DIFFICULTIES.map(
                       (d) =>
                         `<option value="${d}" ${d === settings.difficulty ? "selected" : ""}>${esc(
                           titleCase(d)
                         )}</option>`
                     ).join("")}
                   </select>
                 </label>`
              : `<p class="t-body">The device is passed between turns. The board is covered before the
                 next player sees it, and the cover does not time out.</p>`
          }
        </section>

        <section class="panel custom-panel">
          <h2 class="t-heading custom-panel-title">Your deck</h2>
          ${
            decks.length === 0
              ? `<div class="empty" id="custom-nodeck">
                   ${icon("deck-builder", 36)}
                   <h3 class="t-heading">No saved decks</h3>
                   <p class="t-body">A custom match still needs a legal deck. Build one and it appears here.</p>
                 </div>`
              : `<select class="select input" id="custom-deck">
                   ${decks
                     .map(
                       (entry, index) =>
                         `<option value="${index}" ${index === deckIndex ? "selected" : ""}>${esc(entry.name)}</option>`
                     )
                     .join("")}
                 </select>`
          }
          ${
            banned.length > 0
              ? `<p class="validation-problem" id="custom-banned">
                   The ban list refuses ${banned.length} card${banned.length === 1 ? "" : "s"} in this deck:
                   ${banned.slice(0, 4).map((card) => esc(card.name)).join(", ")}${banned.length > 4 ? "…" : ""}
                 </p>`
              : ""
          }
        </section>

        <section class="panel custom-panel">
          <h2 class="t-heading custom-panel-title">Rules</h2>
          <div class="custom-knobs">
            ${number("custom-health", "Starting health", settings.startingHealth, CUSTOM_LIMITS.health.min, CUSTOM_LIMITS.health.max, `standard ${standard.startingHealth}`)}
            ${number("custom-deck-size", "Deck size", settings.deckSize, CUSTOM_LIMITS.deck.min, CUSTOM_LIMITS.deck.max, `standard ${standard.deckSize}`)}
            ${number("custom-hand-first", "Opening hand — first", settings.handFirst, CUSTOM_LIMITS.hand.min, CUSTOM_LIMITS.hand.max, `standard ${standard.handFirst}`)}
            ${number("custom-hand-second", "Opening hand — second", settings.handSecond, CUSTOM_LIMITS.hand.min, CUSTOM_LIMITS.hand.max, `standard ${standard.handSecond}`)}
          </div>
          <div class="custom-timer-row">
            <label class="custom-knob field-group" for="custom-timer">
              <span class="custom-knob-label t-label">Turn timer</span>
              <input class="field input" type="number" id="custom-timer"
                     value="${settings.turnSeconds ?? ""}" min="${CUSTOM_LIMITS.timer.min}" max="${
                       CUSTOM_LIMITS.timer.max
                     }"
                     ${settings.turnSeconds === null ? "disabled" : ""} />
              <span class="custom-knob-note field-note">seconds per turn</span>
            </label>
            <label class="custom-toggle field-row">
              <input class="switch" type="checkbox" id="custom-timer-off" ${
                settings.turnSeconds === null ? "checked" : ""
              } />
              <span>No timer</span>
            </label>
          </div>
        </section>

        <section class="panel custom-panel">
          <h2 class="t-heading custom-panel-title">Remix modifier</h2>
          <select class="select input" id="custom-modifier">
            <option value="">None</option>
            ${playableModifiers()
              .map(
                (modifier) =>
                  `<option value="${esc(modifier.id)}" ${
                    modifier.id === settings.modifierId ? "selected" : ""
                  }>${esc(modifier.name)}</option>`
              )
              .join("")}
          </select>
          ${
            settings.modifierId
              ? `<p class="t-body" id="custom-modifier-text">${esc(
                  playableModifiers().find((m) => m.id === settings.modifierId)?.text ?? ""
                )}</p>`
              : `<p class="t-body">Any rule from this week's catalogue, applied to both seats.</p>`
          }
        </section>

        <section class="panel custom-panel ${flags.length > 0 ? "custom-unpaid" : ""}">
          <h2 class="t-heading custom-panel-title">Rewards</h2>
          ${
            flags.length === 0
              ? `<p class="custom-pays-ok" id="custom-pays">${icon(
                  "check",
                  15
                )} This match pays the Sparring schedule, against the shared daily cap.</p>`
              : `<p class="validation-problem" id="custom-pays">${icon(
                  "warning",
                  15
                )} This match pays <strong>nothing</strong>:</p>
                 <ul class="custom-flags">${flags.map((flag) => `<li>${esc(flag)}</li>`).join("")}</ul>`
          }
          <p class="t-body">Custom results never affect Ranked.</p>
        </section>

        ${
          problems.length > 0
            ? `<p class="validation-problem" id="custom-problems">${problems.map(esc).join(" · ")}</p>`
            : ""
        }

        <button type="button" class="mat-hero act r-chip custom-start" id="custom-start"
                ${decks.length === 0 || banned.length > 0 || problems.length > 0 ? "disabled" : ""}>
          ${icon("play", 17)} Start ${settings.opponent === "hotseat" ? "Hotseat" : "match"}
        </button>

        <section class="panel custom-panel custom-locked">
          <h2 class="t-heading custom-panel-title">Not in this build</h2>
          <ul class="custom-locked-list">
            ${[...DEFERRED_CUSTOM.entries()]
              .map(
                ([name, reason]) => `
                  <li class="mat-panel custom-locked-item">
                    ${icon("lock", 14)}
                    <span><strong>${esc(name)}</strong> — ${esc(unspec(reason))}</span>
                  </li>`
              )
              .join("")}
          </ul>
        </section>
      </div>`;

    root.querySelector("#custom-back")?.addEventListener("click", () => callbacks.onBack());

    for (const button of root.querySelectorAll<HTMLElement>("[data-opponent]")) {
      button.addEventListener("click", () => {
        settings = { ...settings, opponent: button.dataset.opponent as never };
        audio.play("sfx.ui.toggle");
        render();
      });
    }

    const num = (id: string, apply: (value: number) => void): void => {
      root.querySelector<HTMLInputElement>(`#${id}`)?.addEventListener("change", (event) => {
        apply(Number((event.target as HTMLInputElement).value));
        render();
      });
    };
    num("custom-health", (v) => (settings = { ...settings, startingHealth: v }));
    num("custom-deck-size", (v) => (settings = { ...settings, deckSize: v }));
    num("custom-hand-first", (v) => (settings = { ...settings, handFirst: v }));
    num("custom-hand-second", (v) => (settings = { ...settings, handSecond: v }));
    num("custom-timer", (v) => (settings = { ...settings, turnSeconds: v }));

    root.querySelector<HTMLInputElement>("#custom-timer-off")?.addEventListener("change", (event) => {
      const off = (event.target as HTMLInputElement).checked;
      settings = { ...settings, turnSeconds: off ? null : defaultSettings(content).turnSeconds };
      render();
    });
    root.querySelector<HTMLSelectElement>("#custom-difficulty")?.addEventListener("change", (event) => {
      settings = { ...settings, difficulty: (event.target as HTMLSelectElement).value as AiDifficulty };
    });
    root.querySelector<HTMLSelectElement>("#custom-modifier")?.addEventListener("change", (event) => {
      const value = (event.target as HTMLSelectElement).value;
      settings = { ...settings, modifierId: value === "" ? null : value };
      render();
    });
    root.querySelector<HTMLSelectElement>("#custom-deck")?.addEventListener("change", (event) => {
      deckIndex = Number((event.target as HTMLSelectElement).value);
      render();
    });

    root.querySelector("#custom-start")?.addEventListener("click", () => {
      audio.play("sfx.ui.confirm");
      callbacks.onStart(clampSettings(content, settings), deckIndex);
    });

    enter(root, ".custom-panel", 40);
  }

  render();

  /** Automation hook, the same shape the other screens expose. */
  (window as unknown as { hypeboundCustom?: unknown }).hypeboundCustom = {
    settings: () => clampSettings(content, settings),
    flags: () => integrityFlags(content, settings),
    problems: () => checkCustomSettings(content, settings),
    set: (patch: Partial<CustomSettings>) => {
      settings = clampSettings(content, { ...settings, ...patch });
      render();
    },
    refresh: render,
  };

  return {
    root,
    resume: render,
    dispose: () => {
      delete (window as unknown as { hypeboundCustom?: unknown }).hypeboundCustom;
    },
  };
}
