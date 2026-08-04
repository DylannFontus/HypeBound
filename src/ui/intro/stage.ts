/**
 * The room both opening cinematics are filmed in.
 *
 * There is one stage, not two. The first-run title and the returning sting are
 * the same set with the same lights, the same haze, the same out-of-focus city
 * and the same brand lockup; the only difference between them is which beats
 * fire and how long the camera lingers. That is deliberate and it is the whole
 * reason a five-second title and a one-second sting feel like the same game
 * rather than two videos that happen to share a logo — and it is also why the
 * short one can afford to be good, because it inherits a set somebody spent the
 * effort on.
 *
 * ## It is three.js because a title card is a lit object, not a rectangle
 *
 * CSS can fade a PNG in. It cannot put that PNG *inside* a volume: light shafts
 * passing in front of it and behind it, a defocused bokeh field with real
 * perspective parallax, a reflection on a floor that is not there, a shockwave
 * that expands through the haze. Every one of those is a plane in a frustum
 * here, and together they are the four resolvable depth planes AAA bar §2 asks
 * for — atmosphere (wash, far bokeh), midground (shafts, haze), content (the
 * lockup), overlay (streak, flash, vignette, grain).
 *
 * ## Nothing is depth-tested, and everything has a `renderOrder`
 *
 * This is a 2.5D composite: about thirty transparent quads that must stack in
 * one known order. Depth testing on transparent geometry gives you sorting by
 * centroid distance, which is *nearly* the order you wanted and flips the moment
 * the camera dollies past a boundary. So depth is off everywhere and the stack
 * is stated once, as integers, in `ORDER`. It reads like a layers panel because
 * that is exactly what it is.
 *
 * ## The wipe and the sheen are the same mechanism
 *
 * The wordmark does not fade in; it is *revealed*, along a 45° axis taken from
 * the light rig, by a clipping plane — and the additive copy clipped to a narrow
 * band just behind that plane is the light riding the edge of the reveal. When
 * the wipe finishes, the same band detaches and crawls slowly across the glyphs
 * as the idle specular (§3: "idle is never dead"). One construct, two jobs, and
 * the sheen is exactly on the letterforms rather than a bar floating over them,
 * because a clipping plane clips the artwork's own alpha.
 *
 * ## Layout is solved from the frustum, not from pixels
 *
 * Every size below is a fraction of the *world* rectangle the camera frames at
 * the lockup's depth, and it takes the smaller of a width-derived and a
 * height-derived bound. That is what makes the same composition work at 1600×900
 * and at 844×390 landscape — on the phone the height bound wins and the lockup
 * gets smaller rather than getting cropped, which is the failure mode a
 * pixel-sized title card has on every short viewport.
 *
 * ## The whole set is one `apply()` per frame
 *
 * The timelines never touch three.js. They write numbers into an {@link
 * IntroLook} and this file turns that into transforms, opacities and clip
 * constants. That is what lets the reduced-motion path be one `seek()` and one
 * `apply()` with no frame loop at all, and it is what keeps the two cinematics
 * from quietly growing two different ideas of what "the mark is at rest" means.
 */

import * as THREE from "three";
import { LIGHT_RIG } from "../art/texture";
import { ROOMS, type AtmosphereRoom } from "../atmosphere";
import {
  artworkTexture,
  beamTexture,
  bloomOf,
  bokehTexture,
  cityTexture,
  crowdTexture,
  disposeIntroTextures,
  reflectionTexture,
  flashTexture,
  grainTexture,
  hazeTexture,
  nightlifeColour,
  ringTexture,
  streakTexture,
  vignetteTexture,
  washTexture,
  type BrandSource,
  type CitySpec,
} from "./textures";

// ---------------------------------------------------------------------------
// the dials the cinematics turn
// ---------------------------------------------------------------------------

/**
 * Everything a beat is allowed to change, as plain numbers.
 *
 * Plain numbers rather than method calls because a timeline composes: two beats
 * may both be writing `markScale` on the same frame and the later one has to
 * win cleanly, which it does when the value is a field and does not when it is
 * an animation somebody started.
 */
export interface IntroLook {
  /** Opacity of the opaque room backdrop. 0 lets the live game show through. */
  wash: number;
  /**
   * The skyline and the wet street under it — the only hard-edged thing in the
   * frame, and therefore the only thing that says where the camera is standing.
   */
  city: number;
  /** The out-of-focus crowd along the bottom edge. The foreground plane. */
  crowd: number;
  /** Master brightness of the defocused city. */
  bokeh: number;
  /** Per-shaft intensity. Five entries; the low tier only reads the first three. */
  beams: number[];
  /** Volumetric haze density. */
  haze: number;
  /** Camera distance added to the rest framing, in world units. Negative pushes in. */
  dolly: number;
  /**
   * How far the camera rises toward the badge: 0 frames the whole lockup, 1
   * centres the badge.
   *
   * It exists because a push-in aimed at the origin is not a push-in *through*
   * anything — the mark stands above centre so that the wordmark and its
   * reflection have room, and diving at the origin therefore sends the badge out
   * of the top of the frame rather than past the lens. The camera has to look at
   * the thing it is flying through.
   */
  lift: number;
  /** Camera shake amplitude in world units. */
  shake: number;

  markOpacity: number;
  /** Multiplier on the resting size. */
  markScale: number;
  /**
   * Vertical offset from the resting position, in **mark heights**.
   *
   * Not world units. A cinematic that says "the mark starts 1.4 of its own
   * heights above where it lands" reads the same on a 1600×900 desktop and on a
   * 844×390 phone, where the mark is less than half the size; the same offset in
   * world units would be a gentle settle on one and a fall from off-screen on
   * the other.
   */
  markRise: number;
  /** Offset toward the camera, in world units. */
  markPush: number;
  /** Radians. A few degrees is a landing; more is a spin. */
  markTilt: number;
  /** Strength of the additive halo around the mark. */
  markGlow: number;

  wordOpacity: number;
  wordScale: number;
  /** Vertical offset, in mark heights — same unit as `markRise`. */
  wordRise: number;
  wordGlow: number;
  /** 0 = nothing revealed, 1 = fully revealed, along the 45° light axis. */
  wipe: number;

  /** Where the specular band sits along the same axis, 0–1. */
  sheen: number;
  sheenOpacity: number;

  /** Reflection strength on the floor under the lockup. */
  reflection: number;

  /**
   * How far the lockup has travelled to its handover position, 0–1.
   *
   * Only the returning sting uses it. See `StageOptions.dockTarget`.
   */
  dock: number;

  /** Shockwave radius as a multiple of its resting size. */
  ring: number;
  ringOpacity: number;

  /** Anamorphic streak width, 0–1 of its full span. */
  streak: number;
  streakOpacity: number;

  flash: number;
  vignette: number;
  grain: number;
  /** Master fade for the whole picture — the handoff into the game. */
  master: number;
}

export function restingLook(): IntroLook {
  return {
    wash: 0,
    city: 0,
    crowd: 0,
    bokeh: 0,
    beams: [0, 0, 0, 0, 0],
    haze: 0,
    dolly: 0,
    lift: 0,
    shake: 0,
    markOpacity: 0,
    markScale: 1,
    markRise: 0,
    markPush: 0,
    markTilt: 0,
    markGlow: 0,
    wordOpacity: 0,
    wordScale: 1,
    wordRise: 0,
    wordGlow: 0,
    wipe: 0,
    sheen: -1,
    sheenOpacity: 0,
    reflection: 0,
    dock: 0,
    ring: 0,
    ringOpacity: 0,
    streak: 0,
    streakOpacity: 0,
    flash: 0,
    vignette: 0,
    grain: 0,
    master: 1,
  };
}

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

