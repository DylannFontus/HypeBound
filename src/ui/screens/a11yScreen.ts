/**
 * Accessibility settings — `03-screens-and-navigation.md` §4.6.2 and the whole
 * of `13-accessibility.md`.
 *
 * §4.6.2 asks for a *"dedicated, discoverable accessibility surface"*, and §2
 * makes every control on it **live-preview**: changes apply immediately, with no
 * confirm step. So this screen writes straight through `updateSettings` and
 * re-renders itself, and the sample card beside the colour controls is a real
 * card drawn by the real renderer — not a swatch that approximates one.
 *
 * Two things here are worth reading:
 *
 * **The colour-blind modes say what they do.** Not "colour-blind palette" but
 * *"the default palette has 4 pairs of Currents you would not be able to tell
 * apart; this leaves none"* — measured by the same dichromacy simulation that
 * fails the build if a palette stops being safe. A setting that states its own
 * effect is a setting somebody can make a decision about.
 *
 * **What cannot be honoured yet is listed, with reasons.** §2's inventory is
 * long and this build cannot meet all of it. Every row that is missing says why,
 * rather than leaving somebody hunting for a control that was never built —
 * which for an accessibility screen is worse than for any other screen in the
 * game.
 */

import type { ContentIndex, CurrentId } from "../../engine/types";
import type { Screen } from "../shell";
import type { ColorblindMode, FocusRing, Settings } from "../../save/settings";
import { UI_SCALES, getSettings, patternsActive, updateSettings } from "../../save/settings";
import { COLORBLIND_MODES, CURRENT_PALETTE } from "../cardRenderer/palette";
import { defaultPalettePressure } from "../../game/a11y";
import { renderCardToCanvas } from "../cardRenderer/renderCard";
import { collectibleCards } from "../../engine/content";
import { audio } from "../../audio/audio";
import { DEFERRED_CUES, cueData } from "../../audio/cues";

export interface A11yCallbacks {
  onBack: () => void;
}

const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const MODE_LABEL: Record<ColorblindMode, string> = {
  off: "Off",
  protanopia: "Protanopia",
  deuteranopia: "Deuteranopia",
  tritanopia: "Tritanopia",
};

/**
 * §2's inventory that this build cannot honour, each with the reason.
 *
 * The same justified-allowlist the cosmetics, pass and inbox layers use — and
 * the one screen where leaving a gap unexplained does the most harm, because a
 * player who needs a control will keep looking for it.
 */
export const DEFERRED_A11Y: ReadonlyMap<string, string> = new Map([
  [
    "Eight of §11's 34 cues",
    "the cues themselves are built and synthesised, so they need no audio files at all — but eight rows of §11's table describe events this build does not produce. Two are the 15-second turn rope, which the offline board does not run; two need the trigger queue to emit per-step events, which it does not; three need the network transport; and the pack-rarity escalation wants timbres tuned against art that does not exist. `DEFERRED_CUES` names each one",
  ],
  [
    "Screen-reader support",
    "the board is a three.js canvas with no accessibility tree; §14's Board Mirror — a parallel DOM description of the same state — is the design's answer and is not built",
  ],
  [
    "Keyboard play on the battle board",
    "§13's zone model, key map and interaction state machine are a mode of their own; keyboard navigation works across every menu screen, and the board is still pointer-only",
  ],
  ["Controller support and remapping", "no gamepad handling exists yet, and a remap editor with nothing to remap would be a lie"],
  ["Subtitle size, background and sound captions for voice", "there are no voice lines recorded, so there is nothing to caption"],
  ["Mono audio and left/right balance", "the audio graph mixes per channel and has no panning stage to collapse"],
  ["Dyslexia-friendly font", "shipped, but as a wider-spaced system stack — a licensed face would have to be downloaded, and this build fetches nothing"],
]);

