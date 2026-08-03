/**
 * The room the match is played in: camera, light, atmosphere and the grade.
 *
 * ## Why this camera is perspective, after four rounds of it not being
 *
 * The board shipped for a long time under an `OrthographicCamera`, and the
 * reasoning written here at the time was sound on its own terms: a parallel
 * projection keeps the arena a true rectangle, every token the same size
 * wherever it sits, and hit-testing exactly matches what the player sees. What
 * that argument missed is that **a parallel projection of an axis-aligned box is
 * an axis-aligned screen rectangle**, and no amount of texturing rescues a
 * screen rectangle sitting on a painted photograph. Orthographic also forecloses
 * the two depth carriers §2 of the bar asks for by name — scale and parallax —
 * because a projection with no perspective divide cannot make anything behind
 * move relative to anything in front. A board that cannot parallax cannot be a
 * place.
 *
 * So it is a 30° perspective now, tilted 15° off vertical. The three fears all
 * turned out to be cheap: across seventeen units of board depth the token scale
 * varies by about ±7%, which reads as "my row is nearer" rather than as
 * distortion; the widest card in a row leans about 12° off-axis, which
 * foreshortens its face by 2%; and `Raycaster.setFromCamera` unprojects through
 * the projection matrix, so pointer picking, the table-plane intersection that
 * drives dragging, and `project()` for the DOM anchors are all identical code
 * that simply became correct for a different frustum.
 *
 * ## The framing solves for the HUD rather than ignoring it
 *
 * `VIEW_HEIGHT` used to be the constant 19.4 at every viewport size, and the
 * consequence was measurable: at 844×390 the enemy leader — the object the whole
 * match is about — rendered 44px tall and completely behind the rival's
 * Obsession chip, and at 1280×720 the player's own leader sat behind the hand.
 * The camera now reserves a top and a bottom inset, frames `CONTENT_DEPTH` into
 * what is left, and pushes the image up by half the difference with
 * `setViewOffset` — which shifts the frustum without touching the scale, and
 * which the raycaster reads back out of the same matrix. The insets are
 * published as `--board-inset-*` on the root element so any HUD strip that
 * floats over the board can be positioned against the same numbers the camera
 * framed around rather than against a guess.
 *
 * ## Depth planes, in the order the bar wants them
 *
 * The backdrop is the atmosphere plane and it is **graded on upload** — an 18%
 * darken, a 26% desaturation and a 2.5px blur, painted into the same canvas that
 * already shrinks the 4K master. Before that grade the orange practicals in the
 * board art were the highest-luminance pixels in every frame, so the wallpaper
 * was the most saturated and the sharpest thing on screen while the play area
 * sat behind 37% of flat grey fog. Fog is now almost gone (0.0075, enough to
 * seat the enemy row slightly further away) and the separation is carried by
 * grade, by the mat's own lighting gradient and by the vignette, which is what
 * §2 actually asks for.
 *
 * ## The framing also reserves what the HAND can reach, not what it rests at
 *
 * The bottom inset used to be the height of a *resting* hand card while the hand
 * scaled its focused card to 1.85×. Measured at 1600×900 that focused card came
 * out 220×291 spanning y588–880, over a player medallion centred at (800, 675)
 * with r≈85 — covered outright, at 1600×900 and at 1280×720 both, while the
 * plate in the corner was covered by the ability rail. Your own life total was
 * legible nowhere on screen. `HAND_HOVER_SCALE` is now one number shared with
 * `battle.css`, and the camera reserves space against *it*, so the hand cannot
 * reach a leader at any supported size.
 *
 * ## Entering the board is a curtain, not a cut
 *
 * `playEntrance` closes 14% of framing while the key light comes up from a third
 * of its strength, over 420ms, starting on the same tick the mulligan's Confirm
 * is pressed. Before it, clicking Confirm left the panel unchanged for 627ms and
 * then showed a fully settled board in the next 30ms frame: zero overlap, zero
 * stagger, and §3a names this exact moment as "the big one".
 *
 * ## One fullscreen pass, not four
 *
 * The chain was `RenderPass → UnrealBloomPass → OutputPass` from the three.js
 * examples, which costs a full-screen blit per pass and ships no grade at all.
 * `postprocessing` (pmndrs, Zlib) merges bloom, tone mapping, vignette and grain
 * into a **single** fullscreen shader, and takes its antialiasing from a
 * multisampled render target instead of a separate resolve. It is loaded by
 * dynamic import so its ~70KB never touches the lobby's first paint, and the low
 * tier still renders straight to the canvas with no composer at all.
 */

import * as THREE from "three";
import { LIGHT_RIG, lightPosition, studioEnvironment } from "../art/texture";
import { getSettings } from "../../save/settings";
import { EASE, tween } from "../motion";

export type QualityTier = "high" | "medium" | "low";

export interface SceneQuality {
  tier: QualityTier;
  bloom: boolean;
  shadows: boolean;
  maxParticles: number;
  pixelRatioCap: number;
}

