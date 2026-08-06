/**
 * The world behind the menus.
 *
 * Every screen in HYPEBOUND paints its own `.ambient-bg` and every one of them
 * dies with the screen. Navigate, and the backdrop you were looking at is torn
 * down and an identical one is built a frame later — which is why changing
 * screens has always felt like swapping documents rather than moving through a
 * place. Hearthstone, Arena and Gwent all share the one trait we did not: the
 * space behind the UI is continuous, and only the furniture moves.
 *
 * So this is one background layer, mounted **outside `#app`** — outside the
 * screen router entirely — and never unmounted for the lifetime of the page. It
 * cannot blink, because nothing ever removes it. That single fact is what makes
 * the transitions in `transitions.css` safe to write: an outgoing screen can
 * recede, blur and drop to zero opacity without anyone having to guarantee that
 * the incoming one has already covered the hole, because the hole opens onto the
 * world rather than onto the page background.
 *
 * ## Rooms, not themes
 *
 * A destination is not a colour swap, it is a **lighting setup**: where the key
 * light is, what the fill is, what bounces off the floor, and how loud all of it
 * is allowed to be. `ROOMS` holds ten of them, and the shell names one per route.
 * The Merch Drops shop is lit gold, the deck forge is a cool workshop that gets
 * out of the way of card art, and the policy screens are almost unlit because
 * nobody reads a privacy notice through a neon haze. They are still recognisably
 * the same building — same grain, same grid, same key light at the top-left —
 * which is the difference between ten rooms and ten themes.
 *
 * Changing room **crossfades two full copies of the wash** rather than
 * interpolating the colours in place. Interpolating means re-rasterising four
 * full-screen gradients on every frame of the change; a crossfade of two
 * pre-painted layers is an opacity animation and costs the compositor nothing.
 * That matters here more than anywhere, because the room changes at exactly the
 * moment the screen transition is already asking for the frame budget.
 *
 * ## The room has a ceiling, and it is lower than the furniture
 *
 * The first version of this layer was lighter and more chromatic than the panels
 * in front of it — measured on `#uikit`, the top-left key came out at L*22.4 /
 * C*37.2 against a card face at L*17.2 / C*24.5, and a card's face and the wash
 * directly behind it were inside one luminance level of each other. That is not
 * a backdrop, it is a fifth panel, and it is the exact failure AAA bar §2 names:
 * separation being carried by z-index alone. Every room light is now mixed
 * toward a cool near-neutral before it is used and every alpha is capped, so no
 * part of the world is ever lighter or more saturated than the furniture
 * standing on it. The numbers live in `transitions.css` §1.1, where the
 * gradients that consume them are, and the long note there says how they were
 * chosen. `ROOMS` still decides colour and intensity; it no longer decides how
 * loud the backdrop is allowed to be, because that is a property of the *stack*
 * rather than of any one room.
 *
 * ## Everything here is transform, opacity or a static paint
 *
 * The drift, the breath, the sweep and the motes are all CSS animations on
 * `transform` and `opacity` only, so there is **no render loop** — nothing in
 * this file runs per frame. That is deliberate: fifteen builders sharing one
 * page cannot each afford a `requestAnimationFrame`, and a background is the
 * last thing that should own one. The grid translates by exactly one cell so the
 * loop is seamless; the mote layers translate by exactly one tile for the same
 * reason.
 *
 * ## Why there is a second plane, in front of everything
 *
 * The layer above is architecturally correct and, for most of the session, was
 * invisible. Thirty-nine screens still paint their own opaque `.ambient-bg` and
 * will keep doing so until the migration wave reaches them, so the world sat
 * behind a full-viewport plate: photographing `#missions` frozen, and then again
 * with `.atmosphere { display: none }`, produced a mean pixel delta of 0.000 —
 * deleting the entire world changed not one pixel. Fading that plate during a
 * navigation, which `transitions.css` §2.6 does, buys about 200ms of visible
 * world per route change and leaves the destination dead. §3a's requirement is
 * that the screen is alive *at rest*, and the reference games meet it by moving
 * a lit environment behind the UI the whole time.
 *
 * `.atmosphere-fore` is the answer that does not require touching forty-nine
 * screens: a thin plane mounted **after `#app`**, carrying the near mote field,
 * the specular crawl and a low vignette. It is in front of whatever backdrop a
 * screen happens to paint, so every route gets a living fourth depth plane
 * whether or not it has been migrated. It is deliberately thin — motes at a
 * quarter alpha and a sweep peaking at five percent — because it is over
 * content, and it is driven by the same `--atm-strength` as the layer behind,
 * so high contrast turns it down and reduced motion removes it outright.
 *
 * ## Nothing is fetched
 *
 * The mote fields and the grain are drawn into a canvas at boot and handed to
 * CSS as `data:` URIs, on an idle callback so first paint never waits for them.
 * They fade in when they arrive rather than popping.
 *
 * Known duplication, and it is deliberate for one wave only: `grainTile` here
 * does the job `texture.ts`'s `grainDataUri` will do for everybody. The two
 * modules are being built at the same time and a hard import of a file that
 * does not exist yet breaks the dev server for four other people. When module B
 * lands, the generator below is deleted and the call site takes `grainDataUri`.
 */