export function createA11yScreen(content: ContentIndex, callbacks: A11yCallbacks): Screen {
  const root = document.createElement("div");
  root.className = "screen policy-screen a11y-screen";

  /** A real card for the preview, picked once so it does not change under you. */
  const sample =
    collectibleCards(content).find((card) => card.type === "character" && card.keywords.length > 0) ??
    collectibleCards(content)[0]!;

  const set = (patch: Partial<Settings>): void => {
    updateSettings(patch);
    audio.play("sfx.ui.toggle");
    render();
  };

  const render = (): void => {
    const s = getSettings();
    const pressure = defaultPalettePressure();

    const toggleRow = (label: string, key: keyof Settings, hint: string): string => `
      <div class="setting-row setting-toggle-row">
        <div class="setting-label-group">
          <span class="setting-label">${esc(label)}</span>
          <div class="setting-hint faint">${esc(hint)}</div>
        </div>
        <button class="setting-toggle ${s[key] ? "on" : ""}" data-toggle="${esc(String(key))}"
                role="switch" aria-checked="${Boolean(s[key])}" aria-label="${esc(label)}">
          <span class="setting-knob"></span>
        </button>
      </div>`;

    const choiceRow = <T extends string>(
      label: string,
      key: keyof Settings,
      options: { value: T; label: string; hint?: string }[],
      hint: string
    ): string => `
      <div class="setting-row setting-choice-row">
        <div class="setting-label-group">
          <span class="setting-label">${esc(label)}</span>
          <div class="setting-hint faint">${esc(hint)}</div>
        </div>
        <div class="setting-choices" role="radiogroup" aria-label="${esc(label)}">
          ${options
            .map(
              (option) => `
                <button class="setting-choice ${s[key] === option.value ? "active" : ""}"
                        role="radio" aria-checked="${s[key] === option.value}"
                        data-key="${esc(String(key))}" data-value="${esc(option.value)}"
                        ${option.hint ? `title="${esc(option.hint)}"` : ""}>${esc(option.label)}</button>`
            )
            .join("")}
        </div>
      </div>`;

    root.innerHTML = `
      <div class="ambient-bg"></div>
      <header class="screen-header">
        <button class="btn btn-ghost" id="a11y-back">← Back</button>
        <h1 class="title">Accessibility</h1>
      </header>

      <main class="policy-body a11y-body">
        <section class="panel panel-chrome policy-summary">
          <p class="mastery-rule">
            <strong>Everything here applies as you touch it.</strong> There is no confirm step and
            nothing to save. No option is behind an account level, a purchase or a mode, and the
            ones that are simply good design — damage previews, written labels, turn cues — are on
            by default for everyone.
          </p>
        </section>

        <section class="panel panel-chrome policy-controls">
          <h2 class="profile-section-title">Text</h2>
          <div class="setting-row setting-choice-row">
            <div class="setting-label-group">
              <span class="setting-label">Interface size</span>
              <div class="setting-hint faint">Seven steps from 80% to 160%. The preview below is at the size you pick.</div>
            </div>
            <div class="setting-choices" role="radiogroup" aria-label="Interface size">
              ${UI_SCALES.map(
                (scale) => `
                  <button class="setting-choice ${s.uiScale === scale ? "active" : ""}"
                          role="radio" aria-checked="${s.uiScale === scale}"
                          data-key="uiScale" data-number="${scale}">${Math.round(scale * 100)}%</button>`
              ).join("")}
            </div>
          </div>
          <p class="a11y-preview-text" id="a11y-preview-text">
            <strong>Preview.</strong> Deal 3 damage to a character. If it survives, draw a card.
          </p>
          ${toggleRow("Written labels everywhere", "verboseLabels", "Prints the name beside every icon — hand, deck, discard, statuses and Currents.")}
          ${toggleRow("Card reminder text", "rulesLens", "Prints every keyword's reminder on the card face itself, at every rarity.")}
          ${toggleRow("Dyslexia-friendly text", "dyslexiaFont", "A wider-spaced stack already on your device; nothing is downloaded.")}
        </section>

        <section class="panel panel-chrome policy-controls">
          <h2 class="profile-section-title">Colour</h2>
          <div class="a11y-colour">
            <div class="a11y-colour-controls">
              ${choiceRow<ColorblindMode>(
                "Colour-blind mode",
                "colorblindMode",
                COLORBLIND_MODES.map((mode) => ({ value: mode, label: MODE_LABEL[mode] })),
                "Changes eight hues and nothing else — never a layout, an icon or a label."
              )}
              <ul class="a11y-pressure">
                ${pressure
                  .map(
                    (entry) => `
                      <li>
                        <strong>${esc(MODE_LABEL[entry.mode])}</strong> —
                        the default palette has <strong>${entry.confusableByDefault}</strong>
                        pair${entry.confusableByDefault === 1 ? "" : "s"} of Currents you could not tell apart;
                        this mode leaves <strong>${entry.confusableInMode}</strong>.
                      </li>`
                  )
                  .join("")}
              </ul>
              ${toggleRow("Pattern fills on Currents", "currentPatterns", "A hatch on every Current badge — a fourth signal after shape, glyph and label. Always on in a colour-blind mode.")}
              ${toggleRow("High contrast", "highContrast", "Stronger borders and flattened glass panels.")}
            </div>
            <div class="a11y-swatches" id="a11y-swatches"></div>
          </div>
          <div class="a11y-card-preview" id="a11y-card"></div>
        </section>

        <section class="panel panel-chrome policy-controls">
          <h2 class="profile-section-title">Motion</h2>
          ${toggleRow("Reduced motion", "reducedMotion", "Replaces movement with quick fades and disables particles.")}
          ${toggleRow("Screen shake", "screenShake", "Camera kick on heavy hits.")}
          ${choiceRow("Animation speed", "animationSpeed", [
            { value: "full", label: "Full" },
            { value: "fast", label: "Fast" },
            { value: "instant", label: "Instant" },
          ], "Applies to every animation in a match, including the ones you have not seen before.")}
        </section>

        <section class="panel panel-chrome policy-controls">
          <h2 class="profile-section-title">Input</h2>
          ${toggleRow("Keyboard navigation", "keyboardNav", "Tab moves through every control on every menu screen, and the focused one is outlined.")}
          ${choiceRow<FocusRing>("Focus outline", "focusRing", [
            { value: "thin", label: "Thin" },
            { value: "medium", label: "Medium" },
            { value: "thick", label: "Thick" },
          ], "How heavy the outline around the focused control is.")}
          <p class="faint">
            Tab through this screen to see it. The battle board is still pointer-only — see below.
          </p>
        </section>

        <section class="panel panel-chrome policy-controls">
          <h2 class="profile-section-title">Sound</h2>
          ${toggleRow("Accessibility audio cues", "audioCues", `Distinct sounds for ${cueData().length} events — your turn starting, lethal becoming available, a Confluence, Burnout, a card burning. They are synthesised rather than played from files, so they work in a build with no audio assets at all.`)}
          ${toggleRow("Sound captions", "soundCaptions", "The captioned cues as text on screen, for when sound is not an option.")}
          ${toggleRow("Duck music under cues", "duckUnderCues", "Music and ambience drop 6 dB while a cue plays, so it does not have to compete.")}
          ${toggleRow("Subtitles", "subtitles", "Captions for leader voice lines and story dialogue.")}
          <div class="a11y-cue-list" id="a11y-cues"></div>
        </section>

        <section class="panel panel-chrome policy-note">
          <h2 class="profile-section-title">What is not here yet</h2>
          <p class="muted">
            The specification asks for more than this build can honour. Every missing control is
            listed with the reason, because on this screen of all screens, a gap you cannot see is
            a gap you keep looking for.
          </p>
          <ul class="mail-deferred-list">
            ${[...DEFERRED_A11Y]
              .map(([name, reason]) => `<li><strong>${esc(name)}</strong><span class="muted"> — ${esc(reason)}.</span></li>`)
              .join("")}
          </ul>
        </section>
      </main>`;

    // --- live preview ------------------------------------------------------
    const swatches = root.querySelector("#a11y-swatches");
    if (swatches) {
      for (const [id, entry] of Object.entries(CURRENT_PALETTE) as [CurrentId, (typeof CURRENT_PALETTE)[CurrentId]][]) {
        const chip = document.createElement("div");
        chip.className = "a11y-swatch";
        chip.dataset["current"] = id;
        chip.style.setProperty("--c", entry.key);
        chip.innerHTML = `<span class="a11y-swatch-dot"></span><span>${esc(entry.label)}</span>`;
        swatches.appendChild(chip);
      }
    }

    const cardHost = root.querySelector("#a11y-card");
    if (cardHost) cardHost.appendChild(renderCardToCanvas(sample, 260));

    const preview = root.querySelector<HTMLElement>("#a11y-preview-text");
    if (preview) preview.style.fontSize = `${s.uiScale}rem`;

    // --- wiring ------------------------------------------------------------
    root.querySelector("#a11y-back")?.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      callbacks.onBack();
    });
    for (const button of root.querySelectorAll<HTMLElement>("[data-toggle]")) {
      button.addEventListener("click", () => {
        const key = button.dataset["toggle"] as keyof Settings;
        set({ [key]: !getSettings()[key] } as unknown as Partial<Settings>);
      });
    }
    for (const button of root.querySelectorAll<HTMLElement>("[data-key]")) {
      button.addEventListener("click", () => {
        const key = button.dataset["key"] as keyof Settings;
        const number = button.dataset["number"];
        set({ [key]: number !== undefined ? Number(number) : button.dataset["value"] } as unknown as Partial<Settings>);
      });
    }
  };

  /**
   * Every cue, with a button to hear it.
   *
   * A cue you cannot preview is a cue you learn during a match you are losing.
   * Each row prints §11's own description of the sound next to it, so what the
   * spec asked for and what the synth produces can be compared by ear.
   */
  function renderCues(): void {
    const host = root.querySelector<HTMLElement>("#a11y-cues");
    if (!host) return;
    host.replaceChildren();
    for (const cue of cueData()) {
      const row = document.createElement("button");
      row.className = "btn btn-ghost a11y-cue";
      row.type = "button";
      row.dataset["cue"] = cue.id;
      row.innerHTML = `
        <span class="a11y-cue-event">${esc(cue.event)}</span>
        <span class="muted a11y-cue-character">${esc(cue.character)}${cue.caption ? " · captioned" : ""}</span>`;
      row.addEventListener("click", () => {
        audio.unlock();
        audio.cue(cue.id);
      });
      host.appendChild(row);
    }
  }

  const renderAll = (): void => {
    render();
    renderCues();
  };

  renderAll();

  /** Automation hook, the same shape the other screens expose. */
  (window as unknown as { hypeboundA11y?: unknown }).hypeboundA11y = {
    settings: () => getSettings(),
    cues: () => cueData().map((cue) => ({ id: cue.id, row: cue.row, character: cue.character, tones: cue.tones.length })),
    deferredCues: () => [...DEFERRED_CUES].map(([row, reason]) => ({ row, reason })),
    set: (patch: Partial<Settings>) => {
      updateSettings(patch);
      renderAll();
      return getSettings();
    },
    scales: () => [...UI_SCALES],
    modes: () => [...COLORBLIND_MODES],
    pressure: () => defaultPalettePressure(),
    swatches: () =>
      Object.fromEntries(Object.entries(CURRENT_PALETTE).map(([id, entry]) => [id, entry.key])),
    patternsOn: () => patternsActive(),
    deferred: () => [...DEFERRED_A11Y].map(([name, reason]) => ({ name, reason })),
    refresh: renderAll,
  };

  return {
    root,
    dispose: () => {
      delete (window as unknown as { hypeboundA11y?: unknown }).hypeboundA11y;
    },
  };
}
