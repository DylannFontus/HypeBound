/**
 * The battle screen: owns the match driver, the 3D view, the HUD and the
 * presenter, and mediates every player interaction that needs more than a
 * drag (mulligan, target choosers, chooseOne branches, victory/defeat).
 */

import type {
  CardDef,
  ConfluenceAvailability,
  ContentIndex,
  DeckList,
  MatchRecord,
  MatchState,
  PlayerIntent,
  TargetRef,
} from "../../engine/types";
import { LocalTransport } from "../../net/localTransport";
import { isYourTurn, type MatchClocks, type MatchTransport, type TransportStatus } from "../../net/transport";
import { viewToState } from "../../net/viewToState";
/**
 * Still imported directly because these enumerate *targets*, and they take a
 * `MatchState` — see `matchState()` for why that is the remaining seam. The
 * legality *summary* (`attackableBy`, `canActivateLocation`) moved to the
 * transport and is no longer computed here.
 */
import {
  canUseFixation,
  checkPlayable,
  legalEquipTargets,
  legalFixationTargets,
} from "../../engine/intents";
import { legalChooseTargets } from "../../engine/effects";
import { BattleView } from "../battle/battleView";
import { BattleHud } from "../battle/hud";
import { HandBar } from "../battle/handBar";
import { BattlePresenter } from "../battle/presenter";
import { audio } from "../../audio/audio";
import { getSettings, updateSettings } from "../../save/settings";
import { emoteWheel, wearing } from "../../save/profile";
import { cosmeticById } from "../../game/cosmetics";
import { setPlayerCardBack } from "../battle/cardMesh";
import { getAiProfile } from "../../ai/profiles";
import { renderCardToCanvas } from "../cardRenderer/renderCard";
import { CURRENT_PALETTE } from "../cardRenderer/palette";
import type { AiDifficulty } from "../../engine/types";
import { createCoachOverlay, type CoachOverlay } from "../battle/coach";
import { createBoardMirror, type BoardMirror } from "../battle/mirror";
import { EMPTY_LEGALITY, type BoardSlot, type Legality } from "../battle/boardModel";
import {
  DEFERRED_KEYS,
  SHORTCUTS,
  focusedSlot,
  handleKey,
  initialKeyboardState,
  modeBanner,
  type KeyboardAction,
  type KeyboardContext,
  type KeyboardState,
} from "../battle/keyboard";
import { legalAttackTargets } from "../../engine/combat";
import { StageRunner } from "../../game/stageRunner";
import { HUD_WIDGETS, type HudWidgetId, type StageDef } from "../../engine/encounters";
import type { CardPatch, EncounterSetup, Seat } from "../../engine/types";

/**
 * What a finished match paid, for the result screen to print.
 *
 * Every line is optional except `clout` and `xp`, because the modes pay very
 * different things and a run mode's own payout happens elsewhere.
 */
export interface MatchSettlement {
  clout: number;
  xp: number;
  /** §3.5's first-win-of-the-day bonus, included in `clout` */
  firstWinBonus?: number;
  /** Clout today's AI allowance had no room for (09 §3) */
  cloutCapped?: number;
  /** what is left of the allowance after this match */
  cloutRemainingToday?: number;
  leveledUp?: boolean;
  newLevel?: number;
  /** anything else the mode paid, already worded — "First clear: +150 Clout" */
  extra?: string[];
}

export interface BattleScreenOptions {
  content: ContentIndex;
  playerDeck: DeckList;
  /**
   * An already-connected-or-connectable transport, for a match this screen is
   * not the authority over. Supply this and the screen builds nothing; omit it
   * and it makes its own `LocalTransport` from `aiDeck` and `difficulty`.
   *
   * `aiDeck` and `difficulty` are therefore optional, and required in practice
   * by the runtime check in the constructor rather than by the type. A
   * discriminated union would have the compiler enforce it, at the cost of
   * restructuring all nine existing call sites to prove something none of them
   * gets wrong.
   */
  transport?: MatchTransport;
  aiDeck?: DeckList;
  difficulty?: AiDifficulty;
  seed?: number;
  /**
   * Bank the match, and hand back what it paid so the result screen can say so.
   *
   * Called **once**, the moment the result appears, rather than when the player
   * leaves it. Two things were wrong with settling on the way out. A player who
   * closed the tab on the result screen kept nothing, which is a durability
   * property nobody would choose. And `recordMatch`'s return value was
   * discarded at all five call sites, so **the player was never told what a
   * match paid** — the grant was real and completely invisible, which is the
   * same failure as a reward that does not arrive, minus the way to notice.
   *
   * Return null to print nothing, which is right for a mode whose payout is the
   * run's rather than the match's.
   */
  onSettle?: (result: {
    winner: "player" | "ai" | "draw";
    /** Null online: a client cannot build a replay of a match it did not simulate. */
    record: MatchRecord | null;
    playerLeaderHealth: number;
  }) => MatchSettlement | null;
  onExit: (result: {
    winner: "player" | "ai" | "draw" | "quit";
    /**
     * Null for an online match, and typed that way rather than omitted.
     *
     * A client cannot assemble a `MatchRecord`: it holds neither the seed nor
     * either decklist, by design, because both would tell it what it is about
     * to draw. None of the nine `onExit` handlers reads this field — every
     * `result.record` in `main.ts` is inside an `onSettle` — so widening it
     * costs nothing and stops the exit buttons from silently doing nothing.
     */
    record: MatchRecord | null;
    /**
     * The player's leader health at the final event of the match.
     *
     * Run-based modes carry damage between fights, and re-deriving it by
     * replaying the record would mean re-simulating a finished match to learn a
     * number the driver is already holding.
     */
    playerLeaderHealth: number;
    /** which button was pressed: "again" wants another match, "menu" wants out */
    action: "again" | "menu";
  }) => void;
  /**
   * End-sequence button labels. Defaults to Play Again / Back to Lobby; a run
   * mode overrides them because "Play Again" would mean replaying a node it has
   * already resolved. `secondary: null` hides the second button entirely.
   */
  endActions?: { primary?: string; secondary?: string | null };
  /**
   * Scripted stage (tutorial, puzzle, boss). When present the battle is dealt
   * from the stage's scenario, a coach drives the lesson, and the player is
   * gated to whatever the current beat permits.
   */
  stage?: StageDef;
  /** called when the stage's objective is satisfied */
  onStageComplete?: () => void;
  /** called when the stage's fail condition is satisfied (puzzles: retry) */
  onStageFailed?: () => void;
  /** boss / weekly-modifier balance tweaks, as dotted paths into balance.json */
  balanceOverrides?: Record<string, number>;
  /** per-card patches — how a run artifact or an upgrade bends one seat's cards */
  /**
   * A global rule in force for this match, stated before the first card is
   * played — 09 §12 requires the Remix modifier be *"displayed on the queue tile
   * and in the mulligan screen"*, and the general principle behind that is worth
   * more than the mode: a rule change the player discovers by losing to it is a
   * bug. Any mode with a house rule can pass one.
   */
  ruleNote?: { name: string; text: string };
  /**
   * 09 §17's Hotseat: two humans, one device.
   *
   * The names are shown on the handoff screen so a player knows the device is
   * being passed *to them* and not merely that a turn ended.
   */
  hotseat?: { seatNames: [string, string] };
  cardOverrides?: Record<string, CardPatch>;
  /** Remastered card ids, cloned from the cards they upgrade (Doomscroll) */
  cardVariants?: Record<string, string>;
  /**
   * Scenario setup for a match that is NOT a scripted stage — a boss fight is a
   * normal constructed game that happens to start with extra leader health.
   */
  scenario?: EncounterSetup;
  /**
   * Who takes the first turn. Omitted, it is a coin flip. A story episode may
   * fix it, because "they were already playing when you walked in" is a thing a
   * scene can establish and a coin flip can then contradict.
   */
  firstSeat?: Seat;
}

