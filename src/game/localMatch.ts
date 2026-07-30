/**
 * Local match driver: owns the authoritative MatchState for an offline game,
 * feeds intents to the engine, streams EngineEvents to the presenter, and runs
 * the AI's turn.
 *
 * Shaped exactly like the future network driver — the UI only ever sends
 * PlayerIntents and consumes EngineEvents, so swapping in a WsTransport later
 * changes nothing above this layer.
 */

import type {
  AiProfile,
  CardPatch,
  ConfluenceAvailability,
  ContentIndex,
  DeckList,
  EncounterSetup,
  EngineEvent,
  MatchRecord,
  MatchState,
  PlayerIntent,
  PlayerView,
  RulesErrorShape,
  Seat,
} from "../engine/types";
import { createMatch, redact } from "../engine/state";
import { resolveMatchContent } from "../engine/content";
import { applyIntent, beginScriptedMatch } from "../engine/reducer";
import { RulesError } from "../engine/intents";
import { recordIntent, startRecord } from "../engine/replay";
import { availableConfluences } from "../engine/currents";
import { chooseIntent } from "../ai/ai";

export interface LocalMatchOptions {
  content: ContentIndex;
  playerDeck: DeckList;
  aiDeck: DeckList;
  aiProfile: AiProfile;
  seed: number;
  /** which seat the human plays; defaults to 0 */
  playerSeat?: Seat;
  /** fixed first seat for tutorials/puzzles; omit for a coin flip */
  firstSeat?: Seat;
  /** scripted setup for tutorials, puzzles and boss fights */
  scenario?: EncounterSetup;
  /** boss / weekly-modifier tweaks, as dotted paths into balance.json */
  balanceOverrides?: Record<string, number>;
  /**
   * Per-card patches for this match, keyed by card id. This is the per-player
   * lever — patching one seat's leader changes the game for that seat only,
   * which balance overrides cannot do.
   */
  cardOverrides?: Record<string, CardPatch>;
  /**
   * Extra cards cloned from real ones (variantId → baseId) — the per-copy lever.
   * A Doomscroll deck holding one upgraded copy of a card needs the upgraded one
   * to be a different card, not a patch on the id both copies share.
   */
  cardVariants?: Record<string, string>;
  /**
   * Who fills the other seat.
   *
   * "idle" replaces the AI with an opponent that only ever passes — the
   * tutorial's Practice Bot. It still has to end its turn or the match stalls.
   *
   * "human" is 09 §17's Hotseat: nobody drives the second seat, because a
   * person will. The driver stops taking the turn and the viewing seat moves
   * instead — see `setViewingSeat`.
   */
  opponent?: "ai" | "idle" | "human";
  /**
   * Teaching modes restrict what the player may do to the lesson at hand.
   * Return a message to refuse the intent, or null to let it through.
   *
   * It lives here rather than in the view for two reasons: the view must not be
   * the thing that decides what is permitted, and a gate that only greys out
   * buttons is not a gate — a stray keyboard shortcut or a race would walk
   * straight past it. Legality is still the engine's call; this is only whether
   * the current lesson permits a legal move.
   */
  gate?: (intent: PlayerIntent) => string | null;
}

export type MatchListener = (events: EngineEvent[], state: MatchState) => void | Promise<void>;

export class LocalMatch {
  readonly content: ContentIndex;
  /**
   * The seat the person at the keyboard is currently playing.
   *
   * Not `readonly` any more, and only Hotseat moves it. In every other mode
   * this is set once and never touched, which is why it reads like a constant
   * everywhere else in the file.
   */
  playerSeat: Seat;
  /** The other seat. Mutable for the same reason `playerSeat` is: Hotseat. */
  aiSeat: Seat;
  readonly record: MatchRecord;

  private state: MatchState;
  private readonly aiProfile: AiProfile;
  private readonly opponentKind: "ai" | "idle" | "human";
  private listeners: MatchListener[] = [];
  private busy = false;
  /** teaching-mode gate; swapped as the script advances between beats */
  private gate: ((intent: PlayerIntent) => string | null) | null = null;

