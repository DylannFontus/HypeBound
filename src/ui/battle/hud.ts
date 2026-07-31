/**
 * Battle HUD — the DOM overlay above the 3D board.
 *
 * DOM rather than 3D so it inherits text scaling, high contrast, screen-reader
 * semantics and crisp typography. Covers every element the battle interface
 * requires: leaders and health, Hype, Obsession, deck and discard counts, turn
 * timer, End Turn, action history, trigger order, Confluence, emotes, settings
 * and the victory/defeat sequence.
 */

import type {
  ConfluenceAvailability,
  ContentIndex,
  CurrentId,
  EngineEvent,
  PlayerView,
  Seat,
} from "../../engine/types";
import type { MatchClocks } from "../../net/transport";
import { getAsset } from "../art/assetLoader";
import { iconPath } from "../art/iconAssets";
import { CURRENT_PALETTE } from "../cardRenderer/palette";
import { getSettings } from "../../save/settings";
import { audio } from "../../audio/audio";

export interface HudCallbacks {
  onEndTurn: () => void;
  onConcede: () => void;
  onSettings: () => void;
  onEmote: (emote: string) => void;
  /** the phrases on the wheel; omit for the six every account starts with */
  emotes?: string[];
  onConfluence: (availability: ConfluenceAvailability) => void;
  onInspectLeader: (seat: Seat) => void;
  /** use the player leader Fixation or Ultimate */
  onUseAbility: (kind: "fixation" | "ultimate") => void;
  onToggleHistory: () => void;
}

/**
 * The wheel the account has unlocked.
 *
 * Supplied by the caller rather than fixed here, because Faction and Leader
 * Mastery add phrases to it - and the six starters stay whatever else happens,
 * since the wheel is the only communication channel in the game.
 */
