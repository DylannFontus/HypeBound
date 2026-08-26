/**
 * Player settings: audio mix, accessibility, gameplay preferences.
 *
 * Applied to the document root as data-attributes and custom properties so CSS
 * and the canvas renderer both react instantly. `applySettings` is the single
 * funnel: nothing else writes the root, and nothing else swaps the palette.
 *
 * **Presentation-only, always** (`13-accessibility.md` §1.3). The engine cannot
 * observe any of this: `MatchState`, `EngineEvent` ordering and `MatchRecord`
 * replays are byte-identical whatever is set here.
 */

import { createStore } from "./storage";
import { installDesktopWindow } from "../desktop/window";
import { activePalette, applyColorblindMode, type ColorblindMode } from "../ui/cardRenderer/palette";
import { setPatterns } from "../ui/cardRenderer/hatch";
import { setRulesLens } from "../ui/cardRenderer/renderCard";

export type { ColorblindMode };

/**
 * `13-accessibility.md` §3.2's seven steps, 80%–160%.
 *
 * Stored as the multiplier itself rather than as a name, because the spec's
 * table is a list of multipliers and a name would need a second table to mean
 * anything. `UI_SCALES` is the allowlist; anything else is clamped to the
 * nearest step on load.
 */
export const UI_SCALES = [0.8, 0.9, 1.0, 1.1, 1.25, 1.4, 1.6] as const;
export type UiScale = (typeof UI_SCALES)[number];

export type AnimationSpeed = "full" | "fast" | "instant";
export type QualityPreference = "auto" | "high" | "medium" | "low";
export type FocusRing = "thin" | "medium" | "thick";

export interface Settings {
  // audio — five independent channels plus a master
  volumeMaster: number;
  volumeMusic: number;
  volumeVoice: number;
  volumeUi: number;
  volumeBattle: number;
  volumeAmbient: number;
  streamerSafeAudio: boolean;

  // accessibility — text
  /** §3.2's seven steps; the root font size is 16px × this */
  uiScale: number;
  /** always print Current names and status labels, never icon-only */
  verboseLabels: boolean;
  /** §17's Rules Lens: print every keyword's reminder text on the card face */
  rulesLens: boolean;
  /** a wider-spaced fallback stack, bundled with the browser rather than downloaded */
  dyslexiaFont: boolean;

  // accessibility — motion and colour
  reducedMotion: boolean;
  highContrast: boolean;
  colorblindMode: ColorblindMode;
  /** §8.1's hatch fills on Current badges; forced on inside any colour-blind mode */
  currentPatterns: boolean;
  screenShake: boolean;

  // accessibility — input
  keyboardNav: boolean;
  focusRing: FocusRing;

  // accessibility — audio
  subtitles: boolean;
  /** §11's cues: turn start, the timer rope, and lethal becoming available */
  audioCues: boolean;
  /** independent gain for those cues, so they can sit above the mix */
  audioCueGain: number;
  /** §11's captioned cues as on-screen text, for when sound is not an option */
  soundCaptions: boolean;
  /**
   * §11: music and ambient drop 6 dB for a cue's duration.
   *
   * On by default, because a cue that arrives underneath a music bed is a cue
   * somebody has to strain for — and the whole point of the accessibility gain
   * is that they should not have to.
   */
  duckUnderCues: boolean;

  // gameplay / presentation
  animationSpeed: AnimationSpeed;
  skipSeenAnimations: boolean;
  quality: QualityPreference;
  showDamagePreviews: boolean;
  confirmEndTurnWithPlays: boolean;
  autoEndTurn: boolean;
}

function defaults(): Settings {
  const prefersReducedMotion =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  return {
    volumeMaster: 0.8,
    volumeMusic: 0.6,
    volumeVoice: 0.9,
    volumeUi: 0.7,
    volumeBattle: 0.8,
    volumeAmbient: 0.5,
    streamerSafeAudio: false,

    uiScale: 1,
    verboseLabels: true,
    rulesLens: false,
    dyslexiaFont: false,

    reducedMotion: prefersReducedMotion,
    highContrast: false,
    colorblindMode: "off",
    currentPatterns: false,
    screenShake: true,

    keyboardNav: true,
    focusRing: "medium",

    subtitles: true,
    /**
     * §1.4: on by default for everyone. A cue that tells you your turn started
     * is good design rather than an accommodation — and the players who most
     * need it are the least likely to go looking for a switch.
     */
    audioCues: true,
    audioCueGain: 1,
    soundCaptions: false,
    duckUnderCues: true,

    animationSpeed: "full",
    skipSeenAnimations: true,
    quality: "auto",
    showDamagePreviews: true,
    confirmEndTurnWithPlays: true,
    autoEndTurn: false,
  };
}

/**
 * Bring an older save's shape forward.
 *
 * The text scale used to be four named steps (`s`/`m`/`l`/`xl`); §3.2 asks for
 * seven multipliers. A save carrying the old name is mapped to the nearest new
 * step rather than reset, because somebody who chose "extra large" chose it for
 * a reason and silently returning them to 100% is the worst possible outcome of
 * an accessibility change.
 */