import "./theme/transitions.css";

/** The ten lighting setups. A route names one; it never invents its own. */
export type AtmosphereRoom =
  | "hub"
  | "play"
  | "forge"
  | "market"
  | "record"
  | "signal"
  | "system"
  | "arena"
  | "descent"
  | "stage";

export interface RoomLight {
  /**
   * What this room is called, for the one surface that has to name it.
   *
   * The world behind the UI has been ten lighting setups with no names since it
   * was built, which was fine while nothing ever had to say where you were
   * going. The menu veil does: it is the only screen in the game that is drawn
   * *instead* of a destination rather than as one, and a cover that carries the
   * destination's identity is the difference between Hearthstone's book opening
   * and a progress bar. Naming the room rather than the route is deliberate —
   * the Collection and the Deck Builder are two doors into the same workshop,
   * and saying so is what makes ten rooms read as one building.
   */
  name: string;
  /** The key. The strongest colour in the room, sitting at `keyAt`. */
  key: string;
  /** The fill, thrown from the opposite side. Always cooler or duller than the key. */
  fill: string;
  /** The bounce off the floor, along the bottom edge. */
  rim: string;
  /**
   * Where the key sits, as CSS percentages.
   *
   * Always in the upper left. The foundation contract's one global decision is
   * that the key light is at 315° everywhere, forever; a room that lit itself
   * from the right would put two suns on screen the moment a panel with a
   * top-left rim highlight sat in front of it.
   */
  keyAt: readonly [string, string];
  /** 0–1 master amplitude for the whole room. */
  intensity: number;
}

/**
 * Ten rooms in one building.
 *
 * The intensities are the interesting column. `system` sits at 0.42 and `forge`
 * at 0.72 because both are screens you *read* — a policy page and a wall of card
 * art respectively — and saturation is a resource that belongs to whatever
 * matters most on screen (AAA bar §6). `hub` and `arena` get the full ration
 * because on those two screens the background genuinely is part of the show.
 */