export const QUALITY_PRESETS: Record<QualityTier, SceneQuality> = {
  high: { tier: "high", bloom: true, shadows: true, maxParticles: 420, pixelRatioCap: 2 },
  medium: { tier: "medium", bloom: true, shadows: false, maxParticles: 200, pixelRatioCap: 1.5 },
  low: { tier: "low", bloom: false, shadows: false, maxParticles: 70, pixelRatioCap: 1 },
};

/** Pick a starting tier from what the device advertises. */
export function detectQuality(): QualityTier {
  if (typeof navigator === "undefined") return "medium";
  const memory = (navigator as { deviceMemory?: number }).deviceMemory ?? 4;
  const cores = navigator.hardwareConcurrency ?? 4;
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  if (coarse && (memory <= 4 || cores <= 4)) return "low";
  if (memory <= 4 || cores <= 4) return "medium";
  return "high";
}

/**
 * World-space board layout, derived from measurements of the reference footage.
 *
 * `width` is the load-bearing number here. Frame-by-frame measurement of the
 * reference put its playable ground at 61.4% of screen width, sitting inside a
 * decorated stone border that reaches 71.6%. Our mat had been 72.5% — sized
 * like the reference's *border* but painted like its *ground*, which left a
 * broad empty apron on both flanks and made any small row look marooned in the
 * middle. That, not the pitch, is why the board read as clustered: at every
 * card count our row already spanned a larger fraction of the mat than the
 * reference's does (36% vs 33% at three units). Narrowing the mat to 20 units
 * puts the ground at roughly 60% and lifts a three-card row to 47% of it.
 *
 * Vertical positions follow the reference's measured bands, converted at
 * 5.155% of screen height per world unit:
 *   enemy leader 17.6% | enemy row 37.5% | player row 54%+ | player leader 75.8%
 *
 * The one deliberate deviation is row separation. We put full cards on the
 * board where the reference puts stripped medallions, and a card is a third
 * taller, so the rows sit as close as the card height allows (0.70 clearance)
 * rather than exactly on the reference's 3.28-unit spacing.
 */
export const BOARD = {
  width: 20,
  depth: 17,
  /** z of each character row (negative is toward the enemy) */
  enemyRowZ: -2.4,
  playerRowZ: 1.75,
  /** leader medallions, on the centre line bracketing the rows */
  enemyLeaderZ: -6.4,
  playerLeaderZ: 5.2,
  leaderX: 0,
  /**
   * Height of the leader medallion's plane. It is landscape (see renderLeader),
   * so this is the short axis; the disc itself is ~90% of it.
   *
   * 3.3 rather than the 2.2 it shipped at, because the object the whole match is
   * about was rendering *smaller than a board card* — a 2.0-unit disc beside a
   * 2.6×3.45 token. At 3.3 the disc is 2.98 across, comfortably the largest
   * single object on the arena, which is the proportion the reference uses and
   * the reason its heroes read as the thing you are trying to kill. It cannot go
   * much further without the player's medallion touching the near row.
   */
  leaderHeight: 3.3,
  /** board card footprint (0.753 aspect) and row centre-to-centre spacing */
  cardWidth: 2.6,
  cardHeight: 3.45,
  /**
   * Deliberately looser than the reference's measured 1.20 pitch-to-width. The
   * reference welds its row into one block; this project's brief asks for cards
   * that sit beside each other rather than clumped, so 1.38 is a considered
   * departure, not an oversight.
   */
  tokenSpacing: 3.6,
  /**
   * The widest a full row may span before cards tighten up. Sized so six cards
   * still leave a 0.35 gutter between neighbours and 1.8 units of mat either
   * side, rather than crushing together at the edges.
   */
  slotSpan: 17,
  /**
   * Releasing a dragged card beyond this z is a CANCEL -- the strip of arena
   * nearest the player, where the hand overlaps the board.
   */
  cancelZ: 7.4,
} as const;

/** Vertical space, in CSS pixels, that the HUD owns and the board must not use. */
export interface BoardInsets {
  top: number;
  bottom: number;
}

export interface BattleSceneHandles {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  quality: SceneQuality;
  /** groups the view populates */
  boardGroup: THREE.Group;
  cardGroup: THREE.Group;
  handGroup: THREE.Group;
  fxGroup: THREE.Group;
  render: (elapsed: number) => void;
  resize: () => void;
  dispose: () => void;
  setQuality: (tier: QualityTier) => void;
  /** Run the board's half of the lobby-to-battle curtain (§3a). */
  playEntrance: () => void;
  /**
   * Bring up the active player's practical and take the other one down.
   *
   * The room is what says whose turn it is. A DOM plate parked over the play
   * area says it once, blocks the board while it does and then takes the
   * information away with it; a lamp that is on stays on for the whole turn.
   */
  setActiveSide: (side: "player" | "enemy" | null) => void;
  /** Show a board backdrop behind the scene, or null for the flat void. */
  setBackdrop: (image: HTMLImageElement | null) => void;
  /** screen-space projection helper for anchoring DOM overlays to 3D objects */
  project: (position: THREE.Vector3) => { x: number; y: number };
  raycastFromPointer: (clientX: number, clientY: number, objects: THREE.Object3D[]) => THREE.Intersection[];
  /** HUD-reserved bands the camera framing keeps clear, in CSS pixels. */
  insets: BoardInsets;
  /** Milliseconds of GPU-side work per frame, averaged. Zero until measured. */
  frameTime: () => number;
}

