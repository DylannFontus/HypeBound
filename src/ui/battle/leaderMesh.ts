/**
 * The leader, as an object on the arena rather than a decal printed on it.
 *
 * The portrait itself is still one plane carrying a canvas from `renderLeader`
 * — that file owns the medallion's own artwork and this one must not have a
 * second opinion about it. What was missing is everything *around* the plane.
 * A leader used to be a 2.2-unit landscape quad on `MeshBasicMaterial` with
 * `toneMapped: false`, lying in a soft round pool of light: no frame, no
 * thickness, no shadow, no ground contact, and — on the low tier, where nothing
 * else bypasses the tone curve — in a different tonal space from the mat it lay
 * on. Beside a Hearthstone hero, which is a painted bust in a carved gold rim
 * seated in a recessed tray with a real cast shadow, it read as the smallest and
 * flattest thing on a board it is supposed to be the point of.
 *
 * So there are now four pieces stacked over each other in a 0.05-unit sandwich:
 * the recessed tray it sits in, a contact shadow, the portrait, and a bevelled
 * ring lit from 315° that gives the medallion an edge. The whole assembly is
 * about 1.6× a board card, which is the proportion the reference uses and the
 * reason the win condition stops being the smallest token in frame.
 */

import * as THREE from "three";
import type { CardDef } from "../../engine/types";
import {
  LEADER_H,
  LEADER_W,
  renderLeaderPortrait,
  type LeaderPortraitState,
} from "../cardRenderer/renderLeader";
import { onArtLoaded } from "../art/artLoader";
import { BOARD } from "./scene";
import { groundShadow } from "./board";
import { LIGHT_RIG } from "../art/texture";

/**
 * Higher than the cards use: the medallion's rim is two 12px bands, which are
 * the first thing to blur away under mipmapping at this size.
 */
const TEXTURE_SCALE = 1.8;

function keyFor(card: CardDef, state: LeaderPortraitState): string {
  return [card.id, state.health, state.maxHealth, state.armor ?? 0, state.highlight ?? "none"].join("|");
}

const cache = new Map<string, THREE.CanvasTexture>();

function textureFor(card: CardDef, state: LeaderPortraitState): THREE.CanvasTexture {
  const key = keyFor(card, state);
  const hit = cache.get(key);
  if (hit) return hit;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(LEADER_W * TEXTURE_SCALE);
  canvas.height = Math.round(LEADER_H * TEXTURE_SCALE);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.scale(TEXTURE_SCALE, TEXTURE_SCALE);
    renderLeaderPortrait(ctx, card, state);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  if (cache.size > 40) {
    for (const [k, v] of cache) {
      v.dispose();
      cache.delete(k);
      if (cache.size <= 20) break;
    }
  }
  cache.set(key, texture);
  return texture;
}

/**
 * The tray the medallion is seated in.
 *
 * Only a tray, and deliberately not also a frame: `renderLeader` already draws
 * the medallion's carved Current ring, notches and all, and a second bevel over
 * the top of a good one is how an object ends up looking embossed twice. What is
 * missing from a coin lying on a floor is the *hole it sits in*, and a hole is a
 * well — inner shadow at the top-left where the near lip cuts the light off,
 * faint rim light at the bottom-right where the far wall catches it. Inverting
 * those two is the classic way to turn a recess into a button.
 */
const trays = new Map<string, THREE.CanvasTexture>();

