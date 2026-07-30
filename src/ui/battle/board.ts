/**
 * The physical board: table surface, slot markers, leader podiums, zone rails.
 *
 * Everything here is decoration plus anchor points — no game rules. Slot world
 * positions come from BOARD in scene.ts so the view and the board never drift.
 */

import * as THREE from "three";
import { BOARD } from "./scene";

export interface BoardHandles {
  group: THREE.Group;
  /** world position of a character slot */
  slotPosition: (side: "player" | "enemy", slot: number, slots: number) => THREE.Vector3;
  /** world position of the Nth of `count` tokens in a centred row */
  rowPosition: (side: "player" | "enemy", index: number, count: number) => THREE.Vector3;
  leaderPosition: (side: "player" | "enemy") => THREE.Vector3;
  locationPosition: (side: "player" | "enemy") => THREE.Vector3;
  /** pulse a slot marker (drop targets while dragging a character) */
  setSlotHighlight: (side: "player" | "enemy", slot: number, on: boolean) => void;
  clearSlotHighlights: () => void;
  update: (elapsed: number) => void;
}

function makeTableTexture(): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // glossy base with a deep violet centre wash — bright enough that the table
  // reads as a lit surface rather than a hole in the scene
  const base = ctx.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size * 0.75);
  base.addColorStop(0, "#3a2a63");
  base.addColorStop(0.4, "#291b48");
  base.addColorStop(0.75, "#1a1030");
  base.addColorStop(1, "#0f0920");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  // faint hex weave — reads as a surface texture, not a pattern, at play distance
  ctx.strokeStyle = "rgba(190, 165, 255, 0.11)";
  ctx.lineWidth = 1.5;
  const r = 26;
  for (let row = 0; row * r * 1.5 < size + r; row++) {
    for (let col = 0; col * r * Math.sqrt(3) < size + r; col++) {
      const cx = col * r * Math.sqrt(3) + (row % 2) * ((r * Math.sqrt(3)) / 2);
      const cy = row * r * 1.5;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        const px = cx + Math.cos(a) * r;
        const py = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }

  // the centre divide — a neon seam between the two halves
  const seam = ctx.createLinearGradient(0, size / 2 - 26, 0, size / 2 + 26);
  seam.addColorStop(0, "rgba(0,0,0,0)");
  seam.addColorStop(0.42, "rgba(181, 108, 255, 0.30)");
  seam.addColorStop(0.5, "rgba(233, 200, 255, 0.62)");
  seam.addColorStop(0.58, "rgba(82, 200, 255, 0.30)");
  seam.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = seam;
  ctx.fillRect(0, size / 2 - 26, size, 52);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/**
 * A strip that is solid in the middle and fades out at both ends.
 *
 * The arena edge used to be four bars of even brightness, which drew a hard
 * rectangle around the play area. That outline is what made a small row look
 * stranded: a crisp boundary invites the eye to measure how much of the box is
 * empty. The reference has no such edge at all — its ground is a chamfered
 * lozenge that dissolves into painted scenery. Fading the ends dissolves our
 * corners the same way, so the arena reads as lit ground rather than as a box.
 */
function makeEdgeFadeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 4;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, 256, 0);
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(0.22, "rgba(255,255,255,0.85)");
    grad.addColorStop(0.5, "rgba(255,255,255,1)");
    grad.addColorStop(0.78, "rgba(255,255,255,0.85)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 4);
  }
  return new THREE.CanvasTexture(canvas);
}

/** A soft round glow sprite used for slot markers and light pools. */
function makeGlowTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.35, "rgba(255,255,255,0.42)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  return new THREE.CanvasTexture(canvas);
}