export class BattleScreen {
  readonly root: HTMLElement;
  /**
   * The match, reached only through `MatchTransport`.
   *
   * Typed as the interface. It used to be the concrete `LocalTransport`, on the
   * reasoning that "the day a `WsTransport` exists the compiler will name
   * exactly the lines that do not survive it" — which worked: the compiler
   * named them, and they were `authoritativeState()` (now gone, see
   * `matchState()`) and the debug handle below.
   *
   * `local` is the one remaining narrowing, held once rather than cast at each
   * use, so every place that needs an offline-only capability is visible as a
   * null check instead of hidden inside a cast.
   */
  private readonly match: MatchTransport;
  /** Non-null only for an offline match. The escape hatches, in one place. */
  private readonly local: LocalTransport | null;
  private readonly view: BattleView;
  private readonly handBar: HandBar;
  private readonly hud: BattleHud;
  private readonly presenter: BattlePresenter;
  private readonly content: ContentIndex;
  private readonly boardHost: HTMLElement;
  private overlay: HTMLElement | null = null;
  private ended = false;
  /** False until `connect()` resolves. `refresh()` must not read a view before then. */
  private connected = false;
  /** The last clocks the authority reported; the HUD interpolates from them. */
  private clocks: MatchClocks | null = null;
  private readonly coach: CoachOverlay | null;
  private readonly runner: StageRunner | null;
  private endSequenceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly mirror: BoardMirror;
  private readonly modeBanner: HTMLElement;
  /** Connection state, for a match where the connection can fail. */
  private readonly connectionBanner: HTMLElement;
  private stopStatus: (() => void) | null = null;
  private graceTicker: ReturnType<typeof setInterval> | null = null;
  private graceDeadlineMs: number | null = null;
  private keyboard: KeyboardState = initialKeyboardState();