  constructor(options: LocalMatchOptions) {
    /**
     * Resolve balance overrides ONCE and use the same index for setup, every
     * intent and the AI. Resolving per call would be wasteful and, worse, a
     * mismatch between the index that dealt the match and the one applying
     * intents would produce a game playing by two different rulebooks.
     */
    this.content = resolveMatchContent(
      options.content,
      options.balanceOverrides,
      options.cardOverrides,
      options.cardVariants
    );
    this.playerSeat = options.playerSeat ?? 0;
    this.aiSeat = this.playerSeat === 0 ? 1 : 0;
    this.aiProfile = options.aiProfile;
    this.opponentKind = options.opponent ?? "ai";
    this.gate = options.gate ?? null;

    const decks: [DeckList, DeckList] = this.playerSeat === 0
      ? [options.playerDeck, options.aiDeck]
      : [options.aiDeck, options.playerDeck];

    this.state = createMatch(
      {
        seed: options.seed,
        decks,
        ...(options.firstSeat !== undefined ? { firstSeat: options.firstSeat } : {}),
        ...(options.scenario ? { scenario: options.scenario } : {}),
        // recorded in config so replay() rebuilds the same rulebook
        ...(options.balanceOverrides ? { balanceOverrides: options.balanceOverrides } : {}),
        ...(options.cardOverrides ? { cardOverrides: options.cardOverrides } : {}),
        ...(options.cardVariants ? { cardVariants: options.cardVariants } : {}),
      },
      this.content
    );
    this.record = startRecord(this.state);

    // Scripted stages that teach before they test have no mulligan to make;
    // opening the match here gives the player their first Hype and draw.
    // `replay()` does the same from config, so records still reproduce.
    if (options.scenario?.mulligan === "none") {
      this.pendingOpen = beginScriptedMatch(this.state, this.content);
    }
  }

  /** events from a scripted opening, flushed on start() so listeners see them */
  private pendingOpen: EngineEvent[] = [];

  // --- queries --------------------------------------------------------------

  getState(): MatchState {
    return this.state;
  }

  /** The redacted view the human player is allowed to see. */
  getView(): PlayerView {
    return redact(this.state, this.playerSeat);
  }

  isPlayerTurn(): boolean {
    return this.state.activeSeat === this.playerSeat && this.state.phase === "main" && this.state.winner === null;
  }

  /**
   * Hand the device over — 09 §17's Hotseat.
   *
   * Moving the viewing seat is the *whole* mechanism, and it works because
   * `getView()` redacts against `playerSeat` every time it is called. The second
   * player does not get a second driver, a second state or a second view
   * pipeline; they get the same one, told to look the other way. A hand that was
   * hidden a moment ago is hidden by exactly the code that has always hidden it.
   *
   * Refused outside Hotseat. Every other mode has one person at the keyboard,
   * and a mode that could silently show them the opponent's hand is a cheat with
   * a public method.
   */
  setViewingSeat(seat: Seat): boolean {
    if (this.opponentKind !== "human") return false;
    this.playerSeat = seat;
    this.aiSeat = seat === 0 ? 1 : 0;
    return true;
  }

  /**
   * Whether the other seat is a person at this same device.
   *
   * Exposed so `LocalTransport` can decide whether to offer `HotseatControls`
   * at all. `setViewingSeat` and `awaitingHandoff` already refuse politely
   * outside Hotseat, but "the method is there and always says no" is a worse
   * contract than "the capability is absent", and it is the absence the battle
   * screen actually wants to branch on.
   */
  isHotseat(): boolean {
    return this.opponentKind === "human";
  }

  /** True when the device is waiting to be passed to the other player. */
  awaitingHandoff(): boolean {
    return (
      this.opponentKind === "human" &&
      this.state.winner === null &&
      this.state.phase === "main" &&
      this.state.activeSeat !== this.playerSeat
    );
  }

  isBusy(): boolean {
    return this.busy;
  }

  confluences(): ConfluenceAvailability[] {
    return availableConfluences(this.state, this.content, this.playerSeat);
  }

  // --- listeners ------------------------------------------------------------