export const ROOMS: Readonly<Record<AtmosphereRoom, RoomLight>> = {
  /** The lobby. The loudest room in the game, and the one that sets the tone. */
  hub: { name: "The Lobby", key: "#b56cff", fill: "#ff5fa2", rim: "#52c8ff", keyAt: ["18%", "4%"], intensity: 1 },
  /** Mode select: the same building, one step cooler, because you are choosing. */
  play: { name: "The Door", key: "#8f6cff", fill: "#52c8ff", rim: "#b56cff", keyAt: ["22%", "6%"], intensity: 0.92 },
  /** Collection, decks, gallery. A workshop — deliberately quiet behind card art. */
  forge: { name: "The Workshop", key: "#6f7dff", fill: "#3fa9d8", rim: "#8b5cf6", keyAt: ["14%", "2%"], intensity: 0.72 },
  /** Merch Drops, banners, the Hype Wave. The one gold-lit room. */
  market: { name: "The Market", key: "#ffcc66", fill: "#ff5fa2", rim: "#b56cff", keyAt: ["20%", "4%"], intensity: 0.88 },
  /** Profile, stats, leaderboards, replays. Archival: steel, low saturation. */
  record: { name: "The Archive", key: "#7d92c8", fill: "#5f6fa8", rim: "#4fa8d8", keyAt: ["16%", "4%"], intensity: 0.6 },
  /** News, inbox, events. Broadcast cyan. */
  signal: { name: "The Feed", key: "#52c8ff", fill: "#4fe3d0", rim: "#8b5cf6", keyAt: ["24%", "2%"], intensity: 0.8 },
  /** Settings and the policy hub. Almost unlit — you have stepped out of the game. */
  system: { name: "Back Office", key: "#7a7396", fill: "#5d6b8a", rim: "#8f8aa8", keyAt: ["18%", "6%"], intensity: 0.42 },
  /** Behind the board. Hot, and the only room where the rim is warm. */
  arena: { name: "The Floor", key: "#ff5fa2", fill: "#b56cff", rim: "#ff6b2c", keyAt: ["20%", "0%"], intensity: 1 },
  /** The Doomscroll and the Gauntlet. Sickly, unstable, wrong on purpose. */
  descent: { name: "The Descent", key: "#4fe3d0", fill: "#56c264", rim: "#a855f7", keyAt: ["12%", "2%"], intensity: 0.78 },
  /** Story chapters. Theatrical amber over a bruise. */
  stage: { name: "The Stage", key: "#ffb347", fill: "#8b3a62", rim: "#a855f7", keyAt: ["26%", "4%"], intensity: 0.86 },
};

export const DEFAULT_ROOM: AtmosphereRoom = "hub";

/**
 * How the world moves when the UI does.
 *
 * The world always moves *less* than the furniture in front of it and settles
 * *after* it — that lag is the whole parallax effect, and it is the reason a
 * descend reads as the camera pushing into a room rather than as two rectangles
 * swapping places. Amplitudes here are roughly a quarter of the screen's.
 */
export type TravelKind =
  | "arrive"
  | "descend"
  | "ascend"
  | "sibling-left"
  | "sibling-right"
  | "curtain-in"
  | "curtain-out"
  | "replace";

export interface Atmosphere {
  /** The persistent layer itself. Exposed for tests and for nothing else. */
  readonly root: HTMLElement;
  /** The thin plane in front of `#app`. Exposed for the same reason. */
  readonly fore: HTMLElement;
  /** Light the room a route belongs to. A no-op if we are already in it. */
  enterRoom(room: AtmosphereRoom): void;
  /** Nudge the world in the direction the player just travelled. */
  travel(kind: TravelKind): void;
  /** Freeze every animation. Wired to page visibility; exposed for tests. */
  setPaused(paused: boolean): void;
  dispose(): void;
}

/** Cheap tiers, matching the three the battle board already uses. */
type AtmosphereTier = "high" | "medium" | "low";

/**
 * What this device can afford.
 *
 * Deliberately *not* imported from `battle/scene.ts`, which owns the same
 * heuristic. That module pulls in the whole of three.js, and a DOM background
 * layer that fifteen screens depend on must not carry a 3D renderer behind it
 * just to decide whether it can afford a blur. The two want to stay in step, so
 * if one of them changes, change both — or hoist this into `motion.ts`, which is
 * where it probably belongs once module D has settled.
 *
 * An answer already written onto the root wins. Nothing writes it today, but
 * the graphics-quality setting is going to want to, and a background layer that
 * quietly overrides an explicit "low" would be the worst possible way to find
 * that out.
 */
function detectTier(): AtmosphereTier {
  const declared = typeof document !== "undefined" ? document.documentElement.dataset["gfxTier"] : undefined;
  if (declared === "high" || declared === "medium" || declared === "low") return declared;
  if (typeof navigator === "undefined") return "medium";
  const memory = (navigator as { deviceMemory?: number }).deviceMemory ?? 4;
  const cores = navigator.hardwareConcurrency ?? 4;
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  if (coarse && (memory <= 4 || cores <= 4)) return "low";
  if (memory <= 4 || cores <= 4) return "medium";
  return "high";
}