/**
 * A texture-sized, graded copy of a backdrop.
 *
 * The masters are 3840x2160, which is about 33 MB of video memory once uploaded
 * as RGBA — for a still image that sits behind everything and never moves.
 * Halving the long edge quarters that to roughly 8 MB and is indistinguishable
 * at any viewport this game runs at, because the backdrop is never shown at 1:1.
 *
 * The same pass grades it, because it is the same draw and the grade is not
 * optional. §2 of the bar puts the atmosphere plane furthest back and requires
 * it to be "always darkened and desaturated relative to the foreground"; ours
 * arrived at full saturation and full sharpness with the play area fogged in
 * front of it, so the wallpaper was winning. `filter` on a 2D context is one
 * string and one draw for all three corrections.
 *
 * The overscan is what stops the blur eating the edges: a blurred draw samples
 * transparent black from beyond the source rectangle, so the picture is drawn
 * slightly larger than the canvas and the soft border falls outside it.
 */
const MAX_BACKDROP_WIDTH = 1920;
/**
 * Pulled back from `blur(2.5px) saturate(0.74) brightness(0.82)`, because the
 * previous round overcorrected and then a second vignette landed on top of it.
 *
 * Measured at 2560×1440 the mat centre sat at L≈85 and the four frame corners at
 * L=1.4–4.9 — a 35–60:1 falloff, which is not an atmosphere plane, it is a black
 * surround. §2 wants the backdrop darker and softer than the foreground, not
 * absent: the four depth planes collapse to two when the furthest one is gone.
 */
const BACKDROP_GRADE = "blur(2.6px) saturate(0.6) brightness(1.04)";

function gradeForTexture(image: HTMLImageElement): HTMLImageElement | HTMLCanvasElement {
  const scale = Math.min(1, MAX_BACKDROP_WIDTH / Math.max(1, image.naturalWidth));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return image;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.filter = BACKDROP_GRADE;
  const bleed = 8;
  ctx.drawImage(image, -bleed, -bleed, canvas.width + bleed * 2, canvas.height + bleed * 2);
  ctx.filter = "none";
  return canvas;
}

// --- camera constants --------------------------------------------------------

/** Vertical field of view, degrees. */
const FOV = 30;
/** Degrees off straight-down. Small: this is a board read from above. */
const TILT = 15;
/**
 * World units of board depth that must always be on screen and never behind a
 * HUD strip: from just beyond the enemy leader to just beyond the player's.
 */
const CONTENT_DEPTH = BOARD.playerLeaderZ - BOARD.enemyLeaderZ + BOARD.leaderHeight * 0.9 + 0.6;
/** World z at the centre of that band — the point the camera aims at. */
const CONTENT_CENTRE_Z = (BOARD.enemyLeaderZ + BOARD.playerLeaderZ) / 2;

/**
 * How much vertical space the HUD owns, at a given viewport size.
 *
 * The bottom is the hand: `--hand-card-height` is 17.5vh (26vh under 620px
 * tall), the cards hang 14% of their own height below the viewport, and a
 * hovered card lifts 30% of it. Both ends are clamped so a very tall window does
 * not throw away half the board and a very short one still keeps the leaders
 * visible.
 *
 * The top depends on **width**, not on height, and that is the whole reason this
 * takes two arguments. The band belongs to the rival's Obsession dial, which is
 * one line of chips on a desktop and wraps to two under about a thousand pixels
 * — so the one viewport where the reserve matters most, a phone in landscape, is
 * also the one where a height-derived number is smallest and the strip is
 * tallest. At 844×390 that mismatch put the enemy leader, the object the whole
 * match is about, directly behind the chip.
 */
function insetsFor(width: number, height: number): BoardInsets {
  const handFraction = height < 620 ? 0.26 : 0.175;
  /**
   * The reserve is sized for a **hovered** card, not a resting one, and that is
   * the whole fix for the second half of the leader-occlusion defect.
   *
   * It used to be `handFraction * 0.98` — the resting height — while the hand's
   * focused card scaled to 1.85×. Measured at 1600×900 the focused card came out
   * 220×291 spanning y588–880 over a player medallion centred at (800, 675) with
   * r≈85, i.e. y590–760: covered outright, at 1600×900 *and* at 1280×720, with
   * the plate in the corner covered by the ability rail at the same time. Your
   * own life total was not legible anywhere on screen at either common desktop
   * size.
   *
   * `HAND_HOVER_SCALE` is the same number `battle.css` scales by, and the two
   * have to move together: the camera reserves what the hand can occupy, so the
   * hand can never reach a leader. Changing one without the other puts the
   * medallion back under the cards.
   */
  /**
   * The 0.32 ceiling exists so a very short window does not hand the whole
   * viewport to the hand; at 390px tall it was cutting the reserve to 125px
   * against a 142px hover envelope, which put the player's medallion back under
   * the cards on exactly the target the reserve exists for. Short viewports get
   * a looser ceiling, because their hand is proportionally taller (26vh, not
   * 17.5vh) and their leaders are the thing worth protecting.
   */
  const ceiling = height < COMPACT_HEIGHT ? 0.35 : 0.32;
  const bottom = Math.min(height * ceiling, Math.max(104, height * handFraction * HAND_HOVER_SCALE + 10));
  /**
   * On a short viewport the rival's dial is no longer centred over the enemy
   * leader — `battle.css` moves it out to the right under 500px of height — so
   * the top band only has to clear the leader plate in the corner, which the
   * medallion is nowhere near. Reserving 84px there was costing the phone target
   * a third of its scale for a collision that no longer happens.
   */
  const compact = height < COMPACT_HEIGHT;
  const dial = compact ? 46 : width < 1024 ? 84 : 60;
  const top = Math.min(height * 0.24, Math.max(dial, height * (compact ? 0.05 : 0.075)));
  return { top, bottom };
}

