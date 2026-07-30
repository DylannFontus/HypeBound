/**
 * Colour and shape lookups for card rendering.
 *
 * These mirror the CSS custom properties in theme/base.css. The canvas cannot
 * read CSS variables cheaply per frame, so the values live here as the single
 * source for canvas rendering — keep the two in sync when retheming.
 */

import type { CurrentId, FactionId, Rarity } from "../../engine/types";

export interface CurrentPalette {
  /** primary hue — frame rim, badge, glow */
  key: string;
  /** bright highlight for edges and specular sweeps */
  hi: string;
  /** deep shade for the frame body gradient */
  lo: string;
  /** deepest, used behind the art window */
  abyss: string;
  /** how the frame edge is cut — see frameShapes.ts */
  shape: FrameShape;
  /** short label printed on the badge (accessibility: never colour alone) */
  label: string;
  /** §8.1's hatch fill, drawn on the badge when patterns are on */
  hatch: HatchPattern;
}

export type FrameShape =
  | "flame-notch"
  | "wave-round"
  | "hex-stone"
  | "ribbon-sweep"
  | "circuit-angle"
  | "radiant-circle"
  | "shard-mirror"
  | "crystal-facet";

/**
 * `13-accessibility.md` §8.1's hatch patterns.
 *
 * A fourth redundant channel behind shape, label and glyph — and the only one
 * that survives a photograph, a stream compressed to mush, or a monitor with
 * its saturation at zero. Eight patterns for eight Currents, each visually
 * distinct at badge size.
 */
export type HatchPattern = "diagonal" | "wave" | "grid" | "chevron" | "dots" | "rays" | "cross" | "checker";

export type ColorblindMode = "off" | "protanopia" | "deuteranopia" | "tritanopia";

/**
 * The identity of each Current that does **not** change with colour: its frame
 * shape, its printed label and its hatch. Only the hue is a variable.
 */
const CURRENT_IDENTITY: Record<CurrentId, { shape: FrameShape; label: string; hatch: HatchPattern }> = {
  cinder: { shape: "flame-notch", label: "CINDER", hatch: "diagonal" },
  tide: { shape: "wave-round", label: "TIDE", hatch: "wave" },
  root: { shape: "hex-stone", label: "ROOT", hatch: "grid" },
  gale: { shape: "ribbon-sweep", label: "GALE", hatch: "chevron" },
  pulse: { shape: "circuit-angle", label: "PULSE", hatch: "dots" },
  halo: { shape: "radiant-circle", label: "HALO", hatch: "rays" },
  veil: { shape: "shard-mirror", label: "VEIL", hatch: "cross" },
  prism: { shape: "crystal-facet", label: "PRISM", hatch: "checker" },
};

/**
 * The key hue per Current, per colour-blind mode — `13-accessibility.md` §7.1.
 *
 * A mode changes **only** these eight values. It never changes layout,
 * iconography or labels, because those already carry the information (§8), and
 * a mode that moved things would make two players describing the same board
 * describe different screens.
 *
 * The rest of each palette (`hi`, `lo`, `abyss`) is derived from the key by
 * mixing toward white and black, so a re-tuned hue cannot leave a stale shade
 * behind it. `tests/a11y.test.ts` runs a dichromacy simulation over every pair
 * in every mode and fails if two Currents become confusable — which is what
 * makes these values tunable rather than sacred.
 */
const CURRENT_KEYS: Record<ColorblindMode, Record<CurrentId, string>> = {
  off: {
    cinder: "#ff6b2c",
    tide: "#2f93ff",
    root: "#56c264",
    gale: "#4fe3d0",
    pulse: "#a855f7",
    halo: "#ffd86b",
    veil: "#8b5cf6",
    prism: "#ff8fd8",
  },
  /**
   * Red-blind. Only Veil and Pulse actually needed moving: under protanopia the
   * two purples collapse into each other, so Veil goes darker and bluer while
   * Pulse stays where it was.
   */
  protanopia: {
    cinder: "#ff6926",
    tide: "#2f93ff",
    root: "#54c56d",
    gale: "#4fe3d0",
    pulse: "#a355ff",
    halo: "#ffd86b",
    veil: "#6132c9",
    prism: "#ff8fd8",
  },
  /**
   * Green-blind, which is the harshest of the three: Tide lifts to separate from
   * Pulse, Pulse darkens, Veil lightens, and Prism warms — four moves rather
   * than two, because the red–green collapse takes more of the wheel with it.
   */
  deuteranopia: {
    cinder: "#fb6826",
    tide: "#619dff",
    root: "#55c264",
    gale: "#59dfc3",
    pulse: "#9133ca",
    halo: "#ffd86b",
    veil: "#825fff",
    prism: "#ff98f4",
  },
  /** Blue-blind. Root shifts warm to hold away from Gale; everything else stays. */
  tritanopia: {
    cinder: "#ff6a2c",
    tide: "#2e93ff",
    root: "#79c05e",
    gale: "#4de4d1",
    pulse: "#aa54f7",
    halo: "#ffd86b",
    veil: "#875cf7",
    prism: "#ff8fd8",
  },
};

/** Build a full palette from the eight key hues of a mode. */
export function buildPalette(mode: ColorblindMode): Record<CurrentId, CurrentPalette> {
  const keys = CURRENT_KEYS[mode];
  const out = {} as Record<CurrentId, CurrentPalette>;
  for (const id of Object.keys(CURRENT_IDENTITY) as CurrentId[]) {
    const key = keys[id];
    out[id] = {
      key,
      hi: mix(key, "#ffffff", 0.55),
      lo: mix(key, "#000000", 0.68),
      abyss: mix(key, "#000000", 0.86),
      ...CURRENT_IDENTITY[id],
    };
  }
  return out;
}

