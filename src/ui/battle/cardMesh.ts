/**
 * 3D card objects.
 *
 * A card is a thin rounded box whose front face is a CanvasTexture produced by
 * the shared card renderer, so a card looks identical in the collection, the
 * hand and on the board. Textures are cached by a key describing everything
 * that can change the artwork, since re-rendering a card is expensive.
 */

import * as THREE from "three";
import type { CardDef, CharacterInstance, CurrentId } from "../../engine/types";
import { CARD_H, CARD_W, renderCard } from "../cardRenderer/renderCard";
import { CURRENT_PALETTE } from "../cardRenderer/palette";
import { BOARD } from "./scene";
import { getCardArt, onArtLoaded } from "../art/artLoader";
import { drawEmblem, hexToRgb, type CardBackStyle } from "../cosmetics/emblem";

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

  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 358;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const [r, g, b] = hexToRgb(style.color);
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, `rgb(${Math.round(r * 0.34)}, ${Math.round(g * 0.34)}, ${Math.round(b * 0.42)})`);
    grad.addColorStop(0.5, "#160b2c");
    grad.addColorStop(1, "#0b0518");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.55)`;
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.18)`;
    ctx.lineWidth = 3;
    drawEmblem(ctx, style.emblem, canvas.width / 2, canvas.height / 2);

    ctx.strokeStyle = `rgba(${Math.min(255, r + 60)}, ${Math.min(255, g + 60)}, ${Math.min(255, b + 60)}, 0.35)`;
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);
  }

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

export class CardObject extends THREE.Group {
  readonly front: THREE.Mesh;
  readonly back: THREE.Mesh;
  private readonly rim: THREE.Mesh;
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
      new THREE.MeshBasicMaterial({ map: getCardTexture(card), transparent: true, toneMapped: false })
    );
    this.front.position.z = 0.011;
    this.add(this.front);

    const backGeometry = new THREE.PlaneGeometry(w, h);
    this.back = new THREE.Mesh(
      backGeometry,
      new THREE.MeshBasicMaterial({ map: getCardBackTexture(backFor(userData.seat)), transparent: true, toneMapped: false })
    );
    this.back.rotation.y = Math.PI;
    this.back.position.z = -0.011;
    this.add(this.back);

    // thin edge so the card has physical thickness under raking light
    const palette = CURRENT_PALETTE[card.current as CurrentId];
    this.rim = new THREE.Mesh(
      new THREE.BoxGeometry(w * 1.005, h * 1.005, 0.02),
      new THREE.MeshStandardMaterial({
        color: palette.lo,
        emissive: palette.key,
        emissiveIntensity: 0.28,
        roughness: 0.42,
        metalness: 0.7,
      })
    );
    this.add(this.rim);

    // repaint when this card's art finishes loading
    this.unsubscribeArt = onArtLoaded((cardId) => {
      if (cardId !== this.card.id) return;
      invalidateCardTextures(cardId);
      this.currentKey = ""; // force setFaceState to rebuild
      this.setFaceState(this.lastFaceState);
    });

    this.setFaceUp(faceUp);
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
  }
}
