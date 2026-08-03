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
import { CardObject } from "./cardMesh";
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
    this.loop();
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

        object.syncFromCharacter(
          character,
          this.highlightFor(character),
          totalAttack(this.stateProxy(), this.content, character)
        );
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
        object.position.copy(object.targetPosition);
        object.scale.setScalar(1);
        this.landToken(object, current);
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

    const cards = this.container.parentElement?.querySelectorAll(".hand-card");
    if (cards) stagger(cards, { step: 45, from: 90, max: 420 });
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
    } else if (drag.needsSlot && overArena) {
      /**
       * Over the arena but somewhere this card cannot go — the rival's row, the
       * far apron, the cancel strip under your own hand. A struck-through socket
       * is drawn at the nearest thing to a landing place so the refusal has a
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
      this.board.setDropTarget(row, Math.max(0, count - 1), Math.max(1, count), "blocked");
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
    this.callbacks.onDropFeedback?.(overArena || overBoard ? (accepted ? "valid" : "blocked") : "neutral");
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

  /** Is this table point inside the area where cards may be played? */
  private isPlayZone(point: THREE.Vector3): boolean {
    return point.z > -6 && point.z < BOARD.cancelZ;
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

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);

    const delta = Math.min(this.clock.getDelta(), 0.05);
    const elapsed = this.clock.elapsedTime;

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
    cancelAnimationFrame(this.raf);
    const canvas = this.scene.renderer.domElement;
    canvas.removeEventListener("pointermove", this.onPointerMove);
    canvas.removeEventListener("pointerdown", this.onPointerDown);
    canvas.removeEventListener("pointerup", this.onPointerUp);
    canvas.removeEventListener("pointercancel", this.onPointerUp);
    canvas.removeEventListener("contextmenu", this.onContextMenu);
    window.removeEventListener("keydown", this.onKeyDown);
    this.targeting.dispose();
    this.vfx.dispose();
    for (const object of this.boardObjects.values()) object.dispose();
    this.scene.dispose();
    void this.container;
    void CURRENT_PALETTE;
  }
}