/**
 * A long lens, and the reason it is not a wide one.
 *
 * 38° flattens the perspective, which is what a title card wants: a wide lens
 * puts visible convergence on the light shafts and makes the bokeh field rush
 * past during the push-in like a screensaver. The parallax that is left over at
 * 38° is the amount a slow dolly on a real set gives you.
 */
const FOV = 38;
/** Distance from the lockup plane at rest. */
const CAM_Z = 26;

/** The stacking order. Read it top to bottom as back to front. */
const ORDER = {
  wash: 0,
  cityFar: 1,
  cityFarWet: 2,
  hazeFar: 4,
  cityNear: 5,
  cityNearWet: 6,
  bokehFar: 8,
  beams: 12,
  hazeMid: 16,
  bokehNear: 20,
  floor: 24,
  reflection: 26,
  /**
   * The crowd is in front of the floor and behind the impact.
   *
   * In front of the reflection because a foreground plane that the logo's own
   * reflection is drawn *over* is not a foreground plane; behind the shockwave
   * and the flash because those are light in the air between the camera and
   * everything, including the people.
   */
  crowd: 28,
  ring: 30,
  /**
   * The impact bloom sits *behind* the lockup, not over it.
   *
   * It started in front, as a lens flash, and photographed badly for a reason
   * worth writing down: at the peak of the impact the mark was inside the
   * blow-out rather than in front of it, so the one frame the whole sequence
   * builds to had no logo in it. Light thrown *by* the landing belongs behind
   * the thing that landed — the mark silhouettes against it and reads at its
   * hardest exactly when the frame is brightest. The anamorphic streak stays in
   * front, because that one genuinely is an artefact of the lens.
   */
  flash: 32,
  markGlowWide: 34,
  markGlowTight: 35,
  mark: 36,
  markSheen: 37,
  wordGlowWide: 40,
  wordGlowTight: 41,
  word: 42,
  wordSheen: 43,
  streak: 48,
  vignette: 52,
  grain: 54,
} as const;

/**
 * The reveal and sheen axis: perpendicular to the key light, in screen space.
 *
 * The key is at 315°, so its screen-space direction is up-left; the axis at
 * right angles to it runs up-right, and a highlight that travels along it is a
 * highlight raking across a surface lit from the upper left. Derived rather than
 * typed as `(0.707, 0.707)` because the whole point of `LIGHT_RIG` is that there
 * is one number for this and nobody re-types it.
 */
const SHEEN_AXIS = new THREE.Vector3(-LIGHT_RIG.screen.y, -LIGHT_RIG.screen.x, 0).normalize();

/**
 * The horizon, in world units at the lockup plane.
 *
 * `HORIZON` is where the backdrop paints the far edge of the floor, as a
 * fraction down the frame; this is the same line as a `y` the scene can stand
 * things on. It has to be a world number as well as a texture fraction because
 * the lockup, its reflection and the whole city are positioned against it, and
 * a logo standing a few pixels below its own horizon is the sort of mistake
 * nobody can name and everybody sees.
 *
 * It is constant across viewports: `viewAt(d).h` depends on the field of view
 * and the distance, never on the aspect ratio, so the horizon sits at the same
 * world height on a 1600×900 desktop and on an 844×390 phone.
 */
const HORIZON_FRACTION = 0.5 - 0.7;
/** The same line at the depths the bokeh field lives at, scaled by its spread. */
const HORIZON_DEEP = -3.9;

export type IntroTier = "high" | "medium" | "low";

export interface StageOptions {
  tier: IntroTier;
  /** Which of `atmosphere.ts`'s rooms this cinematic is lit by. */
  room: AtmosphereRoom;
  /**
   * How big the lockup is, as a multiple of the title's own size.
   *
   * The two cinematics want genuinely different answers and it is not a matter
   * of taste. The title owns the screen, so the lockup is the composition. The
   * sting plays *over a live lobby* — photographed at full size it covered the
   * PLAY button and four nav tiles, which is a logo obstructing a menu rather
   * than a sign coming on in a room. At 0.62 it sits in the space the lobby
   * leaves and the player can still see where everything is.
   */
  lockupScale?: number;
  /**
   * `horizon` stands the lockup on the floor line so it has something to cast a
   * reflection onto; `centre` floats it. The sting uses `centre` because it has
   * almost no wash and therefore no visible floor to stand on — a reflection
   * with nothing under it is a second logo hanging in a menu.
   */
  lockupAnchor?: "horizon" | "centre";
  /**
   * Where the lockup is handed over to the running game, in CSS pixels.
   *
   * This is §3a's shared-element rule applied to the one place in HYPEBOUND
   * where it has the largest possible payoff. The lobby wears the wordmark in
   * its header rail; the sting draws the same wordmark, enormous, in the middle
   * of the screen. Two copies of one object, one of which blinks out of
   * existence while the other is already there — which is precisely the thing
   * §3a says must not happen when two screens contain the same object.
   *
   * So the sting does not disperse. It flies the wordmark to the header,
   * shrinking it to exactly the size the header draws it at, and lets go. The
   * player's own wordmark is underneath the whole time at full opacity, so the
   * handover is a crossfade between two identical bitmaps in the same place —
   * there is no frame in which the brand is anywhere but where it belongs, and
   * the sting stops being a video that ends and becomes the game arriving.
   *
   * A function rather than a rect because the destination does not exist yet
   * when the stage is built: the sting mounts inside `boot()`, before the router
   * has put a lobby on screen. It is resolved the first frame the dock is
   * actually needed, which is six hundred milliseconds later.
   *
   * Returning `null` — no header wordmark on this viewport, or the asset never
   * loaded — is expected and handled. The fallback flies to where a header
   * wordmark would be, which is a coherent exit on its own: the sign goes up on
   * the wall rather than evaporating.
   */
  dockTarget?: () => { x: number; y: number; width: number } | null;
}

export interface IntroStage {
  readonly canvas: HTMLCanvasElement;
  /**
   * Hand the badge to the set. Idempotent; safe at any point.
   *
   * The artwork arrives *after* the stage, and that is the whole reason this is
   * a method rather than a constructor argument. The two brand PNGs are 2.4 MB
   * between them and, measured off the dev server on a cold load, take 1.6s and
   * 2.2s to arrive — so a stage that could not be built without them meant the
   * first thing a new player saw was two seconds of black. The room needs no
   * artwork at all: it can light itself, ignite its rig and start its camera
   * move while the logo is still on the wire, and `index.ts` stalls the
   * *sequence clock* at the moment the mark is due rather than stalling the
   * whole picture from the beginning.
   */
  setMark(source: BrandSource): void;
  setWordmark(source: BrandSource): void;
  hasMark(): boolean;
  hasWordmark(): boolean;
  /** Write a composition onto the set and draw it. `elapsed` drives idle life. */
  apply(look: IntroLook, elapsed: number): void;
  resize(): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// small builders
// ---------------------------------------------------------------------------

const UNIT = new THREE.PlaneGeometry(1, 1);

interface QuadOptions {
  texture: THREE.Texture | null;
  order: number;
  additive?: boolean;
  colour?: THREE.Color;
  clip?: THREE.Plane[];
}

/**
 * A plane that accepts everything, so a material with nothing to clip can still
 * carry two clipping planes.
 *
 * That sounds like a waste and it is the single biggest performance decision in
 * this file. `NUM_CLIPPING_PLANES` is a **shader define**: three.js compiles a
 * separate program for every distinct plane count, and this set naturally wants
 * three of them (none for the room, one for the wipe, two for the sheen band).
 * Measured on this page, the first frame of the cinematic costs roughly sixty
 * milliseconds of shader compilation *per program* — so three variants was ~180ms
 * of blocked main thread, on top of everything else, at the exact moment a
 * returning player's lobby is on screen and expecting to be clicked.
 *
 * Giving every mesh exactly two planes collapses all of them into one program.
 * The cost is two dot products per fragment on quads that do not need them,
 * which is nothing on any GPU that can run this game at all.
 */
const ACCEPT_ALL = new THREE.Plane(new THREE.Vector3(0, 0, 1), 1e6);

function quad(options: QuadOptions): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const clip = options.clip ?? [];
  const material = new THREE.MeshBasicMaterial({
    map: options.texture,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    clippingPlanes: [clip[0] ?? ACCEPT_ALL, clip[1] ?? ACCEPT_ALL],
    ...(options.additive ? { blending: THREE.AdditiveBlending } : {}),
    ...(options.colour ? { color: options.colour } : {}),
  });
  const mesh = new THREE.Mesh(UNIT, material);
  mesh.renderOrder = options.order;
  mesh.frustumCulled = false;
  return mesh;
}

