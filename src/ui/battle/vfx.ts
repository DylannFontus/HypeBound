/**
 * Battle visual effects.
 *
 * A small pooled particle system plus a handful of composed set-pieces (summon
 * burst, impact, heal, Confluence flourish, Resonance). Every effect respects
 * the reduced-motion setting and the scene's particle budget, and every effect
 * is short — the animation budget in the art docs caps card play at 600ms and
 * a Confluence flourish at 1200ms.
 */

import * as THREE from "three";
import type { ConfluenceId, CurrentId } from "../../engine/types";
import { CURRENT_PALETTE } from "../cardRenderer/palette";
import type { BattleSceneHandles } from "./scene";
import { getSettings } from "../../save/settings";

interface Particle {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  spin: number;
  fadePower: number;
  startScale: number;
  endScale: number;
}

export interface VfxLayer {
  summonBurst: (position: THREE.Vector3, current: CurrentId) => void;
  /**
   * The dust a card kicks up when it is put down, as distinct from the light it
   * throws. `summonBurst` is the Current arriving; this is the floor answering.
   */
  landing: (position: THREE.Vector3, current: CurrentId) => void;
  /** The turn changing, swept along the arena's centre line toward `side`. */
  turnSweep: (side: "player" | "enemy") => void;
  /**
   * The pool of light a carried card throws on the floor beneath it.
   *
   * Driven every pointer move while a card is out of the hand; `null` puts it
   * away. It is deliberately *at the pointer* rather than at the slot: the board
   * already lights the socket the card would land in, and a player dragging a
   * card is looking at the card, not forty pixels below it.
   */
  dragPool: (point: THREE.Vector3 | null, state: "valid" | "blocked") => void;
  impact: (position: THREE.Vector3, amount: number, elemental: boolean) => void;
  /** white strike flash at the point of contact, thrown along the attack vector */
  contactSpark: (position: THREE.Vector3, direction: THREE.Vector3) => void;
  /**
   * Where the last contact spark was struck. It lives for ~140ms, which is too
   * short to catch reliably in a screenshot, so automation asserts on this
   * instead of trying to photograph the flash.
   */
  lastContactSpark: () => { position: THREE.Vector3; direction: THREE.Vector3 } | null;
  /**
   * Is anything in this layer still moving?
   *
   * Asked by `BattleView.facesSettled` before it blocks the main thread to draw
   * a card face. A card render costs 150–250ms on this machine and the browser
   * paints nothing for the whole of it, so the only question that matters is
   * which frames it eats. A batch that begins while the handover's mote sweep is
   * still crossing the mat freezes those motes in mid-air — measured, a 422ms
   * long task starting 300ms before the sweep's last particle expired. Waiting
   * for the layer to fall silent costs the same milliseconds and spends them on
   * a board where nothing was going to move anyway.
   */
  busy: () => boolean;
  heal: (position: THREE.Vector3, amount: number) => void;
  statusPop: (position: THREE.Vector3, color: string) => void;
  confluence: (id: ConfluenceId, currents: [CurrentId, CurrentId]) => void;
  resonance: (current: CurrentId) => void;
  defeat: (position: THREE.Vector3) => void;
  screenFlash: (color: string, intensity: number) => void;
  update: (delta: number, elapsed: number) => void;
  dispose: () => void;
}