/**
 * The live palette.
 *
 * **Mutated in place** rather than replaced, because every renderer and screen
 * reads `CURRENT_PALETTE[current]` directly and the canvas cannot afford a CSS
 * variable lookup per frame. `applyColorblindMode` is the only writer, and
 * `applySettings` is the only caller — so there is exactly one place a mode
 * change happens, and one object that has to know about it.
 */
export const CURRENT_PALETTE: Record<CurrentId, CurrentPalette> = buildPalette("off");

let activeMode: ColorblindMode = "off";

/** Swap every Current's hue for a colour-blind mode's. Idempotent and cheap. */
export function applyColorblindMode(mode: ColorblindMode): void {
  const next = buildPalette(mode);
  for (const id of Object.keys(next) as CurrentId[]) Object.assign(CURRENT_PALETTE[id], next[id]);
  activeMode = mode;
}

/** The palette as it currently stands, for anyone who needs to read it whole. */
export const activePalette = (): Record<CurrentId, CurrentPalette> => CURRENT_PALETTE;

export const colorblindMode = (): ColorblindMode => activeMode;

/** Every mode's key hues, for the palette guardrail and the preview swatches. */
export const paletteFor = (mode: ColorblindMode): Record<CurrentId, string> => CURRENT_KEYS[mode];

export const COLORBLIND_MODES: ColorblindMode[] = ["off", "protanopia", "deuteranopia", "tritanopia"];

export const FACTION_COLOR: Record<FactionId, string> = {
  "neon-idols": "#ff5fa2",
  "gothic-royalty": "#b8548a",
  "viral-influencers": "#ff8a3d",
  "corporate-creators": "#4d8fd6",
  "digital-demons": "#d92b4b",
  "cosplay-champions": "#c77dff",
  "afterparty-crew": "#ffb347",
  "touch-grass-order": "#6cbf5a",
  "algorithm-syndicate": "#35d0d8",
  "meme-collective": "#f2d541",
  neutral: "#8f8aa8",
};

export interface RarityStyle {
  color: string;
  label: string;
  /** number of gem facets drawn — an accessible, non-colour rarity signal */
  gems: number;
}

export const RARITY_STYLE: Record<Rarity, RarityStyle> = {
  common: { color: "#b8b2cc", label: "COMMON", gems: 1 },
  rare: { color: "#4d9fff", label: "RARE", gems: 2 },
  epic: { color: "#c168ff", label: "EPIC", gems: 3 },
  legendary: { color: "#ffb43d", label: "LEGENDARY", gems: 4 },
};

/**
 * Canonical card size — matches the source art dimensions exactly, because the
 * art is full-bleed: it fills the whole card and the UI is overlaid on top.
 * Drop art at public/assets/art/<card-id>.png at this size.
 */
export const CARD_W = 512;
export const CARD_H = 680;

/**
 * Layout in card-space. With full-bleed art every element sits over the
 * artwork, so each one carries its own scrim or plate for legibility.
 */
export const LAYOUT = {
  bleed: 8,
  /** the art fills the entire card, clipped to the Current frame silhouette */
  art: { x: 0, y: 0, w: CARD_W, h: CARD_H },
  /** darkening bands that keep overlaid text readable over any artwork */
  topScrim: { x: 0, y: 0, w: CARD_W, h: 132 },
  bottomScrim: { x: 0, y: 356, w: CARD_W, h: CARD_H - 356 },
  namePlate: { x: 30, y: 392, w: CARD_W - 60, h: 50 },
  /** the type line sits in the gap between the name banner and the text box */
  typeLineY: 460,
  textBox: { x: 30, y: 476, w: CARD_W - 60, h: 142 },
  costGem: { cx: 56, cy: 58, r: 38 },
  badge: { x: 292, y: 26, w: 190, h: 52 },
  attackChip: { cx: 60, cy: 636, r: 38 },
  healthChip: { cx: CARD_W - 60, cy: 636, r: 38 },
  /**
   * Board cards use these instead — see `statEmphasis` in renderCard.
   *
   * A card on the board renders about 121px wide, where the normal chips are
   * 18px across with a 6px numeral: legible on the inspect view they were
   * designed against, not while you are counting trades. These are 22.4% of the
   * card's width, close to the 24% the reference gives its board units, and sit
   * hard in the bottom corners so the enlargement eats artwork rather than the
   * name plate.
   */
  boardAttackChip: { cx: 64, cy: 620, r: 54 },
  boardHealthChip: { cx: CARD_W - 64, cy: 620, r: 54 },
  /**
   * ...and the rules box gives up the height they need. Gems that size cannot
   * fit below a full-height text box without running off the card, and on the
   * board the stats are what you read while the rules text is what you
   * press-and-hold to read. Shrinking the box is the cheaper loss.
   */
  boardTextBox: { x: 30, y: 476, w: CARD_W - 60, h: 84 },
  rarityGem: { cx: CARD_W / 2, cy: 644, r: 14 },
  crest: { cx: CARD_W / 2, cy: 56, r: 22 },
} as const;

export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const value = parseInt(clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Blend two hex colours; t = 0 returns a, t = 1 returns b. */
export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.replace("#", ""), 16);
  const pb = parseInt(b.replace("#", ""), 16);
  const ar = (pa >> 16) & 255, ag = (pa >> 8) & 255, ab = pa & 255;
  const br = (pb >> 16) & 255, bg = (pb >> 8) & 255, bb = pb & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, "0")}`;
}