  constructor(private readonly options: BattleScreenOptions) {
    this.content = options.content;

    this.root = document.createElement("div");
    this.root.className = "screen battle-screen";

    this.boardHost = document.createElement("div");
    this.boardHost.className = "battle-board-host";
    this.root.appendChild(this.boardHost);

    const stage = options.stage;
    this.coach = stage ? createCoachOverlay(this.root) : null;
    this.runner = stage
      ? new StageRunner(stage, {
          say: async (line, requireAck) => {
            await this.coach?.say({ ...line, requireAck });
          },
          clearCoach: () => this.coach?.clear(),
          reveal: (widgets) => this.applyReveal(widgets),
          refused: (reason) => this.hud.toast(reason, "info"),
          complete: () => this.options.onStageComplete?.(),
          failed: () => this.options.onStageFailed?.(),
          cardIdOf: (instanceId) =>
            this.match.view().you.hand.find((c) => c.instanceId === instanceId)?.cardId ?? null,
        })
      : null;

    /**
     * Bring your own transport, or the screen makes an offline one.
     *
     * Injection is optional rather than mandatory, which deviates from the
     * advice this change was based on ("move construction out to main.ts's nine
     * route factories"). Two reasons. Nine call sites would each gain twenty
     * lines of `LocalTransport` options for no behavioural gain — and the gate
     * closure reads `this.runner`, which is built *inside* this constructor, so
     * a caller physically cannot supply it. Moving construction out would have
     * silently dropped the tutorial and puzzle gating.
     */
    const supplied = options.transport ?? null;
    this.local = supplied ? null : this.buildLocalTransport(options, stage);
    this.match = supplied ?? this.local!;

    /**
     * Render from the RESOLVED content, not the raw index.
     *
     * The driver plays by the resolved rulebook — bent balance numbers, patched
     * cards — so a UI reading the unpatched index would draw an upgraded card at
     * its original cost and show a Fixation price the engine does not charge.
     * The board would be right and the cards would be lying about it.
     */
    this.content = this.match.content;

    /**
     * The worn card back, set before a single card object is built.
     *
     * Card-back textures are cached, and a `CardObject` reads the current back
     * in its constructor — so this has to happen before `BattleView` deals a
     * hand, or the first match after equipping one would still show the house
     * design and only the second would be right.
     */
    /**
     * The **deck's** card back wins over the profile's.
     *
     * §4.3.2 gives the deck builder a card-back pick, and `DeckList.cardBackId`
     * has been declared in `types.ts` since the beginning with nothing anywhere
     * reading or writing it — a field that existed only as a type. A per-deck
     * choice is the more specific one, so it takes precedence; the equipped
     * cosmetic remains the default for every deck that has not made one.
     */
    const deckBack = options.playerDeck.cardBackId
      ? cosmeticById(this.content, options.playerDeck.cardBackId)
      : null;
    const back = (deckBack?.kind === "cardBack" ? deckBack : null) ?? wearing(this.content, "cardBack");
    setPlayerCardBack(back && back.emblem ? { color: back.color, emblem: back.emblem } : null);

    const quality = getSettings().quality;
    this.view = new BattleView(
      this.boardHost,
      this.content,
      {
        onIntent: (intent) => void this.submit(intent),
        onInspect: (card) => this.showCardDetail(card),
        onPeek: (card) => this.peekCardDetail(card),
        onNeedsTargets: (instanceId, slot) => this.openTargetFlow(instanceId, slot),
      },
      quality === "auto" ? undefined : quality
    );

    this.handBar = new HandBar(this.root, this.content, {
      onDragStart: (instanceId) => this.view.externalDragStart(instanceId),
      onDragMove: (_id, x, y) => this.view.externalDragMove(x, y),
      onDragEnd: (_id, x, y) => this.view.externalDragEnd(x, y),
      onInspect: (card) => this.showCardDetail(card),
      onPeek: (card) => this.peekCardDetail(card),
    });
    this.handBar.setStateProvider(() => this.matchState());

    this.hud = new BattleHud(this.root, this.content, {
      onEndTurn: () => void this.endTurn(),
      onConcede: () => this.confirmConcede(),
      onSettings: () => this.openSettings(),
      emotes: emoteWheel(this.content),
      onEmote: (emote) => void emote,
      onConfluence: (availability) => this.openConfluence(availability),
      onInspectLeader: (seat) => this.showLeaderDetail(seat),
      onUseAbility: (kind) => this.useLeaderAbility(kind),
      onToggleHistory: () => undefined,
    });

    this.presenter = new BattlePresenter(this.view, this.hud, this.content, audio);

    /**
     * §16.2's Board Mirror and §13's keyboard model.
     *
     * Mounted here rather than inside the HUD because both read the redacted
     * view this screen already holds, and §13 is explicit that the selection
     * model must live outside the canvas — the canvas cannot be focused, cannot
     * be described, and cannot be reached by a keyboard at all.
     */
    this.mirror = createBoardMirror(this.content);
    this.root.appendChild(this.mirror.root);
    this.modeBanner = document.createElement("div");
    this.modeBanner.className = "board-mode-banner";
    this.modeBanner.id = "board-mode-banner";
    this.modeBanner.hidden = true;
    this.root.appendChild(this.modeBanner);

    /**
     * The connection banner, and why the battle screen only now grew one.
     *
     * Offline there is nothing to say: `LocalTransport` is permanently live at
     * 0 ms and the status stream has exactly one value. Online it has six, and
     * two of them mean the board has stopped for a reason the player cannot see
     * — their own connection, or the opponent's.
     *
     * The server already sent all of it. `presence` frames with a grace
     * countdown were going out and being turned into a `TransportStatus` that
     * nothing subscribed to, so the honest countdown §8.2 insists on reached
     * the client and stopped there. A game that silently pauses is the failure
     * that rule exists to prevent, and it was happening one layer above the
     * rule.
     */
    this.connectionBanner = document.createElement("div");
    this.connectionBanner.className = "board-connection-banner";
    this.connectionBanner.id = "board-connection-banner";
    this.connectionBanner.setAttribute("role", "status");
    this.connectionBanner.setAttribute("aria-live", "polite");
    this.connectionBanner.hidden = true;
    this.root.appendChild(this.connectionBanner);
    this.stopStatus = this.match.onStatus((status) => this.showConnection(status));

    this.root.tabIndex = 0;
    this.root.addEventListener("keydown", (event) => this.onKey(event));

    /**
     * Present each batch as it lands.
     *
     * `await` inside this listener is load-bearing: the transport waits for it
     * before letting the match move on, which is what stops the rival's turn
     * from animating on top of yours. Online it is also the ack boundary — the
     * batch is acknowledged once it has actually been shown.
     */
    this.match.onBatch(async (batch) => {
      /**
       * The clocks travel with every batch, so this is where they are kept.
       *
       * Cached rather than read on demand because there is nowhere to read them
       * from — the transport reports them as part of what it delivers, and
       * between deliveries the HUD interpolates.
       */
      this.clocks = batch.clocks;
      // announced from the event stream, because "it was defeated" is not
      // visible in a snapshot of a board that no longer contains it
      this.mirror.report(this.match.view(), batch.events);
      await this.presenter.play(batch.events, () => this.match.view());
      this.refresh();
      this.checkEnd();
    });

    // click anywhere during a long sequence to fast-forward it
    this.root.addEventListener("pointerdown", () => this.presenter.requestSkip(), { capture: true });

    // debug/automation handle — read-only view of the live match
    (window as unknown as { hypeboundBattle?: unknown }).hypeboundBattle = {
      /**
       * The authoritative state, which only an offline match has. The verify
       * scripts read it to assert things no player may see — that a redacted
       * hand really is hidden, for one — so it is deliberately the omniscient
       * view and deliberately not reachable through `MatchTransport`.
       */
      state: () => this.local?.authoritativeState() ?? null,
      view: () => this.match.view(),
      /**
       * The match's RESOLVED content — the rulebook this match is actually being
       * played with, including any patched or variant cards. Reading the loaded
       * index instead would show the unbent card and quietly disagree with the
       * board.
       */
      content: () => this.match.content,
      confluences: () => this.match.confluences(),
      submit: (intent: PlayerIntent) => this.submit(intent),
      /**
       * The lesson's current state. Automation needs this: a scripted stage
       * refuses anything the beat does not permit, so a script that picks
       * actions purely by legality will hammer a refused move forever.
       */
      stage: () =>
        this.runner
          ? {
              stageId: this.options.stage?.id ?? null,
              beat: this.runner.beat?.id ?? null,
              allow: this.runner.beat?.allow ?? null,
              finished: this.runner.isFinished,
            }
          : null,
      debug: () => {
        const state = this.view.debugState() as Record<string, unknown>;
        // merge in the DOM hand bar's on-screen card positions
        const positions = new Map(this.handBar.debugCards().map((c) => [c.instanceId, c]));
        const hand = (state["hand"] as { instanceId: string }[] | undefined) ?? [];
        state["hand"] = hand.map((card) => ({ ...card, screen: positions.get(card.instanceId)?.screen ?? null }));
        return state;
      },
    };

    /**
     * `start()` is async now, and its rejection is handled rather than dropped.
     *
     * Offline it resolves on the same tick. Online it is a real connect, and a
     * connect that fails — bad token, room gone, server down — must say so on
     * the screen instead of leaving a black board and an unhandled rejection in
     * the console.
     */
    void this.start().catch((error: unknown) => {
      this.hud.toast(error instanceof Error ? error.message : "could not join the match", "error");
    });
    // the key handler lives on the root, so it needs focus to hear anything
    queueMicrotask(() => this.root.focus());
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Connect first, then draw.
   *
   * This used to call `refresh()` — which reads `view()` — before connecting,
   * and only connected at all on the scripted-stage branch. Offline that worked
   * by accident: `LocalTransport` has a view the moment it is constructed.
   * Online it is two failures at once, because `WsTransport.view()` throws
   * before `connect()` resolves and the ordinary match path never connected, so
   * the socket would simply never have opened.
   *
   * `connect()` is idempotent-shaped on both implementations and is now
   * unconditional, which also means the mulligan is opened from what the room
   * says the phase is rather than from what the caller assumed it would be.
   */
  private async start(): Promise<void> {
    /**
     * The faction comes from the card, not from the shape of its id.
     *
     * This used to be `leaderCardId.split("-")[0]`, which produces `idols` for
     * `idols-lumi-starcall` while the manifest declares
     * `music.battle.neon-idols`. Not one of the ten prefixes matches its
     * faction id — `goth` against `gothic-royalty`, `after` against
     * `afterparty-crew`, and so on — so every faction battle theme resolved to
     * a slot that does not exist, and every match was silent. It failed
     * quietly, because an unknown slot is indistinguishable from one with no
     * file yet.
     */
    const leader = this.options.content.leaders[this.options.playerDeck.leaderCardId];
    const factionSlot = `music.battle.${leader?.faction ?? ""}`;
    audio.playMusic(audio.hasSlot(factionSlot) ? factionSlot : "music.battle.default");
    audio.playAmbient("ambient.battle");

    const snapshot = await this.match.connect();
    this.clocks = snapshot.clocks;
    this.connected = true;
    this.refresh();

    // A scripted stage deals its own opening; only a real match mulligans. The
    // phase is read from the view rather than from `stage.scenario`, because
    // online the room is the one that decides whether there is a mulligan.
    if (this.match.view().phase === "mulligan") this.openMulligan();
  }

  /**
   * What the engine says is legal right now.
   *
   * Asked of the transport rather than computed here. The body used to live in
   * this method, reading a full `MatchState`; it moved to `LocalTransport`
   * unchanged, because a networked screen will have no state to read. The
   * keyboard and pointer paths still get the same answer from the same engine
   * functions — that property is the whole reason this exists — they are simply
   * asking something that can still answer once the match is on a socket.
   */
  private legality(): Legality {
    return this.match.legality();
  }

  private refresh(): void {
    /**
     * Nothing to draw until there is a view to draw from.
     *
     * `WsTransport.view()` throws before `connect()` resolves — deliberately,
     * because the alternative is inventing an empty board and rendering it as
     * though it were the game. Offline this is never false by the time anything
     * calls `refresh()`; online it is false for exactly one round trip.
     */
    if (!this.connected) return;
    /**
     * Hotseat's whole safety property lives on this line.
     *
     * The moment the active seat is not the seat being viewed, the board is
     * covered *before* anything is drawn from the new state — so there is no
     * frame in which the next player's hand is on screen and no race between
     * rendering and covering. The cover comes down when they say they are ready.
     */
    if (this.match.hotseat?.awaitingHandoff() && !this.ended) {
      this.openHandoff();
      return;
    }
    const view = this.match.view();
    this.view.sync(view);
    this.handBar.sync(view);
    this.hud.sync(view, this.match.confluences());
    this.mirror.sync(view, this.legality());

    // A lesson has no clock — being timed while reading is the opposite of
    // teaching. Everything else keeps the normal turn timer.
    if (isYourTurn(view) && !this.ended && !this.options.stage) {
      /**
       * Expiry is passed only when this side owns the clock.
       *
       * Online the room injects its own `endTurn` on timeout and journals it;
       * a second countdown here deciding the same thing would be a race, and a
       * losing one — the room pauses its clock inside a disconnect grace window
       * and this side has no way to know it should pause too.
       */
      const ownsExpiry = this.match.clockAuthority === "client";
      this.hud.setClock(this.clocks, ownsExpiry ? () => void this.endTurn() : null);
    } else {
      this.hud.stopTimer();
    }

    void this.runner?.sync(view);
  }

  /**
   * Hide the HUD widgets a teaching stage has not introduced yet, so the board
   * gains controls as the lesson explains them rather than presenting all of it
   * at once. Driven by CSS classes only — nothing here decides rules.
   */
  private applyReveal(widgets: ReadonlySet<HudWidgetId>): void {
    this.root.classList.add("tutorial-active");
    for (const widget of HUD_WIDGETS) {
      this.root.classList.toggle(`reveal-${widget}`, widgets.has(widget));
    }
  }

  /**
   * §13.2's key map, routed through the pure reducer in `keyboard.ts`.
   *
   * Two guards before anything else. A key pressed inside a dialog belongs to
   * the dialog — the chooser is a list of real buttons and the browser already
   * knows how to drive it, and stealing `Enter` from it would break the very
   * flow keyboard players need most. And a modifier chord belongs to the
   * browser: a game that swallows Ctrl+W or a screen reader's own navigation
   * keys is worse than a game with no shortcuts at all.
   */
  private onKey(event: KeyboardEvent): void {
    if (this.overlay || event.ctrlKey || event.metaKey || event.altKey) return;
    if (this.ended) return;

    const result = handleKey(this.keyboard, event.key, this.keyboardContext(), event.shiftKey);
    if (!result.handled) return;
    event.preventDefault();

    this.keyboard = result.state;
    this.applyKeyboardFocus();
    if (result.say) this.mirror.say(result.say);
    if (result.action) this.runKeyboardAction(result.action);
  }

  private keyboardContext(): KeyboardContext {
    return {
      content: this.content,
      view: this.match.view(),
      legality: this.legality(),
      attackTargets: () => legalAttackTargets(this.matchState(), this.match.view().seat),
      animating: this.match.isBusy(),
    };
  }

  /** The mode banner, and the highlight that says where the cursor is. */
  private applyKeyboardFocus(): void {
    const banner = modeBanner(this.keyboard);
    this.modeBanner.textContent = banner;
    this.modeBanner.hidden = banner === "";

    const slot = focusedSlot(this.keyboard, this.keyboardContext());
    this.root.dataset["kbZone"] = this.keyboard.zone;
    this.root.dataset["kbMode"] = this.keyboard.mode;
    this.handBar.setKeyboardFocus(
      this.keyboard.zone === "hand" && slot?.ref.kind === "handCard" ? slot.ref.instanceId : null
    );
    this.view.setKeyboardFocus(
      this.keyboard.mode === "attackSelect"
        ? (this.keyboard.targets[this.keyboard.targetIndex] ?? null)
        : slot?.ref.kind === "character"
          ? { kind: "character", instanceId: slot.ref.instanceId }
          : slot?.ref.kind === "leader"
            ? { kind: "leader", seat: slot.ref.seat }
            : null
    );
  }

  private runKeyboardAction(action: KeyboardAction): void {
    const view = this.match.view();
    switch (action.kind) {
      case "playCard":
        // straight into the same flow the pointer opens, so targets and
        // choose-one branches are asked for exactly once, in one place
        this.openTargetFlow(action.instanceId, action.slot);
        break;
      case "attack":
        void this.submit({
          type: "attack",
          seat: view.seat,
          attackerInstanceId: action.attackerInstanceId,
          target: action.target,
        });
        break;
      case "endTurn":
        void this.endTurn();
        break;
      case "fixation":
        this.useLeaderAbility(action.ultimate ? "ultimate" : "fixation");
        break;
      case "confluence": {
        const availability = this.match.confluences().find((entry) => entry.confluence === action.confluenceId);
        if (availability) this.openConfluence(availability);
        break;
      }
      case "activateLocation":
        if (view.you.location) {
          void this.submit({ type: "activateLocation", seat: view.seat });
        }
        break;
      case "inspect":
      case "rulesLens": {
        const card = this.cardOfSlot(action.slot);
        if (card) this.showCardDetail(card);
        break;
      }
      case "openHistory":
        this.hud.toast("Action log is in the panel on the right.", "info");
        break;
      case "openMenu":
        this.openSettings();
        break;
      case "openShortcuts":
        this.openShortcuts();
        break;
      case "focusMirror":
        this.mirror.focus();
        break;
      case "fastForward":
        this.presenter.requestSkip();
        break;
    }
  }

  private cardOfSlot(slot: BoardSlot): CardDef | null {
    const view = this.match.view();
    if (slot.ref.kind === "handCard") {
      const id = slot.ref.instanceId;
      const instance = view.you.hand.find((entry) => entry.instanceId === id);
      return instance ? (this.content.cards[instance.cardId] ?? null) : null;
    }
    if (slot.ref.kind === "character") {
      const id = slot.ref.instanceId;
      const character =
        view.you.board.find((entry) => entry?.instanceId === id) ??
        view.opponent.board.find((entry) => entry?.instanceId === id);
      return character ? (this.content.cards[character.cardId] ?? null) : null;
    }
    return null;
  }

  /** §13.2's table, on screen. A shortcut list that lies is worse than none. */
  private openShortcuts(): void {
    const overlay = this.mountOverlay("chooser-overlay");
    const panel = document.createElement("div");
    panel.className = "chooser-panel panel panel-chrome shortcut-sheet";
    panel.innerHTML = `
      <h3 class="chooser-title">Keyboard</h3>
      <table class="patch-table shortcut-table">
        <tbody>${SHORTCUTS.map(
          (row) => `<tr><td class="shortcut-keys">${row.keys}</td><td>${row.action}</td></tr>`
        ).join("")}</tbody>
      </table>
      <p class="muted">${DEFERRED_KEYS.size} keys in §13.2 are not bound in this build; each says why on the accessibility screen.</p>`;
    const close = document.createElement("button");
    close.className = "btn btn-ghost";
    close.textContent = "Close";
    close.addEventListener("click", () => this.dismissOverlay());
    panel.appendChild(close);
    overlay.appendChild(panel);
    close.focus();
  }

  private async submit(intent: PlayerIntent): Promise<void> {
    const result = await this.match.submit(intent);
    /**
     * The refusal now arrives with a canonical `code` alongside the message.
     * The toast still shows the prose, because that is what a player can act
     * on — but online the code is what distinguishes "you cannot do that" from
     * "the connection lost your intent", and those must not read the same.
     */
    if (!result.ok) this.hud.toast(result.error.message, "error");
    this.refresh();
    this.checkEnd();
  }

  private async endTurn(): Promise<void> {
    const view = this.match.view();
    /**
     * No "are you sure?" during a lesson. The stage gate already decides whether
     * ending the turn is allowed, so the prompt is redundant — and worse, it
     * appears even when the gate is about to refuse, leaving a modal over a
     * board the player was never permitted to act on.
     */
    if (getSettings().confirmEndTurnWithPlays && !this.options.stage) {
      // warn when the player is leaving obvious value on the table
      const playable = view.you.hand.filter(
        (instance) => checkPlayable(this.matchState(), this.content, view.seat, instance.instanceId).ok
      );
      if (playable.length > 0 && view.you.hype > 0) {
        const proceed = await this.confirm(
          "End your turn?",
          `You still have ${view.you.hype} Hype and ${playable.length} playable card${playable.length === 1 ? "" : "s"}.`,
          "End Turn",
          "Keep Playing"
        );
        if (!proceed) return;
      }
    }
    this.hud.stopTimer();
    await this.submit({ type: "endTurn", seat: view.seat });
  }

  /**
   * The authoritative `MatchState` — **the last thing in this file that a
   * networked build could not do.**
   *
   * Five engine helpers still take a `MatchState` to enumerate legal targets:
   * `legalAttackTargets`, `legalFixationTargets`, `legalEquipTargets`,
   * `legalChooseTargets` and `checkPlayable`. None of them actually *reads*
   * hidden information — targets are characters, leaders and locations, all of
   * them public — they simply have a parameter type a client will not have.
   * Teaching them to answer from a `PlayerView` is phase 2's job (§15), and
   * until then this method is where that debt is collected so it is countable
   * rather than scattered.
   *
   * It was previously typed `never`, which let it be passed anywhere without an
   * import. Naming the real type instead means the compiler will list these
   * call sites the day the helpers change.
   *
   * **Rebuilt from the view, not read from the match.** This used to call
   * `LocalTransport.authoritativeState()`, which was the single biggest
   * obstacle to this screen ever hosting an online match — nine call sites, and
   * a networked client has no authoritative state to give. Phase 2 built
   * `viewToState` for exactly this and checked it against the engine at ~48
   * positions across both seats with **zero disagreements**, using these same
   * helpers.
   *
   * It is now used offline as well, deliberately, rather than branching. A path
   * only the online build takes is a path only the online build tests, and this
   * one decides what the player is allowed to click.
   */
  /**
   * Build the offline transport this screen owns when nobody supplied one.
   *
   * A method rather than an inline literal so the "you must pass one or the
   * other" invariant is checked in one place and the compiler can narrow
   * `aiDeck` and `difficulty` from the throw, instead of being told to trust a
   * pair of non-null assertions.
   */
  private buildLocalTransport(options: BattleScreenOptions, stage: StageDef | undefined): LocalTransport {
    const { aiDeck, difficulty } = options;
    if (!aiDeck || !difficulty) {
      throw new Error(
        "BattleScreen needs either `transport` (an online match) or `aiDeck` + `difficulty` (an offline one); it was given neither."
      );
    }
    const seed = options.seed ?? (stage ? stage.seed : Math.floor(Math.random() * 0x7fffffff));

    return new LocalTransport({
      content: options.content,
      playerDeck: options.playerDeck,
      aiDeck,
      aiProfile: getAiProfile(difficulty),
      seed,
      playerSeat: 0,
      ...(stage?.firstSeat !== undefined
        ? { firstSeat: stage.firstSeat }
        : options.firstSeat !== undefined
          ? { firstSeat: options.firstSeat }
          : {}),
      ...(stage?.scenario ?? options.scenario ? { scenario: (stage?.scenario ?? options.scenario)! } : {}),
      ...(options.balanceOverrides ? { balanceOverrides: options.balanceOverrides } : {}),
      ...(options.cardOverrides ? { cardOverrides: options.cardOverrides } : {}),
      ...(options.cardVariants ? { cardVariants: options.cardVariants } : {}),
      ...(stage?.opponent.kind === "idle" ? { opponent: "idle" as const } : {}),
      ...(options.hotseat ? { opponent: "human" as const } : {}),
      // read the runner lazily: it is built by the constructor before this
      // method is called, and the gate must follow it as it advances between beats
      ...(this.runner ? { gate: (intent: PlayerIntent) => this.runner!.gateFor()(intent) } : {}),
    });
  }

  private matchState(): MatchState {
    return viewToState(this.match.view());
  }

  private checkEnd(): void {
    const view = this.match.view();
    if (view.winner === null || this.ended) return;
    this.ended = true;
    this.hud.stopTimer();
    const playerSeat = this.match.seat;
    const outcome = view.winner === "draw" ? "draw" : view.winner === playerSeat ? "player" : "ai";

    /**
     * A teaching stage that ends in a win has not ended the *tutorial* — the
     * runner carries the player to the next stage. Showing the match-end
     * sequence here would put a "Play Again" dead end in the middle of a lesson.
     * The graduation stage is a real match and keeps the normal ending.
     */
    if (this.options.stage && this.options.stage.opponent.kind !== "ai") return;

    this.endSequenceTimer = setTimeout(() => {
      this.endSequenceTimer = null;
      this.showEndSequence(outcome);
    }, 500);
  }

  // -------------------------------------------------------------------------
  // Overlays
  // -------------------------------------------------------------------------

  /**
   * The hand-hiding handoff — 09 §17 asks for it by name.
   *
   * Deliberately dull, and deliberately requiring a deliberate press: the
   * failure mode of a pass-and-play screen is somebody tapping through it out of
   * momentum while the other player is still looking at the table. It says whose
   * turn it is, it says nothing about the board, and it does not time out.
   */
  private openHandoff(): void {
    const names = this.options.hotseat?.seatNames ?? ["Player 1", "Player 2"];
    const next = this.match.view().activeSeat;
    const overlay = this.mountOverlay("handoff-overlay");

    const panel = document.createElement("div");
    panel.className = "handoff-panel panel panel-chrome";
    panel.innerHTML = `
      <div class="eyebrow">Pass the device</div>
      <h2 class="title" id="handoff-name">${names[next] ?? "Player"}</h2>
      <p class="muted">The board is hidden until you are ready. Do not press this
      until the device is actually in front of you.</p>`;

    const ready = document.createElement("button");
    ready.className = "btn btn-primary";
    ready.id = "handoff-ready";
    ready.textContent = "I am " + (names[next] ?? "ready");
    ready.addEventListener("click", () => {
      this.match.hotseat?.setViewingSeat(next);
      this.dismissOverlay();
      this.refresh();
    });

    panel.appendChild(ready);
    overlay.appendChild(panel);
  }

  private mountOverlay(className: string): HTMLElement {
    this.dismissOverlay();
    const overlay = document.createElement("div");
    overlay.className = `battle-overlay ${className}`;
    this.root.appendChild(overlay);
    this.overlay = overlay;
    return overlay;
  }

  /**
   * Close the overlay and **give focus back to the board**.
   *
   * The second half is not tidiness. Removing the focused element drops focus
   * to `<body>`, and the board's key handler lives on the screen root — so
   * dismissing the mulligan, a target chooser or the settings panel left a
   * keyboard player stranded: every subsequent key went nowhere, with no
   * indication of why, until they happened to Tab back onto the right element.
   * `verify:keyboard` caught it on the very first Tab after the mulligan.
   */
  private dismissOverlay(): void {
    this.overlay?.remove();
    this.overlay = null;
    if (!this.ended) this.root.focus();
  }

  /** Opening mulligan: click cards to mark them for replacement. */
  private openMulligan(): void {
    const view = this.match.view();
    const overlay = this.mountOverlay("mulligan-overlay");
    const selected = new Set<string>();

    const panel = document.createElement("div");
    panel.className = "mulligan-panel panel panel-chrome";
    panel.innerHTML = `
      ${
        this.options.ruleNote
          ? `<div class="mulligan-rule" id="mulligan-rule">
               <span class="mulligan-rule-name">${this.options.ruleNote.name}</span>
               <span class="mulligan-rule-text">${this.options.ruleNote.text}</span>
             </div>`
          : ""
      }
      <div class="mulligan-head">
        <div class="eyebrow">Opening Hand</div>
        <h2 class="title">Choose cards to replace</h2>
        <p class="muted">Selected cards are shuffled back and replaced. You go ${
          view.activeSeat === view.seat ? "first" : "second — you start with an extra card and Borrowed Clout"
        }.</p>
      </div>`;

    const cardRow = document.createElement("div");
    cardRow.className = "mulligan-cards";

    for (const instance of view.you.hand) {
      const card = this.content.cards[instance.cardId];
      if (!card) continue;
      const holder = document.createElement("button");
      holder.className = "mulligan-card";
      holder.type = "button";
      holder.appendChild(renderCardToCanvas(card, 180));
      const mark = document.createElement("div");
      mark.className = "mulligan-mark";
      mark.textContent = "REPLACE";
      holder.appendChild(mark);
      holder.addEventListener("click", () => {
        if (selected.has(instance.instanceId)) selected.delete(instance.instanceId);
        else selected.add(instance.instanceId);
        holder.classList.toggle("selected", selected.has(instance.instanceId));
      });
      cardRow.appendChild(holder);
    }
    panel.appendChild(cardRow);

    const actions = document.createElement("div");
    actions.className = "mulligan-actions";
    const confirm = document.createElement("button");
    confirm.className = "btn btn-primary";
    confirm.textContent = "Confirm";
    confirm.addEventListener("click", () => {
      this.dismissOverlay();
      void this.submit({ type: "mulligan", seat: view.seat, replaceInstanceIds: [...selected] });
    });
    actions.appendChild(confirm);
    panel.appendChild(actions);

    overlay.appendChild(panel);
    // the first thing a keyboard player meets in a match, so it starts focused
    confirm.focus();
  }

  /**
   * A card needs targets or a chooseOne branch that dragging could not supply.
   * Walk the player through each requirement, then submit.
   */
  /**
   * Use a leader's Fixation or Ultimate.
   *
   * Obsession had no way to be spent from the UI at all until this existed —
   * the meter filled and the abilities were unreachable for a human, though the
   * AI used them freely. Legality is the engine's (`canUseFixation`); this only
   * collects a target when the ability needs one.
   */
  private useLeaderAbility(kind: "fixation" | "ultimate"): void {
    const view = this.match.view();
    if (!canUseFixation(this.matchState(), this.content, view.seat, kind)) {
      this.hud.toast("You can't use that right now.", "error");
      return;
    }

    const targets = legalFixationTargets(this.matchState(), this.content, view.seat, kind);
    if (targets.length === 0) {
      void this.submit({ type: "useFixation", seat: view.seat, kind });
      return;
    }

    const leader = this.content.leaders[view.you.leaderCardId];
    const ability = kind === "fixation" ? leader?.fixation : leader?.ultimate;
    this.openChooser(
      ability?.name ?? "Choose a target",
      targets.map((target) => ({ label: this.describeTarget(target), value: target })),
      (target) => {
        this.dismissOverlay();
        void this.submit({ type: "useFixation", seat: view.seat, kind, targets: [target] });
      }
    );
  }

  private openTargetFlow(instanceId: string, slot: number | undefined): void {
    const view = this.match.view();
    const playable = checkPlayable(this.matchState(), this.content, view.seat, instanceId);
    if (!playable.ok) {
      this.hud.toast("That card can't be played right now.", "error");
      return;
    }
    const instance = view.you.hand.find((c) => c.instanceId === instanceId);
    const card = instance ? this.content.cards[instance.cardId] : undefined;
    if (!card) return;

    const targets: TargetRef[] = [];
    const choices: number[] = [];

    const finish = (): void => {
      this.dismissOverlay();
      void this.submit({
        type: "playCard",
        seat: view.seat,
        instanceId,
        ...(playable.needsSlot ? { slot: slot ?? 0 } : {}),
        ...(targets.length > 0 ? { targets } : {}),
        ...(choices.length > 0 ? { choices } : {}),
        ...(playable.needsRefractChoice ? { refractChoice: view.you.pureCurrent ?? "prism" } : {}),
      });
    };

    const askChoices = (index: number): void => {
      if (index >= playable.choiceCount) {
        finish();
        return;
      }
      // chooseOne branches are described by the card's own text
      this.openChooser(
        `${card.name} — choose one`,
        [
          { label: "First option", value: 0 },
          { label: "Second option", value: 1 },
        ],
        (value) => {
          choices.push(value);
          askChoices(index + 1);
        }
      );
    };

    const askTargets = (index: number): void => {
      const specs = card.type === "equipment"
        ? [{ spec: { select: "choose" as const }, legal: legalEquipTargets(this.matchState(), view.seat) }]
        : playable.targetSpecs;

      if (index >= specs.length) {
        askChoices(0);
        return;
      }
      const entry = specs[index];
      if (!entry || entry.legal.length === 0) {
        askTargets(index + 1);
        return;
      }
      const options = entry.legal.map((ref) => ({
        label: this.describeTarget(ref),
        value: ref,
      }));
      this.openChooser(`${card.name} — choose a target`, options, (ref) => {
        targets.push(ref);
        askTargets(index + 1);
      });
    };

    askTargets(0);
  }

  private describeTarget(ref: TargetRef): string {
    if (ref.kind === "leader") {
      const view = this.match.view();
      const player = ref.seat === view.seat ? view.you : view.opponent;
      const leader = this.content.leaders[player.leaderCardId];
      return `${leader?.name ?? "Leader"} (${ref.seat === view.seat ? "yours" : "rival"})`;
    }
    /**
     * Both boards, from the view rather than the state. Characters on a board
     * are public to both players — that is what makes naming an opponent's
     * character in a target prompt legitimate in the first place — so the
     * redacted view carries everything this needs.
     */
    const view = this.match.view();
    for (const board of [view.you.board, view.opponent.board]) {
      for (const character of board) {
        if (character?.instanceId !== ref.instanceId) continue;
        const card = this.content.cards[character.cardId];
        return `${card?.name ?? "Character"} (${character.attack}/${character.health})`;
      }
    }
    return "Target";
  }

  private openChooser<T>(title: string, options: { label: string; value: T }[], onPick: (value: T) => void): void {
    const overlay = this.mountOverlay("chooser-overlay");
    const panel = document.createElement("div");
    panel.className = "chooser-panel panel panel-chrome";
    panel.innerHTML = `<h3 class="chooser-title">${title}</h3>`;

    const list = document.createElement("div");
    list.className = "chooser-list";
    for (const option of options) {
      const button = document.createElement("button");
      button.className = "btn chooser-option";
      button.textContent = option.label;
      button.addEventListener("click", () => {
        this.dismissOverlay();
        onPick(option.value);
      });
      list.appendChild(button);
    }
    panel.appendChild(list);

    const cancel = document.createElement("button");
    cancel.className = "btn btn-ghost";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => this.dismissOverlay());
    panel.appendChild(cancel);

    overlay.appendChild(panel);
    /**
     * Focus the first option.
     *
     * This is what makes keyboard play work at all past "select a card": the
     * chooser is already a list of real buttons that Tab and Enter drive, but
     * focus was still on the board behind it, so a keyboard player opened a
     * modal they had no way into. One line, and every targeting flow, every
     * choose-one branch and every Confluence picker becomes reachable.
     */
    list.querySelector("button")?.focus();
  }

