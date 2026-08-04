/**
 * The presenter: the ONE bridge from engine events to visuals.
 *
 * It consumes the EngineEvent stream into a paced animation queue. The engine
 * never waits on animations — it has already resolved everything — so the
 * presenter is free to compress or skip playback. Durations scale with the
 * animation-speed setting and collapse under reduced motion.
 */

import type { ContentIndex, EngineEvent, PlayerView, TargetRef } from "../../engine/types";
import type { BattleView } from "./battleView";
import type { BattleHud } from "./hud";
import { animationScale, getSettings } from "../../save/settings";
import { CURRENT_PALETTE } from "../cardRenderer/palette";
import * as THREE from "three";
import { BOARD } from "./scene";
import type { AudioManager } from "../../audio/audio";
import { cueCaption } from "../../audio/cues";

/**
 * Base durations in ms, before the animation-speed multiplier.
 *
 * ## These are budgets now, not waits
 *
 * The previous round set `cardPlay` to 170 and `summon` to 250 and believed the
 * whole play therefore fitted §3's 600ms cap. Measured on a 60fps screencast it
 * took **1.9 seconds**, with the player's row completely empty from t≈250ms to
 * t≈1140ms — the object the player had just dragged did not exist anywhere on
 * screen for nine hundred milliseconds of it. Shortening these numbers again
 * would not have touched that, because the hole was not here: `battleView.sync`
 * returned early for the whole batch while layout was locked, so the token was
 * not created by `cardPlayed` or by `characterSummoned` but by the `finally` at
 * the end of `play()`. Every sleep in the batch happened in front of an empty
 * row.
 *
 * With arrivals no longer deferred, the flight starts on the frame the engine
 * answers and lasts 300ms. What these numbers now buy is **overlap**: the beat
 * for `cardPlayed` is short enough that a trigger nameplate lands *while* the
 * card is still in the air rather than 550ms after it vanished, and the summon
 * beat is the tail of the landing rather than a wait in front of it. §3 names
 * sequential animations that wait for each other as the thing that makes a UI
 * feel like a slideshow.
 *
 * `turnBanner` came down from 700 to 240 in the same change, because the
 * handover is now a wipe of light across the mat's centre line instead of three
 * full-board DOM plates costing three and a half seconds a turn.
 */
const TIMING = {
  cardPlay: 90,
  summon: 150,
  attack: 380,
  damage: 240,
  heal: 260,
  status: 200,
  defeat: 380,
  confluence: 1100,
  resonance: 1400,
  turnBanner: 240,
  trigger: 130,
  quiet: 60,
} as const;

const sleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => window.setTimeout(resolve, ms));

export class BattlePresenter {
  /** events seen at least once this session — used by "skip seen animations" */
  private static seenEffects = new Set<string>();

  private queue: Promise<void> = Promise.resolve();
  private skipRequested = false;
  /** the swing whose damage beat has not landed yet — see attackDeclared */
  private pendingStrike: { attackerInstanceId: string; target: TargetRef } | null = null;

  constructor(
    private readonly view: BattleView,
    private readonly hud: BattleHud,
    private readonly content: ContentIndex,
    private readonly audio: AudioManager
  ) {}

  /** Duration after the speed setting, with the skip-seen rule applied. */
  private time(base: number, key?: string): number {
    if (this.skipRequested) return 0;
    let ms = base * animationScale();
    if (key && getSettings().skipSeenAnimations && BattlePresenter.seenEffects.has(key)) {
      ms *= 0.55;
    }
    if (key) BattlePresenter.seenEffects.add(key);
    return ms;
  }

  /** The player pressed skip — collapse the rest of the current sequence. */
  requestSkip(): void {
    this.skipRequested = true;
  }

  /**
   * Play a batch of events. Returns a promise that resolves once the batch has
   * finished animating; batches are serialized so they never interleave.
   */
  play(events: EngineEvent[], getView: () => PlayerView): Promise<void> {
    this.queue = this.queue.then(async () => {
      this.skipRequested = false;
      /**
       * Draw the faces this batch is about to need, before the first beat.
       *
       * The engine has already resolved everything by the time a batch arrives,
       * so `getView()` here is the board as it will be when the last event has
       * played. Handing it over now buys the whole length of the animation to
       * draw the card faces that would otherwise be drawn on the single frame a
       * token appears — measured as a 366ms long task in the middle of the
       * rival's play. See `BattleView.prewarmBatch`; the drain is per-frame and
       * stands down while anything is in flight.
       */
      this.view.prewarmBatch(getView());
      this.view.facesSettled();
      this.view.setLayoutLocked(true);
      try {
        for (const event of events) {
          const view = getView();
          this.hud.logEvent(event, view);
          await this.playOne(event, view);
        }
      } finally {
        this.view.setLayoutLocked(false);
        this.view.sync(getView());
      }
    });
    return this.queue;
  }

