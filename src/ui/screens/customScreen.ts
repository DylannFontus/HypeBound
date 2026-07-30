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

  const number = (id: string, label: string, value: number, min: number, max: number, note: string): string => `
    <label class="custom-knob" for="${id}">
      <span class="custom-knob-label">${esc(label)}</span>
      <input class="input" type="number" id="${id}" value="${value}" min="${min}" max="${max}" />
      <span class="muted custom-knob-note">${esc(note)}</span>
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
        <button class="btn btn-ghost" id="custom-back">← Back</button>
        <h1 class="title">Custom Lobby</h1>
        <span class="muted">Never touches Ranked</span>
      </header>

      <div class="custom-body">
        <section class="panel custom-panel">
          <div class="eyebrow">Seats</div>
          <div class="custom-seats">
            <button class="btn ${settings.opponent === "ai" ? "btn-primary" : "btn-ghost"}" data-opponent="ai">
              vs AI
            </button>
            <button class="btn ${settings.opponent === "hotseat" ? "btn-primary" : "btn-ghost"}" data-opponent="hotseat">
              Hotseat — two players, one device
            </button>
          </div>
          ${
            settings.opponent === "ai"
              ? `<label class="custom-knob" for="custom-difficulty">
                   <span class="custom-knob-label">AI difficulty</span>
                   <select class="input" id="custom-difficulty">
                     ${DIFFICULTIES.map(
                       (d) => `<option value="${d}" ${d === settings.difficulty ? "selected" : ""}>${d}</option>`
                     ).join("")}
                   </select>
                 </label>`
              : `<p class="muted">The device is passed between turns. The board is covered before the
                 next player sees it, and the cover does not time out.</p>`
          }
        </section>

        <section class="panel custom-panel">
          <div class="eyebrow">Your deck</div>
          ${
            decks.length === 0
              ? `<p class="muted" id="custom-nodeck">You have no saved decks. Build one first.</p>`
              : `<select class="input" id="custom-deck">
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
          <div class="eyebrow">Rules</div>
          <div class="custom-knobs">
            ${number("custom-health", "Starting health", settings.startingHealth, CUSTOM_LIMITS.health.min, CUSTOM_LIMITS.health.max, `standard ${standard.startingHealth}`)}
            ${number("custom-deck-size", "Deck size", settings.deckSize, CUSTOM_LIMITS.deck.min, CUSTOM_LIMITS.deck.max, `standard ${standard.deckSize}`)}
            ${number("custom-hand-first", "Opening hand — first", settings.handFirst, CUSTOM_LIMITS.hand.min, CUSTOM_LIMITS.hand.max, `standard ${standard.handFirst}`)}
            ${number("custom-hand-second", "Opening hand — second", settings.handSecond, CUSTOM_LIMITS.hand.min, CUSTOM_LIMITS.hand.max, `standard ${standard.handSecond}`)}
          </div>
          <label class="custom-knob" for="custom-timer">
            <span class="custom-knob-label">Turn timer</span>
            <input class="input" type="number" id="custom-timer"
                   value="${settings.turnSeconds ?? ""}" min="${CUSTOM_LIMITS.timer.min}" max="${CUSTOM_LIMITS.timer.max}"
                   ${settings.turnSeconds === null ? "disabled" : ""} />
            <label class="custom-toggle">
              <input type="checkbox" id="custom-timer-off" ${settings.turnSeconds === null ? "checked" : ""} />
              <span>off</span>
            </label>
          </label>
        </section>

        <section class="panel custom-panel">
          <div class="eyebrow">Remix modifier</div>
          <select class="input" id="custom-modifier">
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
              ? `<p class="muted" id="custom-modifier-text">${esc(
                  playableModifiers().find((m) => m.id === settings.modifierId)?.text ?? ""
                )}</p>`
              : `<p class="muted">Any rule from this week's catalogue, applied to both seats.</p>`
          }
        </section>

        <section class="panel custom-panel ${flags.length > 0 ? "custom-unpaid" : ""}">
          <div class="eyebrow">Rewards</div>
          ${
            flags.length === 0
              ? `<p id="custom-pays">This match pays the Sparring schedule, against the shared daily cap.</p>`
              : `<p class="validation-problem" id="custom-pays">This match pays <strong>nothing</strong>:</p>
                 <ul class="custom-flags">${flags.map((flag) => `<li>${esc(flag)}</li>`).join("")}</ul>`
          }
          <p class="muted">Custom results never affect Ranked.</p>
        </section>

        ${
          problems.length > 0
            ? `<p class="validation-problem" id="custom-problems">${problems.map(esc).join(" · ")}</p>`
            : ""
        }

        <button class="btn btn-primary custom-start" id="custom-start"
                ${decks.length === 0 || banned.length > 0 || problems.length > 0 ? "disabled" : ""}>
          Start ${settings.opponent === "hotseat" ? "Hotseat" : "match"}
        </button>

        <section class="panel custom-panel custom-locked">
          <div class="eyebrow">Not in this build</div>
          ${[...DEFERRED_CUSTOM.entries()]
            .map(([name, reason]) => `<p class="muted"><strong>${esc(name)}</strong> — ${esc(reason)}</p>`)
            .join("")}
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
