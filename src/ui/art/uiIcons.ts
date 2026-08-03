/**
 * The interface icon set — drawn here, once, and nowhere else.
 *
 * Every icon in HYPEBOUND used to be a Unicode code point sitting in an
 * `innerHTML` string. That is a tempting shortcut and it fails in four separate
 * ways at the same time, all of which were visible on the lobby:
 *
 * 1. **You do not control the drawing.** `🏆` on this machine is a purple 3D
 *    trophy with a black outline, which made it the most saturated object on a
 *    screen whose hero action is a neon PLAY button. `✉` renders as a black
 *    phone-shaped envelope with a magenta tick on some Windows builds. Neither
 *    was a decision anybody made.
 * 2. **The weight is whatever the font feels like.** `▦` is a heavy fill, `✎` is
 *    a hairline, `〜` is a CJK-width squiggle. Put them in one column and the
 *    column has no rhythm — §7 of the AAA bar asks for one grid, one stroke
 *    weight, one optical size, and a font salad cannot give you any of the three.
 * 3. **They vanish.** A code point the OS has no glyph for is a tofu box. `⛊`,
 *    `⧉` and `⌖` are all in that territory outside Windows.
 * 4. **They ignore the palette.** An emoji is painted in its own colours, so a
 *    laurel that should sit at 40% opacity on a dark panel arrives as dark grey
 *    on dark grey and is, in practice, invisible.
 *
 * So: one set, hand-drawn, on a 24×24 grid at a single 1.75px stroke, in
 * `currentColor` only, with 2px of optical padding so nothing touches the box.
 * Nothing here is fetched, nothing is a font, nothing is a PNG.
 *
 * 109 drawings under 124 names. Thirteen lobby destinations, the fourteen modes
 * on the play screen, four currencies, the fourteen things the battle HUD counts
 * or offers, the sixteen keyword pips, eight status badges, thirty-nine generic
 * controls and one deliberately ugly `missing`. The extra fifteen names are
 * aliases — see `ALIAS`.
 *
 * ## Symbols, and why `<use>` rather than inlining everywhere
 *
 * The set ships as one `<symbol>` sprite injected into the document once, and
 * `icon(id)` returns a short `<svg><use/></svg>` that points at it. The screens
 * build markup as strings, so an icon has to be expressible as a short string —
 * and 24 hand cards each carrying six inlined `<path>`s is 144 paths the browser
 * has to parse and lay out for six distinct pictures.
 *
 * The trap with a sprite is a `<use>` whose target is not in the document yet:
 * it renders as *nothing*, silently, which is worse than a tofu box because
 * there is no visual evidence anything went wrong. `icon()` therefore installs
 * the sprite itself before it returns, so the reference is always resolvable by
 * the time the string reaches the DOM. Callers never have to remember.
 *
 * `iconInline()` exists for the places a shared document is not available or not
 * enough: a `data:` URI, a canvas draw, a test asserting on geometry. It emits
 * the same artwork with the paths written out.
 *
 * ## Sizing: `1em`, as an attribute, and one weight at three optical sizes
 *
 * Icons are sized in `em` so they track `--ui-scale` — the accessibility screen
 * lets a player scale the whole interface from one custom property, and an icon
 * pinned to 16px would be the one thing on the screen that refuses to grow.
 *
 * The stroke does *not* scale linearly with the box, and `ICON_OPTICAL` is why.
 * A single-weight set blown up to a destination tile's 56px paints a line 2.3×
 * heavier, proportionally, than the one this set was signed off at; the ramp
 * thins it back. It is one number tapering, not two weights — see the long note
 * on `ICON_OPTICAL`.
 *
 * The box is set by a class in a stylesheet this module injects, not by an
 * inline `style`. Inline styles win over everything and would make the icons
 * un-restylable by module A, which owns the actual theme; a class at specificity
 * (0,1,0) is trivially overridden by `.lobby-nav-icon .hb-icon` when somebody
 * wants a different size in one place. That is the right way round.
 *
 * ## What "distinguishable at 24px" cost, specifically
 *
 * Practice vs AI and Casual Match both used to be diamonds (`◈` and `◇`) that
 * differ by a single hairline of inner detail, which at 24px on a dark panel is
 * no difference at all. They are now a robot head and two overlapping people —
 * different silhouettes, not different details.
 *
 * That is the test every icon here had to pass, and the way to run it is to look
 * at all of them together at 24px rather than at one of them large. The
 * contact-sheet script does that: every icon at 24 and at 62, the whole set
 * shoulder to shoulder, forty-seven adversarial pairs, a size ladder from 14px
 * to 64, and the same strip on white. Output lives in
 * `scripts/screenshots/foundation/C/`.
 *
 * Doing that is what caught the ones that were fine in isolation and wrong in
 * company: three cards fanned for the hand were a tiara, three cards upright for
 * the Gauntlet were the ranked bar chart, the Scorched flame was a raindrop, the
 * Lurking hood was the Scorched flame with a hole in it, and the discard pile was
 * — unmistakably, embarrassingly — the download icon.
 *
 * Round 4 caught two more, and both are the same lesson a third time: a mark is
 * separated from its neighbours by its **outline** or not at all. `kw-spotlight`
 * and `mode-lab` were both a narrow top widening into a splayed cone over a
 * horizontal rule; `st-shielded`'s specular sat two thirds of a pixel from its
 * own rim and read as a thickening of the stroke rather than as a second mark.
 * Both are redrawn where they are declared and both say what changed.
 *
 * **And the sheet is not enough on its own, because a destination tile draws its
 * mark at 40–64px.** The whole set now has to be looked at twice — once at 24
 * where it was authored, and once at the size the lobby's nine pills will use
 * when somebody finally makes them objects rather than pills. The gallery
 * carries both, side by side, with the same marks in the same order.
 *
 * Where `docs/design/05-keyword-glossary.md` names a pip shape, that name is
 * followed. Four deviate and each says so where it is drawn: the shape the
 * glossary asks for is legible on a card at 96px and mud at 24.
 *
 * ## Not wired up yet, deliberately
 *
 * This is the primitive. The forty-nine screens still hold their Unicode glyphs
 * and are migrated domain by domain in the next wave — a single commit that
 * swaps every glyph in the game is a commit nobody can review and nobody can
 * bisect.
 */

/** The grid every path is drawn on. Nothing here is authored at another size. */
export const ICON_GRID = 24;

/**
 * One stroke weight for the whole set.
 *
 * 1.75 rather than a round 2 because 2px on a 24 grid is visibly heavy beside
 * the interface type once the icon is rendered at its usual 16–20px, and heavy
 * because it is *scaled down*, which reads as clip-art. 1.75 holds up at 16px
 * and still has body at 48.
 */
export const ICON_STROKE = 1.75;

/**
 * The same weight, at three optical sizes — and why that is not two weights.
 *
 * A stroke authored on a 24 grid is a *ratio*, not a thickness: 1.75/24 is
 * 7.3% of the box, so the same symbol painted at 56px lands a 4.1px line and at
 * 120px a 8.8px one. That is the failure this file's own header warns about, in
 * the other direction — an icon reads as clip-art when its line weight is wrong
 * for its size, and 7.3% is wrong the moment the box stops being a UI icon and
 * starts being an *object* on a tile. Every set that ships at more than one
 * size deals with this: SF Symbols has optical weights, Material has grades,
 * and a designer using a single-weight set at 56px reaches for the stroke
 * slider without thinking about it.
 *
 * The round-4 stills verdict named "nine identical pills with a small centred
 * icon" the flattest thing in any frame. A destination tile that fixes that
 * draws its mark at 40–64px rather than at 20, and until now the set had
 * nothing to say about that range — a lobby builder would have got a
 * proportionally 2.3× heavier line than the contact sheet was signed off on.
 *
 * §7 of the AAA bar asks for "a single stroke weight", and this keeps that
 * promise where it is actually made: **two icons at the same size are never
 * drawn at different weights.** What changes is only how the one weight tapers
 * as the box grows, from one table, so the family stays a family across a 5×
 * size range instead of only at 24px:
 *
 *     16px  ui       1.17px painted   7.3% of box
 *     24px  ui       1.75px           7.3%
 *     40px  display  2.25px           5.6%
 *     56px  display  3.15px           5.6%
 *     64px  hero     2.93px           4.6%
 *    120px  hero     5.50px           4.6%
 *
 * The taper is the same shape type uses: display type tightens its tracking as
 * it grows for exactly this reason (§4), and nobody calls that two typefaces.
 */
export const ICON_OPTICAL = {
  /** 14–32px. The size the whole set was drawn and signed off at. */
  ui: ICON_STROKE,
  /** 33–56px. Tile marks, empty-state glyphs, mode cards. */
  display: 1.35,
  /** 57px and up. Destination heroes, watermarks, splash marks. */
  hero: 1.1,
} as const satisfies Record<string, number>;

export type IconOptical = keyof typeof ICON_OPTICAL;

/**
 * Which rung a given rendered size wants.
 *
 * Exported because the interesting callers are the ones that compute their icon
 * size — a tile that scales with `--ui-scale`, the gallery's own size ladder —
 * and because a builder who has to remember two thresholds will get one of them
 * wrong. `icon()` calls this for you whenever `size` is a number.
 */
export function opticalFor(px: number): IconOptical {
  if (px >= 57) return "hero";
  if (px >= 33) return "display";
  return "ui";
}

/**
 * Optical padding, in grid units, kept clear on every side.
 *
 * Measured to the *painted* edge, not the path: a stroke centred at x=21 paints
 * out to 21.875, so path coordinates live inside [3, 21] and the ink lands
 * inside [2.1, 21.9]. This is what stops an icon sitting flush against a chip
 * border while the one next to it has a comfortable margin.
 *
 * Verified rather than asserted. The contact-sheet script measures `getBBox()`
 * on every symbol in a real browser, adds half a stroke for stroked children
 * and nothing for filled ones, and reports anything that escapes [2, 22]; all
 * 107 pass. Eyeballing this is not good enough, because a rotated `<rect>`
 * grows in both axes by an amount nobody computes correctly in their head — the
 * fanned hand was out of the box the first three times.
 */