  private openConfluence(availability: ConfluenceAvailability): void {
    const def = this.content.confluences[availability.confluence];
    if (!def) return;
    const view = this.match.view();

    const submitConfluence = (targets?: TargetRef[], choice?: number): void => {
      void this.submit({
        type: "activateConfluence",
        seat: view.seat,
        confluence: availability.confluence,
        ...(targets && targets.length > 0 ? { targets } : {}),
        ...(choice !== undefined ? { choice } : {}),
      });
    };

    // branch choice first (Tempest), then targets
    if (def.choice && def.choice.length > 0) {
      this.openChooser(
        `${def.name} — choose one`,
        def.choice.map((branch, index) => ({ label: branch.label, value: index })),
        (choice) => {
          const branchNeedsTarget = def.choice?.[choice]?.ops.some(
            (op) => "target" in op && (op as { target?: { select?: string } }).target?.select === "choose"
          );
          if (!branchNeedsTarget) {
            submitConfluence(undefined, choice);
            return;
          }
          const side = choice === 0 ? "enemy" : "friendly";
          const legal = legalChooseTargets(this.matchState(), this.content, view.seat, {
            select: "choose",
            side,
            zone: "board",
          });
          if (legal.length === 0) {
            submitConfluence(undefined, choice);
            return;
          }
          this.openChooser(
            `${def.name} — choose a target`,
            legal.map((ref) => ({ label: this.describeTarget(ref), value: ref })),
            (ref) => submitConfluence([ref], choice)
          );
        }
      );
      return;
    }

    if (def.target) {
      const legal = legalChooseTargets(this.matchState(), this.content, view.seat, def.target);
      if (legal.length === 0) {
        this.hud.toast("No legal target for that Confluence.", "error");
        return;
      }
      this.openChooser(
        `${def.name} — choose a target`,
        legal.map((ref) => ({ label: this.describeTarget(ref), value: ref })),
        (ref) => submitConfluence([ref])
      );
      return;
    }

    submitConfluence();
  }