function leaderTray(accent: string): THREE.CanvasTexture {
  const hit = trays.get(accent);
  if (hit) return hit;

  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  trays.set(accent, texture);
  if (!ctx) return texture;

  const cx = size / 2;
  const radius = size * 0.47;

  const dish = ctx.createRadialGradient(cx, cx, radius * 0.2, cx, cx, radius);
  dish.addColorStop(0, "rgba(9, 5, 22, 0.66)");
  dish.addColorStop(0.72, "rgba(9, 5, 22, 0.52)");
  dish.addColorStop(0.94, "rgba(4, 2, 12, 0.32)");
  dish.addColorStop(1, "rgba(4, 2, 12, 0)");
  ctx.fillStyle = dish;
  ctx.beginPath();
  ctx.arc(cx, cx, radius, 0, Math.PI * 2);
  ctx.fill();

  const lip = ctx.createLinearGradient(
    cx + LIGHT_RIG.screen.x * radius,
    cx + LIGHT_RIG.screen.y * radius,
    cx - LIGHT_RIG.screen.x * radius,
    cx - LIGHT_RIG.screen.y * radius
  );
  lip.addColorStop(0, "rgba(0, 0, 0, 0.72)");
  lip.addColorStop(0.45, "rgba(0, 0, 0, 0.1)");
  lip.addColorStop(1, "rgba(255, 255, 255, 0.2)");
  ctx.strokeStyle = lip;
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(cx, cx, radius - 6, 0, Math.PI * 2);
  ctx.stroke();

  // A thin accent inlay around the rim, so the seat belongs to a side.
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.42;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(cx, cx, radius - 1.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;

  texture.needsUpdate = true;
  return texture;
}

export class LeaderObject extends THREE.Group {
  private readonly plane: THREE.Mesh;
  private readonly parts: THREE.Mesh[] = [];
  private currentKey = "";
  private lastState: LeaderPortraitState;
  private readonly unsubscribeArt: () => void;

  constructor(readonly card: CardDef, state: LeaderPortraitState, side: "player" | "enemy") {
    super();
    this.lastState = state;
    this.userData = { kind: "leader", side, cardId: card.id };

    const h = BOARD.leaderHeight;
    const w = h * (LEADER_W / LEADER_H);
    const accent = side === "player" ? "#ff5fa2" : "#52c8ff";

    /**
     * Everything below the portrait, in one place so the y-order is readable:
     * the tray at the bottom, the cast shadow over it, the portrait, then the
     * ring. Two thousandths of a unit apart, which at this framing is far less
     * than a pixel — the separation exists only so the transparency sort is
     * deterministic and never flickers between frames.
     */
    const tray = this.flat(new THREE.PlaneGeometry(h * 1.2, h * 1.2), leaderTray(accent), 0.006);
    tray.renderOrder = 2;

    const shadow = groundShadow(h * 1.04, h * 1.04, { lift: 7, opacity: 0.5, y: 0.009, shape: "disc" });
    shadow.renderOrder = 3;
    this.add(shadow);
    this.parts.push(shadow);

    this.plane = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({
        map: textureFor(card, state),
        transparent: true,
        depthWrite: false,
      })
    );
    this.plane.rotation.x = -Math.PI / 2;
    this.plane.position.y = 0.014;
    this.plane.renderOrder = 4;
    this.add(this.plane);
    this.currentKey = keyFor(card, state);

    this.unsubscribeArt = onArtLoaded((cardId) => {
      if (cardId !== this.card.id) return;
      for (const [k, v] of cache) {
        if (k.startsWith(`${cardId}|`)) {
          v.dispose();
          cache.delete(k);
        }
      }
      this.currentKey = "";
      this.setState(this.lastState);
    });
  }

  /** A ground-plane quad at a given height. Added and tracked for disposal. */
  private flat(geometry: THREE.PlaneGeometry, map: THREE.Texture, y: number): THREE.Mesh {
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, fog: false })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    this.add(mesh);
    this.parts.push(mesh);
    return mesh;
  }

  setState(state: LeaderPortraitState): void {
    this.lastState = state;
    const key = keyFor(this.card, state);
    if (key === this.currentKey) return;
    this.currentKey = key;
    const material = this.plane.material as THREE.MeshBasicMaterial;
    material.map = textureFor(this.card, state);
    material.needsUpdate = true;
  }

  dispose(): void {
    this.unsubscribeArt();
    this.plane.geometry.dispose();
    (this.plane.material as THREE.Material).dispose();
    for (const part of this.parts) {
      part.geometry.dispose();
      // The furniture bitmaps are shared between every leader on this side, so
      // the material goes and the texture stays.
      (part.material as THREE.Material).dispose();
    }
    this.parts.length = 0;
  }
}
