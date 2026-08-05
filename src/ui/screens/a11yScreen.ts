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
import { count, enter, icon, quantify, segmented, toggleRow } from "./data/kit";
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
/*
 * Nothing in this table may print a specification reference.
 *
 * Three of these rows shipped "§11's 34 cues", "§14's Board Mirror" and "§13's
 * zone model" as player copy, on the one screen whose whole subject is being
 * plainly readable. No shipped game prints its own design-document section
 * numbers, and `unspec` in the kit exists to strip them where they leak — but
 * the right fix for authored copy is to write the sentence without one, because
 * `unspec` substitutes "the design" and leaves prose that is a shade vaguer
 * than what a player deserves here.
 */
export const DEFERRED_A11Y: ReadonlyMap<string, string> = new Map([
  [
    "Eight of the 34 audio cues",
    "the cues themselves are built and synthesised, so they need no audio files at all — but eight of them describe events this build does not produce. Two are the 15-second turn rope, which the offline board does not run; two need the trigger queue to report each step, which it does not; three need the network; and the pack-rarity escalation wants timbres tuned against art that does not exist yet. Every one of the eight is named in the build's own cue list",
  ],
  [
    "Screen-reader support",
    "the board is a single drawn canvas with no accessibility tree behind it. The answer is a Board Mirror — a parallel, readable description of the same board, kept in step with it — and that is designed and not yet built",
  ],
  [
    "Keyboard play on the battle board",
    "moving between zones, picking a target and confirming with the keyboard is a whole input mode rather than a set of shortcuts. Keyboard navigation works across every menu screen; the board itself is still pointer-only",
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

  /** The entrance plays on arrival, not on every one of the live-preview re-renders. */
  let mounted = false;

  const set = (patch: Partial<Settings>): void => {
    updateSettings(patch);
    audio.play("sfx.ui.toggle");
    render();
  };

  const render = (): void => {
    const s = getSettings();
    const pressure = defaultPalettePressure();

    /**
     * The riser class, and why it is a variable rather than a literal.
     *
     * `.d-enter` carries the `d-rise` keyframe itself — `stagger()` only writes
     * the *delay* it consumes. This screen is live-preview: every switch and
     * every segment re-runs `render()` and rebuilds the whole tree, so hanging
     * `.d-enter` on the panels unconditionally would replay a 260ms rise on all
     * seven of them each time somebody dragged the interface size through its
     * seven steps. Gating the class rather than only the `enter()` call is what
     * actually stops it: the entrance belongs to arriving at the screen, not to
     * using it.
     */
    const rise = mounted ? "" : "d-enter";

    /*
     * Both controls come from the kit now, which means both come from module A.
     *
     * This file used to carry a `<button role="switch">` with a `.setting-knob`
     * span in it and a `.setting-choices` track filled with `rgba(0,0,0,0.35)` —
     * a second switch and a third selection treatment, on the one screen whose
     * entire subject is that controls should be legible. `foundation.css` ships
     * both, lit from 315° with all six of A4's states; see `toggleRow` and
     * `segmented` in `data/kit.ts` for the measurement.
     */
    const toggle = (label: string, key: keyof Settings, hint: string): string =>
      toggleRow({ label, hint, key: String(key), on: Boolean(s[key]) });

    const choiceRow = <T extends string>(
      label: string,
      key: keyof Settings,
      options: { value: T; label: string; hint?: string }[],
      hint: string
    ): string =>
      segmented<T>({ label, hint, key: String(key), value: s[key] as T, options });

    /**
     * A section, marked, so six identical plates in a column become six rooms.
     *
     * This is the Settings screen's own `settings-head` shape, restated here on
     * purpose: the two screens are one click apart in the same tree and were
     * built with different heads — a marked one there, a bare `<h2>` here — so
     * walking between them read as walking between two applications. The mark is
     * from `uiIcons.ts`, at one weight and one optical size, which is the whole
     * argument for having a set.
     */
    const section = (title: string, mark: Parameters<typeof icon>[0], rows: string[], extra = ""): string => `
      <section class="mat-panel policy-controls ${rise} ${extra}">
        <div class="settings-head">
          <span class="settings-mark" aria-hidden="true">${icon(mark, 20)}</span>
          <h2 class="t-heading">${esc(title)}</h2>
        </div>
        ${rows.join("")}
      </section>`;

    root.innerHTML = `
      <div class="ambient-bg"></div>
      <header class="screen-header">
        <button class="btn btn-ghost" id="a11y-back">${icon("arrow-left", 16)} Back</button>
        <h1 class="title">Accessibility</h1>
      </header>

      <main class="policy-body a11y-body data-body data-doc">
        <section class="mat-panel policy-summary ${rise}">
          <p class="t-body mastery-rule">
            <strong>Everything here applies as you touch it.</strong> There is no confirm step and
            nothing to save. No option is behind an account level, a purchase or a mode, and the
            ones that are simply good design — damage previews, written labels, turn cues — are on
            by default for everyone.
          </p>
        </section>

        ${section("Text", "edit", [
          segmented<string>({
            label: "Interface size",
            hint: "Seven steps from 80% to 160%. The preview below is at the size you pick.",
            key: "uiScale",
            numeric: true,
            value: String(s.uiScale),
            options: UI_SCALES.map((scale) => ({
              value: String(scale),
              label: `${Math.round(scale * 100)}%`,
            })),
          }),
          /*
           * The preview sits in a recess rather than inside a dashed rectangle.
           *
           * A 1px dashed border is the browser's own idiom for "drop target",
           * and this is a specimen: `.mat-well` is what the foundation ships for
           * a thing set into a surface, and it puts the sample text on a
           * different plane from the controls above it without a dotted line.
           */
          `<p class="a11y-preview-text mat-well t-body" id="a11y-preview-text">
             <strong>Preview.</strong> Deal 3 damage to a character. If it survives, draw a card.
           </p>`,
          toggle("Written labels everywhere", "verboseLabels", "Prints the name beside every icon — hand, deck, discard, statuses and Currents."),
          toggle("Card reminder text", "rulesLens", "Prints every keyword's reminder on the card face itself, at every rarity."),
          toggle("Dyslexia-friendly text", "dyslexiaFont", "A wider-spaced stack already on your device; nothing is downloaded."),
        ])}

        ${section("Colour", "kw-refract", [
          `<div class="a11y-colour">
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
                       <li class="t-body">
                         <strong>${esc(MODE_LABEL[entry.mode])}</strong> —
                         the default palette has
                         <strong class="num">${count(entry.confusableByDefault)}</strong>
                         ${entry.confusableByDefault === 1 ? "pair" : "pairs"} of Currents you could not tell apart;
                         this mode leaves <strong class="num">${count(entry.confusableInMode)}</strong>.
                       </li>`
                   )
                   .join("")}
               </ul>
               ${toggle("Pattern fills on Currents", "currentPatterns", "A hatch on every Current badge — a fourth signal after shape, glyph and label. Always on in a colour-blind mode.")}
               ${toggle("High contrast", "highContrast", "Stronger borders and flattened glass panels.")}
             </div>
             <div class="a11y-swatches" id="a11y-swatches"></div>
           </div>`,
          /*
           * The specimen, captioned, beside its caption rather than centred.
           *
           * A 260px card floating in the middle of an 870px panel leaves 300px
           * of nothing either side of it, and nothing on the page says what it
           * is for — so a player reading down the Colour section meets a card
           * with no explanation of why it is there. It is a *live specimen*: it
           * is redrawn by the real renderer every time one of these controls
           * moves, which is the strongest claim this screen makes and was going
           * unsaid.
           */
          `<div class="a11y-card-preview">
             <div class="a11y-card-slot" id="a11y-card"></div>
             <div class="a11y-card-note">
               <h3 class="t-label">Live specimen</h3>
               <p class="t-body">
                 A real card, drawn by the game's own renderer with the settings above applied. Every
                 control on this panel redraws it, so what you are looking at is what a match will
                 look like — not an approximation of it.
               </p>
             </div>
           </div>`,
        ])}

        ${section("Motion", "refresh", [
          toggle("Reduced motion", "reducedMotion", "Replaces movement with quick fades and disables particles."),
          toggle("Screen shake", "screenShake", "Camera kick on heavy hits."),
          choiceRow("Animation speed", "animationSpeed", [
            { value: "full", label: "Full" },
            { value: "fast", label: "Fast" },
            { value: "instant", label: "Instant" },
          ], "Applies to every animation in a match, including the ones you have not seen before."),
        ])}

        ${section("Input", "crosshair", [
          toggle("Keyboard navigation", "keyboardNav", "Tab moves through every control on every menu screen, and the focused one is outlined."),
          choiceRow<FocusRing>("Focus outline", "focusRing", [
            { value: "thin", label: "Thin" },
            { value: "medium", label: "Medium" },
            { value: "thick", label: "Thick" },
          ], "How heavy the outline around the focused control is."),
          `<p class="t-body">Tab through this screen to see it. The battle board is still pointer-only — see below.</p>`,
        ])}

        ${section("Sound", "volume", [
          toggle("Accessibility audio cues", "audioCues", `Distinct sounds for ${quantify(cueData().length, "event")} — your turn starting, lethal becoming available, a Confluence, Burnout, a card burning. They are synthesised rather than played from files, so they work in a build with no audio assets at all.`),
          toggle("Sound captions", "soundCaptions", "The captioned cues as text on screen, for when sound is not an option."),
          toggle("Duck music under cues", "duckUnderCues", "Music and ambience drop 6 dB while a cue plays, so it does not have to compete."),
          toggle("Subtitles", "subtitles", "Captions for leader voice lines and story dialogue."),
          `<div class="a11y-cue-list" id="a11y-cues"></div>`,
        ])}

        ${section(
          "What is not here yet",
          "lock",
          [
            `<p class="t-body">
               The specification asks for more than this build can honour. Every missing control is
               listed with the reason, because on this screen of all screens, a gap you cannot see is
               a gap you keep looking for.
             </p>`,
            `<ul class="mail-deferred-list">
               ${[...DEFERRED_A11Y]
                 .map(
                   ([name, reason]) =>
                     `<li><strong>${esc(name)}</strong><span class="muted"> — ${esc(reason)}.</span></li>`
                 )
                 .join("")}
             </ul>`,
          ],
          "policy-note"
        )}
      </main>`;

    // --- live preview ------------------------------------------------------
    const swatches = root.querySelector("#a11y-swatches");
    if (swatches) {
      for (const [id, entry] of Object.entries(CURRENT_PALETTE) as [CurrentId, (typeof CURRENT_PALETTE)[CurrentId]][]) {
        /*
         * `mat-chip chip-static`, because eight of these stand in one column.
         * The material is the same one every other small inline object in the
         * game wears; `chip-static` is module A's own opt-out from the idle
         * sheen, which it documents as existing precisely for "a row of eight
         * badges on one screen".
         */
        const chip = document.createElement("div");
        chip.className = "a11y-swatch mat-chip chip-static";
        chip.dataset["current"] = id;
        chip.style.setProperty("--c", entry.key);
        chip.innerHTML = `<span class="a11y-swatch-dot"></span><span class="t-label">${esc(entry.label)}</span>`;
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
    /*
     * `change`, not `click` — the switch is a real checkbox now, so the space
     * bar and a click both arrive here and neither needs a keydown handler.
     */
    for (const box of root.querySelectorAll<HTMLInputElement>("input.switch[data-toggle]")) {
      box.addEventListener("change", () => {
        const key = box.dataset["toggle"] as keyof Settings;
        set({ [key]: box.checked } as unknown as Partial<Settings>);
      });
    }
    for (const button of root.querySelectorAll<HTMLElement>(".d-seg-opt[data-key]")) {
      button.addEventListener("click", () => {
        const key = button.dataset["key"] as keyof Settings;
        const number = button.dataset["number"];
        set({ [key]: number !== undefined ? Number(number) : button.dataset["value"] } as unknown as Partial<Settings>);
      });
    }

    /*
     * The cascade, which this screen never had — once, on arrival.
     *
     * Six panels landing on one frame is §3a's loudest tell and every other
     * screen in the domain already answers it with `enter()`. It is gated on
     * first mount because this screen re-renders on *every* control change, and
     * replaying a 240ms six-panel entrance each time somebody drags the
     * interface size through seven steps is the opposite of what §3a asks for.
     */
    if (!mounted) {
      mounted = true;
      enter(root, ".d-enter", 40);
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
      /*
       * `.btn.btn-ghost` was a pill with a transparent fill and a 1px border,
       * repeated thirty-four times down a panel — thirty-four outlined lozenges
       * where the reference games would show a list. `mat-chip act` is the same
       * rank of object as every other small inline control in the domain and it
       * brings the six states with it, including a press the old one had not.
       */
      const row = document.createElement("button");
      row.className = "mat-chip act r-tile a11y-cue";
      row.type = "button";
      row.dataset["cue"] = cue.id;
      row.innerHTML = `
        ${icon("volume", 14)}
        <span class="a11y-cue-event">${esc(cue.event)}</span>
        <span class="a11y-cue-character t-label">${esc(cue.character)}${cue.caption ? " · captioned" : ""}</span>`;
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