export const ICON_PADDING = 2;

/** Prefix on every symbol in the sprite, so nothing can collide with page ids. */
const SYMBOL_PREFIX = "hb-i-";

/** The class the injected stylesheet sizes. Exported so hosts can target it. */
export const ICON_CLASS = "hb-icon";

// ---------------------------------------------------------------------------
// The artwork
// ---------------------------------------------------------------------------

/**
 * Every icon, as the inner markup of its symbol.
 *
 * Read as: fill is off and stroke is `currentColor` at 1.75 with round caps and
 * joins, inherited from the `<symbol>` — so a bare `<path d="…">` is a stroked
 * outline and anything solid says `fill="currentColor" stroke="none"` for itself.
 *
 * Coordinates are literals rather than computed at runtime because an icon set
 * is a drawing, and a drawing you can only see by executing it is a drawing
 * nobody will correct. The handful with real trigonometry in them — the gear,
 * the star, the sun — were computed once and pasted, which is the same trade the
 * other direction.
 */
const ART = {
  // -- lobby destinations ---------------------------------------------------

  /** The hero action. A plain triangle; nothing else in the set is one. */
  play: `<path d="M9 5.8 L18.8 12 L9 18.2 Z"/>`,

  /**
   * Collection — a 2×2 grid of cards.
   *
   * A grid rather than a stack or a fan, because those are already the deck and
   * the hand and all three would otherwise be "some rounded rectangles".
   */
  collection: `<rect x="3" y="3" width="7.5" height="8.5" rx="1.6"/><rect x="13.5" y="3" width="7.5" height="8.5" rx="1.6"/><rect x="3" y="12.5" width="7.5" height="8.5" rx="1.6"/><rect x="13.5" y="12.5" width="7.5" height="8.5" rx="1.6"/>`,

  /** Deck builder — one card and a plus. "Add cards to a list." */
  "deck-builder": `<rect x="3.2" y="3.6" width="10.6" height="16.8" rx="2"/><path d="M18 12.4 V18.4 M15 15.4 H21"/>`,

  /**
   * Merch Drops — a sealed pack.
   *
   * The bow is not decoration. A lidded box with a ribbon down it and no bow is
   * a rectangle divided into four panes, which is what the first pass drew and
   * what it looked like: a window.
   */
  "merch-drop": `<rect x="3" y="7.2" width="18" height="3.8" rx="1.2"/><rect x="4.8" y="11" width="14.4" height="9.6" rx="1.4"/><path d="M12 7.2 V20.6"/><path d="M12 7.2 C10.2 4.8 7.6 3.8 7.6 5.6 C7.6 6.8 9.6 7.2 12 7.2 C14.4 7.2 16.4 6.8 16.4 5.6 C16.4 3.8 13.8 4.8 12 7.2 Z"/>`,

  /** The same pack, opened — the lid tipped off and lifted clear of the box. */
  "merch-drop-open": `<rect x="4.8" y="11.6" width="14.4" height="9" rx="1.4"/><path d="M12 11.6 V20.6"/><rect x="3.6" y="5.2" width="17" height="3.4" rx="1.1" transform="rotate(-12 12.1 6.9)"/>`,

  /** Missions — a clipboard with a tick on it. */
  missions: `<rect x="5" y="4.5" width="14" height="16" rx="2"/><rect x="9" y="3" width="6" height="3" rx="1.2"/><path d="M8.6 12.6 L11 15 L15.6 10.2"/>`,

  /**
   * Mastery — a medal on two ribbons.
   *
   * Not a laurel. The laurel this replaces was a thin symmetrical wreath that,
   * at 24px on a dark panel, resolved to a grey smudge with a hole in it.
   */
  mastery: `<path d="M8.4 3.2 H15.6 L13.4 10 H10.6 Z"/><circle cx="12" cy="15.4" r="5.6"/><circle cx="12" cy="15.4" r="2.2"/>`,

  /**
   * Hype Wave — the pass track: a wave that climbs into an arrow.
   *
   * The wave alone was the first draft and it was wrong twice over. It said
   * nothing about progression, which is the entire point of a pass, and it was
   * one crest away from being the Flow keyword. The rising tail is the meaning
   * and the arrowhead is what stops it being ambiguous.
   */
  "hype-wave": `<path d="M3 13.5 C5.4 6.2 8.6 6.2 11 13.5 C12.7 18.7 15.4 19.9 17.6 17 L20.6 12.6"/><path d="M20.6 15.8 L20.6 12.6 L17.4 12.6"/>`,

  /** Achievements — a trophy, drawn as line work rather than borrowed as emoji. */
  achievement: `<path d="M8 4.5 H16 V8.5 A4 4 0 0 1 8 8.5 Z"/><path d="M8 5.6 C5.2 5.6 4.6 9.6 8.3 9.9"/><path d="M16 5.6 C18.8 5.6 19.4 9.6 15.7 9.9"/><path d="M12 12.6 V15.6"/><path d="M8.8 19.8 H15.2 L14.2 15.6 H9.8 Z"/>`,

  /** Events — a calendar with something special on one of the days. */
  events: `<rect x="3.5" y="5" width="17" height="15.5" rx="2.2"/><path d="M3.5 9.6 H20.5 M8 3.2 V6.6 M16 3.2 V6.6"/><path d="M12 11.6 L13.1 14.4 L15.9 15.5 L13.1 16.6 L12 19.4 L10.9 16.6 L8.1 15.5 L10.9 14.4 Z" fill="currentColor" stroke="none"/>`,

  /** Inbox — an envelope. */
  inbox: `<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3.8 7.2 L12 13.4 L20.2 7.2"/>`,

  /** Profile — one person. Two is Casual Match; the count is the whole signal. */
  profile: `<circle cx="12" cy="8.4" r="3.7"/><path d="M4.8 20.2 C4.8 15.8 8 13.5 12 13.5 C16 13.5 19.2 15.8 19.2 20.2"/>`,

  /**
   * Settings — a real eight-tooth gear.
   *
   * A circle with eight rays round it would have been three lines of path data
   * and would also have been the sun icon. The teeth have flanks, so the
   * silhouette is unmistakably mechanical at any size.
   */
  settings: `<path d="M10.9 3.07 L13.1 3.07 L13.66 6.03 L15.05 6.6 L17.54 4.91 L19.09 6.46 L17.4 8.95 L17.97 10.34 L20.93 10.9 L20.93 13.1 L17.97 13.66 L17.4 15.05 L19.09 17.54 L17.54 19.09 L15.05 17.4 L13.66 17.97 L13.1 20.93 L10.9 20.93 L10.34 17.97 L8.95 17.4 L6.46 19.09 L4.91 17.54 L6.6 15.05 L6.03 13.66 L3.07 13.1 L3.07 10.9 L6.03 10.34 L6.6 8.95 L4.91 6.46 L6.46 4.91 L8.95 6.6 L10.34 6.03 Z"/><circle cx="12" cy="12" r="3.2"/>`,

  // -- game modes -----------------------------------------------------------

  /**
   * Practice vs AI — a machine's head.
   *
   * This and `mode-casual` are the pair the brief singles out: they were `◈` and
   * `◇`, two diamonds that differ by an inner hairline. A boxy head with an
   * aerial and two eyes shares no outline with two human shoulders, so the two
   * tiles can now be told apart from across the room.
   */
  "mode-ai": `<rect x="4.6" y="7" width="14.8" height="12" rx="3"/><circle cx="9.2" cy="13" r="1.5" fill="currentColor" stroke="none"/><circle cx="14.8" cy="13" r="1.5" fill="currentColor" stroke="none"/><path d="M12 7 V4.2 M4.6 12.4 H3 M19.4 12.4 H21"/><circle cx="12" cy="3.4" r="1.1" fill="currentColor" stroke="none"/>`,

  /** Interactive Tutorial — an open book. */
  "mode-tutorial": `<path d="M12 6.6 C10 4.9 7 4.5 3.6 5.1 V18.6 C7 18 10 18.4 12 20.1 C14 18.4 17 18 20.4 18.6 V5.1 C17 4.5 14 4.9 12 6.6 Z"/><path d="M12 6.6 V20.1"/>`,

  /** The Grand Tour — a folded map. You go places and collect the decks. */
  "mode-tour": `<path d="M3.4 6.6 L9 4.4 L15 6.9 L20.6 4.7 V17.4 L15 19.6 L9 17.1 L3.4 19.3 Z"/><path d="M9 4.4 V17.1 M15 6.9 V19.6"/>`,

  /** Casual Match — two people. See `mode-ai` for why this shape and not a diamond. */
  "mode-casual": `<circle cx="15.6" cy="8.1" r="3"/><path d="M16.9 14.1 C19.1 14.8 20.6 16.6 20.6 19.6"/><circle cx="9.4" cy="9.2" r="3.4"/><path d="M3.4 19.6 C3.4 15.9 6.1 14 9.4 14 C12.7 14 15.4 15.9 15.4 19.6"/>`,

  /** Ranked Ladder — divisions as ascending bars. Nothing else here is bars. */
  "mode-ranked": `<rect x="3.6" y="13.4" width="4.2" height="7.2" rx="1.2"/><rect x="9.9" y="9.4" width="4.2" height="11.2" rx="1.2"/><rect x="16.2" y="5.4" width="4.2" height="15.2" rx="1.2"/>`,

  /**
   * The Gauntlet — a helm.
   *
   * This one was drawn three times. Every card-based idea (three upright cards,
   * a fan with the middle one lifted, a card with a tick) either turned into the
   * ranked bar chart or into the hand, because a 20px live area cannot hold three
   * separate rounded rectangles and 1.75px of stroke between them — the gaps
   * close and it becomes a striped blob. The mode is a drafted run through an
   * arena, so it gets the arena's object instead, and a domed helm with a visor
   * slit shares an outline with nothing else in the set.
   */
  "mode-draft": `<path d="M5.2 14.8 C5.2 8.2 8.2 4 12 4 C15.8 4 18.8 8.2 18.8 14.8 V20.6 H15.2 V14.8 H8.8 V20.6 H5.2 Z"/><path d="M12 8 V14.8 M8.8 11 H15.2"/>`,

  /** Remix Queue — shuffle. The rule changes each week; the arrows cross. */
  "mode-remix": `<path d="M3.5 7 H7 L17.5 17.5 H20.5"/><path d="M18.3 15.3 L20.5 17.5 L18.3 19.7"/><path d="M3.5 17.5 H7 L17.5 7 H20.5"/><path d="M18.3 9.2 L20.5 7 L18.3 4.8"/>`,

  /** Custom Lobby — sliders. You set the rules yourself. */
  "mode-custom": `<path d="M3.4 7 H20.6 M3.4 12 H20.6 M3.4 17 H20.6"/><circle cx="8" cy="7" r="2.2" fill="currentColor" stroke="none"/><circle cx="15.4" cy="12" r="2.2" fill="currentColor" stroke="none"/><circle cx="9.8" cy="17" r="2.2" fill="currentColor" stroke="none"/>`,

  /**
   * The Doomscroll — a branching run, as its own map: a node, a fork, two nodes.
   *
   * Hollow nodes, not filled dots. Filled dots on the ends of the branches were
   * indistinguishable from the round line caps already there, so the first draft
   * was a tuning fork.
   */
  "mode-roguelike": `<circle cx="12" cy="18.4" r="2.3"/><path d="M12 16.1 V13.4 M12 13.4 L7.4 9.2 M12 13.4 L16.6 9.2"/><circle cx="5.8" cy="7.6" r="2.3"/><circle cx="18.2" cy="7.6" r="2.3"/>`,

  /** Story Chapters — dialogue. A speech bubble with lines of text in it. */
  "mode-story": `<path d="M3.5 7 A2.6 2.6 0 0 1 6.1 4.4 H17.9 A2.6 2.6 0 0 1 20.5 7 V14.9 A2.6 2.6 0 0 1 17.9 17.5 H12.6 L7.8 21 V17.5 H6.1 A2.6 2.6 0 0 1 3.5 14.9 Z"/><path d="M7.6 9.2 H16.4 M7.6 12.8 H13.4"/>`,

  /** Puzzle Battles — a jigsaw piece, knob out on top and socket in on the left. */
  "mode-puzzle": `<path d="M4 11.5 V6 H9.6 C9.6 2.3 14.4 2.3 14.4 6 H20 V20 H4 V16.5 C7.7 16.5 7.7 11.5 4 11.5 Z"/>`,

  /** Replay Theater — a screen with a play mark on it. Not the bare triangle. */
  "mode-replays": `<rect x="3" y="4.4" width="18" height="13" rx="2.4"/><path d="M10.2 9.2 L14.8 11.9 L10.2 14.6 Z"/><path d="M12 17.4 V20.6 M8.6 20.6 H15.4"/>`,

  /**
   * The Lab — a flask. Build any board, break anything, nothing counts.
   *
   * The first draft had a 4.8-unit neck, shoulders that started at y=9.2 and a
   * liquid line at y=15.4, and beside `attack` at 24px that is the same
   * picture: a narrow vertical body 4.6 units wide, a wider base, and one
   * crossbar 1.6 units away from the sword's crossguard at 13.8. Two marks
   * separate at 24px by their outline or not at all.
   *
   * So the waist is where they are pulled apart. The neck is down to 3.2 units
   * — thinner than the sword's blade rather than the same width — the shoulders
   * break at y=8.4 and splay to 14.8 units at the floor, which makes the
   * silhouette a cone rather than a rod on a plinth, and the liquid drops to
   * y=17, a full 3.2 units clear of the crossguard.
   */
  "mode-lab": `<path d="M10.4 3.4 V8.4 L4.6 18.2 Q3.5 20.8 6.6 20.8 H17.4 Q20.5 20.8 19.4 18.2 L13.6 8.4 V3.4"/><path d="M9 3.4 H15 M6.3 17 H17.7"/>`,

  /** Weekly Boss — a skull. */
  "mode-boss": `<path d="M5.6 13.6 C5.6 7.8 8.4 4.6 12 4.6 C15.6 4.6 18.4 7.8 18.4 13.6 V15.6 Q18.4 17.6 16.4 17.6 H7.6 Q5.6 17.6 5.6 15.6 Z"/><circle cx="9.2" cy="12.3" r="1.9" fill="currentColor" stroke="none"/><circle cx="14.8" cy="12.3" r="1.9" fill="currentColor" stroke="none"/><path d="M8.9 17.6 V20.2 M12 17.6 V20.6 M15.1 17.6 V20.2"/>`,

  // -- currencies -----------------------------------------------------------

  /** Clout — a struck token. Earned by playing; the one that reads as money. */
  clout: `<circle cx="12" cy="12" r="9"/><path d="M12 6.6 L17.4 12 L12 17.4 L6.6 12 Z"/>`,

  /**
   * Shards — two broken chips.
   *
   * Deliberately asymmetric. A symmetric faceted gem is the Hype crystal, and a
   * currency you spend must not look like a resource you regenerate every turn.
   */
  shards: `<path d="M9.8 3.4 L16.2 7.4 L13.2 14.6 L6.6 11.8 Z"/><path d="M14.4 13.2 L20.6 16.6 L16.8 21 L11.6 18 Z"/>`,

  /** Glimmer — the premium spark. One four-point sparkle, waisted. */
  glimmer: `<path d="M12 3.1 C12.6 8.6 15.4 11.4 20.9 12 C15.4 12.6 12.6 15.4 12 20.9 C11.4 15.4 8.6 12.6 3.1 12 C8.6 11.4 11.4 8.6 12 3.1 Z"/>`,

  /** Backstage Token — a ticket stub, notched, with its tear line. */
  "backstage-token": `<path d="M3.4 8 H20.6 V10.4 A1.8 1.8 0 0 0 20.6 14 V16.4 H3.4 V14 A1.8 1.8 0 0 0 3.4 10.4 Z"/><path d="M12 9.6 V14.8" stroke-dasharray="1.4 1.8"/>`,

  // -- the battle HUD -------------------------------------------------------

  /**
   * Cards in hand — one card with two more fanned out from behind it.
   *
   * This was the worst mark in the set and it was drawn as three whole
   * transparent rounded rectangles stacked on the same pivot. Every stroke of
   * every card ran straight through the other two, so the interior filled with a
   * lattice: at 24px it closed into a solid blob, and at 48px it resolved into a
   * dome with an A-shaped tangle inside it — which is the same picture as
   * `mode-draft`, the domed helm with a crossbar. Two of the most-used icons in
   * the game, one of them in the battle HUD where a player reads under pressure,
   * sharing a silhouette: precisely the failure this module's header says the set
   * was rebuilt to remove.
   *
   * **Nothing crosses the front card now.** There is no fill to occlude with —
   * every symbol here is stroke-only on `currentColor` and giving one path a
   * background colour would make it the one mark in the set that cannot sit on an
   * arbitrary surface — so the back cards are drawn as partial paths that stop
   * exactly where the front card's outline begins. `deck` above already works
   * this way and it is the best card mark in the set. The front card's interior
   * is therefore empty, which is what a card looks like.
   *
   * The geometry, so it can be corrected rather than re-guessed. Both back cards
   * are 5.0 × 13.6 rectangles rotated ±30° about (12, 20.4) — the front card's
   * bottom-centre, because a pivot far below the box swings the cards sideways
   * instead of tilting them. At 30° each back card's inner edge disappears behind
   * the front card at (8.4, 9.15) and its outer edge disappears again at
   * (8.4, 19.15), so what survives is **two corners and three edges**: a short
   * stub of the inner edge, the top-outer corner, the whole top edge, the
   * top-outer corner again and a long run down the outer edge. That is the
   * difference between this and the two drafts before it, both of which
   * terminated a single corner on the same straight edge and therefore drew a
   * triangle — at 24px, a pair of wings on a bowtie.
   *
   * The fan is wider than the old ±24° because at 24° the corners did not clear
   * the front card's silhouette at all, and the back cards are narrower and
   * shorter than the front one for the reason the first version of this comment
   * gave and got right: three equal cards fanned equally give three equal peaks,
   * which is a crown; one tall card with two lower ones behind it is a hand.
   *
   * Beside the helm at 24px it shares no outline. The helm is a dome on two legs
   * with a crossbar inside it; this is a flat-topped card with two shoulders
   * angling down and out, and its interior is empty.
   */
  hand: `<path d="M8.4 9.15 L8.07 8.58 A1.4 1.4 0 0 0 6.16 8.07 L4.25 9.17 A1.4 1.4 0 0 0 3.74 11.08 L8.4 19.15"/><path d="M15.6 9.15 L15.93 8.58 A1.4 1.4 0 0 1 17.84 8.07 L19.75 9.17 A1.4 1.4 0 0 1 20.26 11.08 L15.6 19.15"/><rect x="8.4" y="5.4" width="7.2" height="15" rx="1.5"/>`,

  /** Cards in deck — a card with the stack behind it showing at the top-right. */
  deck: `<rect x="3.2" y="7.4" width="12.6" height="13" rx="1.8"/><path d="M6.1 7.4 V6.1 A1.7 1.7 0 0 1 7.8 4.4 H17 A1.7 1.7 0 0 1 18.7 6.1 V17.5"/>`,

  /**
   * The discard pile — a card dropping into an open tray.
   *
   * Emphatically *not* a tray with a straight down-arrow over it: that is the
   * download glyph every operating system uses, and a download icon labelled
   * "cards in discard" is a worse lie than the Unicode ✖ it replaces. The tilt
   * on the card is what carries the falling.
   */
  discard: `<path d="M3.6 15.9 V19 A1.8 1.8 0 0 0 5.4 20.8 H18.6 A1.8 1.8 0 0 0 20.4 19 V15.9"/><rect x="8.4" y="4.3" width="7.2" height="9.2" rx="1.4" transform="rotate(20 12 8.9)"/>`,

  /**
   * A face-down Reaction — a card set sideways, showing its back.
   *
   * Landscape because that is how a face-down card is played in every tabletop
   * game that has them, and because a 12×17 portrait rounded rectangle at 24px
   * is a mobile phone no matter what you draw inside it.
   */
  reaction: `<rect x="3" y="6.2" width="18" height="11.6" rx="1.8"/><path d="M12 8.6 L15.4 12 L12 15.4 L8.6 12 Z"/>`,

  /** Armour — the glossary's layered plate: a shield with a plate band across it. */
  armour: `<path d="M12 3.2 L19.8 6 V12.2 C19.8 16.6 16.5 19.7 12 20.8 C7.5 19.7 4.2 16.6 4.2 12.2 V6 Z"/><path d="M4.6 11.6 H19.4"/>`,

  /** Hype — a crystal you spend. Symmetric, with a girdle. */
  hype: `<path d="M12 3.2 L18.6 9.8 L12 20.8 L5.4 9.8 Z"/><path d="M5.4 9.8 H18.6"/>`,

  /**
   * Obsession — a spiral.
   *
   * Not an eye: the eye is taken twice over (`eye`, and Cursed's hexagon) and
   * would have been the third circle-with-something-in-it in the battle HUD. A
   * spiral is unique in the set and it is, for a game about doomscrolling, the
   * more honest picture of the meter anyway. Built from six half-circles of
   * growing radius, which is exact and costs one path.
   */
  obsession: `<path d="M12 12 A1.2 1.2 0 0 1 14.4 12 A2.4 2.4 0 0 1 9.6 12 A3.6 3.6 0 0 1 16.8 12 A4.8 4.8 0 0 1 7.2 12 A6 6 0 0 1 19.2 12 A7.2 7.2 0 0 1 4.8 12"/>`,

  /** Emotes — a face. No bubble, so it never collides with Story's dialogue. */
  emote: `<circle cx="12" cy="12" r="8.8"/><circle cx="9.2" cy="9.9" r="1.15" fill="currentColor" stroke="none"/><circle cx="14.8" cy="9.9" r="1.15" fill="currentColor" stroke="none"/><path d="M7.9 14.3 C9.3 16.8 14.7 16.8 16.1 14.3"/>`,

  /** Concede — a flag. */
  concede: `<path d="M6 3.4 V20.8"/><path d="M6 5 H18.6 L15.7 9.2 L18.6 13.4 H6"/>`,

  /** End Turn — hand the clock over. An arrow running into a stop. */
  "end-turn": `<path d="M3.6 12 H16.2"/><path d="M12.8 8.6 L16.2 12 L12.8 15.4"/><path d="M19.8 6.4 V17.6"/>`,

  /** The action log — lines with time markers down the side. */
  log: `<path d="M8.2 7.4 H20.4 M8.2 12 H20.4 M8.2 16.6 H20.4"/><circle cx="4.4" cy="7.4" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.4" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.4" cy="16.6" r="1.2" fill="currentColor" stroke="none"/>`,

  /** The turn clock. */
  timer: `<circle cx="12" cy="12" r="8.8"/><path d="M12 6.8 V12 L15.6 14.2"/>`,

  /** Attack — a sword. Points up, so it never reads as a cursor or a pin. */
  attack: `<path d="M12 3.2 L14.3 6.6 V13.8 H9.7 V6.6 Z"/><path d="M6.6 13.8 H17.4 M12 13.8 V19.6 M9.7 19.6 H14.3"/>`,

  /** Health. */
  health: `<path d="M12 20.6 C12 20.6 3.4 15.4 3.4 9.4 A4.9 4.9 0 0 1 12 6.4 A4.9 4.9 0 0 1 20.6 9.4 C20.6 15.4 12 20.6 12 20.6 Z"/>`,

  // -- keywords -------------------------------------------------------------
  // Shapes follow docs/design/05-keyword-glossary.md's named pips except where
  // noted. Each note says what was dropped and why it did not survive 24px.

  /** Viral — the glossary's forked share arrow. One tail, two heads. */
  "kw-viral": `<path d="M3.6 12 H11"/><path d="M11 12 L17.9 6.4"/><path d="M13.9 6.4 H17.9 V10.4"/><path d="M11 12 L17.9 17.6"/><path d="M13.9 17.6 H17.9 V13.6"/>`,

  /**
   * Spotlight — a lamp, a beam and the pool it throws, and the lamp leans.
   *
   * The first draft closed the cone into a solid trapezoid and became a bucket;
   * the second stopped the beams just above the pool and the ellipse's top arc
   * closed the shape again into a lampshade. The beams have to land exactly on
   * the pool's widest points — then the eye reads cone, floor, light.
   *
   * The third draft was symmetrical, and that is what the round-4 review caught:
   * a narrow top widening into a splayed cone with a horizontal rule across the
   * bottom is *also* `mode-lab`. The flask's shoulders are this mark's beams and
   * the flask's liquid line is this mark's pool, and the two were the only pair
   * of thirty tested that failed at a true 24px. Worse, `mode-lab` had already
   * spent three passes moving *to* a cone silhouette to get away from `attack`,
   * so the collision was arrived at from both sides.
   *
   * The whole rig is now rotated about −28°: the head is an asymmetric
   * quadrilateral leaning to the right, the left beam runs almost vertically
   * while the right one runs at 45°, and the pool is a tilted ellipse in the
   * bottom-right rather than a level rule across the bottom. **A flask cannot
   * lean** — it is a vessel and its liquid line is horizontal by definition — so
   * the two marks are now separated by the one property that survives being shrunk
   * to 24px, which is the outline. The pool stays (a spotlight without a floor is
   * a torch), and the beams still land exactly on its widest points, which are
   * now its rotated major-axis ends rather than its left and right edges.
   *
   * Every coordinate below is the unrotated rig put through a −28° rotation
   * about (8.6, 5.0) and then shifted (−0.6, +0.5) to sit inside the 2px optical
   * padding; they are literals for the reason the file's header gives, and this
   * paragraph is how to regenerate them rather than re-guess them.
   */
  "kw-spotlight": `<path d="M5.5 5 L9 3.2 L11.6 5.4 L5.9 8.4 Z"/><path d="M6.4 9.2 L8.2 19 M12 6.2 L19.1 13.2"/><ellipse cx="13.6" cy="16.1" rx="6.2" ry="2.4" transform="rotate(-28 13.6 16.1)"/>`,

  /**
   * Parasocial — the glossary's heart bisected by a chain link.
   *
   * One link, not two. Two interlocking rings is Collab, and at 24px the pair
   * would have been the same picture with a heart drawn faintly behind it. The
   * link runs wider than the heart on purpose: contained inside it, it read as a
   * pill somebody had dropped in there.
   */
  "kw-parasocial": `<path d="M12 20 C12 20 4.4 15.2 4.4 9.8 A4.3 4.3 0 0 1 12 7 A4.3 4.3 0 0 1 19.6 9.8 C19.6 15.2 12 20 12 20 Z"/><rect x="5.2" y="11.8" width="13.6" height="4.4" rx="2.2"/>`,

  /** Trending — an upward chevron with a spark trailing it, as specified. */
  "kw-trending": `<path d="M5.5 14.8 L12 8.3 L18.5 14.8"/><path d="M12 15.3 L12.9 17.3 L14.9 18.2 L12.9 19.1 L12 21.1 L11.1 19.1 L9.1 18.2 L11.1 17.3 Z" fill="currentColor" stroke="none"/>`,

  /** Collab — two interlocking rings. */
  "kw-collab": `<circle cx="9" cy="12" r="5.4"/><circle cx="15" cy="12" r="5.4"/>`,

  /** Comeback — a return arrow that goes down, round and back up. */
  "kw-comeback": `<path d="M4.4 20.4 V13.6 A6.6 6.6 0 0 1 17.6 13.6 V15.2"/><path d="M14.7 12.3 L17.6 15.2 L20.5 12.3"/>`,

  /**
   * Raid — a bolt, arriving fast.
   *
   * The glossary asks for a boot with a speed bolt. A boot that fits in a 20px
   * square next to anything else is an L-shaped block — that is literally what
   * the first draft looked like — so the boot went and the bolt stayed. Raid
   * means "it swings the turn it lands", and a bolt with speed lines behind it
   * is that sentence.
   */
  "kw-raid": `<path d="M17.2 3.2 L9.6 13.4 H13.4 L11.4 20.8 L19 10.6 H15.2 Z"/><path d="M7 7.6 H3.4 M6 12 H3.4 M7 16.4 H3.4"/>`,

  /** Touch Grass, and the Banished status — a leaf, and an exit. */
  "kw-touch-grass": `<path d="M3.2 20.8 C3.2 13.6 7.8 9.4 14.2 9.4 C14.2 16 9.8 20.8 3.2 20.8 Z"/><path d="M3.2 20.8 C6.4 18 9.2 15 11.6 12.2"/><path d="M14.6 8.8 L20.8 3.2"/><path d="M17.2 3.2 H20.8 V6.8"/>`,

  /**
   * Afterparty — a glass.
   *
   * The glossary's crescent-over-a-tilted-cup is two objects sharing a 20px
   * square, and neither ends up legible. The glass alone says "the bit after"
   * and is the only stemware in the set.
   */
  "kw-afterparty": `<path d="M4.4 5.4 H19.6 L12 14 Z"/><path d="M12 14 V19.6 M8 19.6 H16"/>`,

  /** Rushwind — two speed chevrons. */
  "kw-rushwind": `<path d="M6 4.6 L13.4 12 L6 19.4"/><path d="M13.1 4.6 L20.5 12 L13.1 19.4"/>`,

  /**
   * Flow — water, held.
   *
   * The glossary's "wave curling into a circle" was drawn as exactly that and
   * came out as a squiggle with a hook on it: a curl and a stroke of the same
   * weight do not separate at this size. Two waves inside a ring says the same
   * thing — Flow is the Tide signature — and it holds together at 16px.
   */
  "kw-flow": `<circle cx="12" cy="12" r="8.7"/><path d="M5 11.2 C6.7 8.4 9.3 8.4 11 11.2 C12.7 14 15.3 14 17 11.2"/><path d="M7 16.2 C8.2 14.4 10 14.4 11.2 16.2 C12.4 18 14.2 18 15.4 16.2"/>`,

  /** Grow — a two-leaf shoot. */
  "kw-grow": `<path d="M12 20.6 V11"/><path d="M12 13.6 C8.5 13.6 6 11.6 6 8.1 C9.5 8.1 12 10.1 12 13.6 Z"/><path d="M12 11.6 C15.5 11.6 18 9.6 18 6.1 C14.5 6.1 12 8.1 12 11.6 Z"/>`,

  /**
   * Overload — a cracked crystal.
   *
   * Same silhouette as Hype on purpose: it *is* your Hype, locked. The crack
   * replaces the girdle line rather than being added to it, so the two are told
   * apart by which line is inside them, not by whether one has an extra mark.
   */
  "kw-overload": `<path d="M12 3.2 L18.6 9.8 L12 20.8 L5.4 9.8 Z"/><path d="M12 3.6 L10 9.6 L13.4 11.8 L10.4 15.2 L12 20.4"/>`,

  /**
   * Inspire — a halo throwing light.
   *
   * Three shrinking ellipses was the first attempt at "a rising ring" and it
   * read as a stack of bangles. One ring plus three rays is unambiguous, and the
   * rays are what say *rising*.
   */
  "kw-inspire": `<ellipse cx="12" cy="16.4" rx="7" ry="2.9"/><path d="M12 11 V4.6 M7 12 L4.6 7.6 M17 12 L19.4 7.6"/>`,

  /** Corrupt — a face, half clean and half gone wrong. */
  "kw-corrupt": `<path d="M12 3.4 C16.9 3.4 20 6.6 20 11.2 C20 16.8 16.4 20.6 12 20.6 C7.6 20.6 4 16.8 4 11.2 C4 6.6 7.1 3.4 12 3.4 Z"/><path d="M12 3.4 V20.6"/><circle cx="8.4" cy="11" r="1.3" fill="currentColor" stroke="none"/><path d="M13.9 9.6 L16.7 12.4 M16.7 9.6 L13.9 12.4"/>`,

  /**
   * Refract — a prism, one beam in and three out.
   *
   * The beams start and stop exactly on the triangle's faces. In the first draft
   * they were eyeballed and overshot into the glass, which turned a light
   * diagram into a scribbled-on triangle.
   */
  "kw-refract": `<path d="M12 5 L18.4 16.4 H5.6 Z"/><path d="M3.2 13 H7.5"/><path d="M16.5 13 L21 9.2 M16.5 13 H21 M16.5 13 L21 16.8"/>`,

  // -- statuses -------------------------------------------------------------

  /**
   * Scorched — a flame. Also the streak marker.
   *
   * The lick on the left is doing all the work. A symmetric teardrop with a
   * pointed top is what the first pass drew, and a symmetric teardrop is water:
   * at 24px the entire difference between fire and a raindrop is that fire is
   * not symmetrical.
   */
  "st-scorched": `<path d="M12.4 3 C12.4 6.6 14.6 8.2 16.2 10 C17.7 11.7 18.6 13.2 18.6 15 C18.6 18.4 15.7 21 12 21 C8.3 21 5.4 18.4 5.4 15 C5.4 12.4 6.8 10.6 8.6 8.6 C8.8 10.2 9.4 11.2 10.4 11.8 C11.2 9.2 10.8 5.6 12.4 3 Z"/>`,

  /**
   * Shielded — a bubble, told from every other circle by its specular.
   *
   * The specular used to sit at radius 6.2–6.6 inside an 8.7 outline. Two 1.75
   * strokes take 1.75 of that 2.2-unit gap, so at 24px the highlight ran within
   * two thirds of a pixel of the rim and the whole mark read as a plain ring
   * with one thick side — the round-4 review's softer note, and correct. The set
   * has seven other circles (`emote`, `timer`, `info`, `help`, `st-cancelled`,
   * `kw-flow`, `clout`) and a ring that is only a ring is indistinguishable from
   * all of them at a glance.
   *
   * So the highlight moves inboard to radius 5.0 — 3.7 units clear of the rim,
   * which is two clean pixels of dark between the two strokes at 24px — and it
   * becomes **two** arcs, a long one and a short one, which is the universal
   * glass idiom and the thing no other circle in the set does. Both sit in the
   * upper left, because the key light is at 315° everywhere and a bubble lit
   * from the bottom-right would be the one object in the game with its own sun.
   */
  "st-shielded": `<circle cx="12" cy="12" r="8.7"/><path d="M7.15 10.79 A5 5 0 0 1 9.73 7.55"/><path d="M10.37 7.27 A5 5 0 0 1 12 7"/>`,

  /** Cancelled — a circle with a strike through it. */
  "st-cancelled": `<circle cx="12" cy="12" r="8.7"/><path d="M6 18 L18 6"/>`,

  /**
   * Lurking — an eye, struck out. Not the glossary's hood.
   *
   * The hood was drawn twice. Domed, it is a horseshoe; pointed, it is a
   * teardrop with a hole in it — which put it one glance away from Scorched,
   * the worst possible neighbour for it, since both are statuses that can sit on
   * the same character. What Lurking actually does is make a character
   * untargetable until it acts, and every interface on earth already spells
   * "you cannot see this" as an eye with a line through it.
   */
  "st-lurking": `<path d="M3.2 12 C5.8 7.6 8.8 5.4 12 5.4 C15.2 5.4 18.2 7.6 20.8 12 C18.2 16.4 15.2 18.6 12 18.6 C8.8 18.6 5.8 16.4 3.2 12 Z"/><circle cx="12" cy="12" r="2.8"/><path d="M4.6 19.4 L19.4 4.6"/>`,

  /**
   * Warded — a shield with a bite taken out of its upper right.
   *
   * It was a rhombus with a small inner V, and the rhombus is the busiest
   * outline in the set: `diamond` is a plain one, `hype` is one with a girdle,
   * `kw-overload` is one with a zigzag. Hype and Overload sharing a silhouette
   * is argued for where they are drawn — they are the same resource, locked —
   * but Warded had no such argument, and it is a status pip that sits on a
   * character in the same HUD that shows the Hype counter. Four marks that are
   * one shape differing by an interior stroke is exactly the failure this set
   * was rebuilt to remove.
   *
   * So it is off the rhombus entirely, and the change is to the *silhouette*
   * rather than to the contents: Warded means one incoming effect is absorbed,
   * and a shield with a chunk missing from the corner the hit landed on says
   * that in one outline. Deliberately no interior line at all — `armour` is a
   * shield with a horizontal band, and the moment this one gains a bar the two
   * are back to being told apart by their insides.
   */
  "st-warded": `<path d="M12 3.4 L16.4 5 L14.8 8.4 L19.4 9.9 V12.4 C19.4 16.7 16.2 19.7 12 20.8 C7.8 19.7 4.6 16.7 4.6 12.4 V6.2 Z"/>`,

  /** Weakened — a down chevron over a floor. The bar is what makes it not a chevron. */
  "st-weakened": `<path d="M6 8.8 L12 14.8 L18 8.8"/><path d="M6.4 19 H17.6"/>`,

  /** Empowered — an up chevron off a floor. */
  "st-empowered": `<path d="M6 15.2 L12 9.2 L18 15.2"/><path d="M6.4 5 H17.6"/>`,

  /** Cursed — a hexagon with an eye set into it. */
  "st-cursed": `<path d="M12 3 L19.79 7.5 L19.79 16.5 L12 21 L4.21 16.5 L4.21 7.5 Z"/><path d="M7.6 12 C9.1 9.7 14.9 9.7 16.4 12 C14.9 14.3 9.1 14.3 7.6 12 Z"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>`,

  // -- generic controls -----------------------------------------------------

  search: `<circle cx="10.5" cy="10.5" r="6.4"/><path d="M15.2 15.2 L20.6 20.6"/>`,
  close: `<path d="M5.6 5.6 L18.4 18.4 M18.4 5.6 L5.6 18.4"/>`,
  plus: `<path d="M12 4.4 V19.6 M4.4 12 H19.6"/>`,
  minus: `<path d="M4.4 12 H19.6"/>`,
  check: `<path d="M4.4 12.6 L9.8 18 L19.6 6.4"/>`,

  /** A rating star, hollow. */
  star: `<path d="M12 3.7 L14.17 9.41 L20.27 9.71 L15.52 13.54 L17.11 19.44 L12 16.1 L6.89 19.44 L8.48 13.54 L3.73 9.71 L9.83 9.41 Z"/>`,
  /** The same star, earned. */
  "star-filled": `<path d="M12 3.7 L14.17 9.41 L20.27 9.71 L15.52 13.54 L17.11 19.44 L12 16.1 L6.89 19.44 L8.48 13.54 L3.73 9.71 L9.83 9.41 Z" fill="currentColor"/>`,

  lock: `<rect x="4.4" y="10.4" width="15.2" height="10.2" rx="2.2"/><path d="M8 10.4 V7.4 A4 4 0 0 1 16 7.4 V10.4"/><path d="M12 14.6 V17"/>`,
  /** Unlocked — the shackle is out of its socket, which is a silhouette change. */
  unlock: `<rect x="4.4" y="10.4" width="15.2" height="10.2" rx="2.2"/><path d="M8 10.4 V7.4 A4 4 0 0 1 16 7.4"/><path d="M12 14.6 V17"/>`,

  crosshair: `<circle cx="12" cy="12" r="7.6"/><path d="M12 3 V6.6 M12 17.4 V21 M3 12 H6.6 M17.4 12 H21"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/>`,

  "chevron-up": `<path d="M5.6 15.4 L12 9 L18.4 15.4"/>`,
  "chevron-down": `<path d="M5.6 8.6 L12 15 L18.4 8.6"/>`,
  "chevron-left": `<path d="M15.4 5.6 L9 12 L15.4 18.4"/>`,
  "chevron-right": `<path d="M8.6 5.6 L15 12 L8.6 18.4"/>`,

  "arrow-left": `<path d="M20 12 H4"/><path d="M9.6 6.4 L4 12 L9.6 17.6"/>`,
  "arrow-right": `<path d="M4 12 H20"/><path d="M14.4 6.4 L20 12 L14.4 17.6"/>`,
  "arrow-up": `<path d="M12 20 V4"/><path d="M6.4 9.6 L12 4 L17.6 9.6"/>`,
  "arrow-down": `<path d="M12 4 V20"/><path d="M6.4 14.4 L12 20 L17.6 14.4"/>`,

  menu: `<path d="M3.6 7 H20.4 M3.6 12 H20.4 M3.6 17 H20.4"/>`,

  info: `<circle cx="12" cy="12" r="8.7"/><path d="M12 11.2 V16.6"/><circle cx="12" cy="7.8" r="1.1" fill="currentColor" stroke="none"/>`,
  help: `<circle cx="12" cy="12" r="8.7"/><path d="M9.2 9.6 A2.9 2.9 0 1 1 12 13.3 V14.8"/><circle cx="12" cy="17.6" r="1.1" fill="currentColor" stroke="none"/>`,
  warning: `<path d="M12 3.6 L21 19.6 H3 Z"/><path d="M12 9.4 V14.4"/><circle cx="12" cy="17.3" r="1.1" fill="currentColor" stroke="none"/>`,

  edit: `<path d="M17.4 3.8 L20.2 6.6 L8.6 18.2 L4.4 19.6 L5.8 15.4 Z"/><path d="M15.2 6 L18 8.8"/>`,
  filter: `<path d="M3.4 5 H20.6 L14 12.8 V19.6 L10 21 V12.8 Z"/>`,
  trash: `<path d="M4.4 6.6 H19.6"/><path d="M9.4 6.6 V4.4 H14.6 V6.6"/><path d="M6.6 6.6 V18.9 A1.7 1.7 0 0 0 8.3 20.6 H15.7 A1.7 1.7 0 0 0 17.4 18.9 V6.6"/><path d="M10.2 10 V17.4 M13.8 10 V17.4"/>`,
  eye: `<path d="M3.2 12 C5.8 7.6 8.8 5.4 12 5.4 C15.2 5.4 18.2 7.6 20.8 12 C18.2 16.4 15.2 18.6 12 18.6 C8.8 18.6 5.8 16.4 3.2 12 Z"/><circle cx="12" cy="12" r="2.8"/>`,

  /** Daily missions. */
  sun: `<circle cx="12" cy="12" r="4.3"/><path d="M18.4 12 L20.9 12 M16.53 16.53 L18.29 18.29 M12 18.4 L12 20.9 M7.47 16.53 L5.71 18.29 M5.6 12 L3.1 12 M7.47 7.47 L5.71 5.71 M12 5.6 L12 3.1 M16.53 7.47 L18.29 5.71"/>`,
  /** Weekly missions. */
  moon: `<path d="M20.4 14.4 A8.8 8.8 0 1 1 9.6 3.6 A7 7 0 0 0 20.4 14.4 Z"/>`,

  /** Rarity pips, and anything that wants a neutral marker. */
  diamond: `<path d="M12 3.2 L20.8 12 L12 20.8 L3.2 12 Z"/>`,

  /**
   * A plain filled pip — and the only mark here that is not a picture of
   * anything.
   *
   * It is in the set because the alternative is `•`, and a Unicode bullet is
   * the precise thing this module was built to delete: it renders at whatever
   * size and weight the OS font decides, it is not `currentColor` in a font
   * that has opinions, and it sits on a different baseline in every face. Four
   * things a destination tile wants want a pip and none of them wants a number
   * — an unread marker where the count is not worth printing, a "you have not
   * seen this" dot, a carousel position, a separator between two bits of meta.
   *
   * 4.2 rather than something daintier because a pip has to survive being the
   * smallest thing on the screen; nothing else in the set is a solid disc, so
   * there is no size at which it can be confused with anything.
   */
  dot: `<circle cx="12" cy="12" r="4.2" fill="currentColor" stroke="none"/>`,

  /**
   * On air. A pip broadcasting in both directions.
   *
   * The set could say "new" (`glimmer`), "unread" (`dot`), "soon" (`timer`) and
   * "finished" (`check`), and had no way at all to say *happening right now* —
   * which for a game about streamers is the single most native word in its
   * vocabulary. Four of the nine lobby destinations want it (Events, Inbox,
   * Hype Wave, Missions), and a tile that can say "LIVE" with a mark instead of
   * a coloured dot is a tile that is not signalling by colour alone (§6).
   *
   * Arcs on **both** sides, deliberately. One-sided arcs are `volume`, and a
   * dot with waves coming off one edge is a speaker no matter what it is
   * labelled. Radii 2.0 / 5.2 / 9.0 with a ±50° span keep two clear pixels of
   * dark between each ring at 24px and hold the outer arc's left extreme at
   * x=3, exactly on the padding line.
   */
  live: `<circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/><path d="M8.66 15.98 A5.2 5.2 0 0 1 8.66 8.02"/><path d="M15.34 15.98 A5.2 5.2 0 0 0 15.34 8.02"/><path d="M6.21 18.89 A9 9 0 0 1 6.21 5.11"/><path d="M17.79 18.89 A9 9 0 0 0 17.79 5.11"/>`,

  /** Doomscroll treasure. A domed lid, because a flat one is a shoebox. */
  chest: `<rect x="3.2" y="10.6" width="17.6" height="9.6" rx="1.4"/><path d="M3.2 10.6 A11 11 0 0 1 20.8 10.6"/><rect x="10.4" y="12.4" width="3.2" height="3.8" rx="0.9"/>`,

  /** Doomscroll rest — the same flame as Scorched, over crossed logs. */
  campfire: `<path d="M12.3 3 C12.3 5.5 13.8 6.6 14.9 7.8 C15.9 9 16.5 10 16.5 11.3 C16.5 13.6 14.5 15.4 12 15.4 C9.5 15.4 7.5 13.6 7.5 11.3 C7.5 9.5 8.5 8.2 9.7 6.9 C9.9 8 10.3 8.7 11 9.1 C11.5 7.3 11.2 4.8 12.3 3 Z"/><path d="M4.4 18 L19.6 20.6 M4.4 20.6 L19.6 18"/>`,

  pause: `<path d="M9 5.4 V18.6 M15 5.4 V18.6"/>`,
  "skip-start": `<path d="M6.6 5.4 V18.6"/><path d="M19 5.4 L9.4 12 L19 18.6 Z"/>`,
  "skip-end": `<path d="M17.4 5.4 V18.6"/><path d="M5 5.4 L14.6 12 L5 18.6 Z"/>`,
  /**
   * Refresh — a 300° sweep with its gap and its arrowhead at the top.
   *
   * The barb coordinates are the tangent at the arc's end rotated ±35°, worked
   * out rather than guessed: an arrowhead placed by eye on an arc points very
   * slightly the wrong way, which is invisible in isolation and obvious the
   * moment it sits next to the shuffle icon.
   */
  refresh: `<path d="M16.2 4.72 A8.4 8.4 0 1 1 7.8 4.72"/><path d="M4.4 4.4 L7.8 4.72 L6.4 7.8"/>`,

  volume: `<path d="M4 9.4 H7.6 L12.6 5 V19 L7.6 14.6 H4 Z"/><path d="M15.6 9.6 A4 4 0 0 1 15.6 14.4"/><path d="M18 7.2 A7.5 7.5 0 0 1 18 16.8"/>`,
  mute: `<path d="M4 9.4 H7.6 L12.6 5 V19 L7.6 14.6 H4 Z"/><path d="M15.6 9.6 L20.6 14.4 M20.6 9.6 L15.6 14.4"/>`,

  /**
   * What an unknown id draws. Deliberately loud.
   *
   * The alternative is what every sprite system does by default — a `<use>` that
   * points at nothing renders nothing, so a typo'd id is a hole you cannot see,
   * in a layout that still reserves space for it. A dashed box with a question
   * mark is ugly on purpose; it will get fixed the same day it appears.
   */
  missing: `<rect x="3.4" y="3.4" width="17.2" height="17.2" rx="2.6" stroke-dasharray="3 2.4"/><path d="M9.4 9.8 A2.7 2.7 0 1 1 12 13.2 V14.4"/><circle cx="12" cy="17.2" r="1.05" fill="currentColor" stroke="none"/>`,
} as const satisfies Record<string, string>;