  private showCardDetail(card: CardDef): void {
    const overlay = this.mountOverlay("detail-overlay");
    overlay.addEventListener("click", () => this.dismissOverlay());

    const panel = document.createElement("div");
    panel.className = "detail-panel";
    panel.appendChild(renderCardToCanvas(card, 420));

    const info = document.createElement("div");
    info.className = "detail-info panel";
    const palette = CURRENT_PALETTE[card.current];
    const keywordList = card.keywords
      .map((id) => {
        const keyword = this.content.keywords[id];
        return keyword ? `<li><strong>${keyword.name}</strong> — ${keyword.reminderText}</li>` : "";
      })
      .join("");

    info.innerHTML = `
      <div class="eyebrow" style="color:${palette.key}">${palette.label} · ${this.content.factions[card.faction]?.name ?? ""}</div>
      <h3 class="detail-name">${card.name}</h3>
      ${card.flavor ? `<p class="detail-flavor">“${card.flavor}”</p>` : ""}
      ${keywordList ? `<div class="eyebrow">Keywords</div><ul class="detail-keywords">${keywordList}</ul>` : ""}
      <div class="eyebrow">Current</div>
      <p class="muted">${palette.label} — beats ${this.content.currents[card.current]?.beats
        .map((c) => this.content.currents[c]?.name ?? c)
        .join(", ") || "nothing (neutral)"}. Attacks against a weak Current deal 1 extra damage.</p>`;

    panel.appendChild(info);
    overlay.appendChild(panel);
  }

