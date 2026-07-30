/**
 * Drives a scripted stage: walks its beats, speaks the coach's lines, gates
 * what the player may do, and decides when the stage is finished.
 *
 * It owns no rules and no rendering. It reads a `PlayerView` the engine
 * produced, hands the driver a gate predicate, and calls back to whoever is
 * drawing the coach and the HUD. That keeps the same runner usable by the
 * tutorial, puzzles, boss intros and story chapters.
 */

import type { PlayerIntent, PlayerView } from "../engine/types";
import type { BeatDef, HudWidgetId, StageDef } from "../engine/encounters";
import { conditionMet, intentAllowed } from "../engine/encounters";

export interface StageRunnerCallbacks {
  /**
   * Speak a line. With `requireAck` it resolves only once the player has
   * acknowledged; otherwise it returns immediately and the line stays on screen
   * as a reminder while they act.
   */
  say: (line: { speaker?: string; text: string; spotlight?: string }, requireAck: boolean) => Promise<void>;
  /** stop speaking and drop any spotlight */
  clearCoach: () => void;
  /** cumulative set of widgets the HUD should show */
  reveal: (widgets: ReadonlySet<HudWidgetId>) => void;
  /** the gate refused something; surface the reason */
  refused: (reason: string) => void;
  /** the stage's objective is satisfied */
  complete: () => void;
  /** the stage's fail condition is satisfied (puzzles: retry) */
  failed?: () => void;
  /** resolve a hand instance to its card id, so beats can name a specific card */
  cardIdOf?: (instanceId: string) => string | null;
}

export class StageRunner {
  private beatIndex = -1;
  private acknowledged = false;
  private revealed = new Set<HudWidgetId>();
  private finished = false;
  /** guards against re-entrant advances while a line is still being spoken */
  private advancing = false;
  /** most recent view, kept fresh even while a coach line holds sync() */
  private latestView: PlayerView | null = null;

  constructor(
    private readonly stage: StageDef,
    private readonly callbacks: StageRunnerCallbacks
  ) {
    for (const widget of stage.reveal ?? []) this.revealed.add(widget);
  }

  /** The beat currently being taught, if any. */
  get beat(): BeatDef | null {
    return this.stage.beats[this.beatIndex] ?? null;
  }

  get isFinished(): boolean {
    return this.finished;
  }

  /**
   * The gate handed to the driver. Refusing here rather than in the view is
   * what makes the lesson binding: the intent never reaches the reducer.
   */
  gateFor(): (intent: PlayerIntent) => string | null {
    return (intent) => {
      const beat = this.beat;
      if (!beat || this.finished) return null;
      /**
       * Two intents are never gated.
       *
       * `mulligan`, because a stage that deals a real opening hand cannot start
       * until it resolves — an intro beat permitting nothing would deadlock the
       * match before the first turn.
       *
       * `concede`, because it is the only way off the screen. A lesson that
       * refuses it strands anyone who wants to stop, and the concede button
       * stays visible and live throughout.
       */
      if (intent.type === "mulligan" || intent.type === "concede") return null;
      if (intentAllowed(intent, beat.allow, this.callbacks.cardIdOf)) return null;
      const reason = beat.denyReason ?? "Not yet — follow the current step.";
      this.callbacks.refused(reason);
      return reason;
    };
  }

  /**
   * Start the stage, or re-evaluate it after the view changed.
   *
   * The latest view is recorded even when a sync is dropped for re-entrancy.
   * A coach line can hold this method for as long as the player takes to read
   * it, and they can act during that time — so evaluating beats against the
   * view captured on entry would judge the lesson on a board several moves out
   * of date, and a condition satisfied while they were reading would be missed
   * entirely with nothing left to re-drive the runner.
   */
  async sync(view: PlayerView): Promise<void> {
    this.latestView = view;
    if (this.finished || this.advancing) return;
    this.advancing = true;
    try {
      if (this.beatIndex < 0) await this.enterBeat(0);

      // Losing is checked before advancing: a puzzle whose turn has ended has
      // lost even if some later beat's condition also happens to be true.
      if (this.stage.failIf && this.latestView && conditionMet(this.stage.failIf, this.latestView, true)) {
        this.finished = true;
        this.callbacks.clearCoach();
        this.callbacks.failed?.();
        return;
      }

      // A single action can satisfy several beats at once — playing a third
      // character can finish "play a card" and the stage objective together —
      // so keep advancing while the current beat is done.
      let guard = 0;
      while (!this.finished && guard++ < 32) {
        const beat = this.beat;
        if (!beat) break;
        if (!this.latestView || !conditionMet(beat.until, this.latestView, this.acknowledged)) break;
        if (this.beatIndex + 1 >= this.stage.beats.length) {
          this.finish();
          break;
        }
        await this.enterBeat(this.beatIndex + 1);
      }

      // an objective can complete a stage early, before the last beat
      if (
        !this.finished &&
        this.stage.objective &&
        this.latestView &&
        conditionMet(this.stage.objective, this.latestView, this.acknowledged)
      ) {
        const last = this.beatIndex >= this.stage.beats.length - 1;
        if (last) this.finish();
      }
    } finally {
      this.advancing = false;
    }
  }

  private finish(): void {
    const view = this.latestView;
    if (view && this.stage.objective && !conditionMet(this.stage.objective, view, true)) {
      // the script ran out of beats but the goal was not met; leave the stage
      // open rather than congratulating the player for nothing
      return;
    }
    this.finished = true;
    this.callbacks.clearCoach();
    this.callbacks.complete();
  }

  private async enterBeat(index: number): Promise<void> {
    this.beatIndex = index;
    this.acknowledged = false;
    const beat = this.beat;
    if (!beat) return;

    for (const widget of beat.reveal ?? []) this.revealed.add(widget);
    this.callbacks.reveal(new Set(this.revealed));

    /**
     * Only a dialogue beat waits for "Got it". An action beat must NOT block:
     * `sync` holds its re-entrancy guard for as long as a line is unresolved,
     * so awaiting an acknowledgement the player was never asked for freezes the
     * runner — it would sit on the beat forever while they did exactly what it
     * asked. Intermediate lines still wait, so multi-line beats read in order;
     * the final line of an action beat stays up as a reminder.
     */
    const lines = beat.say ?? [];
    const waitsForAck = beat.until.when === "acknowledged";
    for (let i = 0; i < lines.length; i++) {
      const isLast = i === lines.length - 1;
      await this.callbacks.say(lines[i]!, waitsForAck || !isLast);
    }

    this.acknowledged = true;
  }
}