/** The id of a symbol that is actually drawn above. */
type ArtId = keyof typeof ART;

/**
 * Names that resolve to a drawing somebody else already made.
 *
 * These are not near-duplicates that should have been merged — they are the
 * same picture wanted under a second name, and the glossary says so out loud in
 * two cases ("Pip shape `leaf-exit`, shared with the **Banished** status"). An
 * alias costs one map entry and stops a future builder drawing a *second*
 * slightly different flame for the streak counter, which is exactly how an icon
 * set stops being one icon set.
 */
const ALIAS = {
  /** `armor` is how the engine spells it; the prose here is British. */
  armor: "armour",
  "st-armor": "armour",
  /** Glossary §3.10: Touch Grass and Banished are the same mark. */
  "st-banished": "kw-touch-grass",
  /** Weekly Boss and a Doomscroll elite are the same threat. */
  skull: "mode-boss",
  elite: "mode-boss",
  /** The streak counter is a flame, and so is Scorched. */
  flame: "st-scorched",
  streak: "st-scorched",
  /** A Doomscroll shop sells the same thing the lobby shop does. */
  shop: "merch-drop",
  /** "Recruit" nodes and Glimmer are both the four-point spark. */
  sparkle: "glimmer",
  recruit: "glimmer",
  /** Rarity pips, treasure markers and the data-version chip all use the diamond. */
  rarity: "diamond",
  /** The lobby calls it the Hype Wave; the code calls it the pass. */
  pass: "hype-wave",
  /** Back navigation is a left arrow, always the same one. */
  back: "arrow-left",
  /** A list and the action log are the same rows. */
  list: "log",
  /** The gear is the gear wherever it appears. */
  gear: "settings",
} as const satisfies Record<string, ArtId>;

