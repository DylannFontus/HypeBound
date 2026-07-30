/**
 * The leader portrait as a flat plane on the arena.
 * Art only — no cost, name plate or rules text (see renderLeader.ts).
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

export class LeaderObject extends THREE.Group {
  private readonly plane: THREE.Mesh;
  private currentKey = "";
  private lastState: LeaderPortraitState;
  private readonly unsubscribeArt: () => void;

  constructor(readonly card: CardDef, state: LeaderPortraitState, side: "player" | "enemy") {
    super();
    this.lastState = state;
    this.userData = { kind: "leader", side, cardId: card.id };

    const h = BOARD.leaderHeight;
    const w = h * (LEADER_W / LEADER_H);

    this.plane = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({
        map: textureFor(card, state),
        transparent: true,
        toneMapped: false,
        depthWrite: false,
      })
    );
    this.plane.rotation.x = -Math.PI / 2;
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
  }
}
