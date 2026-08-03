/**
 * 3D card objects.
 *
 * A card is a thin rounded box whose front face is a CanvasTexture produced by
 * the shared card renderer, so a card looks identical in the collection, the
 * hand and on the board. Textures are cached by a key describing everything
 * that can change the artwork, since re-rendering a card is expensive.
 *
 * ## Why a board card is more than a quad with a picture on it
 *
 * It used to be exactly that, and it read exactly like that: three enemy cards
 * lying on the mat looked like stickers on wallpaper — identical brightness, no
 * ground contact, no glow spill onto the surface underneath despite carrying
 * saturated Cinder-orange and Tide-blue frames. The comment on the rim promised
 * "physical thickness under raking light" and described something that could not
 * happen: the rim was 0.02 world units, which projected to about a sixth of a
 * pixel, and it was set to `metalness: 0.7` in a build with no environment map
 * anywhere in it, so it threw away 70% of its diffuse response in exchange for a
 * specular return that had nothing to reflect.
 *
 * Three things fix it, and none of them touches the face texture: a painted
 * contact shadow so the card sits *on* something, a rim thick enough to catch
 * the key light at 315°, and a small additive pool of the card's own Current
 * colour bleeding onto the mat beneath it. The reference does the same three
 * things to a board minion and none of them to a hand card, which is why they
 * are attached here by `kind` rather than to every card object.
 */

import * as THREE from "three";
import type { CardDef, CharacterInstance, CurrentId } from "../../engine/types";
import { CARD_H, CARD_W, renderCard } from "../cardRenderer/renderCard";
import { CURRENT_PALETTE } from "../cardRenderer/palette";
import { BOARD } from "./scene";
import { groundShadow } from "./board";
import { getCardArt, onArtLoaded } from "../art/artLoader";
import { renderCardBackToCanvas } from "../cardRenderer/renderCardBack";
import type { CardBackStyle } from "../cosmetics/emblem";

// ---------------------------------------------------------------------------
// Texture cache
// ---------------------------------------------------------------------------

interface CachedTexture {
  texture: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  lastUsed: number;
}

const textureCache = new Map<string, CachedTexture>();
const MAX_CACHED = 160;
let cacheClock = 0;

export interface CardFaceState {
  attack?: number;
  health?: number;
  maxHealth?: number;
  highlight?: "none" | "playable" | "target" | "selected";
  dimmed?: boolean;
  premium?: boolean;
  /** enlarge attack/health — set for cards sitting on the board */
  statEmphasis?: boolean;
}

function cacheKey(card: CardDef, state: CardFaceState): string {
  return [
    card.id,
    state.attack ?? "-",
    state.health ?? "-",
    state.maxHealth ?? "-",
    state.highlight ?? "none",
    state.dimmed ? "d" : "",
    state.premium ? "p" : "",
    state.statEmphasis ? "s" : "",
  ].join("|");
}

/** Resolution the card texture is rendered at — 2x card-space for crispness. */
const TEXTURE_SCALE = 1.6;