/** Every name `icon()` will answer to, drawn or aliased. */
export type IconId = ArtId | keyof typeof ALIAS;

/**
 * Every name, in declaration order — drawn ones first, then the aliases.
 *
 * Declaration order rather than alphabetical, because the declarations are
 * grouped by family and a contact sheet that walks this list comes out grouped
 * for free. It is stable across runs either way, which is the property a
 * screenshot diff actually needs.
 */
export const ICON_IDS: readonly IconId[] = Object.freeze([
  ...(Object.keys(ART) as ArtId[]),
  ...(Object.keys(ALIAS) as (keyof typeof ALIAS)[]),
]);

/** Only the ids with their own artwork — what the sprite actually contains. */
export const DRAWN_ICON_IDS: readonly ArtId[] = Object.freeze(Object.keys(ART) as ArtId[]);

/**
 * Narrowing guard, for the many places an icon name arrives as a `string`.
 *
 * `Object.hasOwn`, not `in`. `in` walks the prototype chain, so `hasIcon(
 * "constructor")` would answer true and the caller would go on to render
 * `Function.prototype.toString` as if it were path data. Icon names come from
 * mode ids and keyword ids that are ultimately data files, so "no user string
 * can reach this" is not a claim worth making.
 */
export function hasIcon(id: string): id is IconId {
  return Object.hasOwn(ART, id) || Object.hasOwn(ALIAS, id);
}

