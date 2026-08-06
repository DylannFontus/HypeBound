/**
 * The battle view: keeps 3D card objects in sync with the match state, lays
 * out the hand fan and board rows, and handles pointer interaction
 * (drag a card to a slot to play it, drag a character to an enemy to attack).
 *
 * It never decides rules — it asks the engine what is legal, shows that, and
 * emits PlayerIntents. Damage previews come from the engine's predict API.
 */

import * as THREE from "three";
import type {
  CardDef,
  CharacterInstance,
  ContentIndex,
  CurrentId,
  MatchState,
  PlayerIntent,
  PlayerView,
  Seat,
  TargetRef,
} from "../../engine/types";
import { checkPlayable, legalEquipTargets } from "../../engine/intents";
import { canAttack, legalAttackTargets, previewAttack } from "../../engine/combat";
import { boardOf } from "../../engine/state";
import { totalAttack } from "../../engine/effects";
import { createBattleScene, BOARD, type BattleSceneHandles, type QualityTier } from "./scene";
import { resolveBoardImage } from "../art/boards";
import { createBoard, type BoardHandles } from "./board";
import { CardObject, getCardTexture, invalidateCardTextures, type CardFaceState } from "./cardMesh";
import { onArtLoaded } from "../art/artLoader";
import { LeaderObject } from "./leaderMesh";
import { CURRENT_PALETTE } from "../cardRenderer/palette";
import { createTargetingLayer, type TargetingLayer } from "./targeting";
import { createVfx, type VfxLayer } from "./vfx";
import { HOLD_MS, HOLD_TOLERANCE_PX } from "./gestures";
import { getSettings } from "../../save/settings";
import { EASE, motionEnabled, stagger, tween } from "../motion";
/**
 * One reconstruction of a `MatchState` from a `PlayerView`, not two.
 *
 * This file used to carry its own `buildStateProxy` — seventy lines that did
 * the same job as `net/viewToState.ts` and did it slightly worse: it gave the
 * opponent **empty** hidden zones where `viewToState` keeps count-preserving
 * placeholders. That difference is not cosmetic. `topOfDeckMatches` reads
 * `deck[0]`, which under the old proxy was `undefined`, and any effect
 * predicate counting cards in the opponent's hand saw zero rather than the
 * number the player can see on screen.
 *
 * `viewToState` is also the one that was checked: phase 2 compared it against
 * the engine at ~48 positions across both seats with zero disagreements. The
 * proxy had no test at all.
 */
import { viewToState } from "../../net/viewToState";

export interface BattleViewCallbacks {
  onIntent: (intent: PlayerIntent) => void;
  /** the view asks the host to show a card's details (right-click) */
  onInspect: (card: CardDef) => void;
  /**
   * Show the card enlarged for as long as a press is held, and return the
   * closer. The peek must not swallow pointer events — see startHoldInspect.
   */
  onPeek: (card: CardDef) => () => void;
  /** a card needs targets the board cannot supply — host opens a chooser */
  onNeedsTargets: (instanceId: string, slot: number | undefined) => void;
  /**
   * Whether the ground under the dragged card would take it.
   *
   * The board lights its own socket; this is how the *card* learns the same
   * thing, so an illegal drop reads as illegal at the cursor rather than only
   * forty pixels below it. Optional so a host that has no hand bar (the keyboard
   * path, the tests) does not have to supply one.
   */
  onDropFeedback?: (state: "valid" | "blocked" | "neutral") => void;
}

interface DragState {
  kind: "playCard" | "attack";
  object: CardObject;
  instanceId: string;
  pointerId: number;
  /** legal drop targets while dragging */
  legalTargets: TargetRef[];
  legalSlots: number[];
  hoverTarget: TargetRef | null;
  hoverSlot: number | null;
  originPosition: THREE.Vector3;
}

export class BattleView {
  readonly scene: BattleSceneHandles;
  private readonly board: BoardHandles;
  private readonly targeting: TargetingLayer;
  readonly vfx: VfxLayer;