// --- generated textures -------------------------------------------------------

/** Small, fast, seeded PRNG. Seeded so two boots produce the same starfield. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tileContext(size: number): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return canvas.getContext("2d");
}

/**
 * Source resolution of a mote tile.
 *
 * The stylesheet paints them back at 380–560px, so 512 is close to 1:1 on the
 * middle layer and a mote is a mote rather than a smeared blob. It is also the
 * point past which the `toDataURL` cost stops being free on an idle callback.
 */
const MOTE_TILE_PX = 512;

/**
 * One tile of drifting dust.
 *
 * Each mote is drawn **nine times** — at the tile's position and at every
 * wrapped offset around it. Without that, a mote whose falloff crosses the tile
 * edge is clipped, and a clipped tile repeated across a 1600px screen puts a
 * visible grid of half-motes on the backdrop. Nine draws of forty motes is a
 * few milliseconds on an idle callback and it is the difference between dust and
 * wallpaper.
 */
function moteTile(seed: number, size: number, count: number): string {
  const ctx = tileContext(size);
  if (!ctx) return "";
  const rand = mulberry32(seed);
  for (let i = 0; i < count; i++) {
    const x = rand() * size;
    const y = rand() * size;
    // biased small: two multiplied uniforms give many specks and few sparks
    const radius = (0.5 + rand() * rand() * 2.4) * 3.1;
    const alpha = 0.16 + rand() * 0.6;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const cx = x + dx * size;
        const cy = y + dy * size;
        // skip the wrapped copies that cannot possibly touch the tile
        if (cx < -radius || cy < -radius || cx > size + radius || cy > size + radius) continue;
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        gradient.addColorStop(0, `rgba(255,251,255,${alpha})`);
        gradient.addColorStop(0.4, `rgba(214,196,255,${alpha * 0.34})`);
        gradient.addColorStop(1, "rgba(176,150,255,0)");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  return ctx.canvas.toDataURL("image/png");
}

/**
 * Film grain. AAA bar §1: a mathematically smooth gradient reads as CSS, and the
 * backdrop is the largest smooth gradient in the game.
 *
 * 96px rather than something larger because grain is noise — the tile repeats
 * every 96px and there is no pattern for an eye to catch. Noise does not
 * compress, so the data URI is roughly 30 KB; that is memory, not network, and
 * this build fetches nothing.
 */
function grainTile(size: number, amount: number, seed: number): string {
  const ctx = tileContext(size);
  if (!ctx) return "";
  const image = ctx.createImageData(size, size);
  const rand = mulberry32(seed);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const value = 140 + Math.round(rand() * 115);
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = Math.round(rand() * amount * 255);
  }
  ctx.putImageData(image, 0, 0);
  return ctx.canvas.toDataURL("image/png");
}

/** Run when the browser is not busy, with a hard timeout so it always runs. */
function whenIdle(work: () => void): void {
  const idle = (
    globalThis as {
      requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
    }
  ).requestIdleCallback;
  if (typeof idle === "function") idle(work, { timeout: 1500 });
  else setTimeout(work, 220);
}

// --- the layer ----------------------------------------------------------------

function layer(className: string): HTMLElement {
  const node = document.createElement("div");
  node.className = className;
  return node;
}

/**
 * Paint a room into one of the two crossfade slots.
 *
 * Everything the room decides is written as a custom property; the gradients
 * themselves live in `transitions.css` so the shape of the light is authored in
 * one place and only its colour comes from here.
 */
function paintRoom(slot: HTMLElement, light: RoomLight): void {
  slot.style.setProperty("--room-key", light.key);
  slot.style.setProperty("--room-fill", light.fill);
  slot.style.setProperty("--room-rim", light.rim);
  slot.style.setProperty("--room-x", light.keyAt[0]);
  slot.style.setProperty("--room-y", light.keyAt[1]);
  slot.style.setProperty("--room-intensity", String(light.intensity));
}