/**
 * Follow an alias to the drawing it points at.
 *
 * Anything unrecognised lands on `missing` rather than on undefined. The types
 * say that cannot happen; the types are not present at the point a mode id comes
 * out of a JSON file, and "renders nothing at all" is the one failure mode this
 * module exists to stop.
 */
function resolve(id: IconId | string): ArtId {
  if (Object.hasOwn(ALIAS, id)) return (ALIAS as Record<string, ArtId>)[id]!;
  return Object.hasOwn(ART, id) ? (id as ArtId) : "missing";
}

// ---------------------------------------------------------------------------
// Convention helpers
// ---------------------------------------------------------------------------
//
// Three families are named by prefix so a caller with a mode id, a keyword id or
// a status id from the engine can find its icon without a lookup table of its
// own. These take `string` rather than the engine's union types on purpose: this
// module is a leaf with no imports, and pulling `engine/types` in here to gain a
// compile-time check on sixteen strings would put the whole rules engine in the
// dependency graph of an SVG file.

/** `"ai"` → `"mode-ai"`, or undefined if that mode has no icon. */
export function modeIcon(modeId: string): IconId | undefined {
  const id = `mode-${modeId}`;
  return hasIcon(id) ? id : undefined;
}

/** `"viral"` → `"kw-viral"`. */
export function keywordIcon(keywordId: string): IconId | undefined {
  const id = `kw-${keywordId}`;
  return hasIcon(id) ? id : undefined;
}