function makeParticleTexture(kind: "soft" | "spark" | "ring"): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    if (kind === "soft") {
      const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(0.4, "rgba(255,255,255,0.5)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
    } else if (kind === "spark") {
      const grad = ctx.createLinearGradient(0, size / 2, size, size / 2);
      grad.addColorStop(0, "rgba(255,255,255,0)");
      grad.addColorStop(0.5, "rgba(255,255,255,1)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, size / 2 - 5, size, 10);
      const dot = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 6);
      dot.addColorStop(0, "rgba(255,255,255,1)");
      dot.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = dot;
      ctx.fillRect(0, 0, size, size);
    } else {
      ctx.strokeStyle = "rgba(255,255,255,1)";
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2 - 10, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  return new THREE.CanvasTexture(canvas);
}

export function createVfx(scene: BattleSceneHandles): VfxLayer {
  const textures = {
    soft: makeParticleTexture("soft"),
    spark: makeParticleTexture("spark"),
    ring: makeParticleTexture("ring"),
  };

  const pool: Particle[] = [];
  const active: Particle[] = [];
  const group = new THREE.Group();
  scene.fxGroup.add(group);

  const reduced = (): boolean => getSettings().reducedMotion;
  const budget = (): number => (reduced() ? 0 : scene.quality.maxParticles);

  function spawn(options: {
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    color: string;
    life: number;
    startScale: number;
    endScale: number;
    texture?: keyof typeof textures;
    additive?: boolean;
  }): void {
    if (active.length >= budget()) return;

    let particle = pool.pop();
    if (!particle) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: textures.soft,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      particle = {
        sprite,
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        spin: 0,
        fadePower: 1,
        startScale: 1,
        endScale: 0,
      };
      group.add(sprite);
    }

    const material = particle.sprite.material as THREE.SpriteMaterial;
    material.map = textures[options.texture ?? "soft"];
    material.color.set(options.color);
    material.opacity = 1;
    material.blending = options.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending;
    material.needsUpdate = true;

    particle.sprite.visible = true;
    particle.sprite.position.copy(options.position);
    particle.sprite.scale.setScalar(options.startScale);
    particle.velocity.copy(options.velocity);
    particle.life = options.life;
    particle.maxLife = options.life;
    particle.startScale = options.startScale;
    particle.endScale = options.endScale;
    particle.spin = 0;
    particle.fadePower = 1.4;

    active.push(particle);
  }

  // --- set pieces -----------------------------------------------------------

  function summonBurst(position: THREE.Vector3, current: CurrentId): void {
    const palette = CURRENT_PALETTE[current] ?? CURRENT_PALETTE.prism;
    if (reduced()) return;

    // ground ring
    spawn({
      position: position.clone().setY(0.08),
      velocity: new THREE.Vector3(0, 0.1, 0),
      color: palette.key,
      life: 0.55,
      startScale: 0.6,
      endScale: 4.2,
      texture: "ring",
    });

    const count = Math.min(20, Math.floor(budget() * 0.06));
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count;
      spawn({
        position: position.clone().setY(0.15),
        velocity: new THREE.Vector3(Math.cos(angle) * 2.4, 1.5 + Math.random() * 1.4, Math.sin(angle) * 2.4),
        color: i % 3 === 0 ? palette.hi : palette.key,
        life: 0.5 + Math.random() * 0.35,
        startScale: 0.34,
        endScale: 0.02,
      });
    }
  }

  /**
   * Contact: the floor answering a card being put down on it.
   *
   * Deliberately **not** additive and deliberately pale-violet rather than the
   * card's Current — additive light is what `summonBurst` already does, and
   * doing it twice makes a flash rather than an impact. This is grit lifted off
   * the mat, thrown outward along the ground and dropping back, which is the
   * half of a landing that says the surface is a surface. The ring is flat and
   * wide and gone in a third of a second: any longer and it reads as a spell.
   */
  function landing(position: THREE.Vector3, current: CurrentId): void {
    if (reduced()) return;
    const palette = CURRENT_PALETTE[current] ?? CURRENT_PALETTE.prism;

    spawn({
      position: position.clone().setY(0.05),
      velocity: new THREE.Vector3(),
      color: palette.hi,
      life: 0.32,
      startScale: 1.5,
      endScale: 5.4,
      texture: "ring",
    });

    const count = Math.min(18, Math.max(8, Math.floor(budget() * 0.045)));
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (i % 3) * 0.21;
      const speed = 2.4 + (i % 5) * 0.42;
      spawn({
        position: position
          .clone()
          .setY(0.06)
          .add(new THREE.Vector3(Math.cos(angle) * 0.85, 0, Math.sin(angle) * 0.62)),
        velocity: new THREE.Vector3(Math.cos(angle) * speed, 0.3 + Math.random() * 0.55, Math.sin(angle) * speed * 0.6),
        color: i % 3 === 0 ? "#ded2f6" : "#8a7ab0",
        life: 0.4 + Math.random() * 0.26,
        startScale: 0.28,
        endScale: 1.15,
        additive: false,
      });
    }
  }

  /**
   * The turn changing, as an event in the room rather than a chip over the board.
   *
   * A line of motes runs the width of the arena along the centre seam and drifts
   * toward whoever is now to act. It costs one spawn loop and it replaces the
   * biggest single lump of dead time on this screen — a 1.1-second full-board
   * DOM banner, three times a turn.
   *
   * ## Why it is over in a third of a second
   *
   * It used to live 0.42–0.62s, and it was the only thing on the board still
   * moving when the rival's play arrived: measured on a screencast, the sweep's
   * last mote expired at t≈1260ms after End Turn and the batch's card render
   * blocked the main thread from t≈952ms to t≈1374ms, so the last third of the
   * wipe was a still image of motes hanging over the mat. The wipe and the
   * ribbon that rides with it are one event and they now finish together, inside
   * §3's 200–320ms band for a UI transition — the motes travel the same distance,
   * faster, and the board is genuinely at rest before the batch asks for
   * anything.
   */
  function turnSweep(side: "player" | "enemy"): void {
    if (reduced()) return;
    const toward = side === "player" ? 1 : -1;
    const colour = side === "player" ? "#ff8fc4" : "#8fd8ff";
    const count = Math.min(26, Math.max(10, Math.floor(budget() * 0.06)));
    for (let i = 0; i < count; i++) {
      const t = i / Math.max(1, count - 1);
      spawn({
        position: new THREE.Vector3(-9.4 + t * 18.8, 0.16, (Math.random() - 0.5) * 0.5),
        velocity: new THREE.Vector3((Math.random() - 0.5) * 0.9, 0.7 + Math.random() * 0.7, toward * (4.4 + Math.random() * 2.2)),
        color: i % 4 === 0 ? "#ffffff" : colour,
        life: 0.26 + Math.random() * 0.1,
        startScale: 0.32,
        endScale: 0.04,
        texture: i % 3 === 0 ? "spark" : "soft",
      });
    }
  }

  /**
   * The shadow-and-spill a held card casts on the arena under it.
   *
   * §3's secondary motion, applied to the one interaction the whole game is
   * made of. Measured before this existed: a card held over the mat changed
   * nothing anywhere near the pointer — the board lit a socket at the row, a
   * hundred-odd pixels away, and the ground directly beneath the object being
   * carried stayed exactly as it was. Every physical object held over a lit
   * surface darkens it and, if the object glows, spills onto it; a card that
   * does neither is a picture sliding over a photograph.
   *
   * Two quads rather than one, because the two halves behave differently. The
   * shade is normal-blended and takes light *away*, which is the half that makes
   * the card read as being above the floor rather than printed on it; the spill
   * is additive and carries the legality colour, which is the half that answers
   * "will this work". Both are pooled, both are transform-only per frame, and
   * both are `depthWrite: false` so they never fight the mat for the depth
   * buffer.
   *
   * It survives reduced motion. The setting kills decoration; this is the
   * functional answer to a question the player has asked by picking a card up,
   * and §3 is explicit that the functional layer stays. What it loses is the
   * breathing — under the setting the pool is simply present at a fixed size.
   */
  const dragShade = new THREE.Mesh(
    new THREE.PlaneGeometry(3.7, 3.7),
    new THREE.MeshBasicMaterial({
      map: textures.soft,
      color: 0x080512,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.NormalBlending,
      fog: false,
    })
  );
  dragShade.rotation.x = -Math.PI / 2;
  dragShade.renderOrder = 7;
  dragShade.visible = false;
  scene.fxGroup.add(dragShade);

  const dragSpill = new THREE.Mesh(
    new THREE.PlaneGeometry(5.2, 5.2),
    new THREE.MeshBasicMaterial({
      map: textures.soft,
      color: 0x7dffb0,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    })
  );
  dragSpill.rotation.x = -Math.PI / 2;
  dragSpill.renderOrder = 8;
  dragSpill.visible = false;
  scene.fxGroup.add(dragSpill);

  /** 0 while nothing is carried, 1 while something is; eased in `update`. */
  let dragStrength = 0;
  let dragWanted = 0;

  function dragPool(point: THREE.Vector3 | null, state: "valid" | "blocked"): void {
    if (!point) {
      dragWanted = 0;
      return;
    }
    dragWanted = 1;
    dragShade.visible = true;
    dragSpill.visible = true;
    /**
     * Just clear of the mat and of the row inlay the board draws at 0.02, and
     * below the flight plane so a card in the air is always above its own pool.
     *
     * The shade is offset down-and-right of the spill rather than concentric
     * with it, because the key light is at 315° everywhere in this game and a
     * shadow cast straight down is the tell that a thing was composited rather
     * than lit. 0.42 world units at this framing is about eleven screen pixels,
     * which reads as "held above the table" without detaching.
     */
    dragShade.position.set(point.x + 0.42, 0.03, point.z + 0.42);
    dragSpill.position.set(point.x, 0.028, point.z);
    (dragSpill.material as THREE.MeshBasicMaterial).color.setHex(state === "blocked" ? 0xff3b5c : 0x7dffb0);
  }

  function impact(position: THREE.Vector3, amount: number, elemental: boolean): void {
    if (reduced()) {
      screenFlash(elemental ? "#ffd86b" : "#ff4d6a", 0.12);
      return;
    }
    const color = elemental ? "#ffd86b" : "#ff6b6b";
    const count = Math.min(26, 8 + amount * 3);

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2.2 + Math.random() * 3.4;
      spawn({
        position: position.clone().setY(0.5),
        velocity: new THREE.Vector3(Math.cos(angle) * speed, 1.2 + Math.random() * 2.4, Math.sin(angle) * speed * 0.6),
        color: i % 4 === 0 ? "#ffffff" : color,
        life: 0.28 + Math.random() * 0.3,
        startScale: 0.3,
        endScale: 0.02,
        texture: i % 3 === 0 ? "spark" : "soft",
      });
    }
    spawn({
      position: position.clone().setY(0.4),
      velocity: new THREE.Vector3(),
      color,
      life: 0.26,
      startScale: 0.5,
      endScale: 3.1,
      texture: "ring",
    });
    if (elemental) screenFlash("#ffd86b", 0.16);
  }

  /**
   * The white contact spark, struck where the two silhouettes actually meet.
   *
   * The reference is specific and worth following exactly: the flash sits on the
   * defender's *near rim*, on the line between the pair — not at its centre —
   * and lasts a single frame. The sparks are then thrown along the attack vector
   * *through and past* the defender rather than radiating symmetrically. That
   * direction is what sells force; a centred puff reads as a firework instead.
   */
  let lastSpark: { position: THREE.Vector3; direction: THREE.Vector3 } | null = null;
  const lastContactSpark = (): { position: THREE.Vector3; direction: THREE.Vector3 } | null => lastSpark;

  function contactSpark(position: THREE.Vector3, direction: THREE.Vector3): void {
    if (reduced()) return;
    lastSpark = { position: position.clone(), direction: direction.clone() };

    const along = direction.lengthSq() > 1e-6 ? direction.clone().normalize() : new THREE.Vector3(0, 0, -1);
    // sideways in the ground plane, for spreading the spray about the vector
    const across = new THREE.Vector3(-along.z, 0, along.x);

    // the one-frame cream puff
    spawn({
      position: position.clone().setY(0.55),
      velocity: along.clone().multiplyScalar(0.6),
      color: "#fffaf0",
      life: 0.14,
      startScale: 0.85,
      endScale: 1.9,
      texture: "soft",
    });

    // 8-12 golden sparks continuing past the defender
    const count = Math.min(12, Math.max(8, Math.floor(budget() * 0.03)));
    for (let i = 0; i < count; i++) {
      const spread = (Math.random() - 0.5) * 0.85;
      const speed = 7.5 + Math.random() * 5.5;
      const velocity = along
        .clone()
        .multiplyScalar(speed)
        .addScaledVector(across, spread * speed * 0.42)
        .setY(1.1 + Math.random() * 1.6);
      spawn({
        position: position.clone().setY(0.45),
        velocity,
        color: i % 3 === 0 ? "#ffffff" : "#ffd48a",
        life: 0.16 + Math.random() * 0.12,
        startScale: 0.34,
        endScale: 0.02,
        texture: "spark",
      });
    }
  }

  function heal(position: THREE.Vector3, amount: number): void {
    if (reduced()) return;
    const count = Math.min(16, 5 + amount * 2);
    for (let i = 0; i < count; i++) {
      spawn({
        position: position
          .clone()
          .setY(0.15)
          .add(new THREE.Vector3((Math.random() - 0.5) * 1.1, 0, (Math.random() - 0.5) * 1.1)),
        velocity: new THREE.Vector3((Math.random() - 0.5) * 0.4, 1.5 + Math.random(), (Math.random() - 0.5) * 0.4),
        color: i % 3 === 0 ? "#ffffff" : "#7dffb0",
        life: 0.7 + Math.random() * 0.3,
        startScale: 0.26,
        endScale: 0.04,
      });
    }
  }

  function statusPop(position: THREE.Vector3, color: string): void {
    if (reduced()) return;
    spawn({
      position: position.clone().setY(0.55),
      velocity: new THREE.Vector3(0, 0.6, 0),
      color,
      life: 0.4,
      startScale: 0.4,
      endScale: 2.2,
      texture: "ring",
    });
  }

  function defeat(position: THREE.Vector3): void {
    if (reduced()) return;
    for (let i = 0; i < 22; i++) {
      const angle = Math.random() * Math.PI * 2;
      spawn({
        position: position.clone().setY(0.3),
        velocity: new THREE.Vector3(Math.cos(angle) * 1.6, 0.4 + Math.random() * 1.2, Math.sin(angle) * 1.6),
        color: i % 2 === 0 ? "#5a4a7a" : "#2a1f40",
        life: 0.6 + Math.random() * 0.4,
        startScale: 0.42,
        endScale: 0.02,
        additive: false,
      });
    }
  }

  /** Confluence flourish: two Current colours spiral together over the board. */
  function confluence(id: ConfluenceId, currents: [CurrentId, CurrentId]): void {
    void id;
    if (reduced()) {
      screenFlash(CURRENT_PALETTE[currents[0]]?.key ?? "#b56cff", 0.2);
      return;
    }
    const a = CURRENT_PALETTE[currents[0]] ?? CURRENT_PALETTE.prism;
    const b = CURRENT_PALETTE[currents[1]] ?? CURRENT_PALETTE.prism;
    const centre = new THREE.Vector3(0, 0.6, -0.6);

    const count = Math.min(64, Math.floor(budget() * 0.2));
    for (let i = 0; i < count; i++) {
      const t = i / count;
      const angle = t * Math.PI * 6;
      const radius = 5.2 * (1 - t) + 0.4;
      spawn({
        position: centre.clone().add(new THREE.Vector3(Math.cos(angle) * radius, t * 1.6, Math.sin(angle) * radius * 0.55)),
        velocity: new THREE.Vector3(-Math.cos(angle) * 1.4, 0.9, -Math.sin(angle) * 0.8),
        color: i % 2 === 0 ? a.key : b.key,
        life: 0.65 + t * 0.4,
        startScale: 0.36,
        endScale: 0.02,
        texture: i % 5 === 0 ? "spark" : "soft",
      });
    }
    spawn({ position: centre, velocity: new THREE.Vector3(), color: "#ffffff", life: 0.5, startScale: 0.5, endScale: 8, texture: "ring" });
    screenFlash(a.key, 0.22);
  }

  /** Perfect Resonance: a full-board wave in the deck's Current colour. */
  function resonance(current: CurrentId): void {
    const palette = CURRENT_PALETTE[current] ?? CURRENT_PALETTE.prism;
    screenFlash(palette.key, 0.3);
    if (reduced()) return;

    for (let ring = 0; ring < 3; ring++) {
      window.setTimeout(() => {
        spawn({
          position: new THREE.Vector3(0, 0.4, -0.6),
          velocity: new THREE.Vector3(),
          color: palette.key,
          life: 0.8,
          startScale: 0.6,
          endScale: 13,
          texture: "ring",
        });
      }, ring * 140);
    }

    const count = Math.min(90, Math.floor(budget() * 0.28));
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 7;
      spawn({
        position: new THREE.Vector3(Math.cos(angle) * radius, 0.1, Math.sin(angle) * radius * 0.6 - 0.6),
        velocity: new THREE.Vector3(0, 2 + Math.random() * 2.4, 0),
        color: i % 3 === 0 ? palette.hi : palette.key,
        life: 0.9 + Math.random() * 0.5,
        startScale: 0.3,
        endScale: 0.02,
      });
    }
  }

  // --- screen flash (DOM, so it covers the HUD too) -------------------------
  const flash = document.createElement("div");
  flash.className = "vfx-flash";
  scene.renderer.domElement.parentElement?.appendChild(flash);

  function screenFlash(color: string, intensity: number): void {
    if (getSettings().reducedMotion) intensity = Math.min(intensity, 0.1);
    flash.style.background = color;
    flash.style.opacity = String(intensity);
    window.setTimeout(() => {
      flash.style.opacity = "0";
    }, 60);
  }

  // --- frame update ---------------------------------------------------------
  function update(delta: number, elapsed: number): void {
    /**
     * The carried card's pool, eased rather than switched.
     *
     * A pool that appears on the frame the pointer first crosses the mat and
     * vanishes on the frame it leaves is two pops per drag, which §7 forbids
     * outright. `tau` here is ~90ms in and ~90ms out, which is inside §3's
     * micro-feedback band and short enough that the answer still feels
     * immediate.
     */
    if (dragStrength !== dragWanted) {
      const lerp = 1 - Math.pow(0.0005, delta);
      dragStrength += (dragWanted - dragStrength) * lerp;
      if (Math.abs(dragStrength - dragWanted) < 0.004) dragStrength = dragWanted;
      if (dragStrength === 0) {
        dragShade.visible = false;
        dragSpill.visible = false;
      }
    }
    if (dragStrength > 0) {
      // A slow swell while the card hovers, so the ground under a held card is
      // alive rather than a decal. Pinned at its midpoint under reduced motion.
      const breath = getSettings().reducedMotion ? 1 : 1 + Math.sin(elapsed * 3.1) * 0.06;
      /**
       * The shade carries most of the weight and the spill only tints its edge.
       *
       * First tuning had them the other way round and photographed badly: the
       * pool washed the player's own leader medallion green whenever the pointer
       * passed over it, which is a coloured lie about an object that has nothing
       * to do with the drag. A shadow is never a lie — every card held over a lit
       * table casts one — and the colour is only there to say *which* answer the
       * shadow's owner is getting.
       */
      (dragShade.material as THREE.MeshBasicMaterial).opacity = dragStrength * 0.62;
      (dragSpill.material as THREE.MeshBasicMaterial).opacity = dragStrength * 0.15 * breath;
      dragShade.scale.setScalar(0.86 + dragStrength * 0.14);
      dragSpill.scale.setScalar((0.8 + dragStrength * 0.2) * breath);
    }

    for (let i = active.length - 1; i >= 0; i--) {
      const particle = active[i]!;
      particle.life -= delta;

      if (particle.life <= 0) {
        particle.sprite.visible = false;
        active.splice(i, 1);
        pool.push(particle);
        continue;
      }

      const t = 1 - particle.life / particle.maxLife;
      particle.sprite.position.addScaledVector(particle.velocity, delta);
      particle.velocity.y -= 3.4 * delta; // gravity
      particle.velocity.multiplyScalar(1 - 1.6 * delta); // drag

      const scale = particle.startScale + (particle.endScale - particle.startScale) * t;
      particle.sprite.scale.setScalar(Math.max(0.001, scale));
      (particle.sprite.material as THREE.SpriteMaterial).opacity = Math.pow(1 - t, particle.fadePower);
    }
  }

  function dispose(): void {
    for (const particle of [...active, ...pool]) {
      particle.sprite.removeFromParent();
      (particle.sprite.material as THREE.SpriteMaterial).dispose();
    }
    active.length = 0;
    pool.length = 0;
    for (const mesh of [dragShade, dragSpill]) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    for (const texture of Object.values(textures)) texture.dispose();
    flash.remove();
    group.removeFromParent();
  }

  const busy = (): boolean => active.length > 0;

  return { summonBurst, landing, turnSweep, dragPool, busy, impact, contactSpark, lastContactSpark, heal, statusPop, confluence, resonance, defeat, screenFlash, update, dispose };
}