const setOpacity = (mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>, value: number): void => {
  const clamped = value <= 0 ? 0 : value >= 1 ? 1 : value;
  mesh.material.opacity = clamped;
  mesh.visible = clamped > 0.001;
};

// ---------------------------------------------------------------------------
// the stage
// ---------------------------------------------------------------------------

export function createIntroStage(host: HTMLElement, options: StageOptions): IntroStage | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: options.tier !== "low",
      powerPreference: "high-performance",
    });
  } catch {
    // No WebGL. The caller drops the cinematic entirely rather than showing a
    // black rectangle where the title was meant to be.
    return null;
  }

  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  /**
   * No tone mapping, and that is a choice rather than an omission.
   *
   * ACES would roll the highlights off the brand mark — which is the one object
   * on screen whose colour is not ours to reinterpret. The wordmark's white-to-
   * magenta ramp and the badge's violet-to-pink are the brand, and a filmic
   * curve desaturates exactly the part of them that matters. The blow-outs that
   * tone mapping usually exists to control are all in additive layers here, and
   * they are authored at the alpha that looks right rather than clipped back
   * from something hotter.
   */
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.localClippingEnabled = true;
  /**
   * Do not block on the driver linking a shader.
   *
   * three.js asks the driver for `LINK_STATUS` immediately after linking, which
   * is a *synchronous* stall until ANGLE has translated the GLSL to HLSL and
   * D3D has compiled it — and it is by far the largest single cost in bringing
   * this set up. Every material here is a stock `MeshBasicMaterial` or
   * `PointsMaterial` with no custom shader, so there is no shader of ours that
   * could fail to compile; the check is buying an error report for code nobody
   * here wrote. With it off, three defers the status query and the link overlaps
   * the rest of the build instead of holding it up.
   */
  renderer.debug.checkShaderErrors = false;
  renderer.domElement.className = "hb-intro-canvas";

  const maxDpr = options.tier === "low" ? 1 : options.tier === "medium" ? 1.5 : 2;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.1, 200);
  scene.add(camera);

  host.appendChild(renderer.domElement);

  // --- the artwork, and the light it throws ---------------------------------

  /**
   * The masters' aspect ratios, so the set can be laid out before the artwork
   * lands and does not jump when it does.
   *
   * `data/asset-manifest.json` records them as 2048×2048 and 3072×1024 and they
   * are overwritten from the real bitmap the moment it arrives — these exist
   * only so that the first frame of the room already reserves the right shape,
   * and a wrong guess costs one silent relayout rather than a visible reflow.
   */
  let markAspect = 1;
  let wordAspect = 3;
  let markBloomScale = 1;
  let markGlowScale = 1;
  let wordBloomScale = 1;
  let wordGlowScale = 1;
  let reflectionScale = 1;
  let markLive = false;
  let wordLive = false;

  // --- clip planes ----------------------------------------------------------

  /** The reveal edge: everything behind it along `SHEEN_AXIS` is drawn. */
  const wipePlane = new THREE.Plane(SHEEN_AXIS.clone().negate(), 0);
  /**
   * The specular band, as three nested half-space pairs rather than one.
   *
   * A clipping plane has no soft edge — it is a discard — so a single band draws
   * a highlight with a hard line down both sides of it, and photographed at the
   * moment of the reveal that hard line is the one thing on screen that could
   * not have been painted by a person. Three bands of increasing width and
   * decreasing weight stack into a stepped ramp behind the leading edge: 1.0,
   * 0.58, 0.28, 0.
   *
   * Stepped rather than smooth, and stacked *behind* rather than symmetrically,
   * because that is what the effect actually is. The leading edge is the reveal
   * itself and should be hard; the trailing edge is light falling off a surface
   * and should not be. Three steps is where the banding stops being findable at
   * these opacities, and it costs three extra draws of a quad.
   */
  const SHEEN_STEPS = [
    { span: 1, weight: 0.42 },
    { span: 2, weight: 0.3 },
    { span: 3, weight: 0.28 },
  ] as const;
  const sheenBands = SHEEN_STEPS.map(() => [
    new THREE.Plane(SHEEN_AXIS.clone(), 0),
    new THREE.Plane(SHEEN_AXIS.clone().negate(), 0),
  ]);

  // --- backdrop, parented to the camera so a dolly cannot expose its edge ----

  const wash = quad({ texture: washTexture(ROOMS[options.room]), order: ORDER.wash });
  wash.position.z = -70;
  camera.add(wash);

  const vignette = quad({ texture: vignetteTexture(), order: ORDER.vignette });
  vignette.position.z = -1.6;
  camera.add(vignette);

  const grain = options.tier === "low" ? null : quad({ texture: grainTexture(), order: ORDER.grain });
  if (grain) {
    grain.position.z = -1.4;
    camera.add(grain);
  }

  const flash = quad({ texture: flashTexture(), order: ORDER.flash, additive: true });
  flash.position.z = -1.2;
  camera.add(flash);

  // --- the skyline ----------------------------------------------------------

  /**
   * Two bands at two depths, and the near one is not simply a bigger copy.
   *
   * Parallax alone does not read as distance when both layers have the same
   * statistics — two identical skylines sliding against each other look like a
   * printing error. The far band is many short towers with dense small windows,
   * lifted a long way toward the horizon glow; the near band is a handful of
   * tall blocks, nearly black, with sparse windows and most of the signage. That
   * is what atmospheric perspective does to a city, and it means the two are
   * separable in a still frame as well as in a moving one — which is the test
   * §2 actually sets.
   *
   * The low tier gets one band at half the resolution rather than none, and
   * that decision was made with a stopwatch rather than by feel. Generating both
   * bands measures at 5.6ms and 1.9ms on this machine, and the crowd at 1.0ms —
   * against 290–530ms for the WebGL context and its shader links, which is what
   * bringing this set up actually costs. Cutting nine milliseconds to take the
   * *setting* away from the cheapest devices would be a bad trade at any price
   * and is an absurd one at that price: a low-tier player would get the abstract
   * light show that this whole layer exists to replace.
   */
  interface Band {
    mass: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    wet: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    aspect: number;
    wetAspect: number;
    z: number;
    /** Width as a multiple of the frame at that depth. Over 1, for the dolly. */
    span: number;
    weight: number;
    drift: number;
  }
  const bands: Band[] = [];
  {
    const room = ROOMS[options.room];
    /**
     * The sting buys the cheap city, and so does the low tier.
     *
     * Two bands at 2048 are about nine megabytes of texture to upload, and the
     * upload lands inside the ~360ms of cold WebGL start-up that a returning
     * player's lobby is already paying for. The sting shows the skyline
     * multiplied by a wash that peaks at 0.3, over a menu, for half a second —
     * there is no version of that where the far band's window grid is visible
     * to anybody. One band at half the resolution is the same picture and a
     * quarter of the bytes.
     */
    const frugal = options.tier === "low" || (options.lockupAnchor ?? "horizon") !== "horizon";
    const px = frugal ? 1024 : 2048;
    const half = frugal ? 0.5 : 1;
    const bandSpec: Array<{ spec: CitySpec; z: number; span: number; weight: number; drift: number }> = [
      {
        spec: {
          seed: 7,
          px,
          aspect: 10.5,
          towers: 40,
          low: 0.16,
          high: 0.9,
          ink: "#100a26",
          fog: 0.72,
          fogColour: room.rim,
          lit: 0.42,
          cell: 5 * half,
        },
        z: -46,
        span: 1.22,
        weight: 0.8,
        drift: 0.9,
      },
      {
        spec: {
          seed: 41,
          px,
          aspect: 5,
          towers: 16,
          low: 0.14,
          high: 1,
          ink: "#060313",
          fog: 0.22,
          fogColour: room.key,
          lit: 0.24,
          cell: 8 * half,
        },
        z: -30,
        span: 1.3,
        weight: 1,
        drift: 2.2,
      },
      // The near band is the one that survives a cut: it carries the tall
      // silhouettes, the signage and the reflection worth looking at.
    ].slice(frugal ? 1 : 0);
    for (const [index, entry] of bandSpec.entries()) {
      const built = cityTexture(entry.spec);
      if (!built) continue;
      const far = index === 0;
      const mass = quad({ texture: built.mass, order: far ? ORDER.cityFar : ORDER.cityNear });
      const wet = quad({
        texture: built.wet,
        order: far ? ORDER.cityFarWet : ORDER.cityNearWet,
        additive: true,
      });
      mass.position.z = entry.z;
      wet.position.z = entry.z;
      scene.add(mass, wet);
      bands.push({
        mass,
        wet,
        aspect: built.aspect,
        wetAspect: built.wetAspect,
        z: entry.z,
        span: entry.span,
        weight: entry.weight,
        drift: entry.drift,
      });
    }
  }

  // --- the crowd, in front of everything in the room ------------------------

  /**
   * Only the title gets a crowd, and the reason is the sting, not the budget.
   *
   * A one-megapixel canvas of blurred silhouettes costs a millisecond, so every
   * tier can have it. What no tier can have is an opaque black band across the
   * bottom of a *live lobby* — the sting plays over a menu the player is about
   * to click, and darkening the row the nav grid sits in for half a second is
   * the same mistake as covering the PLAY button with a logo. The sting has no
   * floor and no wash to speak of; a foreground plane needs both.
   */
  const crowd =
    (options.lockupAnchor ?? "horizon") !== "horizon"
      ? null
      : quad({ texture: crowdTexture(), order: ORDER.crowd });
  if (crowd) {
    crowd.position.z = -2;
    scene.add(crowd);
  }

  // --- the defocused city ---------------------------------------------------

  /**
   * Three point clouds rather than one, and the reason is depth.
   *
   * `PointsMaterial` has a single size for every vertex in it, so one cloud is
   * one focal plane and reads as confetti. Three at different sizes, depths and
   * drift rates give the parallax and the size gradient a real depth-of-field
   * has — and they can be lit and faded independently, which is what lets the
   * far field come up first and the near field bloom on the impact.
   */
  const bokehMap = bokehTexture();
  interface Cloud {
    points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
    /** Radians per millisecond of the slow orbital drift. */
    drift: number;
    phase: number;
    weight: number;
  }
  const clouds: Cloud[] = [];
  /**
   * `band` is how tightly a cloud hugs the horizon, and it is the difference
   * between a city and a starfield.
   *
   * Lights in a nightlife scene are not distributed evenly through a volume;
   * they are signs, windows and people, and all of those are near the ground.
   * Scattering the field uniformly put as many points above the logo as below
   * it, which reads as space. Squeezing the vertical spread and pushing the
   * centre down to the horizon reads as a street.
   */
  const cloudSpec: Array<{
    count: number;
    size: number;
    z: number;
    spread: number;
    band: number;
    drift: number;
    weight: number;
  }> =
    options.tier === "low"
      ? [{ count: 46, size: 0.9, z: -22, spread: 1.6, band: 0.34, drift: 0.00004, weight: 1 }]
      : options.tier === "medium"
        ? [
            { count: 84, size: 0.5, z: -32, spread: 2, band: 0.3, drift: 0.000024, weight: 0.75 },
            { count: 34, size: 1.3, z: -14, spread: 1.4, band: 0.42, drift: 0.00005, weight: 0.95 },
          ]
        : [
            { count: 112, size: 0.42, z: -36, spread: 2.2, band: 0.26, drift: 0.00002, weight: 0.68 },
            { count: 54, size: 0.9, z: -22, spread: 1.65, band: 0.36, drift: 0.000036, weight: 0.88 },
            { count: 20, size: 2.2, z: -10, spread: 1.3, band: 0.5, drift: 0.00006, weight: 1 },
          ];

  let seed = 0x9e3f;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (const [index, spec] of cloudSpec.entries()) {
    const positions = new Float32Array(spec.count * 3);
    const colours = new Float32Array(spec.count * 3);
    for (let i = 0; i < spec.count; i++) {
      // Two uniforms summed rather than one: a triangular distribution clusters
      // toward the horizon and thins out above it, which is what a city does.
      const vertical = (random() + random() - 1) * spec.band;
      positions[i * 3] = (random() - 0.5) * 96 * spec.spread;
      positions[i * 3 + 1] = HORIZON_DEEP * spec.spread + vertical * 30 * spec.spread;
      positions[i * 3 + 2] = spec.z + (random() - 0.5) * 7;
      const colour = nightlifeColour(Math.floor(random() * 7), random() > 0.72);
      colours[i * 3] = colour.r;
      colours[i * 3 + 1] = colour.g;
      colours[i * 3 + 2] = colour.b;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
    const material = new THREE.PointsMaterial({
      size: spec.size,
      map: bokehMap,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      toneMapped: false,
    });
    const points = new THREE.Points(geometry, material);
    points.renderOrder = index === cloudSpec.length - 1 ? ORDER.bokehNear : ORDER.bokehFar;
    points.frustumCulled = false;
    scene.add(points);
    clouds.push({ points, drift: spec.drift, phase: index * 2.1, weight: spec.weight });
  }

  // --- the rig --------------------------------------------------------------

  /**
   * Five shafts, all raking along the key-light axis.
   *
   * They are not parallel to each other by a degree or two, and they are not
   * evenly spaced. Both are on purpose: a fan of perfectly parallel, evenly
   * pitched beams is a pattern, and the eye finds a pattern and stops looking.
   */
  const beamMap = beamTexture();
  const beamAngle = Math.atan2(-LIGHT_RIG.screen.x, -LIGHT_RIG.screen.y);
  const beamCount = options.tier === "low" ? 3 : 5;
  /**
   * Widths in the hundredths rather than the tenths.
   *
   * The first pass ran these at 0.045–0.13 of the frame width and the shafts
   * photographed as bands of cloud across the whole picture — at that width a
   * beam has no silhouette, only a gradient, and five of them average out into a
   * nebula. A stage light in smoke is a *narrow* thing with a hot centre; the
   * volume it appears to have comes from being narrow and bright next to
   * something dark, not from being wide.
   */
  const beamSpec = [
    { x: -0.3, tilt: 0.02, width: 0.05, z: -16, tint: 6, gain: 1 },
    { x: -0.06, tilt: -0.05, width: 0.032, z: -11, tint: 0, gain: 0.9 },
    { x: 0.27, tilt: 0.07, width: 0.07, z: -19, tint: 3, gain: 0.66 },
    { x: 0.45, tilt: -0.03, width: 0.026, z: -7, tint: 1, gain: 1 },
    { x: -0.5, tilt: 0.1, width: 0.04, z: -13, tint: 2, gain: 0.6 },
  ];
  const beams: Array<{
    mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    gain: number;
    phase: number;
  }> = [];
  for (let i = 0; i < beamCount; i++) {
    const spec = beamSpec[i]!;
    const mesh = quad({
      texture: beamMap,
      order: ORDER.beams,
      additive: true,
      // The key shaft is warm white — the rig's own lamp. The rest are the
      // room's coloured wash catching the smoke.
      colour: i === 1 ? new THREE.Color(0xfff2e4) : nightlifeColour(spec.tint),
    });
    mesh.rotation.z = beamAngle + spec.tilt;
    mesh.position.z = spec.z;
    scene.add(mesh);
    beams.push({ mesh, gain: spec.gain, phase: i * 1.7 });
  }

  // --- haze -----------------------------------------------------------------

  const hazeMap = hazeTexture();
  const hazeSpec =
    options.tier === "low"
      ? [{ x: -0.18, y: 0.1, size: 1.5, z: -22, tint: 0, order: ORDER.hazeFar }]
      : [
          { x: -0.24, y: 0.16, size: 1.7, z: -26, tint: 0, order: ORDER.hazeFar },
          { x: 0.3, y: -0.12, size: 1.35, z: -15, tint: 2, order: ORDER.hazeFar },
          { x: 0.05, y: -0.3, size: 1.1, z: -6, tint: 3, order: ORDER.hazeMid },
        ];
  const hazes = hazeSpec.map((spec, index) => {
    const mesh = quad({
      texture: hazeMap,
      order: spec.order,
      additive: true,
      colour: nightlifeColour(spec.tint),
    });
    mesh.position.z = spec.z;
    scene.add(mesh);
    return { mesh, spec, phase: index * 2.9 };
  });

  // --- the floor ------------------------------------------------------------

  const streakMap = streakTexture();
  /** The wet-floor highlight the lockup stands on. */
  const floor = quad({ texture: streakMap, order: ORDER.floor, additive: true, colour: nightlifeColour(0) });
  scene.add(floor);

  const reflection = quad({ texture: null, order: ORDER.reflection, clip: [wipePlane] });
  scene.add(reflection);

  // --- the lockup -----------------------------------------------------------

  const markGroup = new THREE.Group();
  scene.add(markGroup);
  const markGlowWide = quad({ texture: null, order: ORDER.markGlowWide, additive: true });
  const markGlowTight = quad({ texture: null, order: ORDER.markGlowTight, additive: true });
  const mark = quad({ texture: null, order: ORDER.mark });
  const markSheens = sheenBands.map((clip) =>
    quad({ texture: null, order: ORDER.markSheen, additive: true, clip })
  );
  markGroup.add(markGlowWide, markGlowTight, mark, ...markSheens);

  const wordGroup = new THREE.Group();
  scene.add(wordGroup);
  const wordGlowWide = quad({ texture: null, order: ORDER.wordGlowWide, additive: true, clip: [wipePlane] });
  const wordGlowTight = quad({ texture: null, order: ORDER.wordGlowTight, additive: true, clip: [wipePlane] });
  const word = quad({ texture: null, order: ORDER.word, clip: [wipePlane] });
  const wordSheens = sheenBands.map((clip) =>
    quad({ texture: null, order: ORDER.wordSheen, additive: true, clip })
  );
  wordGroup.add(wordGlowWide, wordGlowTight, word, ...wordSheens);

  // --- impact furniture -----------------------------------------------------

  const ring = quad({ texture: ringTexture(), order: ORDER.ring, additive: true, colour: nightlifeColour(1, true) });
  scene.add(ring);

  const streak = quad({ texture: streakMap, order: ORDER.streak, additive: true });
  scene.add(streak);

  // ---------------------------------------------------------------------------
  // layout
  // ---------------------------------------------------------------------------

  /** World size of the frame at a given distance in front of the lens. */
  function viewAt(distance: number): { w: number; h: number } {
    const h = 2 * distance * Math.tan(((FOV / 2) * Math.PI) / 180);
    return { h, w: h * camera.aspect };
  }

  let frame = { w: 40, h: 22 };
  let markH = 6;
  let wordW = 20;
  let markRestY = 4;
  let wordRestY = -2;
  /** Extent of the wordmark along the sheen axis, for the wipe and the band. */
  let sheenMin = -10;
  let sheenMax = 10;
  let sheenSpan = 20;

  function layout(): void {
    const rect = host.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || host.clientWidth || 1));
    const height = Math.max(1, Math.round(rect.height || host.clientHeight || 1));

    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, maxDpr));
    renderer.setSize(width, height, false);

    frame = viewAt(CAM_Z);

    /**
     * Both bounds, smaller wins.
     *
     * A phone in landscape is 844×390: wide and very short. Sizing the mark off
     * the width alone puts it through the top and bottom of the frame; sizing it
     * off the height alone leaves a 1600×900 desktop with a stamp in the middle
     * of an empty screen. Taking the minimum of the two is what makes one
     * composition survive both, and it is why the phone gets a smaller lockup
     * rather than a cropped one.
     */
    const lockupScale = options.lockupScale ?? 1;
    markH = Math.min(frame.h * 0.31, frame.w * 0.175) * lockupScale;
    wordW = Math.min(frame.w * 0.43, frame.h * 1.22) * lockupScale;
    const wordH = wordW / wordAspect;
    const markW = markH * markAspect;

    const gap = markH * 0.14;
    /**
     * The title's lockup stands *on* the horizon rather than being centred.
     *
     * Centring it is what a slide deck does. Standing it on the line where the
     * floor meets the room is what gives it a reflection to cast, puts the empty
     * space above it rather than around it, and means the composition has a
     * subject and a ground instead of an object in a field.
     */
    const horizonY = frame.h * HORIZON_FRACTION;
    if ((options.lockupAnchor ?? "horizon") === "horizon") {
      wordRestY = horizonY + frame.h * 0.012 + wordH / 2;
      markRestY = wordRestY + wordH / 2 + gap + markH / 2;
    } else {
      const total = markH + gap + wordH;
      /**
       * A little above centre, because of what is *behind* it.
       *
       * The lobby's densest region is the nine-tile nav grid in the lower
       * middle; the band above it is one wide PLAY button and one deck row.
       * Sitting the sting over the wide elements rather than over the grid
       * means the half-second the lockup is on screen does not read as nine
       * labels being crossed out.
       *
       * Measured against the real lobby rather than guessed. At 0.1 the
       * wordmark's centre landed on the exact row the nav labels sit on and
       * struck through "Collection", "Deck Builder" and "Merch Drops"; at 0.19
       * it sits over the active-deck row, where the only thing behind it is one
       * line of type it is wider than.
       */
      const middle = frame.h * 0.19;
      markRestY = middle + total / 2 - markH / 2;
      wordRestY = middle - total / 2 + wordH / 2;
    }

    mark.scale.set(markW, markH, 1);
    for (const sheen of markSheens) sheen.scale.copy(mark.scale);
    markGlowTight.scale.set(markW * markBloomScale, markH * markBloomScale, 1);
    markGlowWide.scale.set(markW * markGlowScale, markH * markGlowScale, 1);

    word.scale.set(wordW, wordH, 1);
    for (const sheen of wordSheens) sheen.scale.copy(word.scale);
    wordGlowTight.scale.set(wordW * wordBloomScale, wordH * wordBloomScale, 1);
    wordGlowWide.scale.set(wordW * wordGlowScale, wordH * wordGlowScale, 1);

    /**
     * The reflection is squashed to 62% and starts a hair below the horizon.
     *
     * A mirror-exact copy is a mirror, and a mirror is a mistake here: the floor
     * is being seen at a glancing angle, so the reflection is foreshortened, and
     * the small gap between an object and its reflection is the thing that says
     * the surface is *under* the object rather than being a second copy of it.
     */
    reflection.scale.set(wordW * reflectionScale, wordH * 0.62 * reflectionScale, 1);
    reflection.position.set(0, horizonY - wordH * 0.31 * reflectionScale - frame.h * 0.004, 0.01);
    floor.scale.set(frame.w * 1.3, wordH * 1.1, 1);
    floor.position.set(0, horizonY, -0.4);

    ring.scale.set(markH * 3.2, markH * 3.2, 1);
    streak.position.set(0, markRestY, 0.3);

    for (const [index, beam] of beams.entries()) {
      const view = viewAt(CAM_Z - beam.mesh.position.z);
      const spec = beamSpec[index]!;
      const length = Math.hypot(view.w, view.h) * 1.5;
      beam.mesh.scale.set(view.w * spec.width * 3, length, 1);
      beam.mesh.position.x = view.w * spec.x;
      // Sourced above the frame and raking down across the horizon, which is
      // where a rig hangs and where the smoke it is lighting actually is.
      beam.mesh.position.y = view.h * 0.16;
    }

    /**
     * The skyline stands *on* the horizon and the street hangs off the same
     * line, both sized from the frame at their own depth.
     *
     * The line is `HORIZON_FRACTION` of the frame height at that depth, which is
     * the same screen position at every depth and therefore the same line for
     * the wash, the lockup, the reflection and both bands. That agreement is the
     * whole reason the composition holds together: a skyline whose base is nine
     * pixels off the floor the logo is standing on is a collage.
     */
    for (const band of bands) {
      const view = viewAt(CAM_Z - band.z);
      const width = view.w * band.span;
      const height = width / band.aspect;
      const line = view.h * HORIZON_FRACTION;
      band.mass.scale.set(width, height, 1);
      band.mass.position.y = line + height / 2;
      const wetHeight = width / band.wetAspect;
      band.wet.scale.set(width, wetHeight, 1);
      band.wet.position.y = line - wetHeight / 2;
    }

    if (crowd) {
      const view = viewAt(CAM_Z - crowd.position.z);
      /**
       * Anchored to the bottom edge rather than to the horizon, because that is
       * what a foreground is: it is where the camera is, not where the subject
       * is. Sized off the frame height so a phone in landscape — which is short
       * — gets proportionally the same band of heads rather than a wall of them.
       */
      const height = view.h * 0.145;
      crowd.scale.set(view.w * 1.15, height, 1);
      crowd.position.y = -view.h / 2 + height * 0.42;
    }

    for (const haze of hazes) {
      const view = viewAt(CAM_Z - haze.mesh.position.z);
      const size = Math.max(view.w, view.h) * haze.spec.size;
      haze.mesh.scale.set(size, size, 1);
      haze.mesh.position.x = view.w * haze.spec.x;
      haze.mesh.position.y = view.h * haze.spec.y;
    }

    /**
     * Camera-parented plates, sized to their own depth and *not* overscanned.
     *
     * Overscan is what stops a world-space backdrop showing its edge when the
     * camera moves; these four are children of the camera and cannot move
     * relative to it, so there is nothing to protect against — and 4% of
     * overscan on the wash would put its painted horizon 1% down the frame from
     * where `HORIZON_FRACTION` says the scene's horizon is. One percent of a
     * 900px frame is nine pixels of the lockup standing off its own floor.
     */
    for (const [plate, depth] of [
      [wash, 70],
      [vignette, 1.6],
      [flash, 1.2],
      ...(grain ? ([[grain, 1.4]] as Array<[typeof wash, number]>) : []),
    ] as Array<[typeof wash, number]>) {
      const view = viewAt(depth);
      plate.scale.set(view.w, view.h, 1);
    }

    /**
     * One grain cell per device pixel.
     *
     * The tile is 128 texels; anything other than `pixels / 128` resamples it,
     * and resampled noise is not grain — stretched it becomes visible clumps and
     * squeezed it becomes a moiré against the display grid. This is the same
     * mistake `texture.ts` documents having made with `--tex-grain-fine`, which
     * was a 128px tile displayed at 64 and was therefore twice as loud on every
     * retina screen.
     */
    if (grain?.material.map) {
      const dpr = renderer.getPixelRatio();
      grain.material.map.repeat.set((width * dpr) / 128, (height * dpr) / 128);
    }

    /**
     * Where the wordmark starts and ends along the reveal axis.
     *
     * Projecting all four corners rather than assuming the extremes are two of
     * them: the axis is diagonal, so which corner is furthest depends on the
     * aspect ratio of the artwork, and getting it wrong leaves a sliver of the
     * word already visible at `wipe = 0`.
     */
    const half = new THREE.Vector3(wordW / 2, wordH / 2, 0);
    const centreVec = new THREE.Vector3(0, wordRestY, 0);
    let min = Infinity;
    let max = -Infinity;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const corner = new THREE.Vector3(centreVec.x + sx * half.x, centreVec.y + sy * half.y, 0);
        const projection = corner.dot(SHEEN_AXIS);
        min = Math.min(min, projection);
        max = Math.max(max, projection);
      }
    }
    sheenMin = min;
    sheenMax = max;
    sheenSpan = max - min;
  }

  layout();

  // ---------------------------------------------------------------------------
  // artwork, whenever it turns up
  // ---------------------------------------------------------------------------

  const attach = (
    mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>,
    texture: THREE.Texture | null
  ): void => {
    mesh.material.map = texture;
    // A material going from no map to a map changes its shader program, and
    // three.js only recompiles when it is told to.
    mesh.material.needsUpdate = true;
  };

  function setMark(source: BrandSource): void {
    if (markLive) return;
    const map = artworkTexture(source);
    attach(mark, map);
    for (const sheen of markSheens) attach(sheen, map);
    const tight = bloomOf(source, 0.012);
    const wide = bloomOf(source, 0.05);
    attach(markGlowTight, tight?.texture ?? null);
    attach(markGlowWide, wide?.texture ?? null);
    markBloomScale = tight?.scale ?? 1;
    markGlowScale = wide?.scale ?? 1;
    markAspect = source.width / source.height;
    markLive = true;
    layout();
  }

  function setWordmark(source: BrandSource): void {
    if (wordLive) return;
    const map = artworkTexture(source);
    attach(word, map);
    for (const sheen of wordSheens) attach(sheen, map);
    /**
     * The reflection is a *blurred* copy, flipped, with the fade baked in.
     *
     * A sharp mirror is the version that gets built first and it is always
     * wrong: at full resolution the reflection is as legible as the wordmark
     * and the eye reads two logos rather than one logo on a floor. Real
     * reflections in a wet surface are scattered — the roughness of the ground
     * blurs them, more the further from the object they get.
     */
    const smear = reflectionTexture(source, 0.008);
    attach(reflection, smear?.texture ?? map);
    reflectionScale = smear?.scale ?? 1;
    const tight = bloomOf(source, 0.01);
    const wide = bloomOf(source, 0.038);
    attach(wordGlowTight, tight?.texture ?? null);
    attach(wordGlowWide, wide?.texture ?? null);
    wordBloomScale = tight?.scale ?? 1;
    wordGlowScale = wide?.scale ?? 1;
    wordAspect = source.width / source.height;
    wordLive = true;
    layout();
  }

  // ---------------------------------------------------------------------------
  // per-frame
  // ---------------------------------------------------------------------------

  const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);
  const mix = (a: number, b: number, k: number): number => a + (b - a) * k;

  /**
   * The handover position, resolved once and then frozen.
   *
   * Once, because it is read out of the DOM and this is called from inside a
   * frame loop — `getBoundingClientRect` on every frame of a 260ms flight is a
   * forced layout per frame, on the exact frames the lobby is finishing its own
   * entrance. Frozen rather than re-resolved on resize because a viewport change
   * mid-flight is not a case worth a reflow; the sting is over in a quarter of a
   * second.
   */
  /**
   * Stored as fractions of the frame rather than as world units, because the
   * camera has not finished moving.
   *
   * The sting's dolly is still running when the lockup docks, so the world
   * rectangle the lens frames at the lockup's depth is not the one `frame` was
   * solved for — and a two percent error in that rectangle is a two percent
   * error in where the wordmark parks, which at a 92px target is a visible
   * double exposure against the header's own copy. Fractions survive the move;
   * world units do not.
   */
  let dockAt: { fx: number; fy: number; span: number } | null = null;
  function resolveDock(): { fx: number; fy: number; span: number } {
    if (dockAt) return dockAt;
    const target = options.dockTarget?.() ?? null;
    if (!target) {
      // No header wordmark on this viewport. Fly to where one would be.
      dockAt = { fx: 0, fy: 0.4, span: 0.14 };
      return dockAt;
    }
    const rect = host.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    dockAt = {
      fx: (target.x - rect.left) / width - 0.5,
      fy: 0.5 - (target.y - rect.top) / height,
      span: target.width / width,
    };
    return dockAt;
  }

  function apply(look: IntroLook, elapsed: number): void {
    const master = clamp01(look.master);
    const t = elapsed;

    // --- camera -------------------------------------------------------------
    /**
     * A very slow lissajous under everything, at about a fifth of a world unit.
     *
     * Under a 38° lens that is roughly three pixels of travel over ten seconds,
     * which is invisible as movement and unmistakable as life: it means no two
     * frames of a burst capture are ever identical, and it means the light
     * shafts and the bokeh field are always sliding against each other. §3's
     * "idle is never dead" is not satisfied by a screen that only moves when
     * something is happening on it.
     */
    /**
     * The breath is damped out as the lockup docks, and it has to be.
     *
     * A fifth of a world unit is three pixels of drift, which is exactly the
     * point of it — but three pixels is also the entire error budget for parking
     * a 92-pixel wordmark on top of an identical one. A camera that is still
     * wandering cannot land anything precisely, so it settles over the flight
     * and is perfectly still at the moment of the handover. Nobody sees it stop,
     * because by then the only thing on screen is a logo where a logo already
     * is.
     */
    const still = 1 - clamp01(look.dock);
    const breathX = Math.sin(t * 0.00021) * 0.22 * still;
    const breathY = Math.cos(t * 0.00017) * 0.14 * still;
    const shakeX = look.shake > 0 ? Math.sin(t * 0.09) * look.shake : 0;
    const shakeY = look.shake > 0 ? Math.cos(t * 0.113) * look.shake * 0.7 : 0;
    const lift = markRestY * look.lift;
    camera.position.set(breathX + shakeX, breathY + shakeY + lift, CAM_Z + look.dolly);
    camera.lookAt(breathX * 0.4, lift + breathY * 0.4, 0);

    // --- backdrop -----------------------------------------------------------
    setOpacity(wash, look.wash * master);
    setOpacity(vignette, look.vignette * master);
    setOpacity(flash, look.flash * master);
    if (grain) {
      setOpacity(grain, look.grain * master);
      /**
       * The grain jitters by whole texels, once every 55ms.
       *
       * Sub-texel offsets resample the noise and turn it into a soft crawl,
       * which is a completely different artefact — a moving stain rather than
       * film. Whole texels at about eighteen hertz is what a projector does.
       */
      const step = Math.floor(t / 55);
      const texel = 1 / 128;
      grain.material.map?.offset.set(((step * 37) % 128) * texel, ((step * 61) % 128) * texel);
    }

    // --- the place ----------------------------------------------------------
    /**
     * The bands slide, and the near one slides more than twice as far.
     *
     * This is the only motion the skyline has and it is deliberately tiny — a
     * couple of world units over a minute — because it is not meant to be seen
     * as movement. What it is for is the same thing the camera's lissajous is
     * for: two hard-edged layers whose relationship changes mean the frame is
     * never twice the same, and mean a burst capture cannot photograph a dead
     * screen. Wall time drives it, so it keeps going while the sequence clock is
     * stalled waiting for artwork.
     */
    for (const band of bands) {
      const slide = Math.sin(t * 0.000045) * band.drift;
      band.mass.position.x = slide;
      band.wet.position.x = slide;
      const level = look.city * band.weight * master;
      /**
       * The buildings are multiplied by the wash and the reflection is not, and
       * that is physics rather than a fudge.
       *
       * The silhouette is an *occluder* — it is only visible to the extent that
       * there is an opaque room behind it to occlude. The wet street is emitted
       * light, which is visible whether or not anything is drawn behind it. So
       * the title, whose wash goes to 1, gets a full skyline; and the returning
       * sting, whose wash peaks at 0.3 over a live lobby, gets the *lights* of a
       * city with almost none of its mass — which is the correct answer twice
       * over, because a near-black band of towers across a menu the player is
       * about to click is precisely what a logo sting must not do.
       */
      setOpacity(band.mass, level * look.wash);
      // The reflection is dimmer than the source and it shimmers, because water
      // moves. Two slow sines so the period is not findable.
      const shimmer = 0.82 + 0.18 * Math.sin(t * 0.00055 + band.drift) * Math.sin(t * 0.00019);
      setOpacity(band.wet, level * shimmer);
    }
    if (crowd) setOpacity(crowd, look.crowd * master);

    // --- the defocused city -------------------------------------------------
    for (const cloud of clouds) {
      const twinkle = 0.86 + 0.14 * Math.sin(t * 0.0006 + cloud.phase);
      cloud.points.material.opacity = clamp01(look.bokeh * cloud.weight * twinkle) * master;
      cloud.points.visible = cloud.points.material.opacity > 0.002;
      cloud.points.rotation.z = t * cloud.drift;
      cloud.points.position.x = Math.sin(t * cloud.drift * 9 + cloud.phase) * 1.6;
    }

    // --- rig ----------------------------------------------------------------
    for (const [index, beam] of beams.entries()) {
      const breathe = 0.82 + 0.18 * Math.sin(t * 0.00042 + beam.phase);
      setOpacity(beam.mesh, (look.beams[index] ?? 0) * beam.gain * breathe * master);
      beam.mesh.position.x += Math.sin(t * 0.00013 + beam.phase) * 0.004;
    }

    for (const haze of hazes) {
      const breathe = 0.78 + 0.22 * Math.sin(t * 0.00031 + haze.phase);
      setOpacity(haze.mesh, look.haze * breathe * 0.5 * master);
      haze.mesh.rotation.z = Math.sin(t * 0.00007 + haze.phase) * 0.22;
    }

    /*
     * `markLive` and `wordLive` gate every opacity below, because a
     * `MeshBasicMaterial` with no map is a plain white quad — an unattached
     * lockup would draw as two glowing rectangles rather than as nothing.
     */
    /**
     * The flight to the handover, applied to both halves of the lockup.
     *
     * Both, because a badge that stays put while the word flies away is two
     * objects rather than one lockup — the mark converges on the same point and
     * is faded out on the way by the sequence, so what the eye follows is a
     * single thing shrinking into the header.
     */
    const dock = clamp01(look.dock);
    const anchor = dock > 0.001 ? resolveDock() : null;
    /**
     * The target, re-solved against the frame the lens is framing *right now*.
     *
     * `viewAt(CAM_Z + dolly)` rather than the cached `frame`, because the camera
     * is still dollying while the lockup flies. Cheap — one `tan` that is a
     * constant and two multiplies — and it is the difference between the last
     * frame of the sting being a clean handover and being the brand printed
     * twice, three pixels apart, at slightly different sizes.
     */
    const live = dock > 0.001 ? viewAt(CAM_Z + look.dolly) : frame;
    const to = anchor ? { x: anchor.fx * live.w, y: anchor.fy * live.h } : null;
    const dockScale = anchor ? mix(1, (anchor.span * live.w) / Math.max(0.0001, wordW), dock) : 1;

    // --- the mark -----------------------------------------------------------
    const markOn = markLive ? master : 0;
    markGroup.position.set(
      to ? to.x * dock : 0,
      mix(markRestY + look.markRise * markH, to?.y ?? 0, dock),
      look.markPush * (1 - dock)
    );
    markGroup.rotation.z = look.markTilt;
    markGroup.scale.setScalar(look.markScale * dockScale);
    setOpacity(mark, look.markOpacity * markOn);
    setOpacity(markGlowTight, look.markGlow * 0.55 * markOn);
    setOpacity(markGlowWide, look.markGlow * 0.34 * markOn);

    // --- the wordmark -------------------------------------------------------
    const wordOn = wordLive ? master : 0;
    wordGroup.position.set(
      to ? to.x * dock : 0,
      mix(wordRestY + look.wordRise * markH, to?.y ?? 0, dock),
      0
    );
    wordGroup.scale.setScalar(look.wordScale * dockScale);
    setOpacity(word, look.wordOpacity * wordOn);
    setOpacity(wordGlowTight, look.wordGlow * 0.5 * wordOn);
    setOpacity(wordGlowWide, look.wordGlow * 0.3 * wordOn);

    /**
     * The reveal edge, with a margin at both ends.
     *
     * Half a band's worth of overshoot on each side means `wipe = 0` genuinely
     * shows nothing and `wipe = 1` genuinely shows everything, including the
     * soft edge of the glow copies, which extend past the artwork by design.
     */
    const band = sheenSpan * 0.16;
    const edge = sheenMin - band + (sheenSpan + band * 2) * clamp01(look.wipe);
    /**
     * The reveal plane is disarmed the moment the lockup starts travelling.
     *
     * The plane lives in *world* space and its position was solved for the
     * wordmark standing at its resting place. Fly the wordmark up and to the
     * right — which is exactly where a header rail is — and its own leading
     * corner crosses the plane and gets sliced off mid-flight. The wipe has long
     * since finished by then, so the honest statement is "there is nothing left
     * to reveal", and that is what a constant this large says.
     */
    wipePlane.constant = dock > 0.001 ? 1e6 : edge;

    const sheenAt = look.sheen;
    const sheenLive = look.sheenOpacity > 0.002 && sheenAt >= 0;
    /**
     * The stepped falloff. Each pair shares a leading edge and reaches further
     * back than the last, so the three overlap into a ramp rather than three
     * separate stripes.
     *
     * A sheen is also light *on* an object, so every layer is scaled by how
     * present that object is. Without that the band would light the wordmark's
     * glyphs during the impact beat, half a second before the wordmark has been
     * revealed — the artwork is in the scene the whole time, and only its
     * opacity says whether it has arrived.
     */
    const sheenLead = sheenMin - band + (sheenSpan + band * 2) * clamp01(sheenAt);
    const step = band * 0.5;
    for (const [index, planes] of sheenBands.entries()) {
      const weight = SHEEN_STEPS[index]!.weight;
      if (sheenLive) {
        planes[0]!.constant = -(sheenLead - step * SHEEN_STEPS[index]!.span);
        planes[1]!.constant = sheenLead;
      }
      setOpacity(
        wordSheens[index]!,
        sheenLive ? look.sheenOpacity * weight * look.wordOpacity * wordOn : 0
      );
      setOpacity(
        markSheens[index]!,
        sheenLive ? look.sheenOpacity * weight * look.markOpacity * 0.7 * markOn : 0
      );
    }

    // --- floor --------------------------------------------------------------
    /**
     * The lockup's own reflection had to get louder once the street arrived.
     *
     * At 0.34 it was correct against a plain dark floor and invisible against a
     * floor that is now full of the city's own reflected neon — lavender
     * letterforms on a lavender smear. The nearest, brightest, largest object in
     * the frame must have the strongest reflection in it; anything else says the
     * logo is further away than the skyline.
     */
    setOpacity(reflection, look.reflection * 0.52 * wordOn);
    setOpacity(floor, look.reflection * 0.3 * master);

    // --- impact -------------------------------------------------------------
    ring.position.set(0, markRestY + look.markRise, -0.2);
    ring.scale.setScalar(Math.max(0.001, look.ring));
    setOpacity(ring, look.ringOpacity * master);

    streak.scale.set(frame.w * 2.1 * Math.max(0.001, look.streak), markH * 1.1, 1);
    streak.position.y = markRestY + look.markRise;
    setOpacity(streak, look.streakOpacity * master);

    renderer.render(scene, camera);
  }

  // ---------------------------------------------------------------------------
  // teardown
  // ---------------------------------------------------------------------------

  function dispose(): void {
    scene.traverse((object) => {
      const mesh = object as Partial<THREE.Mesh> & Partial<THREE.Points>;
      if (mesh.geometry && mesh.geometry !== UNIT) mesh.geometry.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) for (const entry of material) entry.dispose();
      else material?.dispose();
    });
    camera.traverse((object) => {
      const mesh = object as Partial<THREE.Mesh>;
      const material = mesh.material;
      if (Array.isArray(material)) for (const entry of material) entry.dispose();
      else material?.dispose();
    });
    disposeIntroTextures();
    renderer.dispose();
    /**
     * Give the GL context back rather than waiting for the collector.
     *
     * Browsers cap live WebGL contexts at around sixteen, and this one shares a
     * page with the battle renderer. An intro that leaks its context on every
     * hot reload would, after a dozen reloads, silently take the board's context
     * away instead — a bug that would look like the battle screen breaking.
     */
    renderer.forceContextLoss();
    renderer.domElement.remove();
  }

  return {
    canvas: renderer.domElement,
    setMark,
    setWordmark,
    hasMark: () => markLive,
    hasWordmark: () => wordLive,
    apply,
    resize: layout,
    dispose,
  };
}