  private readonly boardObjects = new Map<string, CardObject>();
  /** while dragging a character over your row, the index the gap opens at */
  private makeRoomIndex: number | null = null;
  /**
   * The arena's last answer about the pointer, kept for `debugState`.
   *
   * Written on every `externalDragMove` and read by nothing in the game. It
   * exists because the alternative — inferring the play zone from screenshots —
   * is how the zone's own asymmetry survived two reviews.
   */
  private dropProbe: Record<string, unknown> | null = null;
  private readonly leaderObjects = new Map<"player" | "enemy", LeaderObject>();
  private leadersBuilt = false;
  private view: PlayerView | null = null;
  /** MatchState rebuilt from the redacted view, invalidated on every sync */
  private proxy: MatchState | null = null;
  private drag: DragState | null = null;
  /** a card being dragged out of the DOM hand bar onto the board */
  private externalDrag: {
    instanceId: string;
    legalTargets: TargetRef[];
    legalSlots: number[];
    hoverTarget: TargetRef | null;
    hoverSlot: number | null;
    needsSlot: boolean;
  } | null = null;
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;
  /** suspended while the presenter is animating so layout does not fight it */
  private layoutLocked = false;
  /** The backdrop is chosen once, on the first sync, from the opponent. */
  private backdropApplied = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly content: ContentIndex,
    private readonly callbacks: BattleViewCallbacks,
    quality?: QualityTier
  ) {
    this.scene = quality ? createBattleScene(container, quality) : createBattleScene(container);
    this.board = createBoard(this.scene.quality);
    this.scene.boardGroup.add(this.board.group);
    this.targeting = createTargetingLayer(container);
    this.vfx = createVfx(this.scene);

    this.attachPointerHandlers();
    this.unsubscribeArt = this.watchArt();
    this.loop();
  }

  private readonly unsubscribeArt: () => void;

  /**
   * ## The painted portrait that turned back into the art-pending plate
   *
   * Reported as intermittent and it is not: it is deterministic, and this file
   * causes it. Warming is aggressive — every character in the hand gets two
   * faces drawn the moment it is dealt, every token on the board gets two or
   * three, and a batch's faces are drawn before its first beat — and all of that
   * starts within a few hundred milliseconds of the match opening, which is
   * *before* the card art has finished loading off disk. `getCardArt` returns
   * null while a PNG is in flight, so those faces are drawn with the placeholder
   * and cached under their own keys.
   *
   * `CardObject` already recovers from this for itself: it subscribes to
   * `onArtLoaded`, drops the card's cached faces and rebuilds. But the guard only
   * exists where a `CardObject` exists, and the faces that go stale are mostly
   * for cards that have no token yet — a character sitting in the hand, or one
   * still in the rival's deck. The art lands, nobody invalidates those entries,
   * and the placeholder face is served from cache for the rest of the match: the
   * card is played, its token appears wearing the art-pending plate, and the same
   * card at the same stats in the collection is painted.
   *
   * Dropping the cached faces for **every** card whose art arrives, whether or
   * not anything is currently showing it, closes the whole class. Un-warming this
   * view's own keys with them is what lets the idle queue draw them again — with
   * the painting this time — rather than believing the job is already done.
   */
  private watchArt(): () => void {
    return onArtLoaded((cardId) => {
      invalidateCardTextures(cardId);
      const prefix = `${cardId}|`;
      for (const key of [...this.faceWarmed]) {
        if (key.startsWith(prefix)) this.faceWarmed.delete(key);
      }
      if (this.view) this.warmHandFaces(this.view);
    });
  }

  // -------------------------------------------------------------------------
  // State sync
  // -------------------------------------------------------------------------

  /**
   * Rebuild the 3D board and hand from a redacted player view.
   *
   * ## The 950ms hole, and where it actually was
   *
   * Measured on a 60fps screencast: mouse-up at t=0, the drag ghost gone by
   * t≈230ms, and then **the player's row was empty from t≈250ms to t≈1140ms** —
   * the object the player had just dragged existed nowhere on screen for nine
   * hundred milliseconds, against §3's 600ms cap for the whole play. Every
   * previous round treated that as an animation-timing problem and shortened
   * sleeps. It was not. It was this method returning early.
   *
   * `setLayoutLocked(true)` is taken for the *whole* event batch, and this
   * used to `return` before `syncBoard()` whenever it was set. So a played card
   * did not get a token when `cardPlayed` fired, nor when `characterSummoned`
   * fired — it got one in the `finally` of `presenter.play`, after every trigger
   * chip, every damage beat and every status pop in the batch had finished
   * sleeping. The lock exists for one real reason: a token must not be deleted
   * out from under the defeat animation that is playing on it. So that is now
   * the only thing it defers. Arrivals are immediate, departures wait.
   */
  sync(view: PlayerView): void {
    this.view = view;
    this.proxy = null; // rebuilt lazily from the new view
    this.applyBackdrop();
    /**
     * The piles are a readout, so they are synced even while the presenter has
     * layout locked: a deck stack that only updates once an animation queue
     * drains is a deck stack that lies for a second every turn.
     */
    this.board.setResources("player", view.you.deck.length, view.you.discard.length);
    this.board.setResources("enemy", view.opponent.deckCount, view.opponent.discard.length);
    this.syncBoard();
    this.layout();
    this.warmHandFaces(view);
  }

  /**
   * Choose the board, once, from who you are playing.
   *
   * Resolved on the first sync rather than in the constructor because that is
   * the first moment the opponent is known — and it is still early enough that
   * the picture arrives during the mulligan rather than over the first turn.
   *
   * Everything about this degrades. An unknown faction falls back to the
   * default board, a default board that does not exist resolves to null, and
   * null is the flat void the game has always used. There is no state in which
   * a missing file produces anything other than the original look.
   */
  private applyBackdrop(): void {
    if (this.backdropApplied || !this.view) return;
    this.backdropApplied = true;

    const leaderCardId = this.view.opponent.leaderCardId;
    const faction = this.content.leaders[leaderCardId]?.faction;
    // Boss leaders are identified by id. The encounter data does not carry a
    // "this is a boss" flag the view can see, and the naming has been
    // consistent across every boss in the set.
    const isBoss = leaderCardId.startsWith("boss-");

    void resolveBoardImage(faction, isBoss).then((image) => {
      // The match can end while a 4K image decodes.
      if (!this.disposed) this.scene.setBackdrop(image);
    });
  }

  /**
   * Leader portraits sit on the podiums bracketing the rows, matching the
   * reference's hero placement. They are static planes; health and resources
   * live in the DOM plates so they stay crisp and screen-reader friendly.
   */
  private syncLeaders(): void {
    const view = this.view;
    if (!view || this.leadersBuilt) return;

    for (const [side, leaderCardId] of [
      ["player", view.you.leaderCardId],
      ["enemy", view.opponent.leaderCardId],
    ] as const) {
      const card = this.content.leaders[leaderCardId];
      if (!card) continue;
      const position = this.board.leaderPosition(side);
      const player = side === "player" ? view.you : view.opponent;
      const token = new LeaderObject(
        card,
        { health: player.leaderHealth, maxHealth: player.leaderMaxHealth, armor: player.armor },
        side
      );
      // lifted clear of the arena plate so nothing occludes the portrait
      token.position.set(position.x, 0.16, position.z);
      this.scene.boardGroup.add(token);
      this.leaderObjects.set(side, token);
    }
    this.leadersBuilt = true;
  }

  private syncBoard(): void {
    const view = this.view;
    if (!view) return;
    this.syncLeaders();

    // keep the leader portraits' health and armour current
    for (const [side, token] of this.leaderObjects) {
      const player = side === "player" ? view.you : view.opponent;
      token.setState({
        health: player.leaderHealth,
        maxHealth: player.leaderMaxHealth,
        armor: player.armor,
      });
    }

    const seen = new Set<string>();
    const rows: { characters: (CharacterInstance | null)[]; side: "player" | "enemy"; seat: Seat }[] = [
      { characters: view.you.board, side: "player", seat: view.seat },
      { characters: view.opponent.board, side: "enemy", seat: view.opponent.seat },
    ];

    for (const row of rows) {
      const occupied = row.characters.filter((c): c is CharacterInstance => c !== null);
      occupied.forEach((character, index) => {
        seen.add(character.instanceId);
        let object = this.boardObjects.get(character.instanceId);
        if (!object) {
          const card = this.content.cards[character.cardId];
          if (!card) return;
          const spawn = this.board.rowPosition(row.side, index, occupied.length);
          object = new CardObject(card, true, {
            kind: "board",
            instanceId: character.instanceId,
            cardId: character.cardId,
            seat: character.controller,
          });
          // Lies flat on the arena. Under the orthographic overhead camera a
          // flat card reads square-on with no foreshortening, so the whole
          // card — art, frame, stats — stays legible.
          object.targetRotation.set(-Math.PI / 2, 0, 0);
          object.rotation.copy(object.targetRotation);
          object.targetPosition.copy(spawn);

          this.scene.cardGroup.add(object);
          this.boardObjects.set(character.instanceId, object);

          /**
           * Every token that appears on this board flies in from somewhere the
           * player can point at, and there is exactly one code path for it.
           *
           * A card the player just released **becomes** the drag ghost: the
           * ghost's screen-space centre is unprojected onto the flight plane and
           * the token is placed there at the ghost's own apparent size, so the
           * two are the same silhouette at the same place at the same scale on
           * the same frame. The ghost then cross-fades out over 90ms and the
           * token carries the movement. Nothing is destroyed and respawned; §3a
           * forbids exactly that, and the previous build did it with a 900ms gap
           * in the middle.
           *
           * A card the *rival* plays flies out of the rival's deck stack, so a
           * play that used to materialise in place now visibly comes from a
           * pile the player can see draining.
           */
          const handoff = this.takeHandoff(character.cardId, row.side);
          const entry = handoff ?? this.deckEntry(row.side);
          this.flyIntoSlot(object, entry.position, entry.scale, character.current as CurrentId);
        }

        const attack = totalAttack(this.stateProxy(), this.content, character);
        object.syncFromCharacter(character, this.highlightFor(character), attack);
        this.warmAlternateFaces(character, attack, row.side);
      });
    }

    /**
     * Departures, and the one thing the layout lock is still for.
     *
     * A token removed the instant the engine says it died takes the defeat
     * animation with it — the presenter grabs the object, asks the vfx layer to
     * burst at its position and then sleeps, and if the object is gone by then
     * there is nothing to burst at. Arrivals have no such constraint, which is
     * why they no longer wait.
     */
    if (this.layoutLocked) return;
    for (const [instanceId, object] of [...this.boardObjects]) {
      if (seen.has(instanceId)) continue;
      this.scene.cardGroup.remove(object);
      object.dispose();
      this.boardObjects.delete(instanceId);
    }
  }

  // -------------------------------------------------------------------------
  // The flight: one object, from wherever it came from, into its slot
  // -------------------------------------------------------------------------

  /**
   * How high above the mat a card travels while it is in the air. It is the
   * plane the released ghost is unprojected onto, so the handoff and the flight
   * agree about where "in the air" is.
   */
  private static readonly FLIGHT_Y = 0.9;

  /** Where the pointer (or any screen point) meets a horizontal plane. */
  private pointerOnPlane(clientX: number, clientY: number, y: number): THREE.Vector3 | null {
    const rect = this.scene.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.scene.camera);
    const point = new THREE.Vector3();
    return raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), point) ? point : null;
  }

  /**
   * The world scale at which a board token covers `widthPx` screen pixels at a
   * given point, so the token can be handed a DOM element's apparent size
   * rather than a hard-coded number that would be wrong at every other viewport.
   */
  private scaleForWidth(at: THREE.Vector3, widthPx: number): number {
    const centre = this.scene.project(at.clone());
    const edge = this.scene.project(at.clone().setX(at.x + BOARD.cardWidth / 2));
    const halfPx = Math.abs(edge.x - centre.x);
    if (halfPx < 1) return 1;
    return Math.max(0.3, Math.min(2.4, widthPx / 2 / halfPx));
  }

  /** The rival's (or your own) deck stack, as a flight origin. */
  private deckEntry(side: "player" | "enemy"): { position: THREE.Vector3; scale: number } {
    const deck = this.board.deckPosition(side);
    return { position: deck.setY(BattleView.FLIGHT_Y), scale: 0.62 };
  }

  /**
   * Fly a token from wherever it came from into the slot it is going to.
   *
   * 300ms on `EASE.overshoot`, which is inside §3's 600ms cap for a whole card
   * play with room left over for the presenter's beats to overlap it. The
   * overshoot is deliberate and is why the tween drives the object directly
   * instead of nudging its easing targets: a curve whose value passes 1 on the
   * way to 1 is what makes a placement feel like it hit something, and the
   * token's own exponential ease can only approach.
   *
   * `targetPosition` is read every frame rather than captured, so a row that
   * re-centres mid-flight (because a second card arrived, or the window
   * resized) redirects the card instead of stranding it.
   */
  private flyIntoSlot(
    object: CardObject,
    from: THREE.Vector3,
    fromScale: number,
    current: CurrentId
  ): void {
    const start = from.clone();
    if (!motionEnabled()) {
      object.position.copy(object.targetPosition);
      object.scale.setScalar(1);
      this.landToken(object, current);
      return;
    }
    const arc = Math.max(0.45, start.distanceTo(object.targetPosition) * 0.075);
    object.position.copy(start);
    object.scale.setScalar(fromScale);
    object.flightHold = true;
    // Counted, not merely flagged: `prewarmBatch`'s drain checks this every
    // frame and a card render landing mid-flight is exactly the stall the whole
    // mechanism exists to move somewhere else.
    this.flightsInAir += 1;
    tween({
      from: 0,
      to: 1,
      ms: 300,
      ease: EASE.overshoot,
      onUpdate: (t) => {
        const to = object.targetPosition;
        const lift = Math.sin(Math.PI * Math.min(1, Math.max(0, t))) * arc;
        object.position.set(
          start.x + (to.x - start.x) * t,
          start.y + (to.y - start.y) * t + lift,
          start.z + (to.z - start.z) * t
        );
        object.scale.setScalar(Math.max(0.2, fromScale + (1 - fromScale) * t));
      },
      onDone: () => {
        object.flightHold = false;
        this.flightsInAir = Math.max(0, this.flightsInAir - 1);
        this.lastFlightAt = performance.now();
        object.position.copy(object.targetPosition);
        object.scale.setScalar(1);
        this.landToken(object, current);
        // The landing burst is the tail of the flight and it is still moving, so
        // the drain waits one more beat rather than firing on the contact frame.
        window.setTimeout(() => this.scheduleSoonWarm(), 360);
      },
    });
  }

  /**
   * The moment of contact, and the three things that happen because of it.
   *
   * §3's secondary motion, measured as absent: over a whole landing the mat
   * 140px to the left of the arriving card changed by a mean of 1.1–4.4, i.e.
   * nothing on the board reacted to a card being put on it. Now the card's own
   * Current floods the floor under it, dust lifts off the mat, and the two
   * nearest tokens in the row give way and settle back.
   */
  private landToken(object: CardObject, current: CurrentId): void {
    const at = object.targetPosition.clone();
    object.flare(1);
    this.vfx.summonBurst(at, current);
    this.vfx.landing(at, current);
    this.nudgeNeighbours(object);
  }

  /** The two nearest tokens in the same row recoil, then settle. */
  private nudgeNeighbours(landed: CardObject): void {
    if (!motionEnabled()) return;
    const seat = landed.userData["seat"];
    const x = landed.targetPosition.x;
    const z = landed.targetPosition.z;
    const neighbours = [...this.boardObjects.values()]
      .filter(
        (other) =>
          other !== landed &&
          other.userData["seat"] === seat &&
          Math.abs(other.targetPosition.z - z) < 0.6
      )
      .sort((a, b) => Math.abs(a.targetPosition.x - x) - Math.abs(b.targetPosition.x - x))
      .slice(0, 2);

    for (const [index, other] of neighbours.entries()) {
      const away = Math.sign(other.targetPosition.x - x) || 1;
      const amount = 0.34 / (1 + index * 0.8);
      tween({
        from: 1,
        to: 0,
        ms: 280,
        ease: EASE.arrive,
        onUpdate: (value) => {
          other.animOffset.x = away * amount * value;
        },
        onDone: () => {
          other.animOffset.x = 0;
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Card faces, drawn before the frame that needs them
  // -------------------------------------------------------------------------

  /**
   * ## The 164ms the game stopped, every time a card was played
   *
   * Measured on a 60fps screencast of a play: three *identical* frames from
   * t+12ms to t+160ms after the mouse-up, and a `longtask` entry of 164ms
   * starting at t+2ms. The card was not animating badly during that window; the
   * browser was not painting at all. A CPU profile over the same window put
   * 104ms of it in one call chain — `syncBoard` → `new CardObject` →
   * `getCardTexture` → `renderCard` — with `drawImage` and `fillRect` at the
   * bottom of it. A board token's face is a full card drawn into a 2D canvas at
   * 1.6x, and it was being drawn **on the frame the token appeared**, which is
   * the single frame in the whole interaction that could least afford it.
   *
   * Worse, it happened twice: `CardObject`'s constructor asks for the plain face
   * and `syncFromCharacter` immediately asks for the board face with live stats,
   * so the first render is thrown away before it is ever shown.
   *
   * And it is not only the play. `highlightFor` gives a friendly character the
   * "can act" ring on your turn and nothing on the rival's, so **every friendly
   * token re-renders its face at every handover**. Profiled across one turn
   * change: 434ms inside `syncBoard`, 407ms of it inside `renderCard`.
   *
   * None of those renders is avoidable and none of them is wrong — they are
   * simply happening at the wrong time. Every one of them is predictable
   * seconds in advance: the moment a card leaves the hand we know the two faces
   * its token will ask for, and the moment a token is on the board we know the
   * two highlights it will alternate between for the rest of the match. So they
   * are drawn *then*, in the browser's idle time, into the cache
   * `getCardTexture` already keeps — and the frame that needs them gets a map
   * lookup instead of a card render.
   *
   * One face per idle callback, deliberately. A card render is ~50ms and an idle
   * slice is ~50ms; two in a row is a dropped frame in the quiet moment rather
   * than in the loud one, which is not a trade worth making.
   */
  private readonly faceQueue: { key: string; card: CardDef; state: CardFaceState }[] = [];
  private readonly faceWarmed = new Set<string>();
  private faceScheduled = false;

  /** Mirrors `cacheKey` in cardMesh closely enough to dedupe our own queue. */
  private faceKey(card: CardDef, state: CardFaceState): string {
    return [
      card.id,
      state.attack ?? "-",
      state.health ?? "-",
      state.maxHealth ?? "-",
      state.highlight ?? "none",
      state.statEmphasis ? "s" : "",
    ].join("|");
  }

  /**
   * `"soon"` is a third rung above `urgent`, and the distinction is which clock
   * the work is allowed to wait on. An idle callback is the browser's opinion of
   * when there is time; `"soon"` is ours, and it is used only for faces a batch
   * of engine events is definitely about to ask for within the second.
   */
  private warmFace(card: CardDef, state: CardFaceState, urgency: boolean | "soon" = false): void {
    const key = this.faceKey(card, state);
    if (this.faceWarmed.has(key)) return;
    /**
     * The set is a *hint*, not a ledger: `getCardTexture` keeps 160 faces and
     * evicts by least-recently-used, so a long match can drop something this
     * still believes is warm. Being wrong costs one uncached render, which is
     * exactly what the situation was before, so it is allowed to be wrong. It
     * is cleared wholesale rather than pruned because there is nothing here
     * worth the bookkeeping.
     */
    if (this.faceWarmed.size > 220) this.faceWarmed.clear();
    this.faceWarmed.add(key);

    if (urgency === "soon") {
      this.soonQueue.push({ key, card, state });
      // One batch's worth. Beyond that the board has changed more than a single
      // handover can animate and the idle queue is the right place for the rest.
      while (this.soonQueue.length > 14) {
        const dropped = this.soonQueue.pop();
        if (dropped) this.faceWarmed.delete(dropped.key);
      }
      this.scheduleSoonWarm();
      return;
    }

    if (urgency) this.faceQueue.unshift({ key, card, state });
    else this.faceQueue.push({ key, card, state });
    // A queue that outgrows the moment it was filled for is stale work; drop the
    // tail rather than spending idle time drawing faces nobody is waiting for.
    while (this.faceQueue.length > 32) {
      const dropped = this.faceQueue.pop();
      if (dropped) this.faceWarmed.delete(dropped.key);
    }
    this.scheduleFaceWarm(urgency === true);
  }

  /**
   * A hard floor between two warm renders, and it is not a tidiness knob.
   *
   * Without it the queue drained as fast as the browser handed out idle slices,
   * and three ~55ms card renders landed inside one window: measured on a
   * screencast of a drag, a **180ms long task 360ms before the drop**. The drag
   * ghost is moved by a pointermove handler on the main thread, so that block is
   * the card freezing under the cursor — a new stutter bought with the one this
   * whole mechanism exists to remove, which is not a trade. Spaced out, the
   * worst case is a single dropped frame at a time, and a drag has several
   * hundred milliseconds to spend.
   */
  private static readonly FACE_WARM_SPACING = 120;

  private scheduleFaceWarm(urgent: boolean): void {
    if (this.faceScheduled || this.faceQueue.length === 0) return;
    this.faceScheduled = true;

    const draw = (): void => {
      this.faceScheduled = false;
      if (this.disposed) return;
      /**
       * Never while anything is moving.
       *
       * Two measurements, both of a ~145ms card render landing in the worst
       * possible frame. On the player's own play: an 85ms long task at t+177ms
       * after the mouse-up, a hundred and eighty milliseconds into a 300ms
       * flight, so five dropped frames out of the eighteen the card is moving
       * across. On a handover: seven faces drawn between t+903ms and t+1933ms,
       * of which only the first two were faces the board was about to ask for —
       * the rest were `warmAlternateFaces`, the "selected", "target" and "can
       * act" variants a token *might* wear later, queued speculatively on every
       * sync and then drawn, in four long tasks of 100, 57, 138 and 54ms, across
       * the second the player was watching the rival act.
       *
       * None of that work is wrong and all of it is early. A turn is *seconds*
       * of a human deciding what to do and it is the most genuinely idle time
       * this screen ever has; a batch is the one second in ten when something is
       * moving. So speculative work waits for the quiet, and `busyWithMotion`
       * is what "quiet" means.
       */
      if (this.busyWithMotion()) {
        this.scheduleFaceWarm(false);
        return;
      }
      const entry = this.faceQueue.shift();
      if (entry) getCardTexture(entry.card, entry.state);
      this.scheduleFaceWarm(false);
    };

    const ask = (): void => {
      if (this.disposed) return;
      const idle = (
        window as unknown as {
          requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
        }
      ).requestIdleCallback;
      // The timeout is the contract: a drag is over in well under a second, so
      // the faces it needs cannot wait for a genuinely idle browser.
      if (idle) idle(draw, { timeout: urgent ? 400 : 3000 });
      else window.setTimeout(draw, 0);
    };

    window.setTimeout(ask, BattleView.FACE_WARM_SPACING);
  }

  // -------------------------------------------------------------------------
  // The faces a whole batch of engine events is about to need
  // -------------------------------------------------------------------------

  /**
   * ## The 366ms the board froze, once per rival card
   *
   * Measured on a 60fps screencast of a handover: a `longtask` of **366ms** at
   * t+923ms after End Turn, a worst rAF gap of 379ms in the same window, and a
   * CPU profile putting 468ms of the three-second window inside
   * `syncBoard → new CardObject → getCardTexture → renderCard`. Twenty-two
   * dropped frames in the middle of the rival's turn, every turn they play
   * something. §9's performance floor is not a preference.
   *
   * Everything the existing warm machinery covers is the *player's* side —
   * `warmHandFaces` during their turn, `warmPlayFaces` on pickup,
   * `warmAlternateFaces` for tokens already on the board. None of it can see the
   * rival's hand, so a card the rival plays is always an uncached face, drawn on
   * the single frame its token appears; and a token that took damage asks for a
   * face keyed on its *new* health, which is a miss for the same reason.
   *
   * The batch already knows all of it. `getView()` is the view **after** the
   * engine has resolved the whole batch — the engine never waits on animation —
   * so at the instant the presenter is handed a batch, the final stats of every
   * character on both boards are readable. There is no prediction here and no
   * heuristic: this warms exactly the face states `syncBoard` is going to ask
   * for, seconds of animation before it asks.
   *
   * Draining is on `requestAnimationFrame`, one face per frame, and **suspended
   * while any token is in flight** (see `flightsInAir`). That is the whole
   * point: a render has to block the main thread for as long as it takes, so the
   * only question is which frame it lands on. It must never be a frame the
   * player is tracking a moving object through.
   */
  prewarmBatch(view: PlayerView): void {
    const rows = [
      { characters: view.you.board, side: "player" as const },
      { characters: view.opponent.board, side: "enemy" as const },
    ];
    const proxy = viewToState(view);
    const arriving: { card: CardDef; state: CardFaceState }[] = [];
    const settling: { card: CardDef; state: CardFaceState }[] = [];

    for (const row of rows) {
      for (const character of row.characters) {
        if (!character) continue;
        const card = this.content.cards[character.cardId];
        if (!card) continue;
        const base: CardFaceState = {
          attack: totalAttack(proxy, this.content, character),
          health: character.health,
          maxHealth: character.maxHealth,
          statEmphasis: true,
        };
        const isNew = !this.boardObjects.has(character.instanceId);
        // The two an arriving token asks for, in the order it asks: `CardObject`'s
        // constructor takes the plain face before anything has set stats on it —
        // a render thrown away a millisecond later and unavoidable from here —
        // and `syncFromCharacter` immediately asks for the real one.
        if (isNew) arriving.push({ card, state: {} }, { card, state: { ...base, highlight: "none" } });
        else settling.push({ card, state: { ...base, highlight: "none" } });
        /**
         * The "can act" ring is warmed at the *idle* rung, not this one.
         *
         * It is the face a friendly token wears when the turn comes back, which
         * is a second away at the very least, and putting it in the same queue as
         * the arriving token's face made it compete for the one budget that has a
         * deadline. Measured: seven faces queued for a handover that needed two
         * of them before the card moved.
         */
        if (row.side === "player") this.warmFace(card, { ...base, highlight: "playable" });
      }
    }

    // Arrivals first: they are the only faces whose absence shows up as the
    // board freezing while an object the player is watching is in the air.
    for (const { card, state } of [...arriving, ...settling]) this.warmFace(card, state, "soon");
  }

  /**
   * Wait, briefly, for the faces `prewarmBatch` queued to actually be drawn.
   *
   * Queueing alone was not enough and the measurement said so: with the drain on
   * `requestAnimationFrame` but nothing waiting for it, the rival's batch still
   * carried a **276ms long task**, because a local match hands the presenter the
   * AI's play as its own batch whose *first* event is `cardPlayed` — there is no
   * earlier beat for the drain to hide in. So the presenter waits, once, at the
   * top of the batch.
   *
   * The wall clock this spends is the render time, which is spent either way.
   * What it buys is *where*: a card render blocks the main thread for as long as
   * it takes, and this moves that block onto a board where nothing is moving —
   * the previous batch has finished, every token is at rest, the only thing
   * running is a 6.8-second specular crawl — instead of onto the frames a token
   * is flying across the mat. A stall on a still board is not visible. A stall
   * inside the game's core verb is the defect this whole file is about.
   *
   * Never waited on when a handoff is parked. That is the player's own play: the
   * released ghost is frozen at the drop point waiting for its token, on a 420ms
   * safety timeout, and the faces it needs were drawn during the drag anyway.
   *
   * ## And it waits for the board to actually be still first
   *
   * "A stall on a still board is not visible" is only true if the board is still,
   * and the first version of this never checked. Measured on a handover: the
   * block ran from t+952ms to t+1374ms while the turn sweep's motes were still
   * crossing the mat and the mat's own tint was mid-transition, so a third of the
   * wipe played as a frozen image and the worst rAF gap in the window was 432ms.
   * The wait below is bounded — a card render has to happen and the batch is
   * holding for it — but in practice it costs a frame or two and moves the whole
   * block past the end of the previous beat's motion.
   */
  async facesSettled(capMs = 380): Promise<void> {
    if (this.soonQueue.length === 0 || this.handoff) return;
    /**
     * Up to ~320ms of waiting for the previous beat's motion to finish, which is
     * one full turn-sweep plus a frame. Longer than that and the handover starts
     * costing the player real time for a smoothness they cannot see, so the block
     * goes ahead regardless. Measured with the cap at 200ms: the block still
     * clipped the last 45ms of the sweep.
     */
    const settleBy = performance.now() + 320;
    while (performance.now() < settleBy && (this.flightsInAir > 0 || this.vfx.busy())) {
      /**
       * A frame **or** a timer, whichever comes first. `requestAnimationFrame`
       * does not fire in a background tab, and a player who switches away during
       * the rival's turn must not come back to a match that stopped animating
       * because a promise here never resolved.
       */
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = (): void => {
          if (done) return;
          done = true;
          resolve();
        };
        requestAnimationFrame(finish);
        window.setTimeout(finish, 90);
      });
      if (this.disposed) return;
    }
    /**
     * Drawn here and now, in one contiguous block, rather than one per frame.
     *
     * The per-frame version was measured first and it was the wrong shape: a
     * card face costs ~140ms on this machine, so spreading four of them across
     * four `requestAnimationFrame` callbacks produces four separate ~140ms
     * stalls with a repaint attempted between each, which is more dropped frames
     * than doing the lot at once and is spread across more of the animation. The
     * only thing that matters is that the block sits *before* the first beat of
     * the batch, where the board is still.
     *
     * The budget is checked before each render rather than after, so it can
     * overshoot by one face and cannot ever refuse to make progress. Whatever is
     * left goes back to the per-frame drain, which stands down while anything is
     * flying.
     */
    const deadline = performance.now() + capMs;
    while (this.soonQueue.length > 0 && performance.now() < deadline) {
      const entry = this.soonQueue.shift();
      if (entry) getCardTexture(entry.card, entry.state);
    }
  }

  /** Tokens currently owned by a flight tween — see `prewarmBatch`. */
  private flightsInAir = 0;
  /** When the last one touched down, so the settle is protected as well. */
  private lastFlightAt = 0;

  /**
   * Is something on this board moving in a way a 150ms card render would ruin?
   *
   * Four windows now, and the fourth is the one the handover kept losing frames
   * to. A batch is playing (`layoutLocked`); a token is in the air
   * (`flightsInAir`); a token landed less than a beat ago — the burst, the dust
   * and the neighbours giving way run for ~280ms *after* the flight tween
   * resolves, and a 99ms task measured at t+410ms on a play whose flight ended at
   * t+350ms is a stall in the middle of the landing; **or the vfx layer still has
   * particles alive**, which covers the impact spray, the defeat puff and the
   * handover's mote sweep — none of which is a flight and all of which are
   * movement a 200ms render turns into a still image.
   */
  private busyWithMotion(): boolean {
    return (
      this.layoutLocked ||
      this.flightsInAir > 0 ||
      performance.now() - this.lastFlightAt < 340 ||
      this.vfx.busy()
    );
  }

  private readonly soonQueue: { key: string; card: CardDef; state: CardFaceState }[] = [];
  private soonFrame = 0;
  /** When the soon drain last refused a frame, so it can never starve. */
  private soonHeldSince = 0;

  /**
   * Drain one queued face per frame, and never on a frame that is carrying
   * something. `requestAnimationFrame` rather than `onMotionFrame` because this
   * has to keep running when the reduced-motion setting has stopped the shared
   * clock — the faces are still needed, they are just needed without a flight.
   *
   * `layoutLocked` is deliberately NOT part of the test: the soon queue is the
   * batch's own faces and the batch is exactly what is waiting for them. What is
   * part of it is whether anything is *visibly* moving — a flight, its landing,
   * or live particles — because those are the frames a render would freeze.
   * Measured before the particle test was added: 60ms and 150ms tasks at t+1634
   * and t+1704 into a handover, landing on the rival's impact spray. The 600ms
   * escape hatch exists because a Resonance keeps particles alive for a second
   * and a half and the queue must not wait that long for work a beat is due.
   */
  private scheduleSoonWarm(): void {
    if (this.soonFrame || this.soonQueue.length === 0) return;
    this.soonFrame = requestAnimationFrame(() => {
      this.soonFrame = 0;
      if (this.disposed) return;
      const now = performance.now();
      const moving = this.flightsInAir > 0 || now - this.lastFlightAt < 340 || this.vfx.busy();
      if (!this.soonHeldSince) this.soonHeldSince = now;
      if (!moving || now - this.soonHeldSince > 600) {
        this.soonHeldSince = 0;
        const entry = this.soonQueue.shift();
        if (entry) getCardTexture(entry.card, entry.state);
      }
      this.scheduleSoonWarm();
    });
  }

  /**
   * The faces a card in the player's hand will want the instant it is released.
   *
   * Called on pickup, which buys the several hundred milliseconds of drag the
   * renders need. The stats are read off the card definition rather than
   * predicted through the effect engine: a static buff would give the arriving
   * token different numbers and this would miss, which costs exactly what the
   * old behaviour cost and nothing more.
   */
  /**
   * Every character in the hand, warmed during the turn rather than the drag.
   *
   * Warming at pickup was the first version and it moved the stall rather than
   * removing it: three card renders inside a drag showed up on the screencast
   * as 60–140ms blocks at t-286, t+274 and t+369, and the drag ghost is moved by
   * a main-thread pointermove handler, so those are the card lagging behind the
   * cursor. A turn, by contrast, is *seconds* of a human deciding what to do,
   * and it is the most genuinely idle time this screen ever has. By the time a
   * card is picked up its faces are already drawn and the drag is clean too.
   *
   * No playability check: it would cost a `checkPlayable` per card per sync to
   * save a render the player is likely to want anyway, and `warmFace` already
   * dedupes, so each distinct card is drawn once for the whole match.
   */
  private warmHandFaces(view: PlayerView): void {
    for (const instance of view.you.hand) {
      const card = this.content.cards[instance.cardId];
      if (card?.type !== "character") continue;
      this.warmFace(card, {});
      this.warmFace(card, {
        attack: card.attack,
        health: card.health,
        maxHealth: card.health,
        statEmphasis: true,
        highlight: "none",
      });
    }
  }

  private warmPlayFaces(card: CardDef): void {
    // what CardObject's constructor asks for before it knows anything
    this.warmFace(card, {}, true);
    if (card.type !== "character") return;
    const health = card.health;
    for (const highlight of ["none", "playable"] as const) {
      this.warmFace(card, { attack: card.attack, health, maxHealth: health, statEmphasis: true, highlight }, true);
    }
  }

  /**
   * The highlight a token on the board is not currently wearing.
   *
   * A friendly character alternates between the "can act" ring and nothing
   * every single handover, and picks up "selected" the moment it is dragged; an
   * enemy lights as a "target" whenever a drag makes it one. Two or three faces
   * per token, drawn once, and the flip is free forever after.
   */
  private warmAlternateFaces(character: CharacterInstance, attack: number, side: "player" | "enemy"): void {
    const card = this.content.cards[character.cardId];
    if (!card) return;
    const base: CardFaceState = {
      attack,
      health: character.health,
      maxHealth: character.maxHealth,
      statEmphasis: true,
    };
    const highlights =
      side === "player" ? (["none", "playable", "selected"] as const) : (["none", "target"] as const);
    for (const highlight of highlights) this.warmFace(card, { ...base, highlight });
  }

  /**
   * The board's half of the curtain, run when the mulligan lets go.
   *
   * `scene.playEntrance` owns the room — the camera closing 14% of framing while
   * the key comes up. This owns the *arrivals*, and they are staggered rather
   * than simultaneous: the leaders come up first because they are what the match
   * is about, the tokens follow at 90ms, and the DOM hand fans in behind both on
   * a 45ms cascade written by `stagger`. §3a asks for 260–420ms with 80–120ms of
   * overlap and never a blank frame, and the overlap here is real — the mulligan
   * panel is still on screen and still shrinking while the leaders are rising.
   *
   * Everything it touches is a *target*: the objects' own exponential easing does
   * the movement, so a resize, a sync or a second call mid-flight cannot leave
   * anything stranded at a keyframe.
   */
  playCurtain(): void {
    this.scene.playEntrance();
    if (!motionEnabled()) return;

    /**
     * `LeaderObject` is a plain `THREE.Group` with no easing of its own — unlike
     * `CardObject`, which eases toward a target every frame — so this drives it
     * rather than nudging it. Setting a scale on something that never eases back
     * is how a "fix" leaves a leader permanently at 72%.
     */
    const leaders = [...this.leaderObjects.values()];
    if (leaders.length > 0) {
      tween({
        from: 1,
        to: 0,
        ms: 340,
        ease: EASE.overshoot,
        onUpdate: (value) => {
          for (const token of leaders) {
            token.scale.setScalar(1 - value * 0.26);
            token.position.y = 0.16 + value * 0.75;
          }
        },
        onDone: () => {
          for (const token of leaders) {
            token.scale.setScalar(1);
            token.position.y = 0.16;
          }
        },
      });
    }
    // Tokens already ease toward `targetScale` every frame; giving them a small
    // start is the whole animation, and it lands 90ms behind the leaders.
    for (const object of this.boardObjects.values()) object.scale.setScalar(0.6);

    /**
     * The opening hand is dealt **here**, and that is the correction.
     *
     * Writing `--enter-delay` was never the whole problem. The hand bar builds
     * its cards on the first sync, which happens during the *mulligan* — so the
     * six-card entrance had already played, in full, behind a panel at z-index
     * 70 with a 12px backdrop blur over it, several seconds before the board was
     * revealed. Measured: `hand-card-in` fired six times while the mulligan was
     * on screen and not once after Confirm. Whatever delays this function wrote
     * afterwards were written onto animations that had finished.
     *
     * So the entrance is restarted on the frame the curtain opens. `stagger`
     * supplies the cascade the comment above has always described, `data-new`
     * goes back on so `HandBar.layout` refreshes each card's origin at the deck,
     * and the animation is re-armed by nulling `animation-name`, forcing exactly
     * **one** reflow for the whole hand, and putting it back.
     *
     * Reaching into `.hand-card` from here is the seam this function has always
     * used: the hand is a DOM strip outside the 3D scene and the curtain is the
     * one moment the board and the hand have to be timed against each other.
     */
    const cards = [...(this.container.parentElement?.querySelectorAll<HTMLElement>(".hand-card") ?? [])];
    if (cards.length > 0) {
      stagger(cards, { step: 45, from: 90, max: 420 });
      const flips = cards.map((card) => card.querySelector<HTMLElement>(".hand-card-flip"));
      for (const [index, card] of cards.entries()) {
        card.dataset["new"] = "";
        card.style.animationName = "none";
        const flip = flips[index];
        if (flip) flip.style.animationName = "none";
      }
      void this.container.offsetWidth; // one forced reflow, deliberately
      for (const [index, card] of cards.entries()) {
        card.style.animationName = "";
        const flip = flips[index];
        if (flip) flip.style.animationName = "";
      }
    }
  }

  /** Cached per sync — layout calls this once per hand card. */
  private stateProxy(): MatchState {
    if (!this.proxy) {
      if (!this.view) throw new Error("stateProxy called before the first sync");
      this.proxy = viewToState(this.view);
    }
    return this.proxy;
  }

  /**
   * Where the keyboard cursor is, so a sighted keyboard player can see it.
   *
   * The board is a canvas: it cannot take DOM focus and cannot show a focus
   * ring, so the cursor has to be drawn as a card highlight like any other. It
   * reuses `"selected"` and `"target"` rather than adding a fourth state,
   * because the meaning is identical — this is the thing you are acting on, and
   * that is the thing you would hit.
   */
  setKeyboardFocus(target: TargetRef | null): void {
    this.keyboardFocus = target;
    if (this.view) this.sync(this.view);
  }

  private keyboardFocus: TargetRef | null = null;

  private highlightFor(character: CharacterInstance): "none" | "playable" | "target" | "selected" {
    const view = this.view;
    if (!view) return "none";

    if (this.keyboardFocus?.kind === "character" && this.keyboardFocus.instanceId === character.instanceId) {
      return character.controller === view.seat ? "selected" : "target";
    }

    const activeDrag = this.drag ?? this.externalDrag;
    if (activeDrag) {
      const isLegal = activeDrag.legalTargets.some(
        (t) => t.kind === "character" && t.instanceId === character.instanceId
      );
      if (isLegal) return "target";
      if (this.drag?.instanceId === character.instanceId) return "selected";
      return "none";
    }

    // a ready attacker gets the "can act" ring
    if (character.controller === view.seat && view.activeSeat === view.seat) {
      if (canAttack(this.stateProxy(), this.content, character)) return "playable";
    }
    return "none";
  }

  // -------------------------------------------------------------------------
  // Layout
  // -------------------------------------------------------------------------

  private layout(): void {
    const view = this.view;
    if (!view) return;

    // --- board rows ---------------------------------------------------------
    for (const [side, board] of [
      ["player", view.you.board],
      ["enemy", view.opponent.board],
    ] as const) {
      const occupied = board.filter((c): c is CharacterInstance => c !== null);

      /**
       * Make room: while a character is being dragged over your own row, the
       * row lays itself out as if the new token were already there and leaves
       * that slot empty. Tokens ease into the gap, so releasing the card drops
       * it into a space that has already opened — the reference does exactly
       * this, and it is most of why placing a minion feels good.
       */
      const gapAt = side === "player" ? this.makeRoomIndex : null;
      const virtualCount = occupied.length + (gapAt !== null ? 1 : 0);

      occupied.forEach((character, index) => {
        const object = this.boardObjects.get(character.instanceId);
        if (!object) return;
        const slot = gapAt !== null && index >= gapAt ? index + 1 : index;
        const position = this.board.rowPosition(side, slot, virtualCount);
        object.targetPosition.copy(position);
        // Both rows render at the same size. Early segment reports claimed the
        // far row was ~7% smaller, but the careful cross-measurement pass put
        // the ratio at 1.00 — and a card that looks smaller reads as weaker,
        // which is a lie we do not want to tell.
        object.targetScale = 1;
      });
    }

    // The hand is NOT part of the 3D scene — it lives in its own DOM strip
    // below the board (see handBar.ts), so the play area is never obscured.
    // It does need to know where the two piles are, though.
    this.publishPileOrigins();
  }

  /**
   * Tell the DOM where the deck and the discard are, in viewport pixels.
   *
   * The hand bar is deliberately outside the 3D scene and therefore has no
   * camera, but the two things a card in the hand travels between — the deck
   * stack it is dealt from and the discard tray it leaves for — are objects on
   * the mat. Four custom properties on the document root are the whole of the
   * seam: they inherit, so the bar reads them off itself with one style
   * resolution per layout instead of reaching across for a projection matrix,
   * and a hand with no board (a test, the first frame) simply finds them absent
   * and falls back to a plain rise.
   *
   * `discardPosition` does not exist on the board API and does not need to:
   * each seat's discard sits on the run its opponent's deck sits on, so the
   * discard's x is the *other* seat's deck x at this seat's own z. That is an
   * identity of the furniture's layout rather than a guess — see
   * `resourceFurniture` in board.ts, where both are placed from the same
   * `RUN_X` pair with `deckX` and `discardX` swapped by side.
   */
  private publishPileOrigins(): void {
    const root = document.documentElement;
    const mine = this.board.deckPosition("player");
    const theirs = this.board.deckPosition("enemy");
    const deck = this.scene.project(mine.clone());
    const discard = this.scene.project(new THREE.Vector3(theirs.x, mine.y, mine.z));
    // `project` answers in canvas pixels; the hand bar positions in viewport
    // pixels. On a full-bleed board these agree, and on anything else they do
    // not — the offset is one rect read and it removes a class of bug that
    // would only appear at a viewport nobody tests at.
    const canvas = this.scene.renderer.domElement.getBoundingClientRect();
    root.style.setProperty("--pile-deck-x", `${Math.round(canvas.left + deck.x)}px`);
    root.style.setProperty("--pile-deck-y", `${Math.round(canvas.top + deck.y)}px`);
    root.style.setProperty("--pile-discard-x", `${Math.round(canvas.left + discard.x)}px`);
    root.style.setProperty("--pile-discard-y", `${Math.round(canvas.top + discard.y)}px`);
  }

  // -------------------------------------------------------------------------
  // Pointer interaction
  // -------------------------------------------------------------------------

  private attachPointerHandlers(): void {
    const canvas = this.scene.renderer.domElement;

    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
    canvas.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("keydown", this.onKeyDown);
  }

  private pickCard(clientX: number, clientY: number): CardObject | null {
    const objects: THREE.Object3D[] = [...this.boardObjects.values()];
    const hits = this.scene.raycastFromPointer(clientX, clientY, objects);
    for (const hit of hits) {
      let node: THREE.Object3D | null = hit.object;
      while (node && !(node instanceof CardObject)) node = node.parent;
      if (node instanceof CardObject) return node;
    }
    return null;
  }

  /** Where the pointer intersects the table plane, in world space. */
  private pointerOnTable(clientX: number, clientY: number): THREE.Vector3 | null {
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hits = this.scene.raycastFromPointer(clientX, clientY, []);
    void hits;
    const rect = this.scene.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.scene.camera);
    const point = new THREE.Vector3();
    return raycaster.ray.intersectPlane(plane, point) ? point : null;
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (this.drag) {
      this.updateDrag(event);
      return;
    }
    const picked = this.pickCard(event.clientX, event.clientY);
    this.scene.renderer.domElement.style.cursor = picked ? "grab" : "default";
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button === 2) return; // right-click inspects, handled separately
    const view = this.view;
    if (!view || view.activeSeat !== view.seat) return;

    const picked = this.pickCard(event.clientX, event.clientY);
    if (!picked) return;

    // press-and-hold on a board card inspects it, exactly as it does in hand
    this.startHoldInspect(picked.card, event);

    const data = picked.userData as { kind: string; instanceId: string; seat: Seat };

    // Cards are played by dragging out of the DOM hand bar (see handBar.ts);
    // the only drag that starts on the canvas is a character declaring an attack.
    if (data.kind === "board" && data.seat === view.seat) {
      const character = this.findCharacter(data.instanceId);
      if (!character || !canAttack(this.stateProxy(), this.content, character)) return;

      this.drag = {
        kind: "attack",
        object: picked,
        instanceId: data.instanceId,
        pointerId: event.pointerId,
        legalTargets: legalAttackTargets(this.stateProxy(), view.seat),
        legalSlots: [],
        hoverTarget: null,
        hoverSlot: null,
        originPosition: picked.position.clone(),
      };
      this.scene.renderer.domElement.setPointerCapture(event.pointerId);
      this.syncBoard();
    }
  };

  private updateDrag(event: PointerEvent): void {
    const drag = this.drag;
    const view = this.view;
    if (!drag || !view) return;

    const point = this.pointerOnTable(event.clientX, event.clientY);

    void point;

    // The only drag that starts on the canvas is an attack; cards are played
    // from the DOM hand bar via externalDrag*.
    const target = this.targetUnderPointer(event, drag.legalTargets);
    drag.hoverTarget = target;
    const from = this.anchorFor(drag.object);
    const to = target ? this.anchorForTarget(target) : { x: event.clientX, y: event.clientY };
    this.targeting.show(from, to, target ? "attack-valid" : "attack");

    if (target) {
      const attacker = this.findCharacter(drag.instanceId);
      if (attacker) {
        const preview = previewAttack(this.stateProxy(), this.content, attacker, target);
        this.targeting.showPreview(to, preview);
      }
    } else {
      this.targeting.hidePreview();
    }
  }

  private onPointerUp = (event: PointerEvent): void => {
    const drag = this.drag;
    const view = this.view;
    this.targeting.hide();
    this.targeting.hidePreview();
    this.board.setDropTarget("player", null, 0);
    this.board.setReceiving(null);

    if (!drag || !view) return;
    this.drag = null;
    drag.object.immediate = false;
    this.scene.renderer.domElement.style.cursor = "default";
    try {
      this.scene.renderer.domElement.releasePointerCapture(event.pointerId);
    } catch {
      /* pointer already released */
    }

    if (drag.hoverTarget) {
      this.callbacks.onIntent({
        type: "attack",
        seat: view.seat,
        attackerInstanceId: drag.instanceId,
        target: drag.hoverTarget,
      });
    }
    this.syncBoard();
    this.layout();
  };

  private onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    // right-click during a drag abandons it; otherwise it inspects the card
    if (this.drag) {
      this.cancelDrag();
      return;
    }
    const picked = this.pickCard(event.clientX, event.clientY);
    if (picked) this.callbacks.onInspect(picked.card);
  };

  /**
   * Arms press-and-hold on a board card: keep the button down without moving
   * and the card blows up for as long as you hold it.
   *
   * The peek is deliberately non-destructive. An earlier version cancelled the
   * attack drag the moment the timer fired, which quietly punished any player
   * who paused before dragging — a very human thing to do — by eating their
   * attack. Now the drag stays armed underneath: moving dismisses the peek and
   * the attack proceeds as though nothing happened, and only releasing without
   * ever moving counts as "I just wanted to look at it".
   */
  private startHoldInspect(card: CardDef, event: PointerEvent): void {
    const originX = event.clientX;
    const originY = event.clientY;
    let closePeek: (() => void) | null = null;

    const detach = (): void => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    const onMove = (moveEvent: PointerEvent): void => {
      if (Math.hypot(moveEvent.clientX - originX, moveEvent.clientY - originY) <= HOLD_TOLERANCE_PX) return;
      closePeek?.();
      closePeek = null;
      detach(); // the press became a drag; the attack owns the pointer now
    };

    const onUp = (): void => {
      detach();
      if (!closePeek) return;
      closePeek();
      closePeek = null;
      this.cancelDrag(); // held still and let go: a look, not an attack
    };

    const timer = window.setTimeout(() => {
      closePeek = this.callbacks.onPeek(card);
    }, HOLD_MS);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && this.drag) {
      event.preventDefault();
      this.cancelDrag();
    }
  };

  /** Abandon the in-progress drag and send the card back where it came from. */
  private cancelDrag(): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    drag.object.immediate = false;
    this.targeting.hide();
    this.targeting.hidePreview();
    this.board.setDropTarget("player", null, 0);
    this.board.setReceiving(null);
    this.scene.renderer.domElement.style.cursor = "default";
    this.syncBoard();
    this.layout();
  }

  private targetUnderPointer(event: PointerEvent, legal: TargetRef[]): TargetRef | null {
    if (legal.length === 0) return null;
    const picked = this.pickCard(event.clientX, event.clientY);
    if (picked && picked.userData.kind === "board") {
      const instanceId = (picked.userData as { instanceId: string }).instanceId;
      const match = legal.find((t) => t.kind === "character" && t.instanceId === instanceId);
      if (match) return match;
    }
    // leader targets: check proximity to the podium in screen space
    for (const target of legal) {
      if (target.kind !== "leader") continue;
      const view = this.view;
      if (!view) continue;
      const side = target.seat === view.seat ? "player" : "enemy";
      const anchor = this.scene.project(this.board.leaderPosition(side).clone().setY(0.6));
      const rect = this.scene.renderer.domElement.getBoundingClientRect();
      const dx = event.clientX - rect.left - anchor.x;
      const dy = event.clientY - rect.top - anchor.y;
      if (Math.hypot(dx, dy) < 78) return target;
    }
    return null;
  }

  private anchorFor(object: THREE.Object3D): { x: number; y: number } {
    const rect = this.scene.renderer.domElement.getBoundingClientRect();
    const point = this.scene.project(object.position.clone());
    return { x: point.x + rect.left, y: point.y + rect.top };
  }

  private anchorForTarget(target: TargetRef): { x: number; y: number } {
    const rect = this.scene.renderer.domElement.getBoundingClientRect();
    if (target.kind === "leader") {
      const view = this.view;
      const side = view && target.seat === view.seat ? "player" : "enemy";
      const point = this.scene.project(this.board.leaderPosition(side).clone().setY(0.6));
      return { x: point.x + rect.left, y: point.y + rect.top };
    }
    const object = this.boardObjects.get(target.instanceId);
    if (!object) return { x: 0, y: 0 };
    const point = this.scene.project(object.position.clone());
    return { x: point.x + rect.left, y: point.y + rect.top };
  }

  private emptySlots(view: PlayerView): number[] {
    const slots: number[] = [];
    view.you.board.forEach((character, index) => {
      if (!character) slots.push(index);
    });
    return slots;
  }

  private findCharacter(instanceId: string): CharacterInstance | null {
    const view = this.view;
    if (!view) return null;
    for (const board of [view.you.board, view.opponent.board]) {
      for (const character of board) {
        if (character?.instanceId === instanceId) return character;
      }
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Public helpers for the presenter
  // -------------------------------------------------------------------------

  getBoardObject(instanceId: string): CardObject | undefined {
    return this.boardObjects.get(instanceId);
  }

  worldPositionOf(target: TargetRef): THREE.Vector3 {
    const view = this.view;
    if (target.kind === "leader") {
      const side = view && target.seat === view.seat ? "player" : "enemy";
      return this.board.leaderPosition(side).clone().setY(0.5);
    }
    return this.boardObjects.get(target.instanceId)?.position.clone() ?? new THREE.Vector3();
  }

  screenPositionOf(target: TargetRef): { x: number; y: number } {
    return this.anchorForTarget(target);
  }

  // -------------------------------------------------------------------------
  // Drags that begin outside the canvas (the DOM hand bar)
  // -------------------------------------------------------------------------

  /** Begin tracking a card dragged out of the DOM hand. */
  externalDragStart(instanceId: string): void {
    // A second drag started before the last handoff resolved: the parked ghost
    // belongs to a play that is no longer the one on screen.
    this.releaseHandoff();
    const view = this.view;
    if (!view) return;
    const playable = checkPlayable(this.stateProxy(), this.content, view.seat, instanceId);
    if (!playable.ok) return;

    const instance = view.you.hand.find((c) => c.instanceId === instanceId);
    const card = instance ? this.content.cards[instance.cardId] : undefined;
    if (!card) return;

    // The drag is the only spare time this interaction has; spend it drawing the
    // faces the drop would otherwise draw on the frame it lands.
    this.warmPlayFaces(card);

    this.externalDrag = {
      instanceId,
      legalTargets:
        card.type === "equipment"
          ? legalEquipTargets(this.stateProxy(), view.seat)
          : playable.targetSpecs[0]?.legal ?? [],
      legalSlots: playable.needsSlot ? this.emptySlots(view) : [],
      hoverTarget: null,
      hoverSlot: null,
      needsSlot: playable.needsSlot,
    };
    /**
     * Open the row on the frame the card leaves the hand, not on the frame the
     * pointer reaches the mat.
     *
     * Only for a card that actually occupies a slot: a spell answers with its
     * legal targets and an equipment with the character it goes on, and cutting
     * a trough along the row for either of those would be the board offering a
     * place that is not where the card is going.
     */
    this.board.setReceiving(playable.needsSlot ? "player" : null);
    this.syncBoard();
  }

  /**
   * Pointer moved during an external drag; update slot and target feedback.
   *
   * This is where the board's drop socket is driven from, and it is the fix for
   * the worst defect on this screen: `setDropTarget` existed, was exported, and
   * had zero call sites, so dragging a card anywhere over the arena lit nothing
   * at all. Everything it needs was already computed here to open the row's gap
   * — the only thing missing was telling the board about it.
   */
  externalDragMove(clientX: number, clientY: number): void {
    const drag = this.externalDrag;
    const view = this.view;
    if (!drag || !view) return;

    const point = this.pointerOnTable(clientX, clientY);
    const overBoard = point !== null && this.isPlayZone(point);
    /** Over the arena at all, including the rival's half and the cancel strip. */
    const overArena = point !== null && Math.abs(point.x) < BOARD.width / 2 + 1 && point.z > -BOARD.depth / 2;
    /**
     * The near strip the hand lies over, which is where every drag begins.
     *
     * It is *not* a refusal and it was being drawn as one. `pointerdown` on a
     * hand card starts the drag with the pointer still inside this band, so the
     * very first thing the board did on picking a card up was draw a red
     * struck-through socket — photographed on the frame after pickup, the only
     * change anywhere on a twenty-unit mat was the game saying no to a gesture
     * the player had only just started. Releasing here puts the card back, which
     * is what the strip means; the row's own trough stays open behind it, so the
     * board is still saying where the card wants to go.
     */
    const overCancelStrip = point !== null && point.z >= BOARD.cancelZ;

    this.dropProbe = {
      screen: { x: Math.round(clientX), y: Math.round(clientY) },
      world: point ? { x: Number(point.x.toFixed(2)), z: Number(point.z.toFixed(2)) } : null,
      overBoard,
      overArena,
      overCancelStrip,
      needsSlot: drag.needsSlot,
    };

    if (overBoard && drag.needsSlot) {
      // Work out which gap the pointer is nearest by comparing against the
      // midpoints between existing tokens, then let layout() open that gap.
      const occupied = view.you.board.filter((c): c is CharacterInstance => c !== null);
      const virtualCount = occupied.length + 1;
      let index = occupied.length;
      for (let i = 0; i < occupied.length; i++) {
        if (point!.x < this.board.rowPosition("player", i, virtualCount).x) {
          index = i;
          break;
        }
      }
      if (index !== this.makeRoomIndex) {
        this.makeRoomIndex = index;
        this.layout();
      }
      drag.hoverSlot = index;
      this.board.setDropTarget("player", index, virtualCount, "valid");
    } else if (drag.needsSlot && overArena && !overCancelStrip) {
      /**
       * Over the arena but somewhere this card cannot go — the rival's far
       * apron, the ground outside the play zone. A struck-through socket is
       * drawn at the nearest thing to a landing place so the refusal has a
       * position, because "nothing happens" and "that is not allowed" looked
       * identical before this and only one of them is true.
       */
      if (this.makeRoomIndex !== null) {
        this.makeRoomIndex = null;
        this.layout();
      }
      drag.hoverSlot = null;
      const enemySide = point!.z < 0;
      const row = enemySide ? "enemy" : "player";
      const count = (enemySide ? view.opponent.board : view.you.board).filter((c) => c !== null).length;
      /**
       * The refusal is drawn **under the pointer**, not at a slot.
       *
       * It used to be placed in the target row — first at `count - 1`, which is
       * where the last character is standing, then at `count`, one past it. Both
       * are wrong for the same reason and the film says so: on an empty row the
       * gap is dead centre, which is exactly where the carried card is, so the
       * struck socket was drawn underneath the object that caused it and did not
       * exist on screen at all. Measured with a 6× amplified difference against
       * the resting frame, holding a character over ground it cannot occupy
       * changed **nothing** outside the card's own footprint.
       *
       * A refusal is not about a slot anyway — there is no slot, that is the
       * point of it. It belongs where the player is pointing, so the red pool
       * (which is three times the socket's width) spills out around the cursor
       * from underneath.
       */
      this.board.setDropTarget(row, count, count + 1, "blocked", { x: point!.x, z: point!.z });
    } else {
      if (this.makeRoomIndex !== null) {
        this.makeRoomIndex = null;
        this.layout();
      }
      this.board.setDropTarget("player", null, 0);
    }

    drag.hoverTarget = this.targetAtPoint(clientX, clientY, drag.legalTargets);
    if (drag.hoverTarget) {
      this.targeting.show({ x: clientX, y: clientY + 60 }, this.anchorForTarget(drag.hoverTarget), "play");
    } else {
      this.targeting.hide();
    }

    /**
     * A spell with no slot is legal wherever its target is, so its ghost turns
     * green over a legal target and red over the arena with nothing under it.
     * A character's answer is the socket's answer.
     */
    const accepted = drag.needsSlot
      ? overBoard
      : drag.legalTargets.length > 0
        ? drag.hoverTarget !== null
        : overBoard;
    /**
     * The cancel strip is neutral on the card too, and it was not.
     *
     * The board learned this a wave ago — `overCancelStrip` is excluded from the
     * refusal above, because `pointerdown` on a hand card starts the gesture with
     * the pointer still inside that band and drawing a struck socket there is the
     * game refusing a gesture the player has only just begun. The ghost never got
     * the same treatment, and it is the object the player is actually looking at.
     * Filmed on the frame after pickup: pointer at world z = 8.63, `overBoard`
     * false, `overArena` true, and the carried card already wearing
     * `.drop-blocked` — greyed to 72% brightness with a red ring, 300ms into a
     * drag that had not gone anywhere yet. Releasing here puts the card back,
     * which is not a refusal; it is the default.
     */
    const feedback = !overBoard && overCancelStrip ? "neutral" : accepted ? "valid" : "blocked";
    this.callbacks.onDropFeedback?.(overArena || overBoard ? feedback : "neutral");

    /**
     * And the ground directly under the card answers too.
     *
     * The socket is at the slot; this is at the pointer, which is where the
     * player is looking. The two are not redundant — the socket says *where it
     * will land*, the pool says *the thing you are holding is over the table,
     * and it is (not) allowed here*. Before this the arena beneath a carried
     * card was pixel-identical to the arena beneath nothing.
     */
    this.vfx.dragPool(overArena || overBoard ? point : null, accepted ? "valid" : "blocked");
  }

  /** Pointer released during an external drag: play the card, or cancel. */
  externalDragEnd(clientX: number, clientY: number, ghost: HTMLElement | null = null): void {
    const drag = this.externalDrag;
    const view = this.view;
    const slotIndex = drag?.hoverSlot ?? null;
    const virtualCount = view ? view.you.board.filter((c) => c !== null).length + 1 : 1;
    this.externalDrag = null;
    this.makeRoomIndex = null;
    this.targeting.hide();
    this.board.setDropTarget("player", null, 0);
    this.board.setReceiving(null);
    this.vfx.dragPool(null, "valid");
    this.callbacks.onDropFeedback?.("neutral");
    if (!drag || !view) {
      this.dismissGhost(ghost);
      return;
    }
    this.layout(); // close the gap

    const point = this.pointerOnTable(clientX, clientY);
    const overBoard = point !== null && this.isPlayZone(point);
    if (!overBoard && !drag.hoverTarget) {
      this.dismissGhost(ghost);
      this.syncBoard(); // released over the hand or off-screen: keep the card
      return;
    }

    const playable = checkPlayable(this.stateProxy(), this.content, view.seat, drag.instanceId);
    if (!playable.ok) {
      this.dismissGhost(ghost);
      this.syncBoard();
      return;
    }

    const needsTarget = playable.targetSpecs.some((spec) => !spec.spec.optional);
    const isEquipment = playable.targetSpecs.length === 0 && drag.legalTargets.length > 0;

    if (((needsTarget || isEquipment) && !drag.hoverTarget) || playable.choiceCount > 0) {
      this.dismissGhost(ghost);
      this.callbacks.onNeedsTargets(drag.instanceId, playable.needsSlot ? (drag.hoverSlot ?? 0) : undefined);
      this.syncBoard();
      return;
    }

    /**
     * Hand the ghost over, then submit.
     *
     * Two different things happen here and they used to be one, which is why
     * neither worked. A card that becomes a **token** hands its screen-space
     * transform to that token and stops travelling: the ghost is frozen where
     * the player let go, `syncBoard` puts the real object at exactly that point
     * at exactly that apparent size within a frame, and the ghost cross-fades
     * out from under it. There is no moment at which the card is nowhere.
     *
     * A card that becomes **nothing** — a spell, a targeted effect — has no
     * token to become, so the ghost itself is the object and it flies to the
     * thing it is being cast at, which is the only honest place for it to go.
     */
    if (playable.needsSlot) {
      /**
       * Claimed by **card id**, not by instance id, and that is the whole reason
       * the last two rounds of this fix did nothing.
       *
       * `summonCharacter` calls `instantiateCharacter`, which mints a fresh
       * instance id for the board token — so the hand instance the player
       * dragged and the character that arrives are, correctly, different
       * objects with different identities. The previous handoff test compared
       * those two ids, never matched, and silently fell through to the "fly in
       * from behind your own leader" entrance every single time. That is exactly
       * what the review photographed: a card released at the slot, and 900ms
       * later a card rising out from behind the player's medallion.
       *
       * Card id plus "the player's own row" plus a 420ms window is enough: only
       * one card can be in flight at a time, and a trigger that summons a
       * *different* character in the same batch will not match.
       */
      const cardId = view.you.hand.find((c) => c.instanceId === drag.instanceId)?.cardId;
      this.armHandoff(cardId ?? null, ghost);
    } else {
      const landing = drag.hoverTarget
        ? this.worldPositionOf(drag.hoverTarget)
        : this.board.leaderPosition("player");
      this.flyGhost(ghost, landing);
    }
    void slotIndex;
    void virtualCount;

    this.callbacks.onIntent({
      type: "playCard",
      seat: view.seat,
      instanceId: drag.instanceId,
      ...(playable.needsSlot ? { slot: drag.hoverSlot ?? 0 } : {}),
      ...(drag.hoverTarget ? { targets: [drag.hoverTarget] } : {}),
    });
  }

  /**
   * A **spell's** flight, and only a spell's.
   *
   * A card that becomes a board token hands itself over to that token instead
   * (see `armHandoff`), because a DOM element flying to a place where a 3D
   * object is about to appear is two objects covering the same ground. A spell
   * has no token to become: the ghost is the only representation the effect will
   * ever have, so it travels to the thing it is being cast at and dissolves
   * there, which is where the player is already looking.
   *
   * A Web Animations tween on `transform` and `opacity` only, so it composites
   * and cannot cost the board a frame.
   *
   * Under reduced motion the card is simply removed: the functional layer here
   * is "the card left your hand", which the hand bar already says.
   */
  private flyGhost(ghost: HTMLElement | null, landing: THREE.Vector3): void {
    if (!ghost) return;
    if (getSettings().reducedMotion || typeof ghost.animate !== "function") {
      this.dismissGhost(ghost);
      return;
    }
    const rect = ghost.getBoundingClientRect();
    const canvasRect = this.scene.renderer.domElement.getBoundingClientRect();
    const target = this.scene.project(landing.clone().setY(0.3));
    const dx = target.x + canvasRect.left - (rect.left + rect.width / 2);
    const dy = target.y + canvasRect.top - (rect.top + rect.height / 2);
    /**
     * The board token is ~2.6 world units wide; the ghost is a DOM card at hand
     * scale. Projecting one world unit at the landing point gives the ratio
     * without hard-coding a number that would be wrong at every other viewport.
     */
    const edge = this.scene.project(landing.clone().setX(landing.x + BOARD.cardWidth / 2).setY(0.3));
    const boardWidth = Math.max(24, Math.abs(edge.x - target.x) * 2);
    const shrink = Math.max(0.3, Math.min(1.4, boardWidth / Math.max(1, rect.width)));

    ghost.style.transformOrigin = "50% 50%";
    ghost.classList.add("flying");
    const current = ghost.style.transform;
    const animation = ghost.animate(
      [
        { transform: current, opacity: 1, offset: 0 },
        {
          transform: `${current} translate(${dx * 0.62}px, ${dy * 0.62}px) scale(${shrink + (1 - shrink) * 0.34})`,
          opacity: 1,
          offset: 0.62,
        },
        { transform: `${current} translate(${dx}px, ${dy}px) scale(${shrink * 0.94})`, opacity: 0, offset: 1 },
      ],
      { duration: 230, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "forwards" }
    );
    animation.finished.catch(() => undefined).finally(() => ghost.remove());
    // A belt-and-braces removal: an animation on a detached element never fires.
    window.setTimeout(() => ghost.remove(), 400);
  }

  /**
   * The released card, parked between the pointer letting go and the token
   * arriving. It holds the ghost itself, because the ghost is not allowed to
   * disappear until something has taken its place.
   */
  private handoff: {
    cardId: string | null;
    ghost: HTMLElement | null;
    screen: { x: number; y: number };
    width: number;
    timeout: number;
  } | null = null;

  /**
   * Freeze the ghost where it was let go and remember its transform.
   *
   * The safety timeout is the only thing standing between a refused play and a
   * card stuck to the cursor forever: the engine can reject, a trigger can eat
   * the play, the batch can arrive empty. 420ms is long enough to cover the
   * round trip and short enough that a stranded ghost is never seen.
   */
  private armHandoff(cardId: string | null, ghost: HTMLElement | null): void {
    this.releaseHandoff();
    const rect = ghost?.getBoundingClientRect();
    const screen = rect
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : { x: 0, y: 0 };
    ghost?.classList.add("handed-off");
    this.handoff = {
      cardId,
      ghost,
      screen,
      width: rect?.width ?? 0,
      timeout: window.setTimeout(() => this.releaseHandoff(), 420),
    };
  }

  /** Drop the parked ghost, whether or not anything took its place. */
  private releaseHandoff(): void {
    const handoff = this.handoff;
    if (!handoff) return;
    this.handoff = null;
    window.clearTimeout(handoff.timeout);
    this.dismissGhost(handoff.ghost);
  }

  /**
   * Claim the parked ghost for a token that is being created right now, and
   * answer with the world transform the token has to start at so the two are
   * indistinguishable on the frame they swap.
   */
  private takeHandoff(
    cardId: string,
    side: "player" | "enemy"
  ): { position: THREE.Vector3; scale: number } | null {
    const handoff = this.handoff;
    if (!handoff || side !== "player" || handoff.cardId !== cardId) return null;
    this.handoff = null;
    window.clearTimeout(handoff.timeout);

    const position = handoff.width
      ? this.pointerOnPlane(handoff.screen.x, handoff.screen.y, BattleView.FLIGHT_Y)
      : null;
    // A 90ms cross-fade rather than a cut: the ghost carries a hand card's
    // outline and drop shadow and the token does not, and swapping those in one
    // frame is a flicker even when the silhouette matches exactly.
    this.fadeGhost(handoff.ghost, 90);
    if (!position) return null;
    return { position, scale: this.scaleForWidth(position, handoff.width) };
  }

  /**
   * Cross-fade the ghost out in place — no travel, no shrink.
   *
   * It is standing exactly where the token now is; moving it would be two
   * objects covering the same ground, which is the discontinuity the handoff
   * exists to remove.
   */
  private fadeGhost(ghost: HTMLElement | null, ms: number): void {
    if (!ghost) return;
    if (getSettings().reducedMotion || typeof ghost.animate !== "function") {
      ghost.remove();
      return;
    }
    ghost.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: ms,
      easing: "linear",
      fill: "forwards",
    });
    window.setTimeout(() => ghost.remove(), ms + 40);
  }

  /** A drag that came to nothing: fade the ghost rather than deleting it. */
  private dismissGhost(ghost: HTMLElement | null): void {
    if (!ghost) return;
    if (getSettings().reducedMotion || typeof ghost.animate !== "function") {
      ghost.remove();
      return;
    }
    const current = ghost.style.transform;
    ghost.animate(
      [
        { transform: current, opacity: 1 },
        { transform: `${current} scale(0.86)`, opacity: 0 },
      ],
      { duration: 130, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" }
    );
    window.setTimeout(() => ghost.remove(), 180);
  }

  /**
   * Is this table point inside the area where cards may be played?
   *
   * The x bound is not decoration. Without it the test was `z` only, so a point
   * fourteen units off the side of a twenty-unit mat — out over the venue, past
   * the frame, on the wallpaper — answered "yes". Measured by holding a card
   * there: the ghost stayed green, the socket stayed lit, and releasing played
   * the card. §5 asks for every state to be designed, and the blocked state that
   * `setDropTarget` and `.drop-blocked` both implement was unreachable in
   * practice because nothing outside the cancel strip was ever refused. The
   * generous z band stays — dropping high, over the rival's half, still plays to
   * your own row, exactly as the reference allows — but the mat's own edge is
   * now the edge.
   */
  private isPlayZone(point: THREE.Vector3): boolean {
    return Math.abs(point.x) < BOARD.width / 2 && point.z > -6 && point.z < BOARD.cancelZ;
  }

  /** Legal target under a screen point, checking characters then leaders. */
  private targetAtPoint(clientX: number, clientY: number, legal: TargetRef[]): TargetRef | null {
    if (legal.length === 0) return null;
    const picked = this.pickCard(clientX, clientY);
    if (picked && picked.userData.kind === "board") {
      const instanceId = (picked.userData as { instanceId: string }).instanceId;
      const match = legal.find((t) => t.kind === "character" && t.instanceId === instanceId);
      if (match) return match;
    }
    for (const target of legal) {
      if (target.kind !== "leader") continue;
      const anchor = this.anchorForTarget(target);
      if (Math.hypot(clientX - anchor.x, clientY - anchor.y) < 90) return target;
    }
    return null;
  }

  /**
   * The viewport box a ground-plane rectangle projects to.
   *
   * Four corners rather than a centre and a radius, because the camera is a
   * perspective one tilted 15° off vertical: a square on the mat projects to a
   * trapezium, and its near edge is measurably wider than its far one. Taking
   * the extent of all four corners is the only version of "where is it on
   * screen" that a collision test can trust.
   */
  private screenBoxOf(centre: THREE.Vector3, width: number, depth: number): { x: number; y: number; w: number; h: number } {
    const rect = this.scene.renderer.domElement.getBoundingClientRect();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const sx of [-1, 1] as const) {
      for (const sz of [-1, 1] as const) {
        const point = this.scene.project(
          new THREE.Vector3(centre.x + (width / 2) * sx, 0, centre.z + (depth / 2) * sz)
        );
        minX = Math.min(minX, point.x + rect.left);
        maxX = Math.max(maxX, point.x + rect.left);
        minY = Math.min(minY, point.y + rect.top);
        maxY = Math.max(maxY, point.y + rect.top);
      }
    }
    return { x: Math.round(minX), y: Math.round(minY), w: Math.round(maxX - minX), h: Math.round(maxY - minY) };
  }

  /** Diagnostic snapshot of interaction state — used by scripts/debug-drag.mjs. */
  debugState(): Record<string, unknown> {
    const view = this.view;
    if (!view) return { view: null };
    return {
      phase: view.phase,
      activeSeat: view.activeSeat,
      seat: view.seat,
      layoutLocked: this.layoutLocked,
      makeRoomIndex: this.makeRoomIndex,
      externalDrag: this.externalDrag
        ? {
            instanceId: this.externalDrag.instanceId,
            needsSlot: this.externalDrag.needsSlot,
            hoverSlot: this.externalDrag.hoverSlot,
            legalTargets: this.externalDrag.legalTargets.length,
          }
        : null,
      /**
       * What the arena decided about the last pointer position, and why.
       *
       * Without this a script can see the *result* of a drag — a class on the
       * ghost, a difference in a screenshot — and never the reason, which is how
       * the play zone spent two waves being asymmetric about x without anybody
       * being able to name it. Every term in the decision is here, in world
       * units, so a walk across the arena prints a map rather than a verdict.
       */
      dropProbe: this.dropProbe,
      /**
       * World x of each friendly token, for verifying row layout and gaps, plus
       * its screen anchor so automation can point at a board card whether or not
       * it happens to be able to attack.
       */
      friendlyRowX: [...this.boardObjects.entries()]
        .filter(([id]) => view.you.board.some((c) => c?.instanceId === id))
        .map(([id, object]) => ({
          id,
          x: Number(object.targetPosition.x.toFixed(3)),
          screen: this.anchorFor(object),
        }))
        .sort((a, b) => a.x - b.x),
      drag: this.drag
        ? {
            kind: this.drag.kind,
            instanceId: this.drag.instanceId,
            legalTargets: this.drag.legalTargets.length,
            legalSlots: this.drag.legalSlots,
            hoverSlot: this.drag.hoverSlot,
            hoverTarget: this.drag.hoverTarget,
          }
        : null,
      // characters that could attack right now, with their screen positions
      readyAttackers: boardOf(this.stateProxy(), view.seat)
        .filter((character) => canAttack(this.stateProxy(), this.content, character))
        .map((character) => {
          const object = this.boardObjects.get(character.instanceId);
          const screen = object ? this.anchorFor(object) : { x: 0, y: 0 };
          return { cardId: character.cardId, instanceId: character.instanceId, ...screen };
        }),
      enemyLeaderScreen: this.anchorForTarget({ kind: "leader", seat: view.opponent.seat }),
      /**
       * The two medallions and the mat, as screen boxes.
       *
       * §9 makes 844×390 landscape a hard constraint and it is the one viewport
       * nobody photographs, so the collisions there — the player's medallion
       * under their own hand, the rival's under its nameplate, the mat's rim off
       * the top of the frame — were reported from eyeballed screenshots and
       * argued about. These are the same `project()` the DOM anchors use, so a
       * script can measure the overlap in pixels rather than describe it.
       */
      medallions: Object.fromEntries(
        (["player", "enemy"] as const).map((side) => [
          side,
          // The portrait plane, not the tray it sits in: the tray is a dish that
          // fades to nothing at its rim, and holding a soft shadow clear of the
          // hand would cost every viewport four per cent of board scale for a
          // thing nobody reads. What must never be covered is the face and the
          // number on it.
          this.screenBoxOf(this.board.leaderPosition(side), BOARD.leaderHeight * (460 / 340), BOARD.leaderHeight),
        ])
      ),
      matBox: this.screenBoxOf(new THREE.Vector3(0, 0, 0), BOARD.width, BOARD.depth),
      /** where the last attack's contact flash was struck, and along what vector */
      lastContactSpark: (() => {
        const spark = this.vfx.lastContactSpark();
        if (!spark) return null;
        return {
          position: { x: +spark.position.x.toFixed(3), z: +spark.position.z.toFixed(3) },
          direction: { x: +spark.direction.x.toFixed(3), z: +spark.direction.z.toFixed(3) },
        };
      })(),
      // legal attack targets right now (Spotlight can exclude the leader)
      legalAttackTargets: legalAttackTargets(this.stateProxy(), view.seat).map((target) => ({
        kind: target.kind,
        id: target.kind === "character" ? target.instanceId : `leader-${target.seat}`,
        ...this.anchorForTarget(target),
      })),
      // hand playability only — screen positions come from the DOM hand bar
      hand: view.you.hand.map((instance) => {
        const p = checkPlayable(this.stateProxy(), this.content, view.seat, instance.instanceId);
        return {
          cardId: instance.cardId,
          instanceId: instance.instanceId,
          type: this.content.cards[instance.cardId]?.type ?? "?",
          ok: p.ok,
          reason: p.reason ?? null,
          cost: p.cost,
          needsSlot: p.needsSlot,
          targetSpecs: p.targetSpecs.map((t) => ({ optional: !!t.spec.optional, legal: t.legal.length })),
          choiceCount: p.choiceCount,
        };
      }),
    };
  }

  /**
   * The turn changing, told to the room.
   *
   * Three things at once, all of them inside one 320ms UI beat: the active
   * half of the mat lifts and stays lifted for the whole turn, that seat's
   * practical comes up while the other goes cold, and a line of motes runs the
   * width of the arena along the centre seam in the direction play is moving.
   * That replaces ~3.5 seconds of full-board DOM plates per handover with a
   * board state a player can read at any moment rather than only in the second
   * after they were told.
   */
  setTurnSide(side: "player" | "enemy"): void {
    this.board.setActiveSide(side);
    this.scene.setActiveSide(side);
    this.vfx.turnSweep(side);
  }

  /** Presenter locks layout while a sequence animates. */
  setLayoutLocked(locked: boolean): void {
    this.layoutLocked = locked;
    if (!locked && this.view) this.sync(this.view);
  }

  boardHandles(): BoardHandles {
    return this.board;
  }

  // -------------------------------------------------------------------------
  // Frame loop
  // -------------------------------------------------------------------------

  /**
   * The ambient clock — the one the board's idle animation is a function of.
   *
   * It is deliberately not `clock.elapsedTime`: under reduced motion it simply
   * stops advancing, so **every** time-driven effect on this board dies at
   * once, at the single place all of them are fed from.
   *
   * This is a guard rail rather than a repair. `scene.render` and
   * `board.update` each already pin their own drift, wash and grain when the
   * setting is on, and a difference heatmap of two frames 1.1s apart with it
   * enabled shows a genuinely still board — the only moving pixels on the whole
   * screen are the turn clock's own arc, which is functional and must keep
   * ticking. (An earlier reading of "reduced motion removes only 23% of the
   * board's movement" was the measuring script's fault, not the board's: it
   * turned the setting on via `await import("/src/save/settings.ts")` inside the
   * page, which in a Vite dev build is a *second* copy of the module — the app's
   * carries an HMR `?t=` query — so it wrote to a store nothing was reading.
   * The heatmap it produced was of a board with motion fully enabled.)
   *
   * What the clock buys is that the next ambient effect anybody adds to the mat
   * cannot quietly fail the setting: §3's line is that everything driven by
   * elapsed time is decorative by construction and dies, while everything
   * functional here — the tokens' easing, the flights, the lunges, every
   * `tween` — is driven by `delta` or by its own timeline and is untouched.
   *
   * It resumes from where it stopped rather than jumping, so turning the
   * setting off mid-match does not snap every ambient phase to a new value.
   */
  private ambientClock = 0;

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);

    const delta = Math.min(this.clock.getDelta(), 0.05);
    if (!getSettings().reducedMotion) this.ambientClock += delta;
    const elapsed = this.ambientClock;

    for (const object of this.boardObjects.values()) object.update(delta);
    /**
     * `window.innerHeight` rather than the canvas's `clientHeight`: this runs
     * every frame and reading a layout property would force a style recalc for a
     * number that changes on resize only. `setCompact` early-returns when the
     * answer has not moved, so the whole check is one comparison.
     */
    this.board.setCompact(window.innerHeight < 500);
    this.board.update(elapsed);
    this.vfx.update(delta, elapsed);
    this.scene.render(elapsed);
  };

  dispose(): void {
    this.disposed = true;
    this.releaseHandoff();
    this.unsubscribeArt();
    cancelAnimationFrame(this.raf);
    if (this.soonFrame) cancelAnimationFrame(this.soonFrame);
    const canvas = this.scene.renderer.domElement;
    canvas.removeEventListener("pointermove", this.onPointerMove);
    canvas.removeEventListener("pointerdown", this.onPointerDown);
    canvas.removeEventListener("pointerup", this.onPointerUp);
    canvas.removeEventListener("pointercancel", this.onPointerUp);
    canvas.removeEventListener("contextmenu", this.onContextMenu);
    window.removeEventListener("keydown", this.onKeyDown);
    this.targeting.dispose();
    this.vfx.dispose();
    // The pile positions are written on the document root and would otherwise
    // outlive the board that meant anything by them, pointing a hand bar in the
    // next match at where the last match's deck used to be.
    for (const name of ["--pile-deck-x", "--pile-deck-y", "--pile-discard-x", "--pile-discard-y"]) {
      document.documentElement.style.removeProperty(name);
    }
    for (const object of this.boardObjects.values()) object.dispose();
    this.scene.dispose();
    void this.container;
    void CURRENT_PALETTE;
  }
}
