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

/**
 * A stable ordinal per faction.
 *
 * Only the procedural crest needs it — it picks a petal count — but three
 * modules draw that crest and each of them was keeping its own copy of the
 * table, so a faction added to one of them was silently a different emblem in
 * the other two.
 */
export const FACTION_INDEX: Record<string, number> = {
  "neon-idols": 0,
  "gothic-royalty": 1,
  "viral-influencers": 2,
  "corporate-creators": 3,
  "digital-demons": 4,
  "cosplay-champions": 5,
  "afterparty-crew": 6,
  "touch-grass-order": 7,
  "algorithm-syndicate": 8,
  "meme-collective": 9,
  neutral: 10,
};

/** The short code printed in the collector line. */
export const FACTION_CODE: Record<FactionId, string> = {
  "neon-idols": "IDL",
  "gothic-royalty": "GTH",
  "viral-influencers": "VRL",
  "corporate-creators": "CRP",
  "digital-demons": "DMN",
  "cosplay-champions": "CSP",
  "afterparty-crew": "AFT",
  "touch-grass-order": "TGO",
  "algorithm-syndicate": "ALG",
  "meme-collective": "MEM",
  neutral: "NTL",
};

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

/**
 * Rarity, as a frame rather than as a colour.
 *
 * The old version of this table was a hex value and a pip count, and the pips
 * were eleven-pixel diamonds hard on the bottom edge of the card where the
 * collection grid's own count pill sits directly over them. On the one screen
 * where a player compares rarities, the only rarity signal was fully occluded —
 * so eleven legendaries and eleven commons photographed identically.
 *
 * Rarity now changes the *object*: how wide the rim is, what metal it is made
 * of, whether the corners carry ornaments, how hard the frame glows, and what
 * mark sits in the name plate's left cap. Colour is the last of five channels
 * rather than the only one, which is what §9 of the accessibility contract asks
 * for and what makes a legendary legible in a photograph of a stream.
 *
 * ## The ladder is a value ladder, which means it cannot be a hue mix
 *
 * The previous table blended a rarity *hue* into the Current's — `mixInto` at
 * 0.44 of Epic's violet over Halo's gold — and that inverted the hierarchy the
 * bar asks for. Two saturated colours a half-turn apart average to grey: held to
 * one Current, Halo epic rendered as a desaturated grey-beige beside a Halo
 * common in rich gold, so the more valuable card was visibly the *cheaper*
 * object. No value of `mixInto` fixes that; the mix is the defect.
 *
 * So the frame metal now only ever climbs. `chroma` multiplies the Current's
 * saturation and `lift` raises its lightness, so each tier is strictly more
 * saturated and brighter than the one below it *on the same Current*, and
 * `gild` — a warm metal, reserved for legendary, the one place a hue shift is
 * worth its cost — arrives on top of that rather than instead of it.
 *
 * Rarity's own colour has not gone anywhere. It is the keyline, the corner caps,
 * the mark in the name plate's cap and the word in the collector line: four
 * accents laid *over* the Current's metal instead of stirred into it, which is
 * the same division Hearthstone makes between a gild and a class colour.
 */
export interface RarityStyle {
  color: string;
  label: string;
  /** number of marks in the name plate's rarity cap — a non-colour signal */
  gems: number;
  /** the metal the rarity mark and the corner caps are cut from */
  metal: { hi: string; key: string; lo: string };
  /** multiplier on the Current's saturation in the frame band; never below 1 above common */
  chroma: number;
  /** added to the Current's lightness in the frame band */
  lift: number;
  /** how much warm gild is laid over the result — legendary's alone */
  gild: number;
  /**
   * Thickness of the frame band, in card-space pixels.
   *
   * The one rarity channel that survives *any* amount of downsampling, because it
   * changes the card's silhouette rather than anything drawn inside it. A 21px
   * band and a 31px band are 6.9 and 10.2 device pixels on a 168px tile — a
   * difference you can see across a room, and the reason a legendary in
   * Hearthstone's collection reads as heavier before you can make out a single
   * ornament on it.
   */
  band: number;
  /** width of the second inset rim line, in the rarity's own colour; 0 draws none */
  innerRim: number;
  /** reach of the corner ornaments in card-space pixels; 0 draws none */
  ornament: number;
  /** strength of the frame's own bloom, and of the specular band that crawls it */
  glow: number;
}