  /**
   * Fire an accessibility cue (§11), and show its caption when the setting asks.
   *
   * Cues are synthesised rather than loaded (src/audio/cues.ts). They sit
   * beside the existing SFX calls rather than replacing them: an SFX slot is a
   * flourish that may one day hold a real recording, and a cue is a signal that
   * has to work today whether or not one ever arrives.
   */
  private cue(id: string): void {
    this.audio.cue(id);
    const caption = cueCaption(id);
    if (caption) this.hud.toast(caption, "info");
  }

  /** Whether a target belongs to the seat being shown. */
  private ownsTarget(target: TargetRef, view: PlayerView): boolean {
    if (target.kind === "leader") return target.seat === view.seat;
    const object = this.view.getBoardObject(target.instanceId);
    return object ? object.userData["seat"] === view.seat : false;
  }

  private async playOne(event: EngineEvent, view: PlayerView): Promise<void> {
    switch (event.e) {
      /**
       * The handover, moved into the room.
       *
       * The board learns whose turn it is *first* — the active half of the mat
       * lifts, that seat's practical comes up, motes run the seam — and the DOM
       * ribbon that names the turn rides along with it rather than being waited
       * for. Measured before this change: RIVAL'S TURN occupied the centre of the
       * play area from 476ms to 1576ms, a card nameplate from 2326ms to 2702ms
       * and YOUR TURN from 2702ms to 3447ms, every turn.
       */
      case "turnStarted": {
        const yours = event.seat === view.seat;
        this.view.setTurnSide(yours ? "player" : "enemy");
        this.hud.announceTurn(yours, event.turn);
        this.audio.play("sfx.turn.start");
        this.cue(yours ? "turnStartedYou" : "turnStartedEnemy");
        await sleep(this.time(TIMING.turnBanner));
        break;
      }

      case "cardDrawn": {
        this.audio.play("sfx.card.draw");
        this.cue("cardDrawn");
        await sleep(this.time(TIMING.quiet));
        break;
      }

      case "cardPlayed": {
        const card = this.content.cards[event.cardId];
        if (card) this.audio.play(`sfx.card.play.${card.current}`);
        this.view.sync(view);
        await sleep(this.time(TIMING.cardPlay, `play:${event.cardId}`));
        break;
      }

      case "characterSummoned": {
        this.view.sync(view);
        await sleep(this.time(TIMING.summon));
        break;
      }

      /**
       * A wave lands during the turn-start beat, when the player is not looking
       * for the board to change, so it is announced rather than merely drawn.
       * The count is part of the announcement — "2 of 3" is the whole difference
       * between a wave encounter and an opponent who will not stop.
       */
      case "waveArrived": {
        const short = event.dropped > 0 ? ` · ${event.dropped} had no room` : "";
        this.hud.toast(`Wave ${event.index} of ${event.total} — ${event.label}${short}`);
        this.audio.play("sfx.card.play.gale");
        this.view.sync(view);
        await sleep(this.time(TIMING.summon));
        break;
      }

      case "attackDeclared": {
        this.audio.play("sfx.combat.attack");
        const attacker = this.view.getBoardObject(event.attackerInstanceId);
        if (attacker && !getSettings().reducedMotion) {
          /**
           * A PARTIAL lunge, per the reference: the attacker leans about 30% of
           * the way toward its target and swells slightly, rather than
           * travelling the whole distance. It never leaves its row. The token's
           * own exponential easing (tau about 0.14s, which matches the measured
           * slide) carries both the lean and the snap back, so the whole
           * exchange lands inside ~0.4s.
           */
          const from = attacker.targetPosition.clone();
          const to = this.view.worldPositionOf(event.target);
          const gap = to.clone().sub(from);
          const lunge = gap.clone().multiplyScalar(0.3).clampLength(0, 1.35);

          attacker.animOffset.copy(lunge);
          attacker.targetScale = 1.13;
          await sleep(this.time(TIMING.attack * 0.45));

          attacker.animOffset.set(0, 0, 0);
          attacker.targetScale = 1;
        }
        /**
         * Remember who swung, so the damage beat can strike its spark on the
         * line between the pair rather than at the defender's centre. The
         * damage event alone does not name an attacker.
         */
        this.pendingStrike = { attackerInstanceId: event.attackerInstanceId, target: event.target };
        await sleep(this.time(TIMING.attack * 0.3));
        break;
      }

      case "damageDealt": {
        const position = this.view.worldPositionOf(event.target);
        this.audio.play("sfx.combat.impact");
        if (event.target.kind === "leader") {
          this.cue(event.target.seat === view.seat ? "yourLeaderDamaged" : "enemyLeaderDamaged");
        }
        if (event.elementalBonus) this.cue("elementalBonus");
        if (event.absorbedByShield) this.cue("shieldAbsorbed");
        this.strikeSpark(event.target, position);
        this.view.vfx.impact(position, event.amount, event.elementalBonus);
        if (event.amount > 0) {
          this.floatNumber(event.target, `-${event.amount}`, event.elementalBonus ? "elemental" : "damage");
        } else if (event.absorbedByShield) {
          this.floatNumber(event.target, "Blocked", "block");
        }
        if (getSettings().screenShake && event.amount >= 4 && !getSettings().reducedMotion) {
          this.shake(Math.min(event.amount / 12, 0.7));
        }
        await sleep(this.time(TIMING.damage));
        break;
      }

      case "healed": {
        if (event.amount <= 0) break;
        const position = this.view.worldPositionOf(event.target);
        this.view.vfx.heal(position, event.amount);
        this.floatNumber(event.target, `+${event.amount}`, "heal");
        await sleep(this.time(TIMING.heal));
        break;
      }

      /**
       * A card lost because the hand was full.
       *
       * Worth a sound of its own: the card is gone and nothing else on screen
       * says so as plainly as hearing it burn.
       */
      case "cardBurned": {
        this.audio.play("sfx.card.burn");
        await sleep(this.time(TIMING.quiet));
        break;
      }

      /**
       * A Reaction going face-down. Deliberately not the Current sound the
       * other cards get — nothing has been cast yet, something has been *set*,
       * and the two should not be confusable by ear.
       */
      case "reactionSet": {
        this.audio.play("sfx.card.set");
        this.view.sync(view);
        await sleep(this.time(TIMING.quiet));
        break;
      }

      case "statusRemoved": {
        this.audio.play("sfx.status.expire");
        await sleep(this.time(TIMING.quiet));
        break;
      }

      case "statusApplied": {
        const definition = this.content.statuses[event.status.id];
        const color = definition?.polarity === "positive" ? "#7dffb0" : "#ff6b8a";
        this.view.vfx.statusPop(this.view.worldPositionOf(event.target), color);
        this.audio.play("sfx.status.apply");
        // §11 row 18 is scoped to a NEGATIVE status on one of yours; a buff
        // landing on your own board is not a thing to warn somebody about
        if (definition?.polarity !== "positive" && this.ownsTarget(event.target, view)) this.cue("statusApplied");
        await sleep(this.time(TIMING.status));
        break;
      }

      case "characterDefeated": {
        const object = this.view.getBoardObject(event.instance.instanceId);
        this.audio.play("sfx.combat.defeat");
        this.cue(event.instance.controller === view.seat ? "friendlyDefeated" : "enemyDefeated");
        if (object) this.view.vfx.defeat(object.position.clone());
        await sleep(this.time(TIMING.defeat));
        break;
      }

      case "confluenceActivated": {
        this.audio.play(`sfx.confluence.${event.confluence}`);
        this.cue("confluenceActivated");
        this.view.vfx.confluence(event.confluence, event.currents);
        const def = this.content.confluences[event.confluence];
        if (def) this.hud.toast(`Confluence — ${def.name}`);
        await sleep(this.time(TIMING.confluence, `confluence:${event.confluence}`));
        break;
      }

      case "resonanceActivated": {
        this.audio.play("sfx.resonance");
        this.cue("resonanceActivated");
        this.view.vfx.resonance(event.current);
        const current = this.content.currents[event.current];
        this.hud.toast(`Perfect Resonance — ${current?.resonance?.name ?? current?.name}`);
        await sleep(this.time(TIMING.resonance, `resonance:${event.current}`));
        break;
      }

      case "obsessedThresholdCrossed": {
        if (event.nowObsessed) {
          this.audio.play("sfx.obsession.gain");
          if (event.seat === view.seat) this.cue("obsessed");
          this.hud.toast(
            event.seat === view.seat ? "You are Obsessed — you take +1 damage" : "Rival is Obsessed",
            event.seat === view.seat ? "error" : "info"
          );
        }
        await sleep(this.time(TIMING.status));
        break;
      }

      case "fullFixation": {
        this.audio.play("sfx.obsession.full");
        this.cue("fullFixation");
        this.view.vfx.screenFlash("#ffd86b", 0.32);
        this.hud.toast("FULL FIXATION — your Ultimate costs nothing this turn");
        await sleep(this.time(TIMING.status * 2));
        break;
      }

      case "triggerQueued": {
        const card = this.content.cards[event.sourceCardId];
        if (card) this.hud.showTrigger(card.name, humanTrigger(event.trigger));
        await sleep(this.time(TIMING.trigger));
        break;
      }

      case "keywordTriggered": {
        const keyword = this.content.keywords[event.keyword];
        const card = this.content.cards[event.cardId];
        if (keyword && card) this.hud.showTrigger(card.name, keyword.name);
        await sleep(this.time(TIMING.trigger));
        break;
      }

      case "refracted": {
        const palette = CURRENT_PALETTE[event.intoCurrent];
        this.view.vfx.screenFlash(palette.key, 0.18);
        this.hud.toast(`Refracted into ${palette.label}`);
        await sleep(this.time(TIMING.status));
        break;
      }

      case "fatigueDamage": {
        this.view.vfx.screenFlash("#ff4d6a", 0.2);
        if (event.seat === view.seat) this.cue("burnout");
        this.floatNumber({ kind: "leader", seat: event.seat }, `-${event.amount} Burnout`, "damage");
        await sleep(this.time(TIMING.damage));
        break;
      }

      case "matchEnded": {
        this.audio.play(event.winner === view.seat ? "sfx.victory" : "sfx.defeat");
        this.cue(event.winner === view.seat ? "victory" : "defeat");
        await sleep(this.time(TIMING.quiet));
        break;
      }

      default:
        // events with no dedicated animation still advance the log
        await sleep(this.time(TIMING.quiet));
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Floating combat text
  // -------------------------------------------------------------------------

  private floatNumber(target: EngineEvent extends never ? never : { kind: "leader"; seat: 0 | 1 } | { kind: "character"; instanceId: string }, text: string, kind: string): void {
    const point = this.view.screenPositionOf(target);
    const node = document.createElement("div");
    node.className = `float-number float-${kind}`;
    node.textContent = text;
    const container = this.hud.root;
    const rect = container.getBoundingClientRect();
    node.style.left = `${point.x - rect.left}px`;
    node.style.top = `${point.y - rect.top}px`;
    container.appendChild(node);
    // outlives the impact beat — damage numbers double as combat history
    window.setTimeout(() => node.remove(), 2000);
  }

  /**
   * Strike the white contact flash where the attacker's and defender's
   * silhouettes meet, and throw the sparks onward along the same vector.
   *
   * Only fires for the swing we are actually mid-way through: damage from a
   * card effect has no attacker and no direction, and would place the flash on
   * an arbitrary line if we guessed one.
   */
  private strikeSpark(target: TargetRef, targetPosition: THREE.Vector3): void {
    const strike = this.pendingStrike;
    if (!strike) return;
    const sameTarget =
      strike.target.kind === target.kind &&
      (target.kind === "character"
        ? strike.target.kind === "character" && strike.target.instanceId === target.instanceId
        : strike.target.kind === "leader" && strike.target.seat === target.seat);
    if (!sameTarget) return;
    this.pendingStrike = null;

    const attacker = this.view.getBoardObject(strike.attackerInstanceId);
    if (!attacker) return;

    const from = attacker.targetPosition.clone();
    const along = targetPosition.clone().sub(from);
    if (along.lengthSq() < 1e-6) return;
    /**
     * Pull the flash back off the target's centre to its near rim, so it lands
     * on the contact line rather than in the middle of the defender.
     *
     * The distance has to come from what was actually struck: a leader is a
     * medallion only 2.2 deep, so pulling back by a card's 3.45 would overshoot
     * its near edge entirely and strike the flash in empty arena.
     */
    const depth = target.kind === "leader" ? BOARD.leaderHeight : BOARD.cardHeight;
    const contact = targetPosition.clone().addScaledVector(along.clone().normalize(), -depth * 0.42);
    this.view.vfx.contactSpark(contact, along);
  }

  private shake(intensity: number): void {
    const canvas = this.view.scene.renderer.domElement;
    // The reference never shakes the camera at all, even on a lethal trade, so
    // keep ours subtle: capped well below the point where it fights readability.
    canvas.style.setProperty("--shake", String(Math.min(intensity, 0.45)));
    canvas.classList.add("shaking");
    window.setTimeout(() => canvas.classList.remove("shaking"), 260);
  }
}

function humanTrigger(trigger: string): string {
  const map: Record<string, string> = {
    onPlay: "On play",
    onDefeat: "On defeat",
    afterparty: "Afterparty",
    startOfTurn: "Start of turn",
    onAttack: "On attack",
    onDamaged: "On damaged",
    onHealed: "On healed",
    inspire: "Inspire",
    flow: "Flow",
    rushwind: "Rushwind",
    onTargeted: "Parasocial",
    onCardPlayed: "On card played",
    growComplete: "Grow",
    reaction: "Reaction",
    activate: "Activate",
    eventTick: "Event",
  };
  return map[trigger] ?? trigger;
}
