/**
 * Settings — `03-screens-and-navigation.md` §4.6.1.
 *
 * Audio, gameplay, graphics, player data, and the links row to the information
 * screens. Every control writes straight to the settings store, which applies
 * data-attributes and custom properties to the document root, so a change is
 * visible before the finger leaves the button.
 *
 * **Accessibility is not here.** §4.6.2 asks for a *"dedicated, discoverable
 * accessibility surface"*, and a section buried between Audio and Graphics is
 * neither — so what remains is the signpost, and the controls live at `#a11y`.
 */

import type { Screen } from "../shell";
import {
  getSettings,
  updateSettings,
  type AnimationSpeed,
  type QualityPreference,
  type Settings,
} from "../../save/settings";
import { audio } from "../../audio/audio";
import { getProfile, profileStore } from "../../save/profile";
import { count, enter, icon, quantify, room, segmented, toggleRow } from "./data/kit";

export interface SettingsCallbacks {
  onBack: () => void;
  onAccessibility: () => void;
  /** §4.6.1's links row — the four system-hub screens */
  onFairness: () => void;
  onPrivacy: () => void;
  onLegal: () => void;
  onSupport: () => void;
}

export function createSettingsScreen(callbacks: SettingsCallbacks): Screen {
  const root = document.createElement("div");
  /**
   * The rail here fixes a defect rather than decorating one.
   *
   * "Open accessibility settings" is a `.mat-hero` — the one hero action on the
   * screen — and it lived in the second of five stacked sections, which put it
   * **below the fold at 1600×900**: the tallest supported desktop viewport
   * showed the Audio panel's six sliders and cut the hero in half. A hero action
   * a player has to scroll to find is not a hero action, and no amount of
   * material fixes a position.
   *
   * On the rail it is the first thing on the screen that is not the title, it
   * never leaves, and the five Information links sit under it — so the whole of
   * "where else can I go from Settings" is one column that does not move, and
   * the main column is left holding only the things you actually adjust.
   */
  root.className = "screen settings-screen d-hall";
  root.innerHTML = `
    ${room({ lit: 0.5 })}
    <header class="sub-header">
      <button class="btn btn-ghost" id="set-back">${icon("arrow-left", 16)} Lobby</button>
      <h1 class="title">Settings</h1>
      <div></div>
    </header>
    <div class="settings-body data-body data-doc" id="settings-body"></div>
    <section class="d-rail" aria-label="Accessibility and information"></section>`;

  const body = root.querySelector<HTMLElement>("#settings-body");
  const rail = root.querySelector<HTMLElement>(".d-rail");

  /**
   * A section, with a drawn mark rather than a heading on its own.
   *
   * Five identical panels in a column is a settings *document*; a mark at the
   * head of each is what makes it a settings *screen*. The icon is from the one
   * set at the one weight, which is the whole point of having a set.
   */
  function section(
    title: string,
    iconId: Parameters<typeof icon>[0],
    description?: string,
    host: HTMLElement | null = body
  ): HTMLElement {
    const node = document.createElement("section");
    node.className = "settings-section mat-panel d-enter";
    node.innerHTML = `
      <div class="settings-head">
        <span class="settings-mark" aria-hidden="true">${icon(iconId, 20)}</span>
        <div>
          <h2 class="settings-title t-heading">${title}</h2>
          ${description ? `<p class="settings-desc t-body">${description}</p>` : ""}
        </div>
      </div>`;
    host?.appendChild(node);
    return node;
  }

  function slider(host: HTMLElement, label: string, key: keyof Settings, onChange?: () => void): void {
    const row = document.createElement("div");
    // `d-set-row` so the six audio rails share the rhythm and the fading divider
    // with the toggles under them; `d-set-slider` re-cuts it into three columns.
    row.className = "d-set-row d-set-slider";
    const value = getSettings()[key] as number;
    /*
     * `.slider` is module A's control and `shell.ts` keeps `--slider-fill` in
     * step with the value, so the filled portion of the groove is real rather
     * than the empty black rail every slider in the game used to render as. The
     * old class only ever said `accent-color`, which a control with
     * `appearance: none` ignores entirely.
     */
    row.innerHTML = `
      <label class="setting-label d-set-label" for="s-${key}">${label}</label>
      <input class="slider setting-slider" id="s-${key}" type="range" min="0" max="100"
             value="${Math.round(value * 100)}" style="--slider-fill:${Math.round(value * 100)}%" />
      <output class="setting-output num" id="o-${key}" style="--digits:4">${Math.round(value * 100)}%</output>`;
    host.appendChild(row);

    const input = row.querySelector<HTMLInputElement>(`#s-${key}`);
    const output = row.querySelector<HTMLElement>(`#o-${key}`);
    input?.addEventListener("input", () => {
      const next = Number(input.value) / 100;
      updateSettings({ [key]: next } as unknown as Partial<Settings>);
      if (output) output.textContent = `${input.value}%`;
      onChange?.();
    });
  }

  /**
   * Both of these are the kit's now, which means both are module A's.
   *
   * What was here was a `<button role="switch">` wrapping a `.setting-knob`
   * span, and a `.setting-choices` track filled with `rgba(0,0,0,0.35)` whose
   * selected segment was a flat `background: var(--accent)`. Neither had a light
   * source, a press state or a disabled skin; both were duplicated verbatim on
   * the Accessibility screen one click away. `foundation.css` §8 ships a switch
   * that is a lit object in a recess, and `data/kit.ts` supplies the row around
   * it — see the notes on `toggleRow` and `segmented`.
   */
  function toggle(host: HTMLElement, label: string, key: keyof Settings, description?: string): void {
    const wrap = document.createElement("div");
    wrap.innerHTML = toggleRow({
      label,
      hint: description,
      key: String(key),
      on: Boolean(getSettings()[key]),
    });
    const row = wrap.firstElementChild as HTMLElement;
    host.appendChild(row);

    row.querySelector<HTMLInputElement>("input.switch")?.addEventListener("change", (event) => {
      updateSettings({ [key]: (event.target as HTMLInputElement).checked } as unknown as Partial<Settings>);
      audio.play("sfx.ui.toggle");
    });
  }

  function choice<T extends string>(
    host: HTMLElement,
    label: string,
    key: keyof Settings,
    options: { value: T; label: string }[],
    description?: string
  ): void {
    const wrap = document.createElement("div");
    wrap.innerHTML = segmented<T>({
      label,
      hint: description,
      key: String(key),
      value: getSettings()[key] as T,
      options,
    });
    const row = wrap.firstElementChild as HTMLElement;
    host.appendChild(row);

    for (const button of row.querySelectorAll<HTMLButtonElement>(".d-seg-opt")) {
      button.addEventListener("click", () => {
        updateSettings({ [key]: button.dataset["value"] } as unknown as Partial<Settings>);
        for (const node of row.querySelectorAll(".d-seg-opt")) {
          node.classList.remove("is-on");
          node.setAttribute("aria-checked", "false");
        }
        button.classList.add("is-on");
        button.setAttribute("aria-checked", "true");
        audio.play("sfx.ui.click");
      });
    }
  }

  // ---- audio ---------------------------------------------------------------
  const audioSection = section(
    "Audio",
    "volume",
    "Five independent channels. Drop your own files into public/assets/audio and map them in data/audio-manifest.json."
  );
  slider(audioSection, "Master", "volumeMaster", () => audio.applyVolumes());
  slider(audioSection, "Music", "volumeMusic", () => audio.applyVolumes());
  slider(audioSection, "Voice Lines", "volumeVoice", () => audio.applyVolumes());
  slider(audioSection, "Interface", "volumeUi", () => audio.applyVolumes());
  slider(audioSection, "Battle Effects", "volumeBattle", () => audio.applyVolumes());
  slider(audioSection, "Ambient", "volumeAmbient", () => audio.applyVolumes());
  toggle(audioSection, "Streamer-safe music", "streamerSafeAudio", "Swaps any licensed tracks for cleared alternatives.");

  const missing = audio.missingSlots().length;
  if (missing > 0) {
    const note = document.createElement("p");
    note.className = "faint settings-note";
    note.textContent = `${count(missing)} of ${quantify(
      audio.allSlots().length,
      "audio slot"
    )} have no file yet — the game runs silently until you add them.`;
    audioSection.appendChild(note);
  }

  /**
   * Accessibility lives on its own screen — `03-screens-and-navigation.md`
   * §4.6.2 asks for a "dedicated, discoverable accessibility surface", and a
   * section buried between Audio and Graphics is neither. What stays here is
   * the signpost, which §4.6.1 asks for by name.
   */
  const a11y = section(
    "Accessibility",
    "eye",
    "Text size, motion, colour-blind modes, focus and captions.",
    rail
  );
  a11y.classList.add("settings-a11y-card");
  const a11yNote = document.createElement("p");
  a11yNote.className = "muted";
  a11yNote.textContent =
    "Every control has a live preview and none of it is behind an account level, a purchase or a mode.";
  a11y.appendChild(a11yNote);
  const a11yButton = document.createElement("button");
  a11yButton.className = "mat-hero act r-chip settings-cta";
  a11yButton.type = "button";
  a11yButton.id = "set-a11y";
  a11yButton.innerHTML = `Open accessibility settings ${icon("chevron-right", 15)}`;
  a11yButton.addEventListener("click", () => {
    audio.play("sfx.ui.click");
    callbacks.onAccessibility();
  });
  a11y.appendChild(a11yButton);

  /**
   * The two shorter panels share a row rather than queueing behind Audio.
   *
   * Audio is six sliders and a toggle and is genuinely tall; Gameplay is five
   * controls and Player Data is three figures and a button. Stacking all three
   * full width made the screen 2,100px of scroll where 1,300 would do, and —
   * more to the point — gave every panel the same rank. A tall panel over a pair
   * of shorter ones is a *composition*; three of the same is a list.
   */
  const band = document.createElement("div");
  band.className = "d-band settings-band";
  body?.appendChild(band);

  // ---- gameplay ------------------------------------------------------------
  const gameplay = section("Gameplay & Presentation", "settings", undefined, band);
  choice<AnimationSpeed>(gameplay, "Animation speed", "animationSpeed", [
    { value: "full", label: "Full" },
    { value: "fast", label: "Fast" },
    { value: "instant", label: "Instant" },
  ]);
  toggle(gameplay, "Shorten seen animations", "skipSeenAnimations", "Effects you have already watched play at reduced length.");
  toggle(gameplay, "Damage previews", "showDamagePreviews", "Shows exact damage, elemental bonus and lethal before you confirm.");
  toggle(gameplay, "Confirm risky end turn", "confirmEndTurnWithPlays", "Warns when you end a turn with unspent Hype and playable cards.");
  choice<QualityPreference>(gameplay, "Graphics quality", "quality", [
    { value: "auto", label: "Auto" },
    { value: "high", label: "High" },
    { value: "medium", label: "Medium" },
    { value: "low", label: "Low" },
  ], "Takes effect on the next match.");

  // ---- data ----------------------------------------------------------------
  const data = section(
    "Player Data",
    "deck",
    "Everything is stored locally in this browser. Cloud saves arrive with the online build.",
    band
  );
  const profile = getProfile();
  const info = document.createElement("dl");
  info.className = "d-stats settings-data-stats";
  info.innerHTML = `
    <div class="d-stat"><dt>Matches played</dt><dd class="num">${count(profile.stats.matchesPlayed)}</dd></div>
    <div class="d-stat"><dt>Unique cards</dt><dd class="num">${count(Object.keys(profile.collection).length)}</dd></div>
    <div class="d-stat"><dt>Saved decks</dt><dd class="num">${count(profile.decks.length)}</dd></div>`;
  data.appendChild(info);

  /**
   * The one destructive action on the screen, styled like one.
   *
   * It used to be a plain `.btn`, visually identical to "Accessibility →" and
   * "Support →" two panels below — so the highest-consequence control in the
   * game was the least distinguished, which is §6's "saturation is a resource"
   * inverted. It is now danger-cased, carries the warning glyph, and still goes
   * through the browser confirm it always did.
   */
  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.className = "mat-panel act r-chip settings-danger";
  resetButton.innerHTML = `${icon("warning", 15)} Reset all player data`;
  resetButton.addEventListener("click", () => {
    if (window.confirm("This erases your collection, decks and progress on this device. Continue?")) {
      profileStore.reset();
      window.location.reload();
    }
  });
  data.appendChild(resetButton);

  /**
   * §4.6.1's links row.
   *
   * Fairness is first because policy F1 names that screen as one of the two
   * places a rate must be readable, and the other one is a purchase button —
   * which is not somewhere a player goes to *check*.
   */
  const links = section("Information", "info", "Everything the game is obliged to tell you, in one place.", rail);
  const linkRow = document.createElement("div");
  linkRow.className = "settings-links";
  for (const [id, label, handler, glyph] of [
    ["set-accessibility", "Accessibility", callbacks.onAccessibility, "eye"],
    ["set-fairness", "Probability disclosures", callbacks.onFairness, "diamond"],
    ["set-privacy", "Privacy", callbacks.onPrivacy, "lock"],
    ["set-legal", "Legal", callbacks.onLegal, "log"],
    ["set-support", "Support", callbacks.onSupport, "help"],
  ] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mat-panel act r-tile settings-link";
    button.id = id;
    button.innerHTML = `${icon(glyph, 18)}<span>${label}</span>${icon("chevron-right", 15, "settings-link-go")}`;
    button.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      handler();
    });
    linkRow.appendChild(button);
  }
  links.appendChild(linkRow);

  const missingNote = audioSection.querySelector(".settings-note");
  if (missingNote) audioSection.appendChild(missingNote);

  root.querySelector("#set-back")?.addEventListener("click", () => callbacks.onBack());
  enter(root, ".settings-section", 42);
  return { root };
}