/** `"scorched"` → `"st-scorched"`. */
export function statusIcon(statusId: string): IconId | undefined {
  const id = `st-${statusId}`;
  return hasIcon(id) ? id : undefined;
}

// ---------------------------------------------------------------------------
// Markup
// ---------------------------------------------------------------------------

/** The custom property one instance uses to ask for a different rung. */
export const ICON_STROKE_VAR = "--hb-icon-stroke";

/**
 * The presentation shared by every drawing, with one number left open.
 *
 * On the symbol rather than on the `<svg>` host, because a host attribute is
 * only an *inherited* value inside the shadow tree a `<use>` builds — and an
 * inherited value loses to anything a page stylesheet says about `svg path`. A
 * specified attribute on the symbol wins, which is what keeps the set at one
 * stroke weight even on a screen whose CSS has opinions.
 *
 * That is also what made the optical ramp look impossible: a specified
 * attribute is specified for every instance at once, so one sprite could only
 * ever have one weight, and a second sprite is a second icon set with all the
 * drift that implies.
 *
 * `var()` inside a presentation attribute is the way out, and it is the *only*
 * value in this string that is not a constant. A presentation attribute is
 * parsed as a CSS declaration, and custom properties inherit across the shadow
 * boundary a `<use>` builds — so `--hb-icon-stroke` set on the host element
 * reaches the cloned geometry, per instance, from one sprite. Verified in a
 * real browser rather than assumed: the same symbol at a 96px box measured 8,
 * 6 and 16 device pixels of line under three different values of the property.
 *
 * The host also carries a plain numeric `stroke-width` matching the rung it
 * asked for. That is not belt and braces for its own sake — if an engine ever
 * rejects `var()` in a presentation attribute the declaration is invalid at
 * computed-value time, `stroke-width` falls back to its inherited value, and
 * the inherited value is the host's. The fallback lands on the right number
 * instead of on the SVG default of 1.
 */