function buildRoomSlot(): HTMLElement {
  const slot = layer("atm-room");
  slot.append(layer("atm-wash"), layer("atm-bloom"), layer("atm-horizon"));
  return slot;
}

let mounted: Atmosphere | null = null;

/**
 * Mount the world. Call once, at boot, before anything else renders.
 *
 * Idempotent: a second call hands back the layer that is already there rather
 * than stacking a second one, because a double-mounted background is the kind of
 * bug that costs 8% of a frame budget and shows up as "the lobby feels heavy".
 *
 * The layer is inserted as the **first child of `<body>`**, ahead of `#app`.
 * Both are `position: fixed` with an auto z-index, so document order decides:
 * the world paints first and every screen paints over it. It carries
 * `pointer-events: none` and `aria-hidden`, so it is invisible to the mouse and
 * to a screen reader alike.
 */
export function mountAtmosphere(host: HTMLElement | null = null): Atmosphere {
  if (mounted) return mounted;

  const parent = host ?? document.body;
  const root = layer("atmosphere");
  root.setAttribute("aria-hidden", "true");

  /**
   * The tier goes on the document root rather than on this element, because the
   * screen transitions need it too — `transitions.css` drops its blurs on the
   * low tier — and those run on elements inside `#app`, which is not a
   * descendant of anything this module owns.
   */
  const tier = detectTier();
  document.documentElement.dataset["gfxTier"] = tier;

  /**
   * Everything animated lives inside `.atm-body` so that a navigation can move
   * the whole world with one transform, rather than nudging nine layers and
   * hoping they agree.
   */
  const body = layer("atm-body");

  const slotA = buildRoomSlot();
  const slotB = buildRoomSlot();
  slotA.classList.add("is-front");

  /**
   * The deep plane, and why it is an element rather than two more rules.
   *
   * The grid and the far mote field are the two layers that are meant to read
   * as *furthest away*, and for the first version of this module the only thing
   * making that true was their position in the stack. AAA bar §2 is explicit
   * that stacking is not depth — separation has to come from blur, desaturation,
   * scale and parallax — and measured against a card face the backdrop was
   * lighter, more chromatic and moving on exactly the same transform as
   * everything else in the world.
   *
   * `transitions.css` gives this wrapper a permanent 7% oversize, a blur on its
   * two children and a counter-move on every navigation, so it travels at about
   * 60% of the wash's rate and the wash at about 40% of the screen's. It has to
   * be a wrapper because both children already animate `transform` for their own
   * reasons; hanging a second transform animation on either would mean restating
   * a 26-second breathe every time somebody changes screen, which restarts it
   * from wherever it was and visibly jumps.
   */
  const deep = layer("atm-deep");
  const grid = layer("atm-grid");
  const motesFar = layer("atm-motes atm-motes-far");
  deep.append(grid, motesFar);

  const motesMid = layer("atm-motes atm-motes-mid");
  const motesNear = layer("atm-motes atm-motes-near");
  const sweep = layer("atm-sweep");
  const vignette = layer("atm-vignette");

  body.append(slotA, slotB, deep, motesMid, motesNear, sweep, vignette);
  root.append(body);
  parent.insertBefore(root, parent.firstChild);

  /**
   * The near plane, appended **last** so it lands after `#app`.
   *
   * `#app` is `position: fixed`, which makes it a stacking context of its own,
   * so nothing inside a screen — not the mulligan at z-index 70, not the shop
   * reveal at 60 — can paint over a sibling of `#app` with a higher z-index.
   * That is exactly what is wanted: this is a lens over the whole window, not a
   * layer inside the page. `#rotate-overlay` at 9999 still clears it.
   *
   * Its own body element exists for the same reason the back layer's does: one
   * transform can move the whole plane if a future set-piece wants to, and the
   * pause switch has one thing to talk to.
   */
  const fore = layer("atmosphere-fore");
  fore.setAttribute("aria-hidden", "true");
  const foreBody = layer("atm-fore-body");
  const foreMotes = layer("atm-motes atm-fore-motes");
  const foreSweep = layer("atm-sweep atm-fore-sweep");
  /**
   * The grain, and it is the only layer in this file that a probe can see.
   *
   * `transitions.css` §1.6 carries the arithmetic in full; the summary is that
   * dust covers about a tenth of a percent of the frame and a drifting grid
   * moves a fifth of a pixel per 200ms tick, so between them they are worth
   * hundredths of a level — while a translated noise tile changes *every* pixel
   * by roughly its own amplitude and lands on its own near the reference floor.
   * Every other moving thing in this module is for the eye. This one is the
   * reason forty-nine routes measure alive instead of eleven.
   *
   * It goes in the front plane rather than into a screen because this element
   * is mounted once, outside the router, and is never unmounted — which is the
   * strongest available form of "a route added tomorrow gets it for free". It
   * is not per-route at all; it is per-page, so it also covers the two error
   * screens and anything else that is drawn without a route factory.
   */
  const foreGrain = layer("atm-fore-grain");
  foreBody.append(foreMotes, foreSweep, foreGrain, layer("atm-fore-vignette"));
  fore.append(foreBody);
  parent.appendChild(fore);

  /**
   * Grain, immediately rather than on an idle callback, and written onto the
   * **document root** rather than onto this layer.
   *
   * It is a 96px noise tile — a few milliseconds — and it is painted *by* the
   * wash rather than as a layer of its own, so there is nothing to fade in and
   * no way to add it later without the surface visibly changing. Generating it
   * up front means the backdrop has never once been a mathematically clean
   * gradient, which is the whole point of having it.
   *
   * **The low tier used to skip it, and that is now a bug rather than a saving.**
   * The argument was that a device choosing between this and the board should
   * not spend anything on a repeating background image. Since `.atm-fore-grain`
   * exists, this tile is the single layer keeping every route alive at rest, and
   * a low-tier device with no `--grain-src` gets `background-image: none` and a
   * front plane that measures zero. It is 30 KB of memory and one composited
   * 96px repeat — genuinely the cheapest thing in this file — and the tier's
   * saving is taken instead by `--atm-strength`, which §1.8 already drops to 0.6
   * on low and which the grain's opacity is multiplied by.
   *
   * The property used to live on `.atmosphere`, which meant only the four
   * layers inside this element could reach it. The one other surface in the
   * game that is a full-screen field of nothing — `transitions.css`'s menu veil,
   * which now holds opaque over a heavy route's constructor for as long as that
   * takes — sits inside `#app` and could not, so the largest flat area a player
   * ever sees was the one place with no dirt on it. Inheriting from the root
   * costs nothing (it is a string, resolved only where it is used) and means
   * there is one grain in the build rather than a second one generated by
   * whoever needs it next. §1: reality has dirt, and it has the *same* dirt
   * everywhere or the eye reads two materials.
   */
  {
    const grain = grainTile(96, 0.055, 0x1d4b);
    if (grain) document.documentElement.style.setProperty("--grain-src", `url("${grain}")`);
  }

  let room: AtmosphereRoom | null = null;
  let front = slotA;
  let back = slotB;

  /**
   * The mote fields, once the browser has a spare moment.
   *
   * These are the expensive ones — three 512px canvases, each with several
   * hundred radial-gradient fills — and none of them is load-bearing, so first
   * paint never waits. They fade in over 1.2s when they arrive rather than
   * appearing between two frames.
   *
   * How many is decided here and mirrored by the `data-gfx-tier` rules in
   * `transitions.css`: three fields on high, two on medium, one on low.
   * Generating a tile for a field the stylesheet has set to `display: none`
   * would spend the canvas work and a megabyte of decoded PNG on something
   * nobody can see, so the two lists have to agree — change one, change both.
   *
   * The counts look small because the tiles are large on screen: fourteen motes
   * in a 560px tile is about sixty visible at 1600×900, and three fields come
   * to roughly two hundred. Fine dust, not a starfield.
   */
  whenIdle(() => {
    if (!root.isConnected) return;
    const fields: Array<[HTMLElement, number, number]> =
      tier === "low"
        ? [[motesMid, 0x51ce, 10]]
        : tier === "medium"
          ? [
              [motesMid, 0x51ce, 10],
              [motesNear, 0x2b77, 6],
            ]
          : [
              [motesFar, 0x9e3f, 14],
              [motesMid, 0x51ce, 10],
              [motesNear, 0x2b77, 6],
            ];
    for (const [node, seed, count] of fields) {
      const src = moteTile(seed, MOTE_TILE_PX, count);
      if (!src) continue;
      node.style.setProperty("--mote-src", `url("${src}")`);
      node.classList.add("is-ready");
    }
    /**
     * The front plane's dust, at every tier including low.
     *
     * A fourth tile rather than a reuse of one of the three above: the front
     * layer sits at a different scale and a different tilt, and repeating the
     * same forty specks in front of and behind the UI is the one arrangement
     * where the eye finds the repeat immediately. Eleven motes in a 340px tile
     * is around eighty on screen at 1600x900 — dust, not weather, but enough of
     * it that a burst capture of a static route is never two identical frames.
     * The low tier keeps it because this is the only thing making an unmigrated
     * route move at all, and one tiled transform is the cheapest possible way to
     * say so; what low drops is the sweep, in `transitions.css`, which is the
     * full-screen gradient.
     */
    const foreSrc = moteTile(0x7c41, MOTE_TILE_PX, 11);
    if (foreSrc) {
      foreMotes.style.setProperty("--mote-src", `url("${foreSrc}")`);
      foreMotes.classList.add("is-ready");
    }
  });

  /**
   * Retiring the travel attribute.
   *
   * `animationend` rather than a timer, so a paused tab or a slow frame cannot
   * leave the world stuck mid-dolly. Re-setting the same attribute value does
   * not restart a CSS animation, so a second navigation inside 600ms has to
   * clear it and force a reflow first — otherwise every navigation after the
   * first would move the furniture and leave the world standing still.
   */
  const clearTravel = (event: AnimationEvent): void => {
    if (event.target !== body) return;
    delete root.dataset["travel"];
  };
  body.addEventListener("animationend", clearTravel);
  body.addEventListener("animationcancel", clearTravel);

  const visibility = (): void => {
    api.setPaused(document.visibilityState === "hidden");
  };
  document.addEventListener("visibilitychange", visibility);

  const api: Atmosphere = {
    root,
    fore,
    enterRoom(next: AtmosphereRoom): void {
      if (next === room) return;
      room = next;
      paintRoom(back, ROOMS[next]);
      // resolve the new paint before the opacity swap, or the crossfade starts
      // from a layer the browser has not yet rasterised and snaps on the first
      // frame instead of fading
      void back.offsetWidth;
      back.classList.add("is-front");
      front.classList.remove("is-front");
      const previous = front;
      front = back;
      back = previous;
    },
    travel(kind: TravelKind): void {
      delete root.dataset["travel"];
      void body.offsetWidth;
      root.dataset["travel"] = kind;
    },
    setPaused(paused: boolean): void {
      if (paused) {
        root.dataset["paused"] = "true";
        fore.dataset["paused"] = "true";
      } else {
        delete root.dataset["paused"];
        delete fore.dataset["paused"];
      }
    },
    dispose(): void {
      body.removeEventListener("animationend", clearTravel);
      body.removeEventListener("animationcancel", clearTravel);
      document.removeEventListener("visibilitychange", visibility);
      root.remove();
      fore.remove();
      // The grain outlives this element now that it lives on the root, so it
      // has to be taken back explicitly — a test that mounts and disposes twice
      // would otherwise leave a 30 KB data URI on the document for the rest of
      // the process.
      document.documentElement.style.removeProperty("--grain-src");
      if (mounted === api) mounted = null;
    },
  };

  paintRoom(slotA, ROOMS[DEFAULT_ROOM]);
  room = DEFAULT_ROOM;
  mounted = api;
  return api;
}

/** The mounted world, or null before boot. Never throws; callers may skip it. */
export function getAtmosphere(): Atmosphere | null {
  return mounted;
}
