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
import { count, enter, icon, quantify } from "./data/kit";

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
  root.className = "screen settings-screen";
  root.innerHTML = `
    <div class="ambient-bg"></div>
    <header class="sub-header">
      <button class="btn btn-ghost" id="set-back">${icon("arrow-left", 16)} Lobby</button>
      <h1 class="title">Settings</h1>
      <div></div>
    </header>
    <div class="settings-body data-body" id="settings-body"></div>`;

  const body = root.querySelector<HTMLElement>("#settings-body");

  /**
   * A section, with a drawn mark rather than a heading on its own.
   *
   * Five identical panels in a column is a settings *document*; a mark at the
   * head of each is what makes it a settings *screen*. The icon is from the one
   * set at the one weight, which is the whole point of having a set.
   */
  function section(title: string, iconId: Parameters<typeof icon>[0], description?: string): HTMLElement {
    const node = document.createElement("section");
    node.className = "settings-section panel d-enter";
    node.innerHTML = `
      <div class="settings-head">
        <span class="settings-mark" aria-hidden="true">${icon(iconId, 20)}</span>
        <div>
          <h2 class="settings-title t-heading">${title}</h2>
          ${description ? `<p class="settings-desc t-body">${description}</p>` : ""}
        </div>
      </div>`;
    body?.appendChild(node);
    return node;
  }

  function slider(host: HTMLElement, label: string, key: keyof Settings, onChange?: () => void): void {
    const row = document.createElement("div");
    row.className = "setting-row";
    const value = getSettings()[key] as number;
    /*
     * `.slider` is module A's control and `shell.ts` keeps `--slider-fill` in
     * step with the value, so the filled portion of the groove is real rather
     * than the empty black rail every slider in the game used to render as. The
     * old class only ever said `accent-color`, which a control with
     * `appearance: none` ignores entirely.
     */
    row.innerHTML = `
      <label class="setting-label" for="s-${key}">${label}</label>
      <input class="slider setting-slider" id="s-${key}" type="range" min="0" max="100"
             value="${Math.round(value * 100)}" />
      <output class="setting-output num" id="o-${key}">${Math.round(value * 100)}%</output>`;
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

  function toggle(host: HTMLElement, label: string, key: keyof Settings, description?: string): void {
    const row = document.createElement("div");
    row.className = "setting-row setting-toggle-row";
    const checked = Boolean(getSettings()[key]);
    row.innerHTML = `
      <div class="setting-label-group">
        <label class="setting-label" for="s-${key}">${label}</label>
        ${description ? `<div class="setting-hint faint">${description}</div>` : ""}
      </div>
      <button class="setting-toggle ${checked ? "on" : ""}" id="s-${key}" role="switch" aria-checked="${checked}">
        <span class="setting-knob"></span>
      </button>`;
    host.appendChild(row);

    const button = row.querySelector<HTMLButtonElement>(`#s-${key}`);
    button?.addEventListener("click", () => {
      const next = !Boolean(getSettings()[key]);
      updateSettings({ [key]: next } as unknown as Partial<Settings>);
      button.classList.toggle("on", next);
      button.setAttribute("aria-checked", String(next));
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
    const row = document.createElement("div");
    row.className = "setting-row setting-choice-row";
    row.innerHTML = `
      <div class="setting-label-group">
        <span class="setting-label">${label}</span>
        ${description ? `<div class="setting-hint faint">${description}</div>` : ""}
      </div>`;

    const group = document.createElement("div");
    group.className = "setting-choices";
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", label);

    for (const option of options) {
      const button = document.createElement("button");
      const selected = getSettings()[key] === option.value;
      button.className = `setting-choice ${selected ? "active" : ""}`;
      button.textContent = option.label;
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", String(selected));
      button.addEventListener("click", () => {
        updateSettings({ [key]: option.value } as unknown as Partial<Settings>);
        group.querySelectorAll(".setting-choice").forEach((node) => {
          node.classList.remove("active");
          node.setAttribute("aria-checked", "false");
        });
        button.classList.add("active");
        button.setAttribute("aria-checked", "true");
        audio.play("sfx.ui.click");
      });
      group.appendChild(button);
    }

    row.appendChild(group);
    host.appendChild(row);
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
  const a11y = section("Accessibility", "eye", "Text size, motion, colour-blind modes, focus and captions.");
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

  // ---- gameplay ------------------------------------------------------------
  const gameplay = section("Gameplay & Presentation", "settings");
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
    "Everything is stored locally in this browser. Cloud saves arrive with the online build."
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
  const links = section("Information", "info", "Everything the game is obliged to tell you, in one place.");
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