  /**
   * The same detail panel, shown for the duration of a press-and-hold.
   *
   * It must stay out of the pointer stream: a hold arms a drag too, and if this
   * overlay swallowed pointermove the board below would never learn the player
   * had started dragging after all. `pointer-events: none` keeps the peek
   * purely visual, and the caller closes it when the press ends.
   */
  private peekCardDetail(card: CardDef): () => void {
    this.showCardDetail(card);
    const overlay = this.overlay;
    overlay?.classList.add("peeking");
    return () => {
      // only dismiss our own peek — another overlay may have taken over since
      if (this.overlay === overlay) this.dismissOverlay();
    };
  }

  private showLeaderDetail(seat: number): void {
    const view = this.match.view();
    const player = seat === view.seat ? view.you : view.opponent;
    const leader = this.content.leaders[player.leaderCardId];
    if (leader) this.showCardDetail(leader);
  }

  private openSettings(): void {
    const overlay = this.mountOverlay("settings-overlay");
    const panel = document.createElement("div");
    panel.className = "panel panel-chrome settings-quick";
    panel.innerHTML = `<h3 class="title">Battle Settings</h3>`;

    const speeds: { label: string; value: "full" | "fast" | "instant" }[] = [
      { label: "Full animations", value: "full" },
      { label: "Fast animations", value: "fast" },
      { label: "Instant", value: "instant" },
    ];
    const row = document.createElement("div");
    row.className = "row wrap";
    for (const speed of speeds) {
      const button = document.createElement("button");
      button.className = `btn ${getSettings().animationSpeed === speed.value ? "btn-primary" : "btn-ghost"}`;
      button.textContent = speed.label;
      button.addEventListener("click", () => {
        updateSettings({ animationSpeed: speed.value });
        this.dismissOverlay();
        this.openSettings();
      });
      row.appendChild(button);
    }
    panel.appendChild(row);

    const close = document.createElement("button");
    close.className = "btn";
    close.textContent = "Close";
    close.addEventListener("click", () => this.dismissOverlay());
    panel.appendChild(close);
    overlay.appendChild(panel);
  }