  onEvents(listener: MatchListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private async emit(events: EngineEvent[]): Promise<void> {
    for (const listener of this.listeners) {
      await listener(events, this.state);
    }
  }

  // --- intents --------------------------------------------------------------

  /**
   * Submit a player intent. Returns a refusal when the intent was rejected (the
   * UI should have prevented it, but never crash on it), or null on success.
   *
   * Returns the structured `RulesErrorShape` rather than a bare message string.
   * `RulesError` has carried a canonical `code` since it was written and this
   * method was keeping only `.message`, so the caller could show the refusal but
   * never branch on it. Nothing new is computed here — information that was
   * being discarded is now passed on, which is what `SubmitResult` in
   * `src/net/transport.ts` needs in order to exist.
   *
   * The three non-engine refusals borrow the closest canonical codes: a wrong
   * seat is `notYourTurn`, and both the busy guard and a teaching gate are
   * `invalidIntent` — "the rules allow this, the situation does not".
   */
  async submit(intent: PlayerIntent): Promise<RulesErrorShape | null> {
    if (this.busy) {
      return { code: "invalidIntent", message: "Please wait for the current action to finish." };
    }
    if (intent.seat !== this.playerSeat) return { code: "notYourTurn", message: "Not your seat." };
    const refused = this.gate?.(intent);
    if (refused) return { code: "invalidIntent", message: refused };

    try {
      this.busy = true;
      const result = applyIntent(this.state, this.content, intent);
      this.state = result.state;
      recordIntent(this.record, intent);
      await this.emit(result.events);
    } catch (error) {
      if (error instanceof RulesError) return { code: error.code, message: error.message };
      throw error;
    } finally {
      this.busy = false;
    }

    await this.maybeRunAi();
    return null;
  }

  /** Auto-mulligan for the AI, and play its turn when it becomes active. */
  async maybeRunAi(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      // mulligan phase
      while (this.state.phase === "mulligan" && !this.state.players[this.aiSeat].mulliganDone) {
        const decision = chooseIntent(this.state, this.content, this.aiSeat, this.aiProfile);
        if (!decision) break;
        if (!(await this.applyAiIntent(decision.intent))) break;
      }

      // the AI's turn, one intent at a time so each step animates
      let guard = 0;
      while (
        this.state.phase === "main" &&
        this.state.winner === null &&
        this.state.activeSeat === this.aiSeat &&
        guard++ < 40
      ) {
        // The tutorial's Practice Bot does nothing but pass. It still has to
        // end its turn, or the match sits on the bot's turn forever.
        // Hotseat: the other seat is a person, so there is nothing to drive.
        // The screen shows the handoff and calls setViewingSeat when they are ready.
        if (this.opponentKind === "human") break;
        const decision =
          this.opponentKind === "idle"
            ? { intent: { type: "endTurn", seat: this.aiSeat } as PlayerIntent }
            : chooseIntent(this.state, this.content, this.aiSeat, this.aiProfile);
        if (!decision) break;
        const applied = await this.applyAiIntent(decision.intent);
        if (!applied || decision.intent.type === "endTurn") break;
      }
    } finally {
      this.busy = false;
    }
  }

  /**
   * Apply one AI intent, surviving an illegal one.
   *
   * The AI's randomness is derived from match state, so asking again after a
   * rejection returns the *same* intent forever — a retry loop would spin
   * rather than recover. On a RulesError the driver plays a single endTurn and
   * gives up on the turn: a rival that passes is a bug worth investigating, a
   * frozen board is a bug that ends the session. Returns false when the caller
   * should stop looping.
   */
  private async applyAiIntent(intent: PlayerIntent): Promise<boolean> {
    try {
      const result = applyIntent(this.state, this.content, intent);
      this.state = result.state;
      recordIntent(this.record, intent);
      await this.emit(result.events);
      return true;
    } catch (error) {
      if (!(error instanceof RulesError)) throw error;
      console.error("AI produced an illegal intent; ending its turn", intent, error.message);
      try {
        const fallback: PlayerIntent = { type: "endTurn", seat: this.aiSeat };
        const result = applyIntent(this.state, this.content, fallback);
        this.state = result.state;
        recordIntent(this.record, fallback);
        await this.emit(result.events);
      } catch {
        // nothing left to do; the guard in the caller stops the loop
      }
      return false;
    }
  }

  /** Swap the teaching gate as a script moves between beats. */
  setGate(gate: ((intent: PlayerIntent) => string | null) | null): void {
    this.gate = gate;
  }

  /** Kick off the match (player mulligan is submitted by the UI). */
  async start(): Promise<void> {
    if (this.pendingOpen.length > 0) {
      const events = this.pendingOpen;
      this.pendingOpen = [];
      await this.emit(events);
    }
    await this.maybeRunAi();
  }

  /** Finalize the record for match history. */
  finishRecord(): MatchRecord {
    if (this.state.winner !== null) {
      this.record.result = { winner: this.state.winner, turns: this.state.turn };
    }
    return this.record;
  }
}
