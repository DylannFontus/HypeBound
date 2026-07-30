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

  /** Rebuild the 3D board and hand from a redacted player view. */
  sync(view: PlayerView): void {
    this.view = view;
    this.proxy = null; // rebuilt lazily from the new view
    this.applyBackdrop();
    if (this.layoutLocked) return;
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

          /**
           * Fly the card in from its owner's hand instead of popping it into
           * the slot. It starts small, off the near edge on that player's side
           * and lifted clear of the arena, then the object's own easing carries
           * it down into place — so a played card visibly travels from where you
           * dragged it, and the rival's plays read as coming from across the
           * table rather than materialising.
           *
           * The burst fires at the destination straight away rather than on
           * arrival: the reference always prepares the receiving slot before the
           * card gets there, never the other way round.
           */
          const entry = spawn.clone();
          // Start just BEYOND the owner's leader, not on top of it. A fixed
          // offset put the card down squarely over the medallion — dead centre
          // for the first character of a row — so the flight began by hiding the
          // portrait instead of arriving from the hand behind it.
          const leaderZ = row.side === "player" ? BOARD.playerLeaderZ : BOARD.enemyLeaderZ;
          const beyond = BOARD.leaderHeight / 2 + 0.9;
          entry.z = row.side === "player" ? leaderZ + beyond : leaderZ - beyond;
          entry.y += 1.3;
          object.position.copy(entry);
          object.scale.setScalar(0.5);

          this.scene.cardGroup.add(object);
          this.boardObjects.set(character.instanceId, object);
          this.vfx.summonBurst(spawn, character.current as CurrentId);
        }

        object.syncFromCharacter(
          character,
          this.highlightFor(character),
          totalAttack(this.stateProxy(), this.content, character)
        );
      });
    }

    for (const [instanceId, object] of [...this.boardObjects]) {
      if (seen.has(instanceId)) continue;
      this.scene.cardGroup.remove(object);
      object.dispose();
      this.boardObjects.delete(instanceId);
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
    this.board.clearSlotHighlights();

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
    this.board.clearSlotHighlights();
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

  /** Pointer moved during an external drag; update slot and target feedback. */
  externalDragMove(clientX: number, clientY: number): void {
    const drag = this.externalDrag;
    const view = this.view;
    if (!drag || !view) return;

    const point = this.pointerOnTable(clientX, clientY);
    const overBoard = point !== null && this.isPlayZone(point);

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
    } else if (this.makeRoomIndex !== null) {
      this.makeRoomIndex = null;
      this.layout();
    }

    drag.hoverTarget = this.targetAtPoint(clientX, clientY, drag.legalTargets);
    if (drag.hoverTarget) {
      this.targeting.show({ x: clientX, y: clientY + 60 }, this.anchorForTarget(drag.hoverTarget), "play");
    } else {
      this.targeting.hide();
    }
  }

  /** Pointer released during an external drag: play the card, or cancel. */
  externalDragEnd(clientX: number, clientY: number): void {
    const drag = this.externalDrag;
    const view = this.view;
    this.externalDrag = null;
    this.makeRoomIndex = null;
    this.targeting.hide();
    this.board.clearSlotHighlights();
    if (!drag || !view) return;
    this.layout(); // close the gap

    const point = this.pointerOnTable(clientX, clientY);
    const overBoard = point !== null && this.isPlayZone(point);
    if (!overBoard && !drag.hoverTarget) {
      this.syncBoard(); // released over the hand or off-screen: keep the card
      return;
    }

    const playable = checkPlayable(this.stateProxy(), this.content, view.seat, drag.instanceId);
    if (!playable.ok) {
      this.syncBoard();
      return;
    }

    const needsTarget = playable.targetSpecs.some((spec) => !spec.spec.optional);
    const isEquipment = playable.targetSpecs.length === 0 && drag.legalTargets.length > 0;

    if (((needsTarget || isEquipment) && !drag.hoverTarget) || playable.choiceCount > 0) {
      this.callbacks.onNeedsTargets(drag.instanceId, playable.needsSlot ? (drag.hoverSlot ?? 0) : undefined);
      this.syncBoard();
      return;
    }

    this.callbacks.onIntent({
      type: "playCard",
      seat: view.seat,
      instanceId: drag.instanceId,
      ...(playable.needsSlot ? { slot: drag.hoverSlot ?? 0 } : {}),
      ...(drag.hoverTarget ? { targets: [drag.hoverTarget] } : {}),
    });
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
    this.board.update(elapsed);
    this.vfx.update(delta, elapsed);
    this.scene.render(elapsed);
  };

  dispose(): void {
    this.disposed = true;
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