  private confirmConcede(): void {
    void this.confirm("Concede this match?", "Your rival takes the win.", "Concede", "Keep Playing").then((yes) => {
      if (yes) void this.submit({ type: "concede", seat: this.match.seat });
    });
  }

  private confirm(title: string, body: string, yesLabel: string, noLabel: string): Promise<boolean> {
    return new Promise((resolve) => {
      const overlay = this.mountOverlay("confirm-overlay");
      const panel = document.createElement("div");
      panel.className = "panel panel-chrome confirm-panel";
      panel.innerHTML = `<h3 class="title">${title}</h3><p class="muted">${body}</p>`;

      const actions = document.createElement("div");
      actions.className = "row center";

      const no = document.createElement("button");
      no.className = "btn btn-ghost";
      no.textContent = noLabel;
      no.addEventListener("click", () => {
        this.dismissOverlay();
        resolve(false);
      });

      const yes = document.createElement("button");
      yes.className = "btn btn-primary";
      yes.textContent = yesLabel;
      yes.addEventListener("click", () => {
        this.dismissOverlay();
        resolve(true);
      });

      actions.append(no, yes);
      panel.appendChild(actions);
      overlay.appendChild(panel);
    });
  }

  /** true once the match has been banked, so it can never be banked twice */
  private settled = false;

  /**
   * The reward readout — what the match paid, itemised.
   *
   * Every line is a fact the player would otherwise have to find by comparing
   * two numbers in the lobby header, and the capped line exists because a
   * ceiling nobody is told about reads as the game being broken rather than as
   * a rule.
   */
  private rewardBlock(paid: MatchSettlement): HTMLElement {
    const block = document.createElement("div");
    block.className = "end-rewards";
    block.id = "end-rewards";

    const line = (label: string, value: string, className = ""): void => {
      const row = document.createElement("div");
      row.className = `end-reward-row ${className}`.trim();
      row.dataset["reward"] = label.toLowerCase().replace(/[^a-z]+/g, "-");
      row.innerHTML = `<span class="end-reward-label">${label}</span><span class="end-reward-value">${value}</span>`;
      block.appendChild(row);
    };

    const base = paid.clout - (paid.firstWinBonus ?? 0);
    line("Clout", `+${base}`);
    if (paid.firstWinBonus) line("First win today", `+${paid.firstWinBonus}`, "end-reward-bonus");
    line("Fame XP", `+${paid.xp}`);
    if (paid.leveledUp) line("Level up", `${paid.newLevel}`, "end-reward-bonus");
    for (const extra of paid.extra ?? []) {
      const row = document.createElement("div");
      row.className = "end-reward-row end-reward-bonus";
      row.textContent = extra;
      block.appendChild(row);
    }

    if (paid.cloutCapped && paid.cloutCapped > 0) {
      const note = document.createElement("p");
      note.className = "end-reward-note muted";
      note.id = "end-reward-capped";
      note.textContent =
        `${paid.cloutCapped} more Clout was earned than today's allowance for playing the AI had room for. ` +
        `It resets tomorrow; Fame XP, missions, Mastery and achievements are not capped.`;
      block.appendChild(note);
    } else if (paid.cloutRemainingToday !== undefined && paid.cloutRemainingToday <= paid.clout * 2) {
      const note = document.createElement("p");
      note.className = "end-reward-note muted";
      note.id = "end-reward-remaining";
      note.textContent = `${paid.cloutRemainingToday} Clout left in today's allowance for playing the AI.`;
      block.appendChild(note);
    }

    return block;
  }