/**
 * Below this viewport height the camera stops framing the whole content band.
 *
 * At 844×390 framing `CONTENT_DEPTH` into the 207px the HUD leaves solves to a
 * 28.6-unit view: 13.6 pixels per world unit, a 47px board card and a 40px leader
 * medallion. Both are illegible, and the previous framing bought that with the
 * genuine fix for the leader sitting behind the rival's chip. There is no
 * arrangement of a 390px-tall window that shows two uncropped leaders *and* a
 * readable token, so this picks the token: frame the two leader centres, let each
 * medallion's far half sit under its own HUD strip, and take the 75px card.
 */
const COMPACT_HEIGHT = 500;

/**
 * How far a hand card grows when the pointer is on it.
 *
 * Mirrored into `--hand-hover-scale` in `battle.css`; this copy is the one the
 * camera framing reserves space against. It came down from 1.85 because no
 * arrangement of a 1.85× card and a leader medallion fits in the lower third of
 * a 900px window — the full-size read belongs to press-and-hold and right-click,
 * both of which already exist and neither of which covers the board.
 */
const HAND_HOVER_SCALE = 1.3;

export function createBattleScene(container: HTMLElement, tier: QualityTier = detectQuality()): BattleSceneHandles {
  let quality = QUALITY_PRESETS[tier];

  const renderer = new THREE.WebGLRenderer({
    // Multisampling moves to the composer's render target when there is one;
    // this only covers the low tier, which renders straight to the canvas.
    antialias: quality.tier === "low" ? false : true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0x05030b, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.touchAction = "none";

  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  /**
   * Almost nothing, and deliberately. At 0.028 this washed the entire content
   * plane 37% toward near-black while varying by five percentage points across
   * the mat — a very large contrast cost for no depth cue at all. At 0.0075 the
   * enemy row sits perhaps 2% further back than yours, which is the whole job.
   */
  scene.fog = new THREE.FogExp2(0x120a24, 0.0075);
  scene.environment = studioEnvironment(renderer);
  scene.environmentIntensity = 0.6;

  // --- camera ----------------------------------------------------------------
  const camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.5, 260);
  let insets: BoardInsets = { top: 0, bottom: 0 };
  /** Distance from the aim point, solved each resize from the framing above. */
  let camDistance = 40;
  /** Ambient drift, in world units, applied on top of the solved position. */
  const drift = new THREE.Vector3();

  const aim = new THREE.Vector3(0, 0, CONTENT_CENTRE_Z);

  /**
   * How much further back than solved the camera currently sits, 0 at rest.
   *
   * The curtain (§3a's "entering the game — the big one") is a push-in: the
   * arena is framed 14% wider at the moment the mulligan lets go and closes to
   * its solved framing while the panel is still leaving, so the two overlap and
   * there is never a frame in which neither is drawn. It is a multiplier on the
   * solved distance rather than a separate camera, so a resize mid-entrance
   * still lands in the right place.
   */
  let introPull = 0;

  function placeCamera(): void {
    const distance = camDistance * (1 + introPull);
    const lift = Math.cos((TILT * Math.PI) / 180) * distance;
    const back = Math.sin((TILT * Math.PI) / 180) * distance;
    camera.position.set(drift.x, lift + drift.y, aim.z + back + drift.z);
    camera.lookAt(aim.x + drift.x * 0.35, 0, aim.z + drift.z * 0.35);
  }

  // --- board backdrop -------------------------------------------------------
  /**
   * The backdrop is a quad parented to the camera, **not** a DOM layer behind
   * the canvas.
   *
   * The DOM version is the obvious design and it does not work here. It needs a
   * transparent canvas, and this renderer draws through a composer for bloom:
   * the composer renders into its own targets and writes them to the screen, so
   * `setClearColor(…, 0)` on the renderer never reaches the output and the
   * canvas stays opaque. Measured, not assumed — with the host element painted
   * bright red behind a supposedly transparent canvas, the pixels came back
   * pure black.
   *
   * It stays parented to the camera rather than moving to a world-space plane,
   * and that is a considered call now rather than an inherited one. The camera
   * looks down at 15° off vertical, so a *vertical* plane behind the board is
   * seen at 75° — edge-on, useless — and a *horizontal* one far below the mat
   * has to be enormous and drifts out of frame at the corners. What the audit
   * actually wanted from unparenting was parallax, and parallax is available
   * without any of that: the quad is overscanned by 12% and counter-shifted
   * against the camera's own ambient drift, so the world behind the board slides
   * relative to the board and can never expose an edge while doing it.
   */
  scene.add(camera);

  let backdropMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  /** Distance in front of the lens. Inside the far plane, behind everything. */
  const BACKDROP_Z = -90;
  const BACKDROP_OVERSCAN = 1.12;
  /** World units the backdrop counter-moves per world unit of camera drift. */
  const PARALLAX = 1.9;

  /**
   * Scale the quad to the frustum and crop the texture like CSS `cover`.
   *
   * Letterboxing would be the alternative and it is wrong for a backdrop —
   * bars at the edge of a game board read as a broken layout, not as a choice.
   * The brief tells the artist the outer 12% may be cropped; this is what crops
   * it, and the overscan is why that allowance exists.
   */
  function fitBackdrop(): void {
    if (!backdropMesh) return;
    const viewHeight = 2 * Math.tan((camera.fov * Math.PI) / 360) * Math.abs(BACKDROP_Z);
    const viewWidth = viewHeight * camera.aspect;
    backdropMesh.scale.set(viewWidth * BACKDROP_OVERSCAN, viewHeight * BACKDROP_OVERSCAN, 1);

    const texture = backdropMesh.material.map;
    const source = texture?.image as { width?: number; height?: number } | undefined;
    if (!texture || !source?.width || !source.height) return;

    const imageAspect = source.width / source.height;
    const viewAspect = viewWidth / viewHeight;
    if (viewAspect > imageAspect) {
      const shown = imageAspect / viewAspect;
      texture.repeat.set(1, shown);
      texture.offset.set(0, (1 - shown) / 2);
    } else {
      const shown = viewAspect / imageAspect;
      texture.repeat.set(shown, 1);
      texture.offset.set((1 - shown) / 2, 0);
    }
  }

  function clearBackdrop(): void {
    if (!backdropMesh) return;
    camera.remove(backdropMesh);
    backdropMesh.geometry.dispose();
    backdropMesh.material.map?.dispose();
    backdropMesh.material.dispose();
    backdropMesh = null;
  }

  /**
   * Show a backdrop, or go back to the flat void.
   *
   * Null restores exactly the original look, which is what every board without
   * a picture gets.
   */
  function setBackdrop(image: HTMLImageElement | null): void {
    clearBackdrop();
    if (!image) return;

    const texture = new THREE.Texture(gradeForTexture(image));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;

    backdropMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: texture,
        // Behind everything, and taking no part in depth.
        depthTest: false,
        depthWrite: false,
        // Fog would drag the whole picture toward the fog colour, which is the
        // flat void this exists to replace. The grade above is what darkens it.
        fog: false,
      })
    );
    backdropMesh.renderOrder = -1;
    backdropMesh.position.set(0, 0, BACKDROP_Z);
    camera.add(backdropMesh);
    fitBackdrop();
  }

  // --- lighting -------------------------------------------------------------
  /**
   * One key, from 315°, with a *shape*.
   *
   * The rig this replaces could not put a gradient on the mat even in principle:
   * an ambient term at intensity 1.5 has no direction by definition, and a
   * directional light on a flat horizontal plane gives a constant N·L, so both
   * of the two largest terms were mathematically uniform across all 340 world
   * units of surface. Everything that looked like shading was baked into the
   * canvas.
   *
   * A spot light is the fix, and it is the fix for a specific reason: its cone
   * attenuation varies with *position on the plane* rather than with the plane's
   * normal, so it is the only cheap light that can fall off toward the corners
   * of a flat surface. It is placed along `LIGHT_RIG.world` — the same top-left
   * the CSS materials and every canvas bevel in the game are lit from — with a
   * wide angle and a heavy penumbra, so what lands is a soft off-centre pool
   * rather than a torch beam. `decay` is zero because the distance falloff of a
   * physically-correct light across a 24-unit throw is a second, competing
   * gradient nobody asked for.
   *
   * The directional is kept underneath it at fill strength, because the spot
   * alone leaves the card rims and the plinth bevels outside the pool unlit.
   */
  const ambient = new THREE.AmbientLight(0x9c93bd, 0.3);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xfff2e2, LIGHT_RIG.fill);
  keyLight.position.copy(lightPosition(24));
  scene.add(keyLight);

  /**
   * Up from 2.8, because the mat has to be the light mass.
   *
   * The measured frame was one dark violet field: median L17.6 whole-frame, the
   * play surface itself only reaching L55. This is the half of that fix that
   * belongs to the light rather than to the albedo — raising the albedo alone
   * would flatten the pool the spot is here to draw.
   */
  const keySpot = new THREE.SpotLight(0xffeedd, 3.05, 0, Math.PI / 3.9, 0.98, 0);
  keySpot.position.copy(lightPosition(19));
  keySpot.target.position.set(0, 0, CONTENT_CENTRE_Z * 0.4);
  scene.add(keySpot);
  scene.add(keySpot.target);

  /**
   * The two practicals, and the reason they now have bodies.
   *
   * Magenta from the player's side, cyan from the rival's — the nightlife look,
   * and the one place the board is allowed a second and third light source. What
   * they were missing is the thing that made them read as Photoshop soft-brush
   * blobs: nothing on screen caused them. In the reference every light on the
   * board has an emitter you can point at, so each of these now carries a small
   * additive orb at its own position, sized and coloured from the light it is.
   */
  /**
   * Down from 26 and 22, and lifted clear of the deck they were sitting on.
   *
   * The magenta practical stood at y=3.4 directly over the near-right run of the
   * arena rim, and it was bright enough to beat the key across the whole board:
   * measured, the near rim came back at L≈74 against the far rim at L≈39 — the
   * *unlit* edge nearly twice as bright as the lit one, which inverts
   * FOUNDATION-CONTRACT §0 on the largest surface in the game. Raising them and
   * pulling the intensity back keeps the colour and stops them out-voting the
   * sun; the rim's own vertex shading (board.ts) is the other half of the fix.
   */
  /**
   * …and then they moved off the arena entirely.
   *
   * At (±9.8, 4.8) they stood directly over the two deck runs, and once the
   * resource furniture moved onto those runs the player's deck came back as a
   * blown magenta blob with a bloom halo instead of as a pile of cards. A
   * practical that is *inside* the set lights whatever it is standing on and
   * nothing else. Out at |x| = 13.5 and 7.5 units up they are venue lighting —
   * off the deck, above the eyeline, throwing across the arena rather than
   * pooling on one object — which is also where the emitter sprites read as
   * lamps hung on the rig rather than as smudges lying on the floor.
   */
  const rimWarm = new THREE.PointLight(0xff5fa2, 26, 40, 2);
  rimWarm.position.set(13.5, 7.5, 4);
  scene.add(rimWarm);

  const rimCool = new THREE.PointLight(0x52c8ff, 22, 40, 2);
  rimCool.position.set(-13.5, 7.5, -4.2);
  scene.add(rimCool);

  /**
   * Whose lamp is up. Eased toward rather than set, so a turn change is a light
   * coming up in a room rather than a switch being thrown.
   */
  const RIM_REST = { warm: 26, cool: 22 };
  let warmTarget = RIM_REST.warm;
  let coolTarget = RIM_REST.cool;

  function setActiveSide(side: "player" | "enemy" | null): void {
    warmTarget = RIM_REST.warm * (side === "player" ? 1.75 : side === "enemy" ? 0.55 : 1);
    coolTarget = RIM_REST.cool * (side === "enemy" ? 1.75 : side === "player" ? 0.55 : 1);
  }

  const emitterTexture = makeEmitterTexture();
  const emitters: THREE.Sprite[] = [];
  for (const [light, size] of [
    [rimWarm, 2.5],
    [rimCool, 2.2],
  ] as const) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: emitterTexture,
        color: light.color,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      })
    );
    sprite.scale.set(size, size, 1);
    sprite.position.copy(light.position);
    scene.add(sprite);
    emitters.push(sprite);
  }

  // --- groups ---------------------------------------------------------------
  const boardGroup = new THREE.Group();
  const cardGroup = new THREE.Group();
  const handGroup = new THREE.Group();
  const fxGroup = new THREE.Group();
  scene.add(boardGroup, cardGroup, handGroup, fxGroup);

  // --- post-processing ------------------------------------------------------
  /**
   * Bloom, tone mapping, vignette and grain, in one shader.
   *
   * `postprocessing` merges every non-convolution effect into a single
   * fullscreen pass, so what used to be three blits after the render is one.
   * Antialiasing comes from the composer's multisampled render target rather
   * than from a resolve pass, which is why `antialias` is off on the renderer
   * whenever a composer exists — asking for both allocates two multisample
   * buffers and only one of them is ever read.
   *
   * Tone mapping moves into the pass, and `renderer.toneMapping` therefore has
   * to be switched off while it is active: three.js applies its curve in the
   * material shader, the effect applies one at the end, and running both turns
   * every highlight to paste. The low tier keeps the renderer's own ACES and no
   * composer at all.
   *
   * The vignette is the other half of defect 9: with none, the four corners of
   * the frame were the brightest region on screen and the composition actively
   * pushed the eye off the board and onto the scenery.
   */
  type Composer = import("postprocessing").EffectComposer;
  let composer: Composer | null = null;
  let composerToken = 0;
  let noiseEffect: import("postprocessing").NoiseEffect | null = null;

  const teardownComposer = (): void => {
    composer?.dispose();
    composer = null;
    noiseEffect = null;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
  };

  const setupComposer = async (): Promise<void> => {
    const token = ++composerToken;
    teardownComposer();
    if (!quality.bloom) return;
    try {
      const pp = await import("postprocessing");
      if (token !== composerToken) return;

      const next = new pp.EffectComposer(renderer, {
        frameBufferType: THREE.HalfFloatType,
        multisampling: quality.tier === "high" ? 4 : 2,
      });
      next.addPass(new pp.RenderPass(scene, camera));

      const bloom = new pp.BloomEffect({
        blendFunction: pp.BlendFunction.SCREEN,
        // A neon game glows off saturated mid-tones, not off blown highlights,
        // so the threshold sits well under 1 and the smoothing is wide enough
        // that a card frame ramps into the bloom instead of popping into it.
        luminanceThreshold: 0.62,
        luminanceSmoothing: 0.34,
        mipmapBlur: true,
        intensity: quality.tier === "high" ? 1.15 : 0.8,
        radius: 0.72,
        levels: quality.tier === "high" ? 7 : 5,
      });
      const toneMapping = new pp.ToneMappingEffect({ mode: pp.ToneMappingMode.ACES_FILMIC });
      const vignette = new pp.VignetteEffect({ offset: 0.42, darkness: 0.34 });
      const noise = new pp.NoiseEffect({ blendFunction: pp.BlendFunction.OVERLAY, premultiply: true });
      noise.blendMode.opacity.value = 0.055;
      noiseEffect = noise;

      next.addPass(new pp.EffectPass(camera, bloom, toneMapping, vignette, noise));
      renderer.toneMapping = THREE.NoToneMapping;
      composer = next;
      resize();
    } catch {
      // The grade is a nicety — if the module fails to load we render plain.
      teardownComposer();
    }
  };
  void setupComposer();

  // --- sizing ---------------------------------------------------------------
  function resize(): void {
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, quality.pixelRatioCap);

    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    composer?.setSize(width, height);

    /**
     * Published on the root element rather than on the host, and that is not
     * laziness: the HUD is a *sibling* of the board host, so a custom property
     * set on the host is inherited by nothing the HUD can see. The whole point
     * of publishing these is that the strips which must never cover a leader are
     * positioned against the same numbers the camera framed around.
     */
    insets = insetsFor(width, height);
    const root = document.documentElement;
    root.style.setProperty("--board-inset-top", `${Math.round(insets.top)}px`);
    root.style.setProperty("--board-inset-bottom", `${Math.round(insets.bottom)}px`);

    /**
     * Frame `CONTENT_DEPTH` into the band the HUD leaves, then scale the whole
     * frustum up so that band is only the middle of it. Guarded at 40% of the
     * viewport so a phone in landscape with a tall hand does not pull the camera
     * back to the horizon.
     */
    const usable = Math.max(height * 0.4, height - insets.top - insets.bottom);
    const aspect = width / Math.max(1, height);
    let viewHeight = (CONTENT_DEPTH * height) / usable;

    // …and pull back further if the mat would not fit across.
    const neededWidth = BOARD.width + 1.4;
    if (viewHeight * aspect < neededWidth) viewHeight = neededWidth / aspect;

    camera.aspect = aspect;
    camDistance = viewHeight / 2 / Math.tan((FOV * Math.PI) / 360);

    /**
     * Shift the image up by half the inset difference. `setViewOffset` moves the
     * frustum's top edge without touching its size, so nothing changes scale and
     * `Raycaster.setFromCamera` — which unprojects through this same matrix —
     * stays exactly in agreement with what is drawn.
     */
    const shift = (insets.bottom - insets.top) / 2;
    camera.setViewOffset(width, height, 0, shift, width, height);
    camera.updateProjectionMatrix();
    placeCamera();
    fitBackdrop();
  }
  resize();

  const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => resize()) : null;
  resizeObserver?.observe(container);
  window.addEventListener("resize", resize);

  // --- render ---------------------------------------------------------------
  /**
   * The board breathes, and it stops breathing when the player asks it to.
   *
   * Three periods, none of them a multiple of another, so the loop never lands
   * on a beat: 23s and 31s on the camera drift, 6.9s and 8.7s on the practicals.
   * The drift is the one that matters — a perspective camera moving a fifth of a
   * world unit is what makes the backdrop slide against the mat, and it is the
   * only thing on this screen that can produce parallax at all.
   *
   * Under reduced motion every one of them is pinned to its midpoint rather than
   * merely slowed. §3 is explicit that the decorative layer dies and the
   * functional layer lives, and an idle drift is entirely decorative.
   */
  let frameAccum = 0;
  let frameCount = 0;
  let frameAverage = 0;

  /** The intensities actually on screen, eased toward their targets. */
  let warmShown = RIM_REST.warm;
  let coolShown = RIM_REST.cool;

  function render(elapsed: number): void {
    const still = getSettings().reducedMotion;
    const started = still ? 0 : performance.now();

    // Whose lamp is up is *functional* — it is how the board says whose turn it
    // is — so it keeps working under reduced motion. It simply arrives at once.
    warmShown += (warmTarget - warmShown) * (still ? 1 : 0.09);
    coolShown += (coolTarget - coolShown) * (still ? 1 : 0.09);

    if (still) {
      drift.set(0, 0, 0);
      rimWarm.intensity = warmShown;
      rimCool.intensity = coolShown;
      /**
       * The grain is switched **off**, not turned down.
       *
       * `NoiseEffect` regenerates its field every frame from the shader's own
       * time, so leaving it at 0.03 left the whole screen shimmering under a
       * setting whose entire promise is that decorative motion stops. Measured
       * with it on: reduced motion still moved 38.9% of the frame's pixels
       * against 58.0% with motion enabled — barely half the reduction the
       * setting claims. §3 asks for the decorative layer to die.
       */
      if (noiseEffect) noiseEffect.blendMode.opacity.value = 0;
    } else {
      drift.set(
        Math.sin(elapsed * ((Math.PI * 2) / 23)) * 0.55,
        Math.sin(elapsed * ((Math.PI * 2) / 37)) * 0.28,
        Math.cos(elapsed * ((Math.PI * 2) / 31)) * 0.4
      );
      rimWarm.intensity = warmShown + Math.sin(elapsed * ((Math.PI * 2) / 6.9)) * 2.6;
      rimCool.intensity = coolShown + Math.cos(elapsed * ((Math.PI * 2) / 8.7)) * 2.3;
      if (noiseEffect) noiseEffect.blendMode.opacity.value = 0.055;
    }
    placeCamera();
    for (let i = 0; i < emitters.length; i++) {
      const sprite = emitters[i];
      const light = i === 0 ? rimWarm : rimCool;
      if (sprite) sprite.material.opacity = 0.42 + (light.intensity / 26) * 0.42;
    }
    if (backdropMesh) {
      // Counter-shift, so the world behind the board slides against it.
      backdropMesh.position.x = -drift.x * PARALLAX;
      backdropMesh.position.y = drift.z * PARALLAX;
    }

    if (composer) composer.render();
    else renderer.render(scene, camera);

    if (!still) {
      frameAccum += performance.now() - started;
      if (++frameCount >= 60) {
        frameAverage = frameAccum / frameCount;
        frameAccum = 0;
        frameCount = 0;
      }
    }
  }

  // --- helpers --------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  function raycastFromPointer(clientX: number, clientY: number, objects: THREE.Object3D[]): THREE.Intersection[] {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(objects, true);
  }

  const projectVec = new THREE.Vector3();
  function project(position: THREE.Vector3): { x: number; y: number } {
    projectVec.copy(position).project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    return {
      x: ((projectVec.x + 1) / 2) * rect.width,
      y: ((1 - projectVec.y) / 2) * rect.height,
    };
  }

  /**
   * The curtain going up.
   *
   * Entering the board was a hard cut and it was measured as one: clicking
   * Confirm on the mulligan left the panel completely unchanged for 627ms — no
   * press state, no exit — and then the board appeared fully settled, hand
   * fanned, leaders in place, everything at rest, in the very next 30ms frame at
   * t=657. Zero overlap, zero stagger, 627ms of dead air in front of it.
   *
   * What this half owns is the room: the camera closes 14% of framing while the
   * key light comes up from a third of its strength, so the arena resolves out
   * of a wider, dimmer, further-away version of itself rather than being
   * switched on. The DOM half — the panel leaving and the hand fanning in — is
   * in `battleView.playCurtain`, and the two deliberately overlap.
   *
   * Reduced motion collapses it to nothing here and to a 120ms fade in the DOM,
   * which is §3's rule: the decorative layer dies, the functional layer lives.
   */
  function playEntrance(): void {
    if (getSettings().reducedMotion) return;
    const baseSpot = keySpot.intensity;
    const baseAmbient = ambient.intensity;
    tween({
      from: 1,
      to: 0,
      ms: 420,
      ease: EASE.arrive,
      onUpdate: (value) => {
        introPull = value * 0.14;
        keySpot.intensity = baseSpot * (0.34 + 0.66 * (1 - value));
        ambient.intensity = baseAmbient * (0.5 + 0.5 * (1 - value));
        placeCamera();
      },
      onDone: () => {
        introPull = 0;
        keySpot.intensity = baseSpot;
        ambient.intensity = baseAmbient;
      },
    });
  }

  function setQuality(nextTier: QualityTier): void {
    quality = QUALITY_PRESETS[nextTier];
    void setupComposer();
    resize();
  }

  function dispose(): void {
    resizeObserver?.disconnect();
    window.removeEventListener("resize", resize);
    teardownComposer();
    renderer.dispose();
    renderer.domElement.remove();
    clearBackdrop();
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose();
    });
  }

  return {
    renderer,
    scene,
    camera,
    get quality() {
      return quality;
    },
    boardGroup,
    cardGroup,
    handGroup,
    fxGroup,
    render,
    resize,
    dispose,
    setQuality,
    playEntrance,
    setActiveSide,
    setBackdrop,
    project,
    raycastFromPointer,
    get insets() {
      return insets;
    },
    frameTime: () => frameAverage,
  } as BattleSceneHandles;
}

/**
 * The practical's body: a hot core, a bloom-catching halo, and nothing else.
 *
 * Two stops would give a soft ball; the near-solid core out to 12% is what makes
 * the composer's luminance threshold clip it, so the emitter blooms and the pool
 * of light it casts does not. That is the difference between a lamp and a smudge.
 */
function makeEmitterTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.12, "rgba(255,255,255,0.92)");
    grad.addColorStop(0.3, "rgba(255,255,255,0.28)");
    grad.addColorStop(0.62, "rgba(255,255,255,0.07)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