export function createBoard(quality: { shadows: boolean }): BoardHandles {
  const group = new THREE.Group();
  const glowTexture = makeGlowTexture();

  // --- table ----------------------------------------------------------------
  const table = new THREE.Mesh(
    new THREE.BoxGeometry(BOARD.width, 0.42, BOARD.depth),
    new THREE.MeshStandardMaterial({
      map: makeTableTexture(),
      roughness: 0.42,
      metalness: 0.38,
      envMapIntensity: 0.9,
    })
  );
  table.position.y = -0.21;
  table.receiveShadow = quality.shadows;
  group.add(table);

  // Two materials because the fade runs along the strip, and the side rails run
  // the other way — the texture is rotated rather than authored twice.
  const edgeFade = makeEdgeFadeTexture();
  const edgeFadeAcross = edgeFade.clone();
  edgeFadeAcross.center.set(0.5, 0.5);
  edgeFadeAcross.rotation = Math.PI / 2;
  edgeFadeAcross.needsUpdate = true;

  const edgeOptions = { color: 0xb56cff, transparent: true, opacity: 0.55, depthWrite: false } as const;
  const edgeAlong = new THREE.MeshBasicMaterial({ ...edgeOptions, map: edgeFade });
  const edgeSide = new THREE.MeshBasicMaterial({ ...edgeOptions, map: edgeFadeAcross });

  for (const [w, d, x, z, along] of [
    [BOARD.width + 0.5, 0.07, 0, -(BOARD.depth / 2 + 0.25), true],
    [BOARD.width + 0.5, 0.07, 0, BOARD.depth / 2 + 0.25, true],
    [0.07, BOARD.depth + 0.5, -(BOARD.width / 2 + 0.25), 0, false],
    [0.07, BOARD.depth + 0.5, BOARD.width / 2 + 0.25, 0, false],
  ] as const) {
    const edge = new THREE.Mesh(new THREE.PlaneGeometry(w, d), along ? edgeAlong : edgeSide);
    edge.rotation.x = -Math.PI / 2;
    edge.position.set(x, 0.03, z);
    group.add(edge);
  }

  // The midline separating the two halves — the reference's rope.
  const midline = new THREE.Mesh(
    new THREE.PlaneGeometry(BOARD.width - 0.6, 0.055),
    new THREE.MeshBasicMaterial({ color: 0xd9a5ff, transparent: true, opacity: 0.5, depthWrite: false })
  );
  midline.rotation.x = -Math.PI / 2;
  midline.position.set(0, 0.03, (BOARD.enemyRowZ + BOARD.playerRowZ) / 2);
  group.add(midline);

  // --- slot markers ---------------------------------------------------------
  const slotMarkers = new Map<string, { ring: THREE.Mesh; glow: THREE.Sprite; highlighted: boolean }>();
  const SLOTS = 6;

  /**
   * Where the Nth of `count` tokens sits in a row. Rows stay centred and use a
   * fixed spacing until they would exceed slotSpan, at which point tokens
   * tighten up rather than spilling off the arena — this is what the reference
   * does and it keeps a full board readable.
   */
  const rowPosition = (side: "player" | "enemy", index: number, count: number): THREE.Vector3 => {
    const spacing = Math.min(BOARD.tokenSpacing, BOARD.slotSpan / Math.max(1, count));
    const spread = spacing * Math.max(0, count - 1);
    const x = count > 1 ? -spread / 2 + index * spacing : 0;
    const z = side === "player" ? BOARD.playerRowZ : BOARD.enemyRowZ;
    return new THREE.Vector3(x, 0.02, z);
  };

  const slotPosition = (side: "player" | "enemy", slot: number, slots = SLOTS): THREE.Vector3 =>
    rowPosition(side, slot, slots);

  for (const side of ["player", "enemy"] as const) {
    for (let slot = 0; slot < SLOTS; slot++) {
      const position = slotPosition(side, slot);

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.66, 0.75, 48),
        new THREE.MeshBasicMaterial({
          color: side === "player" ? 0x9a6cff : 0x4aa0ff,
          transparent: true,
          opacity: 0.17,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(position);
      group.add(ring);

      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTexture,
          color: side === "player" ? 0xb56cff : 0x52c8ff,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      glow.scale.set(2.6, 2.6, 1);
      glow.position.set(position.x, 0.06, position.z);
      group.add(glow);

      slotMarkers.set(`${side}:${slot}`, { ring, glow, highlighted: false });
    }
  }

  // --- leader podiums -------------------------------------------------------
  const leaderPosition = (side: "player" | "enemy"): THREE.Vector3 =>
    new THREE.Vector3(0, 0.02, side === "player" ? BOARD.playerLeaderZ : BOARD.enemyLeaderZ);

  /**
   * The leader zone is a soft round pool of light, nothing more.
   *
   * It used to be a rectangular glow plate with a bright four-bar outline sized
   * to `cardWidth x cardHeight`. That outline was the single biggest reason the
   * leader read as "a full rectangular card" no matter what shape the portrait
   * itself was: a card-shaped frame around it told the eye "card" before the
   * artwork inside got a chance to say otherwise. A radial falloff with no edge
   * at all cannot draw a rectangle, and it suits a medallion.
   */
  for (const side of ["player", "enemy"] as const) {
    const position = leaderPosition(side);
    const accent = side === "player" ? 0xff5fa2 : 0x52c8ff;

    // A ground-plane mesh rather than a sprite: a sprite would face the camera
    // and the pool has to read as light lying on the arena.
    const pool = new THREE.Mesh(
      // wider than deep, because the medallion it sits under is landscape too
      new THREE.PlaneGeometry(BOARD.leaderHeight * 2.5, BOARD.leaderHeight * 1.9),
      new THREE.MeshBasicMaterial({
        map: glowTexture,
        color: accent,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(position.x, 0.01, position.z);
    group.add(pool);
  }

  // --- location plinths (one per side, at the row's outer edge) -------------
  // Anchored to the mat edge, not to slotSpan: derived from the row it would
  // otherwise sit beside, a wide row pushes the plinth off the arena entirely.
  const locationPosition = (side: "player" | "enemy"): THREE.Vector3 =>
    new THREE.Vector3(
      BOARD.width / 2 - 1.5,
      0.02,
      side === "player" ? BOARD.playerLeaderZ : BOARD.enemyLeaderZ
    );

  // Empty location slots read as faint outlined recesses rather than solid
  // blocks, so an unused zone never looks like a rendering artefact.
  for (const side of ["player", "enemy"] as const) {
    const position = locationPosition(side);
    const plinth = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 1.9),
      new THREE.MeshBasicMaterial({ color: 0x2a1f4a, transparent: true, opacity: 0.35, depthWrite: false })
    );
    plinth.rotation.x = -Math.PI / 2;
    plinth.position.set(position.x, 0.015, position.z);
    group.add(plinth);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.82, 0.88, 4, 1, Math.PI / 4),
      new THREE.MeshBasicMaterial({
        color: 0x8f7ac0,
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.scale.set(1.15, 1.45, 1);
    ring.position.set(position.x, 0.02, position.z);
    group.add(ring);
  }

  // --- api ------------------------------------------------------------------
  function setSlotHighlight(side: "player" | "enemy", slot: number, on: boolean): void {
    const marker = slotMarkers.get(`${side}:${slot}`);
    if (marker) marker.highlighted = on;
  }

  function clearSlotHighlights(): void {
    for (const marker of slotMarkers.values()) marker.highlighted = false;
  }

  function update(elapsed: number): void {
    for (const marker of slotMarkers.values()) {
      // Characters centre themselves on the row rather than snapping to fixed
      // slots, so idle rings would never line up with them. They appear only
      // as drop targets while a card is being dragged.
      const targetRing = marker.highlighted ? 0.8 + Math.sin(elapsed * 5) * 0.18 : 0;
      const targetGlow = marker.highlighted ? 0.45 + Math.sin(elapsed * 5) * 0.14 : 0;
      const ringMaterial = marker.ring.material as THREE.MeshBasicMaterial;
      const glowMaterial = marker.glow.material as THREE.SpriteMaterial;
      ringMaterial.opacity += (targetRing - ringMaterial.opacity) * 0.2;
      glowMaterial.opacity += (targetGlow - glowMaterial.opacity) * 0.2;
    }
  }

  return { group, slotPosition, rowPosition, leaderPosition, locationPosition, setSlotHighlight, clearSlotHighlights, update };
}