const SYMBOL_ATTRS =
  `fill="none" stroke="currentColor" stroke-width="var(${ICON_STROKE_VAR}, ${ICON_STROKE})" ` +
  `stroke-linecap="round" stroke-linejoin="round"`;

/** The same presentation with the stroke and the ink resolved — for `data:` URIs. */
function flatAttrs(stroke: number, colour: string): string {
  return `fill="none" stroke="${colour}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"`;
}

/**
 * The stylesheet that gives an icon its box.
 *
 * Shipped from here rather than from `foundation.css` because this module is
 * supposed to be droppable: an icon that needs a second file edited before it
 * has a size is not a primitive, it is a two-part assembly. Specificity is a
 * single class deliberately, so module A's theme can size icons per context
 * without fighting an inline style.
 *
 * `1em` is the load-bearing choice — it is what makes the set honour
 * `--ui-scale`, and it means an icon dropped into a slot that currently holds a
 * Unicode glyph lands at exactly the size that glyph was.
 *
 * `flex: 0 0 auto` because an icon inside a flex row with a long label is
 * otherwise a flex item that can be squashed, and a squashed circle is the sort
 * of thing that only shows up in one language's translation. `overflow: visible`
 * because at a fractional device-pixel size the browser will otherwise shave the
 * outer edge of a stroke that sits on the viewBox boundary — every icon here is
 * measured to stay 2px inside it, so there is nothing legitimate to clip.
 */
/*
 * The optical rungs ship as classes rather than as inline styles for the reason
 * the paragraph above gives: at (0,1,0) a host can say
 * `.lobby-nav-icon .hb-icon{--hb-icon-stroke:1.2}` and win, which an inline
 * `style` would make impossible. `ui` deliberately has no class — it is the
 * `var()` fallback baked into every symbol, so the default costs no markup and
 * an icon with no opinion is always the signed-off weight.
 */
const ICON_CSS =
  `.${ICON_CLASS}{display:inline-block;width:1em;height:1em;` +
  `vertical-align:-0.125em;flex:0 0 auto;overflow:visible}` +
  (Object.entries(ICON_OPTICAL) as [IconOptical, number][])
    .filter(([rung]) => rung !== "ui")
    .map(([rung, stroke]) => `.${ICON_CLASS}-${rung}{${ICON_STROKE_VAR}:${stroke}}`)
    .join("");

const XMLNS = "http://www.w3.org/2000/svg";

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** One `<symbol>`. */
function symbolMarkup(id: ArtId): string {
  return `<symbol id="${SYMBOL_PREFIX}${id}" viewBox="0 0 ${ICON_GRID} ${ICON_GRID}" ${SYMBOL_ATTRS}>${ART[id]}</symbol>`;
}

/**
 * The whole sprite as markup.
 *
 * Exported for the contact sheet and for anything that wants to render the set
 * outside a live page. In the app it is `installIconSprite` that uses this.
 */
export function iconSprite(): string {
  return (
    `<svg xmlns="${XMLNS}" id="hb-icon-sprite" aria-hidden="true" focusable="false" ` +
    `style="position:absolute;width:0;height:0;overflow:hidden">` +
    `${DRAWN_ICON_IDS.map(symbolMarkup).join("")}</svg>`
  );
}