  private showEndSequence(outcome: "player" | "ai" | "draw"): void {
    const overlay = this.mountOverlay(`end-overlay end-${outcome}`);
    audio.playMusic(outcome === "player" ? "music.victory" : "music.defeat");

    // The final board, read once — the turn count and the surviving health both
    // come from it, and re-reading between the two could not disagree today but
    // would be a rich source of confusion if it ever could.
    const finalView = this.match.view();

    const title = outcome === "player" ? "VICTORY" : outcome === "ai" ? "DEFEAT" : "DRAW";
    const subtitle =
      outcome === "player"
        ? "The feed belongs to you."
        : outcome === "ai"
          ? "Rough numbers this cycle. Post through it."
          : "Nobody trends today.";

    const panel = document.createElement("div");
    panel.className = "end-panel";
    panel.innerHTML = `
      <div class="end-title">${title}</div>
      <div class="end-sub">${subtitle}</div>
      <div class="end-stats muted">Turns played: ${finalView.turn}</div>`;

    /**
     * The replay record and the final health, read once.
     *
     * `finishRecord()` is null for a networked client, which never learns the
     * seed or either decklist and so cannot build one.
     *
     * This used to say online settlement "will not come through here at all",
     * and would skip settling entirely without a record. Half of that was
     * right: the **authoritative** result — who won — is written by the room
     * into the account's own storage and never travels through this screen.
     *
     * The other half was wrong, and cost an online winner their payout. Clout
     * and XP are a *local* save, exactly as they are offline, and they do come
     * through here. Skipping them because there is no replay to attach
     * conflated "we cannot prove what happened" with "we cannot pay for it" —
     * and the proving already happened, on the server.
     */
    const record = this.match.finishRecord();
    const finalHealth = finalView.you.leaderHealth;

    /**
     * Bank it here, not on the way out, and print what it paid.
     *
     * Guarded because `showEndSequence` must never run twice — a double credit
     * is the one bug in this area that would be worth more to a player than to
     * report.
     */
    // No `&& record`: a match with no replay is still a match that was played.
    if (!this.settled) {
      this.settled = true;
      const paid = this.options.onSettle?.({
        winner: outcome,
        record,
        playerLeaderHealth: finalHealth,
      });
      if (paid) panel.appendChild(this.rewardBlock(paid));
    }

    const exit = (action: "again" | "menu"): void => {
      /**
       * No `if (!record) return;` here any more.
       *
       * It made both end-overlay buttons silent no-ops for any transport that
       * cannot produce a `MatchRecord` — which is every online one — trapping
       * the player on the victory screen with no way back to the lobby. `record`
       * is nullable on `onExit` now, and no handler reads it.
       */
      this.options.onExit({
        winner: outcome,
        record,
        playerLeaderHealth: finalHealth,
        action,
      });
    };

    const actions = document.createElement("div");
    actions.className = "row center end-actions";
    const again = document.createElement("button");
    again.className = "btn btn-primary";
    again.textContent = this.options.endActions?.primary ?? "Play Again";
    again.addEventListener("click", () => exit("again"));
    actions.appendChild(again);

    // `secondary: null` means the mode has exactly one way out of the fight
    const secondary = this.options.endActions?.secondary;
    if (secondary !== null) {
      const menu = document.createElement("button");
      menu.className = "btn btn-ghost";
      menu.textContent = secondary ?? "Back to Lobby";
      menu.addEventListener("click", () => exit("menu"));
      actions.appendChild(menu);
    }
    panel.appendChild(actions);
    overlay.appendChild(panel);
  }

  /**
   * Say what the connection is doing, and count the grace down.
   *
   * The countdown ticks locally from the deadline the server sent, because the
   * server only sends `presence` when something *changes* — sending one a
   * second would be a frame per second per match to animate a number the client
   * can subtract for itself. The server still decides: when the hold expires it
   * ends the match, whatever this number says.
   */
  private showConnection(status: TransportStatus): void {
    this.clearGraceTicker();

    const render = (): void => {
      const remaining = this.graceDeadlineMs === null ? null : Math.max(0, this.graceDeadlineMs - Date.now());
      const seconds = remaining === null ? null : Math.ceil(remaining / 1000);
      switch (status.kind) {
        case "opponentDisconnected":
          this.connectionBanner.textContent =
            seconds !== null && seconds > 0
              ? `Your opponent lost connection — ${seconds}s to reconnect`
              : "Your opponent lost connection";
          this.connectionBanner.dataset.tone = "waiting";
          this.connectionBanner.hidden = false;
          return;
        case "disconnected":
          this.connectionBanner.textContent = "Reconnecting…";
          this.connectionBanner.dataset.tone = "warning";
          this.connectionBanner.hidden = false;
          return;
        case "connecting":
          this.connectionBanner.textContent = "Connecting…";
          this.connectionBanner.dataset.tone = "waiting";
          this.connectionBanner.hidden = false;
          return;
        case "unstable":
          this.connectionBanner.textContent = "Connection unstable";
          this.connectionBanner.dataset.tone = "warning";
          this.connectionBanner.hidden = false;
          return;
        case "closed":
          // Not shown once the match is over: "disconnected" over a victory
          // screen reads as though the result might not have counted.
          this.connectionBanner.hidden = this.ended;
          this.connectionBanner.textContent = `Disconnected — ${status.reason}`;
          this.connectionBanner.dataset.tone = "warning";
          return;
        case "live":
          this.connectionBanner.hidden = true;
          return;
      }
    };

    if (status.kind === "opponentDisconnected" || status.kind === "disconnected") {
      const grace = status.graceRemainingMs;
      this.graceDeadlineMs = grace > 0 ? Date.now() + grace : null;
      if (this.graceDeadlineMs !== null) this.graceTicker = setInterval(render, 1000);
    } else {
      this.graceDeadlineMs = null;
    }
    render();
  }

  private clearGraceTicker(): void {
    if (this.graceTicker !== null) clearInterval(this.graceTicker);
    this.graceTicker = null;
  }

  dispose(): void {
    // An interval and a listener both outlive the DOM unless somebody stops
    // them, and this screen is mounted and unmounted repeatedly.
    this.clearGraceTicker();
    this.stopStatus?.();
    this.stopStatus = null;
    this.mirror.dispose();
    this.hud.dispose();
    this.handBar.dispose();
    this.view.dispose();
    /**
     * The coach runs a per-frame loop to keep its spotlight on a moving target.
     * Removing the root detaches it but does not stop the loop, so leaving and
     * re-entering the tutorial would accumulate one live rAF per visit, each
     * doing a querySelector and a layout read every frame. Disposing also
     * settles any line still waiting to be acknowledged, so nothing is left
     * awaiting a click that can never come.
     */
    this.coach?.dispose();
    // a scripted stage can navigate away before this fires, and an orphaned
    // end sequence would start victory music over whatever screen came next
    if (this.endSequenceTimer !== null) clearTimeout(this.endSequenceTimer);
    this.dismissOverlay();
    /**
     * Close the transport.
     *
     * Offline this detaches `LocalMatch.onEvents` and releases the whole match
     * object graph; without it, leaving and re-entering a battle accumulated
     * one per visit. Online it is the difference between leaving a match and
     * leaving a socket behind — `WsTransport`'s heartbeat re-arms itself and its
     * reconnect backoff keeps firing `open()` against a match the player has
     * already walked away from. Idempotent on both.
     */
    this.match.close("left the battle");
    audio.stopMusic();
    this.root.remove();
  }
}