const DEFAULT_EMOTES = ["Greetings", "Well played", "Nice", "Oops", "Threaten", "Thanks"];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class BattleHud {
  readonly root: HTMLElement;

  private readonly enemyPlate: HTMLElement;
  private readonly playerPlate: HTMLElement;
  private readonly hypeRow: HTMLElement;
  private readonly obsessionPlayer: HTMLElement;
  private readonly abilityBar: HTMLElement;
  private readonly obsessionEnemy: HTMLElement;
  private readonly endTurnButton: HTMLButtonElement;
  private readonly timerRing: HTMLElement;
  private readonly timerLabel: HTMLElement;
  private readonly historyList: HTMLElement;
  private readonly confluenceBar: HTMLElement;
  private readonly triggerRail: HTMLElement;
  private readonly turnBanner: HTMLElement;
  private readonly toastLayer: HTMLElement;

  private timerHandle: number | null = null;
  /**
   * The last clocks the authority reported, and the local instant they landed.
   *
   * The countdown is interpolated from these two rather than counted down by
   * this class. `receivedAt` is a *local* reading, so the elapsed time since it
   * is measured against the same clock that produced it and no skew between the
   * device and the server can enter the arithmetic. `serverNowMs` is
   * deliberately not compared with `Date.now()` for exactly that reason.
   */
  private clocks: MatchClocks | null = null;
  private clocksReceivedAt = 0;
  /** Whole seconds last rendered, so cues fire once per second and not per frame. */
  private lastWholeSecond = -1;
  private ropeAnnounced = false;
  private onExpire: (() => void) | null = null;
  private view: PlayerView | null = null;

  constructor(
    container: HTMLElement,
    private readonly content: ContentIndex,
    private readonly callbacks: HudCallbacks
  ) {
    this.root = el("div", "battle-hud");

    // ---- enemy plate (top centre) -----------------------------------------
    this.enemyPlate = el("div", "leader-plate leader-plate-enemy");
    this.enemyPlate.addEventListener("click", () => this.view && this.callbacks.onInspectLeader(this.view.opponent.seat));
    this.root.appendChild(this.enemyPlate);

    // ---- player plate (bottom centre) -------------------------------------
    this.playerPlate = el("div", "leader-plate leader-plate-player");
    this.playerPlate.addEventListener("click", () => this.view && this.callbacks.onInspectLeader(this.view.seat));
    this.root.appendChild(this.playerPlate);

    // ---- obsession dials ---------------------------------------------------
    this.obsessionEnemy = el("div", "obsession-dial obsession-enemy");
    this.obsessionPlayer = el("div", "obsession-dial obsession-player");
    this.abilityBar = el("div", "ability-bar");
    this.root.append(this.obsessionEnemy, this.obsessionPlayer, this.abilityBar);

    // ---- hype crystals (bottom right) -------------------------------------
    const hypeWrap = el("div", "hype-wrap");
    const hypeLabel = el("div", "hype-label", "HYPE");
    this.hypeRow = el("div", "hype-row");
    hypeWrap.append(this.hypeRow, hypeLabel);
    this.root.appendChild(hypeWrap);

    // ---- end turn + timer --------------------------------------------------
    const turnWrap = el("div", "turn-wrap");
    this.timerRing = el("div", "timer-ring");
    this.timerLabel = el("div", "timer-label", "");
    this.endTurnButton = el("button", "end-turn-btn");
    this.endTurnButton.type = "button";
    this.endTurnButton.innerHTML = '<span class="end-turn-text">End Turn</span>';
    this.endTurnButton.addEventListener("click", () => this.callbacks.onEndTurn());
    this.timerRing.append(this.endTurnButton, this.timerLabel);
    turnWrap.appendChild(this.timerRing);
    this.root.appendChild(turnWrap);

    // ---- confluence bar ----------------------------------------------------
    this.confluenceBar = el("div", "confluence-bar");
    this.root.appendChild(this.confluenceBar);

    // ---- action history ----------------------------------------------------
    const historyPanel = el("div", "history-panel panel");
    const historyHead = el("div", "history-head");
    historyHead.append(el("span", "eyebrow", "Action Log"));
    const historyToggle = el("button", "btn btn-ghost btn-icon history-toggle", "▾");
    historyToggle.setAttribute("aria-label", "Toggle action log");
    historyToggle.addEventListener("click", () => {
      historyPanel.classList.toggle("collapsed");
      this.callbacks.onToggleHistory();
    });
    historyHead.appendChild(historyToggle);
    this.historyList = el("div", "history-list scroll");
    historyPanel.append(historyHead, this.historyList);
    this.root.appendChild(historyPanel);

    // ---- trigger rail (shows the resolving trigger queue) ------------------
    this.triggerRail = el("div", "trigger-rail");
    this.root.appendChild(this.triggerRail);

    // ---- top-right controls ------------------------------------------------
    const controls = el("div", "battle-controls");
    const settingsBtn = el("button", "btn btn-ghost btn-icon", "⚙");
    settingsBtn.setAttribute("aria-label", "Settings");
    settingsBtn.addEventListener("click", () => this.callbacks.onSettings());

    const emoteBtn = el("button", "btn btn-ghost btn-icon", "☺");
    emoteBtn.setAttribute("aria-label", "Emotes");
    const emoteMenu = el("div", "emote-menu");
    for (const emote of this.callbacks.emotes ?? DEFAULT_EMOTES) {
      const item = el("button", "emote-item", emote);
      item.addEventListener("click", () => {
        this.callbacks.onEmote(emote);
        emoteMenu.classList.remove("open");
        this.toast(`You: “${emote}”`);
      });
      emoteMenu.appendChild(item);
    }
    emoteBtn.addEventListener("click", () => emoteMenu.classList.toggle("open"));

    const concedeBtn = el("button", "btn btn-ghost btn-icon", "⚑");
    concedeBtn.setAttribute("aria-label", "Concede");
    concedeBtn.addEventListener("click", () => this.callbacks.onConcede());

    controls.append(emoteBtn, emoteMenu, settingsBtn, concedeBtn);
    this.root.appendChild(controls);

    // ---- turn banner + toasts ---------------------------------------------
    this.turnBanner = el("div", "turn-banner");
    this.turnBanner.hidden = true;
    this.root.appendChild(this.turnBanner);

    this.toastLayer = el("div", "toast-layer");
    this.root.appendChild(this.toastLayer);

    container.appendChild(this.root);
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  sync(view: PlayerView, confluences: readonly ConfluenceAvailability[]): void {
    this.view = view;
    this.renderLeaderPlate(this.playerPlate, view, "player");
    this.renderLeaderPlate(this.enemyPlate, view, "enemy");
    this.renderObsession(this.obsessionPlayer, view.you.obsession, "You", view.you.leaderCardId);
    this.renderObsession(this.obsessionEnemy, view.opponent.obsession, "Rival", view.opponent.leaderCardId);
    this.renderLeaderAbilities(this.abilityBar, view);
    this.renderHype(view);
    this.renderConfluences(confluences, view.activeSeat === view.seat);

    const yourTurn = view.activeSeat === view.seat && view.phase === "main";
    this.endTurnButton.disabled = !yourTurn;
    this.endTurnButton.classList.toggle("ready", yourTurn);
    this.root.classList.toggle("enemy-turn", !yourTurn);
  }

  private renderLeaderPlate(plate: HTMLElement, view: PlayerView, side: "player" | "enemy"): void {
    const player = side === "player" ? view.you : view.opponent;
    const leader = this.content.leaders[player.leaderCardId];
    const palette = CURRENT_PALETTE[(leader?.current ?? "prism") as CurrentId];
    const health = side === "player" ? view.you.leaderHealth : view.opponent.leaderHealth;
    const maxHealth = side === "player" ? view.you.leaderMaxHealth : view.opponent.leaderMaxHealth;
    const armor = player.armor;
    const ratio = Math.max(0, Math.min(1, health / Math.max(1, maxHealth)));

    const deckCount = side === "player" ? view.you.deck.length : view.opponent.deckCount;
    const discardCount = player.discard.length;
    const handCount = side === "player" ? view.you.hand.length : view.opponent.handCount;
    const reactionCount = side === "player" ? view.you.reactions.length : view.opponent.reactionCount;

    /**
     * The orb carries health and armour even though the 3D medallion shows them
     * too. That duplication is deliberate: the medallion sits low on the mat and
     * the hand overlaps the board rather than occupying a reserved strip, so on
     * a short viewport (the 26vh hand at <=620px) the player's own health gem
     * ends up behind their cards. The plate is HUD, above the hand and clear of
     * it, so this is the readout that is always legible.
     */
    plate.style.setProperty("--leader-color", palette.key);
    plate.innerHTML = `
      <div class="leader-orb" role="img" aria-label="${health} of ${maxHealth} health${armor > 0 ? `, ${armor} armour` : ""}">
        <div class="leader-orb-fill" style="--fill:${ratio}"></div>
        <div class="leader-orb-value">
          <span class="hp">${health}</span>
          ${armor > 0 ? `<span class="armor">⛊${armor}</span>` : ""}
        </div>
      </div>
      <div class="leader-info">
        <div class="leader-name">${leader?.name ?? "Unknown"}</div>
        <div class="leader-meta">
          <span class="chip" title="Cards in hand">✋ ${handCount}</span>
          <span class="chip" title="Cards in deck">▤ ${deckCount}</span>
          <span class="chip" title="Cards in discard">✖ ${discardCount}</span>
          ${reactionCount > 0 ? `<span class="chip chip-reaction" title="Face-down Reactions">⧉ ${reactionCount}</span>` : ""}
        </div>
      </div>`;
  }

  private renderObsession(node: HTMLElement, value: number, label: string, leaderCardId?: string): void {
    const max = this.content.balance.obsession.max;
    const threshold = this.content.balance.obsession.obsessedThreshold;
    const obsessed = value >= threshold;
    /**
     * The marks come off the leader, not off `balance.obsession`.
     *
     * Balance holds the numbers the leader cards were authored against, but the
     * price actually charged is the one printed on the card — so anything that
     * re-prices a leader (a story rule, a boss twist, an artifact) would move
     * the cost without moving the mark, and the track would quietly lie about
     * how far away the button is.
     */
    const leader = leaderCardId ? this.content.leaders[leaderCardId] : undefined;
    const fixation = leader?.fixation.obsessionCost ?? this.content.balance.obsession.fixationCost;
    const ultimate = leader?.ultimate.obsessionCost ?? this.content.balance.obsession.ultimateCost;

    node.classList.toggle("danger", obsessed);
    node.setAttribute("role", "img");
    node.setAttribute(
      "aria-label",
      `${label} Obsession ${value} of ${max}${obsessed ? ", in the danger zone: takes extra damage" : ""}`
    );

    const pips = Array.from({ length: max }, (_, i) => {
      const filled = i < value;
      const marker = i + 1 === fixation ? "fix" : i + 1 === ultimate ? "ult" : "";
      const danger = i + 1 >= threshold ? "danger" : "";
      return `<span class="obs-pip ${filled ? "filled" : ""} ${marker} ${danger}"></span>`;
    }).join("");

    node.innerHTML = `
      <div class="obs-head">
        <span class="obs-label">${label} · Obsession</span>
        <span class="obs-value">${value}<span class="obs-max">/${max}</span></span>
      </div>
      <div class="obs-track">${pips}</div>
      ${obsessed ? '<div class="obs-warning">⚠ OBSESSED — takes +1 damage</div>' : ""}`;
  }

  /**
   * The player's leader abilities.
   *
   * Obsession's entire payoff lives here — without these buttons the meter
   * fills and can never be spent, which is what the tutorial's Obsession stage
   * uncovered. The engine already decides legality (`canUseFixation`); this only
   * shows the two abilities, their costs, and why one is unavailable.
   */
  private renderLeaderAbilities(node: HTMLElement, view: PlayerView): void {
    const leader = this.content.leaders[view.you.leaderCardId];
    if (!leader) {
      node.innerHTML = "";
      return;
    }

    const abilities = [
      { kind: "fixation" as const, ability: leader.fixation, used: view.you.fixationUsedThisTurn, spent: "used this turn" },
      { kind: "ultimate" as const, ability: leader.ultimate, used: view.you.ultimateUsed, spent: "used this match" },
    ];

    node.innerHTML = "";
    for (const { kind, ability, used, spent } of abilities) {
      const affordable = view.you.obsession >= ability.obsessionCost;
      const yourTurn = view.activeSeat === view.seat && view.phase === "main";
      const enabled = affordable && !used && yourTurn;

      const button = document.createElement("button");
      button.type = "button";
      button.className = `ability-btn ability-${kind}${enabled ? " ready" : ""}`;
      button.disabled = !enabled;
      button.innerHTML = `
        <span class="ability-cost">${ability.obsessionCost}</span>
        <span class="ability-body">
          <span class="ability-name">${ability.name}</span>
          <span class="ability-text">${ability.text}</span>
        </span>`;
      button.title = used ? `${ability.name} — already ${spent}` : affordable ? ability.text : `Needs ${ability.obsessionCost} Obsession`;
      button.setAttribute(
        "aria-label",
        `${ability.name}, costs ${ability.obsessionCost} Obsession. ${used ? `Already ${spent}.` : affordable ? "Ready." : "Not enough Obsession."}`
      );
      button.addEventListener("click", () => this.callbacks.onUseAbility(kind));
      node.appendChild(button);
    }
  }

  private renderHype(view: PlayerView): void {
    const { hype, hypeMax, hypeLockedNextTurn } = view.you;
    const cap = this.content.balance.hype.cap;
    const shown = Math.max(hypeMax, hype);

    const crystals: string[] = [];
    for (let i = 0; i < Math.min(cap, Math.max(shown, 1)); i++) {
      const filled = i < hype;
      crystals.push(`<span class="hype-crystal ${filled ? "filled" : "spent"}"></span>`);
    }
    this.hypeRow.innerHTML =
      crystals.join("") +
      `<span class="hype-count">${hype}<span class="hype-of">/${hypeMax}</span></span>` +
      (hypeLockedNextTurn > 0 ? `<span class="hype-locked" title="Overload">⛓ ${hypeLockedNextTurn}</span>` : "");
    this.hypeRow.setAttribute("aria-label", `Hype ${hype} of ${hypeMax}`);
  }

  private renderConfluences(confluences: readonly ConfluenceAvailability[], yourTurn: boolean): void {
    const usable = confluences.filter((c) => c.available);
    this.confluenceBar.innerHTML = "";
    this.confluenceBar.classList.toggle("visible", usable.length > 0 && yourTurn);
    if (!yourTurn) return;

    for (const availability of usable) {
      const def = this.content.confluences[availability.confluence];
      if (!def) continue;
      const [a, b] = availability.currents;
      const paletteA = CURRENT_PALETTE[a];
      const paletteB = CURRENT_PALETTE[b];

      const button = el("button", "confluence-btn");
      button.style.setProperty("--c-a", paletteA.key);
      button.style.setProperty("--c-b", paletteB.key);

      /**
       * The painted Confluence emblem where one exists, the two parent initials
       * where it does not.
       *
       * The letters are a recipe — GALE + PULSE — and the emblem is the result.
       * Showing both would say the same thing twice in a space the width of a
       * thumb, and the recipe survives anyway: the button is already a gradient
       * between the two Current colours, the emblems were drawn from those same
       * two colours, and the title attribute spells it out for anyone hovering
       * or using a screen reader.
       */
      const emblem = getAsset(iconPath("confluence", availability.confluence));
      const symbols = emblem
        ? `<span class="conf-symbols"><img class="conf-emblem" src="${emblem.src}" alt="" /></span>`
        : `
        <span class="conf-symbols">
          <span class="conf-sym" style="--c:${paletteA.key}">${paletteA.label[0]}</span>
          <span class="conf-plus">+</span>
          <span class="conf-sym" style="--c:${paletteB.key}">${paletteB.label[0]}</span>
        </span>`;

      button.innerHTML = `
        ${symbols}
        <span class="conf-body">
          <span class="conf-name">${def.name}</span>
          <span class="conf-text">${def.text}</span>
        </span>`;
      button.title = `${paletteA.label} + ${paletteB.label} — ${def.text}`;
      button.addEventListener("click", () => this.callbacks.onConfluence(availability));
      this.confluenceBar.appendChild(button);
    }
  }

  // -------------------------------------------------------------------------
  // Feedback
  // -------------------------------------------------------------------------

  /** Append a human-readable line to the action log. */
  logEvent(event: EngineEvent, view: PlayerView): void {
    const line = describeEvent(event, this.content, view);
    if (!line) return;
    const entry = el("div", "history-entry", line);
    entry.classList.add(event.e.startsWith("damage") ? "damage" : "neutral");
    this.historyList.appendChild(entry);
    while (this.historyList.childElementCount > 120) this.historyList.firstElementChild?.remove();
    this.historyList.scrollTop = this.historyList.scrollHeight;
  }

  /** Show the trigger queue as it resolves, so cascades are readable. */
  showTrigger(cardName: string, trigger: string): void {
    const chip = el("div", "trigger-chip");
    chip.innerHTML = `<span class="trigger-card">${cardName}</span><span class="trigger-kind">${trigger}</span>`;
    this.triggerRail.appendChild(chip);
    window.setTimeout(() => {
      chip.classList.add("out");
      window.setTimeout(() => chip.remove(), 320);
    }, 900);
  }

  toast(message: string, kind: "info" | "error" = "info"): void {
    const toast = el("div", `toast toast-${kind}`, message);
    this.toastLayer.appendChild(toast);
    window.setTimeout(() => {
      toast.classList.add("out");
      window.setTimeout(() => toast.remove(), 300);
    }, 2200);
  }

  announceTurn(yours: boolean, turn: number): void {
    if (getSettings().animationSpeed === "instant") return;
    this.turnBanner.textContent = yours ? `Your Turn ${turn}` : `Rival's Turn ${turn}`;
    this.turnBanner.className = `turn-banner ${yours ? "yours" : "theirs"}`;
    this.turnBanner.hidden = false;
    this.turnBanner.classList.add("show");
    window.setTimeout(() => {
      this.turnBanner.classList.remove("show");
      window.setTimeout(() => {
        this.turnBanner.hidden = true;
      }, 320);
    }, 1100);
  }

  // -------------------------------------------------------------------------
  // Turn timer
  // -------------------------------------------------------------------------

  /**
   * Show the countdown the match authority is reporting.
   *
   * The HUD used to run its own `setInterval` seeded from `balance.timer`,
   * which is right offline and wrong online in a way nothing on screen reveals.
   * The room pauses its clock while a disconnected opponent is inside the grace
   * window; an interval here counts through the pause, so the ring reached zero
   * while the server still considered the turn live — and, because the client
   * also owned expiry, it ended the turn on the strength of its own wrong
   * number.
   *
   * Now the numbers come from `MatchClocks` and this only interpolates between
   * updates. `onExpire` is supplied **only** by a caller whose transport says
   * `clockAuthority === "client"`; online it is null and the room's injected
   * `endTurn` arrives as an ordinary event.
   */
  setClock(clocks: MatchClocks | null, onExpire: (() => void) | null): void {
    if (!clocks) {
      this.stopTimer();
      return;
    }

    const changedTurn = this.clocks?.activeSeat !== clocks.activeSeat;
    this.clocks = clocks;
    this.clocksReceivedAt = performance.now();
    this.onExpire = onExpire;
    if (changedTurn) {
      this.ropeAnnounced = false;
      this.lastWholeSecond = -1;
    }

    if (this.timerHandle === null) {
      // Four times a second: the ring moves smoothly enough at this size and it
      // is a quarter of the work of a frame loop for a thing that shows
      // integers.
      this.timerHandle = window.setInterval(() => this.paintClock(), 250);
    }
    this.paintClock();
  }

  private paintClock(): void {
    const clocks = this.clocks;
    if (!clocks) return;

    const since = performance.now() - this.clocksReceivedAt;
    const turnLeft = Math.max(0, clocks.turnMsRemaining - since);
    const ropeLeft = Math.max(0, clocks.ropeMsRemaining - since);
    const inRope = turnLeft <= 0 && ropeLeft > 0;

    /**
     * The ring tracks the turn, then the rope. Two phases rather than one long
     * bar, because the rope is a different promise: the turn is time you have,
     * the rope is time you are being given back.
     */
    const turnMs = Math.max(1, this.content.balance.timer.turnSeconds * 1000);
    const ropeMs = Math.max(1, this.content.balance.timer.ropeSeconds * 1000);
    const ratio = inRope ? ropeLeft / ropeMs : turnLeft / turnMs;
    this.timerRing.style.setProperty("--timer", String(Math.max(0, Math.min(1, ratio))));
    this.timerRing.classList.toggle("rope", inRope);

    const secondsLeft = Math.ceil((inRope ? ropeLeft : turnLeft) / 1000);
    this.timerLabel.textContent = inRope ? String(Math.max(0, secondsLeft)) : "";

    /**
     * §11 rows 3 and 4 — the rope, and its last five ticks.
     *
     * The clock is the one thing on this board that takes something away from
     * you without your doing anything, so it is the cue with the strongest
     * claim to existing. Guarded on the whole second so interpolating four
     * times a second does not fire it four times.
     */
    if (inRope && !this.ropeAnnounced) {
      this.ropeAnnounced = true;
      audio.cue("ropeStarted");
      audio.play("sfx.turn.warning");
    }
    if (inRope && secondsLeft !== this.lastWholeSecond && secondsLeft > 0 && secondsLeft <= 5) {
      audio.cue("ropeTick");
    }
    this.lastWholeSecond = secondsLeft;

    if (turnLeft <= 0 && ropeLeft <= 0) {
      const expire = this.onExpire;
      this.stopTimer();
      // Null online: the room injects its own `endTurn` and this side simply
      // stops showing a countdown that has run out.
      expire?.();
    }
  }

  stopTimer(): void {
    if (this.timerHandle !== null) {
      clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
    this.clocks = null;
    this.onExpire = null;
    this.ropeAnnounced = false;
    this.lastWholeSecond = -1;
    this.timerRing.classList.remove("rope");
    this.timerLabel.textContent = "";
    this.timerRing.style.setProperty("--timer", "1");
  }

  dispose(): void {
    this.stopTimer();
    this.root.remove();
  }
}

// ---------------------------------------------------------------------------
// Event → readable log line
// ---------------------------------------------------------------------------

export function describeEvent(event: EngineEvent, content: ContentIndex, view: PlayerView): string | null {
  const name = (cardId: string | null | undefined): string =>
    (cardId && content.cards[cardId]?.name) ?? "a card";
  const who = (seat: Seat): string => (seat === view.seat ? "You" : "Rival");

  switch (event.e) {
    case "turnStarted":
      return `— ${who(event.seat)} turn ${event.turn} (${event.hype}/${event.hypeMax} Hype)`;
    case "cardPlayed":
      return `${who(event.seat)} played ${name(event.cardId)} for ${event.cost}`;
    case "attackDeclared":
      return null; // covered by the damage line
    case "damageDealt": {
      const target = event.target.kind === "leader" ? `${who(event.target.seat)} leader` : "a character";
      const bonus = event.elementalBonus ? " (Current advantage +1)" : "";
      if (event.absorbedByShield) return `Shield absorbed the hit on ${target}`;
      return `${target} took ${event.amount}${bonus}`;
    }
    case "healed":
      return event.blocked ? "Healing was blocked" : `Restored ${event.amount} health`;
    case "characterDefeated":
      return `${name(event.instance.cardId)} was defeated`;
    case "confluenceActivated": {
      const def = content.confluences[event.confluence];
      return `${who(event.seat)} activated ${def?.name ?? event.confluence}`;
    }
    case "resonanceActivated":
      return `${who(event.seat)} reached Perfect Resonance (${content.currents[event.current]?.name})`;
    case "fixationUsed":
      return `${who(event.seat)} used ${event.abilityName}`;
    case "obsessedThresholdCrossed":
      return event.nowObsessed ? `${who(event.seat)} is now Obsessed` : `${who(event.seat)} left the danger zone`;
    case "fatigueDamage":
      return `${who(event.seat)} took ${event.amount} Burnout damage`;
    case "cardBurned":
      return `${who(event.seat)} lost ${name(event.cardId)} — hand full`;
    case "statusApplied":
      return `${content.statuses[event.status.id]?.name ?? event.status.id} applied`;
    case "characterBanished":
      return `${name(event.cardId)} was sent to touch grass`;
    case "comebackReturned":
      return `${name(event.cardId)} made a Comeback`;
    case "waveArrived": {
      const bodies = event.instances.map((instance) => name(instance.cardId)).join(", ");
      // the dropped count is stated rather than swallowed: a wave that delivers
      // four of six is a board nobody authored, and the log is where that shows
      const short = event.dropped > 0 ? ` (${event.dropped} had no room)` : "";
      const whose = event.seat === view.seat ? "your" : "their";
      return `— Wave ${event.index}/${event.total} arrived on ${whose} board: ${bodies || "nobody"}${short} —`;
    }
    case "matchEnded":
      return event.winner === "draw" ? "— Draw —" : `— ${who(event.winner)} won —`;
    default:
      return null;
  }
}