/** The warm metal a legendary is gilded with, and nothing else is. */
export const GILD = "#e8b74a";

export const RARITY_STYLE: Record<Rarity, RarityStyle> = {
  common: {
    color: "#b8b2cc",
    label: "COMMON",
    gems: 1,
    metal: { hi: "#e6e2f2", key: "#9a93b4", lo: "#3a3450" },
    chroma: 0.52,
    lift: -0.1,
    gild: 0,
    band: 21,
    innerRim: 0,
    ornament: 0,
    glow: 0.4,
  },
  rare: {
    color: "#6fb6ff",
    label: "RARE",
    gems: 2,
    metal: { hi: "#e2efff", key: "#78a6dc", lo: "#26374f" },
    chroma: 1,
    lift: 0.03,
    gild: 0,
    band: 24,
    /**
     * Wide enough to survive the grid, which is the whole point of the tier.
     *
     * A rare and a common on the same Current were frame-identical at 168px: the
     * keyline was 1.6px in card space, which is half a device pixel once a 512px
     * card lands in a tile, and the corner caps were anchored on a corner that
     * Tide's 30px fillet had already rounded away, so the outer clip ate them.
     * 3.2px and a cap that starts inside the fillet are both readable at tile
     * size, and they are the two channels a player can see without leaning in.
     */
    innerRim: 3.4,
    ornament: 34,
    glow: 0.6,
  },
  epic: {
    color: "#c987ff",
    label: "EPIC",
    gems: 3,
    metal: { hi: "#f2d9ff", key: "#a86ce0", lo: "#361c52" },
    chroma: 1.34,
    lift: 0.1,
    gild: 0,
    band: 27,
    innerRim: 4.4,
    ornament: 43,
    glow: 0.85,
  },
  legendary: {
    color: "#ffc257",
    label: "LEGENDARY",
    gems: 4,
    metal: { hi: "#fff3cd", key: "#dfa63a", lo: "#4e3208" },
    chroma: 1.2,
    lift: 0.15,
    gild: 0.6,
    band: 31,
    innerRim: 5.2,
    ornament: 54,
    glow: 1,
  },
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
 *
 * ## The bleed is transparent margin, and it is load-bearing
 *
 * It used to be 8px, which is less than the frame's own glow — so a 24px bloom
 * drawn on a stroke 8px from the canvas edge lost two thirds of itself to the
 * clip and terminated in a hard straight line with square corners on all four
 * sides. Several Current silhouettes were worse off than that: Cinder's flame
 * peaks reached 15px past the rect and Pulse's circuit steps 12px, so the two
 * most distinctive outlines in the game were the two that got sliced flat.
 *
 * 20px of margin, silhouette features capped at 9px and a tight 11px rim glow
 * now all fit inside the canvas with room to fade. The big neon bloom stays
 * where it belongs — on the DOM tile and in the board's bloom pass, on a layer
 * larger than the card — because baking a large glow into a fixed-size bitmap
 * is what caused the clip in the first place.
 *
 * ## The top band holds two objects, not three
 *
 * Cost on the left, Current on the right, both centred on y=66. The faction
 * crest moved down into the name plate's right cap, which is what a printed card
 * does with a set symbol and what stopped three unrelated objects from sitting
 * on three baselines six pixels apart. The rarity mark takes the matching left
 * cap, where the collection grid's count pill can never reach it.
 */
export const LAYOUT = {
  bleed: 20,
  /** thickness of the frame band, inward from the silhouette */
  frame: 24,
  /** the art fills the entire card, clipped to the Current frame silhouette */
  art: { x: 0, y: 0, w: CARD_W, h: CARD_H },
  /** darkening bands that keep overlaid text readable over any artwork */
  topScrim: { x: 0, y: 0, w: CARD_W, h: 152 },
  bottomScrim: { x: 0, y: 340, w: CARD_W, h: CARD_H - 340 },
  namePlate: { x: 52, y: 384, w: CARD_W - 104, h: 54 },
  /** the square caps at each end of the name plate: rarity left, faction right */
  plateCap: 54,
  /** the type line sits in the gap between the name banner and the text box */
  typeLineY: 456,
  textBox: { x: 52, y: 470, w: CARD_W - 104, h: 112 },
  /** the collector line: set code, number, rarity word, art credit */
  footerY: 604,
  costGem: { cx: 78, cy: 66, r: 36 },
  badge: { x: 318, y: 47, w: 144, h: 38 },
  attackChip: { cx: 78, cy: 632, r: 40 },
  healthChip: { cx: CARD_W - 78, cy: 632, r: 40 },
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
  boardAttackChip: { cx: 84, cy: 614, r: 54 },
  boardHealthChip: { cx: CARD_W - 84, cy: 614, r: 54 },
  /**
   * ...and the rules text goes entirely.
   *
   * A board card is displayed at about 121px, which is a 4.2:1 downsample of the
   * face. At that size three lines of 17px rules text are a grey smear with a
   * plate under them — a *designed-looking* block of noise, which is worse than
   * an empty band, and it was eating 40% of the unit. Hearthstone shows a board
   * minion its art, its name, its attack and its health and nothing else;
   * HYPEBOUND was shipping the whole card face at a quarter scale.
   *
   * So the board face keeps the art (a much larger window, because the scrim can
   * start far lower), a full-width name at a fixed size, a single line of
   * keywords in caps, and the two gems. Everything a player needs to count a
   * trade, and nothing they would have to lean in for. The complete face is
   * still one press-and-hold away, rendered at 420px where every word of it is
   * legible.
   */
  boardScrimY: 452,
  boardNamePlate: { x: 44, y: 476, w: CARD_W - 88, h: 58 },
  boardKeywordY: 556,
  /** the rarity mark, in the name plate's left cap where nothing can occlude it */
  rarityGem: { cx: 79, cy: 411, r: 17 },
  /** the faction crest, in the matching right cap, seated in a recessed medallion */
  crest: { cx: CARD_W - 79, cy: 411, r: 20 },
} as const;

export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const value = parseInt(clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Push a colour along the two axes that rarity is allowed to move it on.
 *
 * Mixing toward a rarity hue was the mechanism the ladder used, and it inverted
 * the value hierarchy the moment the two hues disagreed: Epic's `#a86ce0` blended
 * 44% over Halo's `#ffd86b` is a grey-beige, so Employee of the Year (Halo epic)
 * photographed *cheaper* than Lobby Greeter (Halo common). Two saturated colours
 * on opposite sides of the wheel average to mud — that is not a tuning mistake,
 * it is what a linear RGB mix does, and no choice of `mixInto` avoids it.
 *
 * So rarity moves saturation and lightness and leaves the hue to the Current.
 * `factor` multiplies chroma and `lift` adds to lightness, both clamped, so a
 * step up the ladder can only ever make a frame *more* saturated and brighter
 * than the tier below it on the same Current. Colour still carries rarity — in
 * the keyline, the corner caps, the nameplate mark and the printed word — but it
 * carries it as an accent laid over the metal rather than mixed into it.
 */
export function saturate(hex: string, factor: number, lift = 0): string {
  const value = parseInt(hex.replace("#", ""), 16);
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const delta = max - min;

  let h = 0;
  if (delta > 1e-6) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = delta < 1e-6 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  const s2 = Math.max(0, Math.min(1, s * factor));
  const l2 = Math.max(0, Math.min(1, l + lift));

  const c = (1 - Math.abs(2 * l2 - 1)) * s2;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l2 - c / 2;
  const sector = Math.floor(h / 60) % 6;
  const rgb: [number, number, number] =
    sector === 0 ? [c, x, 0]
    : sector === 1 ? [x, c, 0]
    : sector === 2 ? [0, c, x]
    : sector === 3 ? [0, x, c]
    : sector === 4 ? [x, 0, c]
    : [c, 0, x];

  const byte = (v: number): number => Math.max(0, Math.min(255, Math.round((v + m) * 255)));
  return `#${((byte(rgb[0]) << 16) | (byte(rgb[1]) << 8) | byte(rgb[2])).toString(16).padStart(6, "0")}`;
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