const LEGACY_TEXT_SCALE: Record<string, number> = { s: 0.9, m: 1, l: 1.1, xl: 1.4 };

function migrate(data: unknown): Settings {
  const raw = (data ?? {}) as Record<string, unknown> & Partial<Settings>;
  const legacy = typeof raw["textScale"] === "string" ? LEGACY_TEXT_SCALE[raw["textScale"] as string] : undefined;
  const scale = typeof raw.uiScale === "number" ? raw.uiScale : legacy;
  return {
    ...defaults(),
    ...(raw as Partial<Settings>),
    uiScale: nearestScale(scale ?? 1),
  };
}

/** The closest shipped step to an arbitrary number, so a bad value cannot stick. */
export function nearestScale(value: number): number {
  return UI_SCALES.reduce((best, step) => (Math.abs(step - value) < Math.abs(best - value) ? step : best), UI_SCALES[2]);
}

export const settingsStore = createStore<Settings>({
  key: "settings",
  version: 2,
  defaults,
  migrate,
});

export function getSettings(): Settings {
  return settingsStore.get();
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const next = settingsStore.set(patch);
  applySettings(next);
  return next;
}

/** Multiplier the presenter applies to every animation duration. */
export function animationScale(): number {
  const settings = getSettings();
  if (settings.reducedMotion) return 0.25;
  switch (settings.animationSpeed) {
    case "instant":
      return 0.01;
    case "fast":
      return 0.55;
    default:
      return 1;
  }
}

/** Effective volume for a channel, after the master. */
export function channelVolume(channel: "music" | "voice" | "ui" | "battle" | "ambient"): number {
  const s = getSettings();
  const map = {
    music: s.volumeMusic,
    voice: s.volumeVoice,
    ui: s.volumeUi,
    battle: s.volumeBattle,
    ambient: s.volumeAmbient,
  };
  return Math.max(0, Math.min(1, map[channel] * s.volumeMaster));
}

/**
 * Volume for an accessibility cue (§11).
 *
 * Deliberately **not** multiplied by the battle channel: a cue that tells you
 * your turn has started is not a battle effect, and turning battle effects down
 * must not turn off the thing telling you it is your move.
 */
export function cueVolume(): number {
  const s = getSettings();
  if (!s.audioCues) return 0;
  return Math.max(0, Math.min(1, s.audioCueGain * s.volumeMaster));
}

/** §8.1: hatch fills are forced on inside any colour-blind mode. */
export const patternsActive = (settings: Settings = getSettings()): boolean =>
  settings.currentPatterns || settings.colorblindMode !== "off";

/**
 * Push settings onto the document root so CSS and the renderer can read them.
 *
 * The **colour tokens are written from here** rather than declared per mode in
 * CSS. `palette.ts` owns the values because the canvas cannot read CSS variables
 * cheaply per frame, and two copies of eight hex codes across four modes is
 * thirty-two chances for the DOM and the card frames to disagree about what
 * colour Cinder is.
 */
export function applySettings(settings: Settings = getSettings()): void {
  applyColorblindMode(settings.colorblindMode);
  setPatterns(patternsActive(settings));
  setRulesLens(settings.rulesLens);
  if (typeof document === "undefined") return;
  /**
   * The desktop window is a presentation surface too.
   *
   * This is here rather than in `main.ts::boot` for one reason: `applySettings`
   * is the funnel that already runs at boot *and* on every change, and `main.ts`
   * belongs to another owner. The call is idempotent — it binds F11 and Escape
   * once and then costs a boolean — and on the web build it returns before it
   * has read anything, because `window.isTauri` is not defined there. It is
   * deliberately not passed `settings`: the fullscreen preference is **not** a
   * `Settings` field, because `settingsStore` syncs between devices and a window
   * rectangle must not. See `src/desktop/window.ts`.
   */
  installDesktopWindow();
  const root = document.documentElement;
  root.dataset["reducedMotion"] = String(settings.reducedMotion);
  root.dataset["contrast"] = settings.highContrast ? "high" : "normal";
  root.dataset["colorblind"] = settings.colorblindMode;
  root.dataset["labels"] = settings.verboseLabels ? "verbose" : "compact";
  root.dataset["font"] = settings.dyslexiaFont ? "dyslexia" : "default";
  root.dataset["keyboardNav"] = String(settings.keyboardNav);
  root.dataset["focusRing"] = settings.focusRing;
  root.dataset["patterns"] = String(patternsActive(settings));
  root.style.setProperty("--ui-scale", String(nearestScale(settings.uiScale)));

  for (const [id, entry] of Object.entries(activePalette())) {
    root.style.setProperty(`--current-${id}`, entry.key);
    root.style.setProperty(`--current-${id}-lo`, entry.lo);
  }
}