export function getCardTexture(card: CardDef, state: CardFaceState = {}): THREE.CanvasTexture {
  const key = cacheKey(card, state);
  const cached = textureCache.get(key);
  if (cached) {
    cached.lastUsed = ++cacheClock;
    return cached.texture;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(CARD_W * TEXTURE_SCALE);
  canvas.height = Math.round(CARD_H * TEXTURE_SCALE);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.scale(TEXTURE_SCALE, TEXTURE_SCALE);
    renderCard(ctx, card, {
      art: getCardArt(card),
      ...(state.attack !== undefined ? { liveAttack: state.attack } : {}),
      ...(state.health !== undefined ? { liveHealth: state.health } : {}),
      ...(state.maxHealth !== undefined ? { liveMaxHealth: state.maxHealth } : {}),
      ...(state.highlight ? { highlight: state.highlight } : {}),
      ...(state.dimmed ? { dimmed: true } : {}),
      ...(state.premium ? { premium: true } : {}),
      ...(state.statEmphasis ? { statEmphasis: true } : {}),
    });
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;

  textureCache.set(key, { texture, canvas, lastUsed: ++cacheClock });

  // evict least-recently-used entries
  if (textureCache.size > MAX_CACHED) {
    const entries = [...textureCache.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (let i = 0; i < entries.length - MAX_CACHED; i++) {
      const entry = entries[i];
      if (!entry) continue;
      entry[1].texture.dispose();
      textureCache.delete(entry[0]);
    }
  }

  return texture;
}

/** Force a card's cached faces to be rebuilt (used when art finishes loading). */
export function invalidateCardTextures(cardId: string): void {
  for (const [key, value] of [...textureCache.entries()]) {
    if (key.startsWith(`${cardId}|`)) {
      value.texture.dispose();
      textureCache.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// Card back
// ---------------------------------------------------------------------------

/**
 * One texture per card back, built once and kept.
 *
 * Keyed by cosmetic id rather than replaced, because the enemy's back and yours
 * can differ in the same match — and will, once the server exists and the
 * opponent is another account wearing their own.
 */
const cardBackTextures = new Map<string, THREE.CanvasTexture>();

/** The back an account wears when it owns none — the house design. */
const DEFAULT_BACK = { color: "#b56cff", emblem: "diamond" as const };

/**
 * The back the local player is wearing, set once when a match starts.
 *
 * Module-level rather than threaded through every `CardObject`, because it is a
 * property of the account rather than of any card — and the alternative is an
 * argument added to a constructor called from a dozen places to carry a value
 * that is the same every time.
 */
let playerCardBack: CardBackStyle | null = null;

/** Seat 0's card back. Null restores the house design. */
export function setPlayerCardBack(style: CardBackStyle | null): void {
  playerCardBack = style;
}

/**
 * The back a seat's face-down cards show.
 *
 * Only the local player's is customised: the opponent is an AI with no account
 * to wear anything, and showing them your back would be stranger than showing
 * them the house one. When the server lands and the opponent is a real account,
 * this is where their back arrives.
 */
const backFor = (seat: number): CardBackStyle | null => (seat === 0 ? playerCardBack : null);

/** Read the back a seat is dealing. Exported so a browser check can see it. */
export const cardBackStyleFor = (seat: number): CardBackStyle | null => backFor(seat);

/**
 * The card back that is worn.
 *
 * `null` is the default rather than an error: a save naming a back that a later
 * build removed should show the house design, not a blank card.
 */
export function getCardBackTexture(back: CardBackStyle | null): THREE.CanvasTexture {
  const style = back ?? DEFAULT_BACK;
  const key = `${style.color}:${style.emblem}`;
  const cached = cardBackTextures.get(key);
  if (cached) return cached;

  /**
   * The drawing lives in `cardRenderer` and not here, and that is the point.
   *
   * A back built next to the three.js mesh is a back nobody compares to a front,
   * which is how it stayed a 256×358 wireframe — a vertical gradient, four
   * stroked diamonds and one square-cornered `strokeRect` — while the face grew
   * a lit frame band, grain, a section through its border and a contact shadow.
   * The two are now the same object flipped over, because they are built from
   * the same primitives in the same folder at the same size.
   */
  const canvas = renderCardBackToCanvas(style);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  cardBackTextures.set(key, texture);
  return texture;
}

// ---------------------------------------------------------------------------
// Card object
// ---------------------------------------------------------------------------

export interface CardObjectUserData {
  kind: "hand" | "board" | "leader";
  instanceId: string;
  cardId: string;
  seat: number;
}

/**
 * The pool of coloured light a lit card throws onto the floor it is lying on.
 *
 * One bitmap for every card on the board: it is tinted per-Current by the
 * material's `color`, which costs a uniform instead of a texture.
 */
let spillTexture: THREE.CanvasTexture | null = null;
function getSpillTexture(): THREE.CanvasTexture {
  if (spillTexture) return spillTexture;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, "rgba(255,255,255,0.5)");
    grad.addColorStop(0.42, "rgba(255,255,255,0.2)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  spillTexture = new THREE.CanvasTexture(canvas);
  spillTexture.colorSpace = THREE.SRGBColorSpace;
  return spillTexture;
}

export class CardObject extends THREE.Group {
  readonly front: THREE.Mesh;
  readonly back: THREE.Mesh;
  private readonly rim: THREE.Mesh;
  private readonly grounding: THREE.Object3D[] = [];
  private currentKey = "";
  private lastFaceState: CardFaceState = {};
  private readonly unsubscribeArt: () => void;

  /** animation targets — the view sets these, update() eases toward them */
  targetPosition = new THREE.Vector3();
  targetRotation = new THREE.Euler();
  targetScale = 1;
  /** set while the card is being dragged so easing is skipped */
  immediate = false;
  /** additive offset for attack lunges, cleared once the lunge returns */
  animOffset = new THREE.Vector3();

  constructor(public card: CardDef, public faceUp: boolean, userData: CardObjectUserData) {
    super();
    this.userData = userData;

    const w = BOARD.cardWidth;
    const h = BOARD.cardHeight;

    const frontGeometry = new THREE.PlaneGeometry(w, h);
    this.front = new THREE.Mesh(
      frontGeometry,
      new THREE.MeshBasicMaterial({ map: getCardTexture(card), transparent: true })
    );
    /**
     * Clear of the rim's top face, which is the whole reason this number is
     * written down. The rim is a solid box 0.06 deep, so its faces are at
     * ±0.03; the front lived at 0.011 back when the box was 0.02 deep, and
     * thickening the edge without moving the face buried every card on the
     * board under a slab of its own Current colour.
     */
    this.front.position.z = 0.034;
    this.add(this.front);

    const backGeometry = new THREE.PlaneGeometry(w, h);
    this.back = new THREE.Mesh(
      backGeometry,
      new THREE.MeshBasicMaterial({ map: getCardBackTexture(backFor(userData.seat)), transparent: true })
    );
    this.back.rotation.y = Math.PI;
    this.back.position.z = -0.034;
    this.add(this.back);

    /**
     * The edge of the card, thick enough to see.
     *
     * 0.06 world units is roughly 2.5 screen pixels at the framing this board
     * uses, which is the smallest edge that still reads as a bevel rather than
     * as an aliasing artefact. Metalness comes down from 0.7 to 0.35 now that
     * there is an environment to reflect: a card edge is lacquered card stock,
     * not chrome, and the remaining specular comes from the studio map rather
     * than from throwing away diffuse.
     */
    const palette = CURRENT_PALETTE[card.current as CurrentId];
    this.rim = new THREE.Mesh(
      new THREE.BoxGeometry(w * 1.022, h * 1.022, 0.06),
      new THREE.MeshStandardMaterial({
        color: palette.lo,
        emissive: palette.key,
        emissiveIntensity: 0.14,
        roughness: 0.38,
        metalness: 0.35,
        envMapIntensity: 1.2,
      })
    );
    this.add(this.rim);

    if (userData.kind === "board") this.ground(w, h, palette.key);

    // repaint when this card's art finishes loading
    this.unsubscribeArt = onArtLoaded((cardId) => {
      if (cardId !== this.card.id) return;
      invalidateCardTextures(cardId);
      this.currentKey = ""; // force setFaceState to rebuild
      this.setFaceState(this.lastFaceState);
    });

    this.setFaceUp(faceUp);
  }

  /**
   * Put the card on the ground: a contact shadow under it and its own colour
   * spilling out from underneath.
   *
   * Both are parented to the card rather than left on the board, which is the
   * unusual choice and the deliberate one. A shadow left behind on the mat would
   * have to be found, moved and re-sorted every time a card slid along a row,
   * and it would sit still while the card lunged. Parented, the whole object
   * moves as one thing — and because a card only ever lies flat or lifts
   * straight up, the shadow never falls anywhere it should not.
   *
   * The offsets are in the card's own space, where +Z is world up: the mat is at
   * y=0 and a board card at y=0.02, so -0.014 puts the shadow six thousandths of
   * a unit above the floor. Close enough to touch, far enough not to z-fight
   * with a surface that does not write depth.
   */
  private ground(w: number, h: number, accent: string): void {
    const shadow = groundShadow(w * 1.05, h * 1.05, { lift: 5, opacity: 0.5, space: "card" });
    shadow.position.z = -0.014;
    this.add(shadow);
    this.grounding.push(shadow);

    const spill = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 2.1, h * 1.75),
      new THREE.MeshBasicMaterial({
        map: getSpillTexture(),
        color: new THREE.Color(accent),
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      })
    );
    spill.position.z = -0.012;
    spill.renderOrder = 2;
    this.add(spill);
    this.grounding.push(spill);
  }

  setFaceUp(faceUp: boolean): void {
    this.faceUp = faceUp;
    this.front.visible = faceUp;
    this.back.visible = !faceUp;
  }

  /** Refresh the front texture when live stats or highlight change. */
  setFaceState(state: CardFaceState): void {
    this.lastFaceState = state;
    const key = cacheKey(this.card, state);
    if (key === this.currentKey) return;
    this.currentKey = key;
    const material = this.front.material as THREE.MeshBasicMaterial;
    material.map = getCardTexture(this.card, state);
    material.needsUpdate = true;
  }

  /** Convenience for board characters: show live stats and statuses. */
  syncFromCharacter(character: CharacterInstance, highlight: CardFaceState["highlight"], attack: number): void {
    this.setFaceState({
      attack,
      health: character.health,
      maxHealth: character.maxHealth,
      // on the board the numbers are what you read, not the rules text
      statEmphasis: true,
      ...(highlight ? { highlight } : {}),
    });
  }

  /** Ease toward the animation targets. Called every frame by the view. */
  update(delta: number): void {
    // exponential ease-out, tau ~= 0.14s — matches the slide timing measured
    // in the reference footage
    const lerp = this.immediate ? 1 : 1 - Math.pow(0.0009, delta);
    this.position.lerp(this.targetPosition.clone().add(this.animOffset), lerp);
    this.rotation.x += (this.targetRotation.x - this.rotation.x) * lerp;
    this.rotation.y += (this.targetRotation.y - this.rotation.y) * lerp;
    this.rotation.z += (this.targetRotation.z - this.rotation.z) * lerp;
    const s = this.scale.x + (this.targetScale - this.scale.x) * lerp;
    this.scale.setScalar(s);
  }

  dispose(): void {
    this.unsubscribeArt();
    this.front.geometry.dispose();
    this.back.geometry.dispose();
    this.rim.geometry.dispose();
    (this.rim.material as THREE.Material).dispose();
    for (const object of this.grounding) {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose();
      // The maps are memoised in module B and shared by every card on the
      // board, so the material goes and the bitmap stays.
      (mesh.material as THREE.Material | undefined)?.dispose();
    }
    this.grounding.length = 0;
  }
}