export interface IconOptions {
  /**
   * Accessible name.
   *
   * Omit it — which is the common case — and the icon is `aria-hidden`, because
   * almost every icon in this game sits next to its own text label and a screen
   * reader announcing "trophy, Achievements" is a worse experience, not a better
   * one. Supply it only for an icon that is the *entire* content of a control.
   */
  label?: string;
  /** Classes appended after `hb-icon`. */
  class?: string;
  /**
   * Override the box. A number is pixels; a string is any CSS length.
   *
   * Reach for this rarely. An icon that has to be told its size is an icon whose
   * host has not been given a font size, and fixing the host is what keeps the
   * set scaling with `--ui-scale`.
   */
  size?: number | string;
  /**
   * Which rung of the optical ramp to draw at.
   *
   * Left alone this is `"auto"`, which reads the numeric `size` and picks with
   * `opticalFor()`. It has to be stated explicitly in the one case the markup
   * cannot answer for itself — an icon sized by CSS rather than by `size`, which
   * is the *preferred* way to size an icon and therefore not a rare case:
   *
   *     icon("collection", { class: "dest-mark", optical: "hero" })
   *
   * The other way round works too and is often tidier: set
   * `--hb-icon-stroke` on any ancestor and every icon under it moves rung.
   */
  optical?: IconOptical | "auto";
  /** Anything else — `data-*`, `id`, `title`. Values are escaped. */
  attrs?: Record<string, string>;
}

/**
 * The rung an instance ends up on.
 *
 * A number in `size` is a promise about the rendered box, so it is enough to
 * choose with. A string is not — `1.4em` and `var(--x)` are both legal there and
 * neither can be resolved without a layout — so a CSS-sized icon stays on `ui`
 * unless the caller says otherwise. Silently guessing at a rung from a string
 * would be worse than not ramping at all: it would put two icons of the same
 * size at two weights, which is the one thing §7 actually forbids.
 */
function opticalOf(options: IconOptions | undefined): IconOptical {
  const asked = options?.optical;
  if (asked && asked !== "auto") return asked;
  return typeof options?.size === "number" ? opticalFor(options.size) : "ui";
}

function hostAttributes(options: IconOptions | undefined, optical: IconOptical): string {
  const rung = optical === "ui" ? "" : ` ${ICON_CLASS}-${optical}`;
  const classes = options?.class ? `${ICON_CLASS}${rung} ${options.class}` : `${ICON_CLASS}${rung}`;
  let out = ` class="${escapeAttribute(classes)}" viewBox="0 0 ${ICON_GRID} ${ICON_GRID}" focusable="false"`;

  if (options?.size !== undefined) {
    const length = typeof options.size === "number" ? `${options.size}px` : options.size;
    out += ` style="width:${escapeAttribute(length)};height:${escapeAttribute(length)}"`;
  }
  out += options?.label
    ? ` role="img" aria-label="${escapeAttribute(options.label)}"`
    : ` aria-hidden="true"`;

  for (const [name, value] of Object.entries(options?.attrs ?? {})) {
    out += ` ${name}="${escapeAttribute(value)}"`;
  }
  return out;
}

/**
 * One icon, as markup, pointing at the shared sprite.
 *
 * This is the helper the contract asks for and the one every screen should use.
 * It installs the sprite before returning, so the `<use>` it hands back can
 * never be a reference to something that is not there yet — the failure mode
 * that makes sprite systems produce invisible, un-debuggable holes.
 *
 *     row.innerHTML = `${icon("achievement")}<span>Achievements</span>`;
 */
export function icon(id: IconId, options?: IconOptions): string {
  installIconSprite();
  const target = resolve(id);
  const optical = opticalOf(options);
  const title = options?.label ? `<title>${escapeAttribute(options.label)}</title>` : "";
  return (
    `<svg${hostAttributes(options, optical)} stroke-width="${ICON_OPTICAL[optical]}">` +
    `${title}<use href="#${SYMBOL_PREFIX}${target}"/></svg>`
  );
}

/**
 * The same icon with its paths written out, depending on no shared document.
 *
 * For the three places `<use>` cannot reach: a `data:` URI, markup being built
 * for a document that is not this one, and a test that wants to assert on the
 * geometry rather than on a reference. Everywhere else, prefer `icon()`.
 */
export function iconInline(id: IconId, options?: IconOptions): string {
  const target = resolve(id);
  const optical = opticalOf(options);
  const title = options?.label ? `<title>${escapeAttribute(options.label)}</title>` : "";
  return (
    `<svg xmlns="${XMLNS}"${hostAttributes(options, optical)} ` +
    `${SYMBOL_ATTRS}>${title}${ART[target]}</svg>`
  );
}

/**
 * One icon as a real element, for code that builds DOM rather than strings.
 *
 * Built by parsing the markup rather than by thirty `createElementNS` calls: the
 * artwork above is a string of SVG and the shortest correct path from a string
 * of SVG to nodes is the parser the browser already has.
 */
export function iconElement(id: IconId, options?: IconOptions): SVGSVGElement {
  const scratch = document.createElement("div");
  scratch.innerHTML = icon(id, options);
  const parsed = scratch.firstElementChild as SVGSVGElement | null;
  return parsed ?? document.createElementNS(XMLNS, "svg");
}

/**
 * An icon as a `data:` URI, for `background-image`, `mask-image` and canvas.
 *
 * The colour has to be passed in and cannot be `currentColor`: a `data:` URI is
 * a document of its own with no cascade reaching into it, so `currentColor`
 * there resolves to the SVG initial value — black — and produces an icon that is
 * invisible on every screen in this game. Passing the colour explicitly is the
 * cost of leaving the cascade behind, and making it a required-looking parameter
 * is cheaper than debugging a black icon on a black panel.
 *
 * Percent-encoded rather than base64: it stays readable in devtools and is
 * shorter for markup this repetitive.
 *
 * The stroke is resolved to a number here rather than left as `var()`, and that
 * is the whole reason this function does not just call `iconInline`. A `data:`
 * URI is a document with no cascade reaching into it, so a `var()` would always
 * take its fallback — which is exactly wrong for the case this signature now
 * serves. A destination tile's watermark is the same drawing at 160px, and at
 * 160px the `ui` rung paints an 11.7px line: a blot, not a mark. `size` picks
 * the rung, the same way it does for `icon()`, so a caller asking for a big
 * watermark gets a big watermark rather than a big mistake.
 */
export function iconDataUri(
  id: IconId,
  color = "#ffffff",
  size = ICON_GRID,
  optical: IconOptical | "auto" = "auto"
): string {
  const target = resolve(id);
  const rung = optical === "auto" ? opticalFor(size) : optical;
  const attrs = flatAttrs(ICON_OPTICAL[rung], color);
  const svg =
    `<svg xmlns="${XMLNS}" viewBox="0 0 ${ICON_GRID} ${ICON_GRID}" width="${size}" height="${size}" ${attrs}>` +
    `${ART[target].replace(/currentColor/g, color)}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * The two `data:` marks module A's checkbox draws, emitted from the real artwork.
 *
 * Round 4: `--tick` and `--tick-off` in `foundation.css` are a second icon set
 * living inside module A — the same idea as `check` but a different path
 * (`m5 13 4.5 4.5L19 6.5`), at a different weight (2.75 against 1.75), with the
 * ink baked in as `#ffffff` and `#8e88a4` and none of this set's 2px of optical
 * padding. Photographed side by side at 4× they are plainly two different hands,
 * and the baked colour is the exact failure the chevron comment forty lines
 * above it condemns: a tinted checkbox gets a white tick.
 *
 * The fix belongs in module A's file and module A owns it. What module C can do
 * — and this is the whole of it — is stop the redraw being *necessary*: these
 * are the correct strings, generated from the same paths as every other mark, so
 * the repair there is a paste rather than a fourth attempt at drawing a tick.
 * The gallery photographs both hands at 6× so the difference is a picture rather
 * than a paragraph, and so that the day module A lands the fix, the same photo
 * shows one hand instead of two.
 *
 * Deliberately *not* installed onto `:root` from here. Writing another module's
 * custom properties out of a JS boot step would win over its stylesheet
 * silently, which is a worse failure than the one it fixes — the next person to
 * edit `foundation.css` would change the tick and watch nothing happen.
 */
export const FORM_TICKS: Readonly<Record<"tick" | "tickOff", string>> = Object.freeze({
  tick: iconDataUri("check", "#ffffff"),
  tickOff: iconDataUri("check", "#8e88a4"),
});

// ---------------------------------------------------------------------------
// Installing the sprite
// ---------------------------------------------------------------------------

let installedIn: Document | null = null;

/**
 * Put the sprite and its one stylesheet into the document. Idempotent.
 *
 * Called for you by `icon()` and `iconElement()`; call it directly at boot only
 * if you want the parse cost paid before the first screen mounts rather than
 * during it. It is a single `innerHTML` assignment of about twenty kilobytes,
 * which is nothing next to a three.js scene, so the whole set goes in at once
 * rather than symbol-by-symbol on demand — a lazy sprite has to guarantee the
 * symbol is present before the referencing markup is inserted, and every way of
 * guaranteeing that is more code than just installing the lot.
 *
 * Safe to call with no document (tests, a worker): it does nothing and the
 * string helpers still work.
 *
 * The two pieces are checked separately rather than behind one flag. A document
 * can plausibly arrive with the sprite already in it and no stylesheet — that is
 * what happens the moment anybody serialises a rendered page — and a single
 * "already done" guard would leave every icon in it sized 0×0.
 */
export function installIconSprite(doc: Document | undefined = globalThis.document): void {
  if (!doc || installedIn === doc) return;
  const mount = doc.body ?? doc.documentElement;
  if (!mount) return; // called from <head> before the parser reached <body>

  if (!doc.getElementById("hb-icon-style")) {
    const style = doc.createElement("style");
    style.id = "hb-icon-style";
    style.textContent = ICON_CSS;
    (doc.head ?? mount).appendChild(style);
  }

  if (!doc.getElementById("hb-icon-sprite")) {
    const holder = doc.createElement("div");
    holder.innerHTML = iconSprite();
    const sprite = holder.firstElementChild;
    // First child, so the symbols exist ahead of any screen's markup. It is
    // `aria-hidden` and zero-sized: a bag of 106 symbols is not content.
    if (sprite) mount.insertBefore(sprite, mount.firstChild);
  }

  installedIn = doc;
}

/** Test seam — forget that the sprite was installed. */
export function resetIconSprite(): void {
  installedIn = null;
}
