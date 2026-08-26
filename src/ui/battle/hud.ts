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
  TargetRef,
} from "../../engine/types";
import type { MatchClocks } from "../../net/transport";
import { getAsset } from "../art/assetLoader";
import { iconPath } from "../art/iconAssets";
import { CURRENT_PALETTE } from "../cardRenderer/palette";
import { parseCardText } from "../cardRenderer/renderCard";
import { icon } from "../art/uiIcons";
import { getSettings } from "../../save/settings";
import { audio } from "../../audio/audio";
import { createStyleElement } from "../styleSheet";

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

/**
 * A leader ability's own mini-markup, drawn rather than printed.
 *
 * `ability.text` is authored in the same `**bold**` / `*italic*` dialect the
 * card faces use, and this went to `innerHTML` raw — which was invisible only
 * because the rail clipped every ability to one ellipsised line. Given the
 * second line the sentence needs, the button read "Deal 2 damage to a character
 * and apply \*\*Scorched\*\* to it." — asterisks on the player's own leader
 * power, six inches from the same keyword set in real bold on a card face.
 * `parseCardText` is the canvas renderer's own parser, so the two cannot
 * disagree, and everything that reaches the DOM is escaped on the way.
 */
const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);

const richAbilityText = (text: string): string =>
  parseCardText(text)
    .map((part) =>
      part.bold
        ? `<strong>${escapeHtml(part.text)}</strong>`
        : part.italic
          ? `<em>${escapeHtml(part.text)}</em>`
          : escapeHtml(part.text)
    )
    .join("");

/** The same sentence with the markup removed, for a `title` attribute. */
const plainAbilityText = (text: string): string =>
  parseCardText(text)
    .map((part) => part.text)
    .join("");

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

/* -------------------------------------------------------------------------
   two rules that cannot be written in battle.css this wave
   ------------------------------------------------------------------------- */

/**
 * A stylesheet installed by the HUD, and why it is not simply in `battle.css`.
 *
 * `battle.css` is module A's file and is in another pair of hands right now, so
 * this follows the idiom `rewards/packOpening.ts` already established for the
 * same problem: append a `<style>` at mount, which lands *after* every
 * stylesheet in the head and therefore out-specifies without `!important`, and
 * costs nothing on any page that never opens a board. Both rules below belong in
 * `battle.css` and should be moved there the next time it is free.
 *
 * ## 1. The press has to be visible from across the room
 *
 * Filmed at 50fps, the existing press state moved 0.79 of mean frame delta on a
 * board whose *ambient* is 0.28–0.77 per frame. Everything about it was correct
 * and none of it was perceptible, because it was 3% of a 132px disc and a
 * brightness change that the idle animation was overriding (see the pointerdown
 * handler for that half). §5's rule is that a press moves the element, lights it
 * and scales it — all three, in under 120ms — so the light gets somewhere to go:
 * a flare behind the ring, on the collar's own footprint, punched in over 90ms
 * and gone in 260. It is one composited element and it paints nothing.
 *
 * ## 2. The Hype tray must not be the widest object on a small screen
 *
 * Measured at 1280×720: at `--ui-scale 1.6` the rightmost hand card runs 70px
 * under the tray and at 1.4 it runs 64px, while the 1600×900 control at 100%
 * shows a clean 0. The tray's crystals are fixed pixels but its label, its count
 * and its padding are all in scaled units, so it is the one object on the board
 * that grows while the viewport it has to fit inside does not. Hearthstone's
 * mana tray is the same physical size at every interface scale for exactly this
 * reason. Below the window where both can have what they want, the tray gives
 * way — it is a readout, and the hand is the thing being played.
 */
const HUD_STYLE_ID = "hb-hud-supplement";

const HUD_CSS = `
/* --- 1. the press flare -------------------------------------------------- */

.end-turn-flare {
  position: absolute;
  inset: -34px;
  border-radius: 50%;
  z-index: -1;
  pointer-events: none;
  opacity: 0;
  background: radial-gradient(
    closest-side,
    rgb(238 222 255 / 0.85) 0%,
    rgb(181 108 255 / 0.5) 44%,
    rgb(181 108 255 / 0) 76%
  );
}

.end-turn-flare.lit {
  animation: end-turn-flare 260ms var(--ease-out, ease-out) both;
}

@keyframes end-turn-flare {
  0%   { opacity: 0; transform: scale(0.72); }
  34%  { opacity: 1; transform: scale(1.04); }
  100% { opacity: 0; transform: scale(1.24); }
}

/*
 * The disc itself takes a deeper bite than the 1.5% it was getting — and the
 * :not() chain is not decoration, it is the entire repair.
 *
 * \`battle.css\` writes \`.end-turn-btn.pressed { transform: scale(0.955) }\`, which
 * is specificity (0,2,0). \`foundation.css\` §A4 writes
 * \`.act:active:not(:disabled):not([aria-disabled]):not([data-state="loading"])\`,
 * which is (0,5,0) and is true at exactly the same moment. So the bespoke press
 * state on the most-clicked control in the game has never once applied its own
 * transform: what a player actually saw was the foundation's generic 0.985
 * micro-press, three thousandths of travel different from a hover. Measured off
 * the film at 50fps — computed transform settling at \`matrix(0.985, …)\` while
 * the class \`pressed\` sat on the element the whole time — which is exactly what
 * a rule that resolves and then loses looks like.
 *
 * Matching the chain puts this at (0,5,0) too, and a later sheet at equal
 * specificity wins. Deliberately not \`!important\`: the correct fix for losing a
 * cascade is to enter it properly.
 */
.end-turn-btn.pressed:not(:disabled):not([aria-disabled="true"]):not([data-state="loading"]) {
  transform: scale(0.93);
}

:root[data-reduced-motion="true"] .end-turn-flare { animation: none; }
/*
 * Reduced motion kills the decorative layer and keeps the functional one, which
 * here means the press still has to be *visible* — it is the only confirmation
 * the player gets that the game heard them. So the flare stops travelling and
 * simply holds while the button is down.
 */
:root[data-reduced-motion="true"] .end-turn-flare.lit { opacity: 0.7; }

/* --- 2. the tray gives way ----------------------------------------------- */

/*
 * Keyed on the viewport rather than on the scale, because the collision is a
 * function of both and only one of them is a media feature. 1400px is where the
 * 1600-wide control stops applying; the hand's own fan is what occupies the rest.
 */
@media (max-width: 1400px) {
  .hype-wrap {
    /* Away from the corner the hand's outermost card sweeps through, and up
       against the ring it belongs beside. */
    bottom: var(--sp-4);
    padding: 5px var(--sp-2);
    gap: 1px;
  }
  /* Ten sockets and nine gaps is the whole width of this thing, so both numbers
     come down together. Measured at 1280x720 @1.6: the tray's left edge moves
     from 928 to 1018 and the rightmost hand card ends at 1005 — the 70px
     collision becomes 13px of clearance. */
  .hype-crystal { width: 16px; height: 22px; }
  .hype-sockets { gap: 2px; }
  .hype-count { font-size: var(--fs-md); }
  .hype-label { font-size: var(--fs-xs); }
}

/*
 * And below 1120 the label goes, which is 46px of tray width for a word the ten
 * lit crystals under it already say. The name survives on the row's aria-label,
 * so nothing is lost to a screen reader — this is the §5 distinction between a
 * state that is *drawn* differently and one that is missing.
 */
@media (max-width: 1120px) {
  .hype-label { display: none; }
  .hype-crystal { width: 15px; height: 21px; }
}

/*
 * A phone in landscape, where the tray is competing for width with a fanned
 * hand inside 844 pixels. Everything that can go, goes: the crystals reach their
 * floor, the gaps close to a hairline, and the "/10" suffix comes off the count
 * — the ten sockets beside it are already the maximum, drawn, which is the whole
 * argument for drawing them.
 *
 * Measured at 844x390 @1.4 this takes the tray from 231px wide to 137 and the
 * rightmost hand card's incursion from 101px to what is reported in the wave
 * notes. Any residue is not the tray's to give: the hand's fan is laid out by
 * handBar.ts and spans nearly the full viewport at this size, so the last card
 * arrives in that corner whatever the tray does. That number belongs to whoever
 * owns the fan's width, and it is stated rather than absorbed here so it is not
 * lost.
 */
@media (max-width: 960px) {
  .hype-wrap { right: var(--sp-2); padding: 4px 7px; }
  .hype-crystal { width: 12px; height: 17px; }
  .hype-sockets { gap: 1px; }
  .hype-row { gap: 5px; }
  .hype-of { display: none; }
}
`;

/**
 * Idempotent by id rather than by a module flag: a hot reload replaces the
 * module and not the document, and two copies of a sheet is two copies of
 * everything in it.
 */
function installHudStyle(doc: Document | undefined = globalThis.document): void {
  if (!doc || doc.getElementById(HUD_STYLE_ID)) return;
  const style = createStyleElement(doc);
  style.id = HUD_STYLE_ID;
  style.textContent = HUD_CSS;
  doc.head.append(style);
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
  private readonly endTurnFlare: HTMLElement;
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
    installHudStyle();
    this.root = el("div", "battle-hud");

    /**
     * Every raised surface on this HUD is one of the foundation's four
     * materials, and this is where that is decided.
     *
     * The recon measured two lighting models on one screen: `.history-panel`
     * used `.panel`, which carries an inset top rim and a drop shadow, while the
     * leader plate, the Obsession dial and the ability buttons each hand-rolled
     * `background: var(--glass-strong); border: 1px solid var(--glass-border)`.
     * §1 bans that twice over — "a solid background on any surface larger than
     * an icon" and "a `border: 1px solid` as the only edge treatment" — and §1's
     * key-light rule makes it worse than a style inconsistency: the log panel
     * was lit from the top-left and the dial ten pixels beside it was not, which
     * is the two-suns defect stated in the foundation contract as the single
     * thing fifteen parallel builders will get wrong.
     *
     * Composition rather than a private bevel, per the contract. `.mat-chip` for
     * the pills and the small inline objects, `.mat-panel` for the structural
     * plates, `.mat-well` for the recessed tracks. The rim, the lip, the drop,
     * the 2px contact shadow and the grain arrive with the class.
     */
    // ---- the two rails -----------------------------------------------------
    this.enemyPlate = el("div", "leader-plate mat-panel leader-plate-enemy");
    this.enemyPlate.addEventListener("click", () => this.view && this.callbacks.onInspectLeader(this.view.opponent.seat));

    this.playerPlate = el("div", "leader-plate mat-panel leader-plate-player");
    this.playerPlate.addEventListener("click", () => this.view && this.callbacks.onInspectLeader(this.view.seat));

    this.obsessionEnemy = el("div", "obsession-dial mat-panel obsession-enemy");
    this.obsessionPlayer = el("div", "obsession-dial mat-panel obsession-player");
    this.abilityBar = el("div", "ability-bar");

    /**
     * The bottom-left corner is one flow column, not three absolute offsets.
     *
     * It was three elements anchored to the same corner and separated by two
     * hand-measured constants — `--rail-h: 104px` and `--plate-h: 84px` — which
     * is correct at exactly one text size. At `--ui-scale: 1.4` the ability rail
     * grew past 104px and its top edge cut straight through the leader plate's
     * meta row, so the player's own hand, deck and discard counts were clipped
     * by their own abilities. A column that stacks its children cannot go wrong
     * at any scale, and it deletes both constants.
     */
    const corner = el("div", "hud-corner");
    corner.append(this.obsessionPlayer, this.playerPlate, this.abilityBar);

    /**
     * And the rival gets the same column, mirrored.
     *
     * The two Obsession dials are the same number about two players and they sat
     * in two unrelated places — the rival's on the centre line above their
     * medallion, the player's in the bottom-left corner underneath their own
     * abilities — at two different distances from the plate they belong to. §6's
     * rule is that a mirrored resource has to be *presented* identically or it
     * cannot be compared at a glance, which is the only reason the rival's is on
     * screen at all. Gwent puts both round scores in identical plates on one
     * vertical axis; Hearthstone mirrors both mana rows. Now so does this: one
     * column per player, plate and dial, top-left and bottom-left, and the
     * centre line above the rival's medallion is given back to the board.
     */
    const rivalRail = el("div", "hud-corner hud-corner-rival");
    rivalRail.append(this.enemyPlate, this.obsessionEnemy);
    this.root.append(rivalRail, corner);

    /**
     * ---- the Hype tray (bottom right) -------------------------------------
     *
     * A tray with sockets cut into it, not a row of dots on a photograph.
     * `.mat-well` is the foundation's recess — inner shadow at the top-left,
     * faint rim light at the bottom-right, casts nothing — which is exactly
     * what a resource tray is, and it gives the crystals something to sit in
     * and spill onto instead of the brightest orange lights in the backdrop art.
     */
    const hypeWrap = el("div", "hype-wrap mat-well");
    const hypeLabel = el("div", "hype-label t-label", "Hype");
    this.hypeRow = el("div", "hype-row");
    hypeWrap.append(this.hypeRow, hypeLabel);
    this.root.appendChild(hypeWrap);

    // ---- end turn + timer --------------------------------------------------
    const turnWrap = el("div", "turn-wrap");
    this.timerRing = el("div", "timer-ring");
    this.timerLabel = el("div", "timer-label", "");
    /**
     * The one hero action on this screen, wearing the one hero material.
     *
     * It was a flat `radial-gradient` disc with a single uniform 2px ring as its
     * whole edge treatment — §1 bans that twice over ("a solid #hex on any
     * surface larger than an icon", "a `border: 1px solid` as the only edge
     * treatment") — and because the ring was equally bright the whole way round,
     * the most important control on the screen was the one object on it with no
     * light direction at all while everything near it is lit from 315°.
     * `.mat-hero` is where that gradient, that rim, that lip, that contact shadow
     * and that grain already live, and `.act` is where the six interaction
     * states live. Composition, per the foundation contract: a builder who
     * hand-rolls their own bevel has broken it even if the bevel is prettier.
     */
    this.endTurnButton = el("button", "end-turn-btn mat-hero act");
    this.endTurnButton.type = "button";
    /**
     * An icon, a label and a rule — not a sentence in body type.
     *
     * It read as 16px black body-weight "End Turn" with default tracking on a
     * lavender disc: the most-clicked object in the game typeset like a
     * paragraph. `.t-label` is the role §4 gives a control — uppercase, +0.08em
     * — and the chevron is module C's drawing at module C's stroke weight, so
     * the mark on the hero action is the same mark as every other affordance on
     * the screen rather than a glyph the OS happened to have.
     */
    this.endTurnButton.innerHTML =
      `<span class="end-turn-icon">${icon("chevron-right")}</span>` +
      '<span class="end-turn-text t-label">End Turn</span>';
    this.endTurnButton.addEventListener("click", () => this.callbacks.onEndTurn());
    /**
     * Something moves on the same frame as the press — and this time it does.
     *
     * The first repair for this moved the acknowledgement to `pointerdown`, on
     * the correct reasoning that 130ms passed between the click and the first
     * pixel of the confirm dialogue with no press state on the button at any
     * point in it. That reasoning was right and the repair still did not land.
     * Filmed at 50fps from the pointer going down, the class arrives at **8ms**
     * and the computed transform starts moving at **33ms** — so the JavaScript
     * was never the problem — and yet the largest frame-to-frame delta anywhere
     * in the first 300ms is **0.79**, against a measured board ambient of
     * 0.28–0.77 per frame. The acknowledgement was inside the noise of the room
     * it was happening in. A player cannot see it because it is not there.
     *
     * Two reasons, both of them cascade rather than code, and the fix is split
     * between here and the sheet at the top of this file.
     *
     * 1. **`.pressed`'s own transform has never once applied.** It is (0,2,0);
     *    `foundation.css`'s `.act:active:not(…):not(…):not(…)` is (0,5,0) and is
     *    true at the same instant. The bespoke press state on the most-clicked
     *    control in the game was silently resolving to the foundation's generic
     *    0.985 — three thousandths away from the hover it interrupts. Confirmed
     *    off the film: the class is on the element from 9ms and the computed
     *    transform settles at `matrix(0.985, …)`, which is not the 0.955 the
     *    rule asks for. `HUD_CSS` answers that one by matching the chain.
     * 2. **A keyboard press has no `:active` to help it.** That same foundation
     *    rule ends with `animation: none`, which is what lets `.pressed`'s
     *    `filter: brightness(0.88)` land on a *pointer* press — otherwise the
     *    `end-turn-ready` breath, being a running animation, would outrank it,
     *    as running animations outrank every normal author declaration. Press
     *    Space instead and `:active` never fires, the breath keeps running, and
     *    the button does not darken at all. That half cannot be written in a
     *    stylesheet, because the cascade has no way to say "unless pressed" to
     *    an animation — the animation is the thing that has to stop. So it stops
     *    here, which is also the honest reading of it: a button being held down
     *    is not idling.
     *
     * `pressed` is tracked as a field because `sync()` re-asserts `ready` on
     * every engine event, and an event landing between the pointer going down
     * and coming up would otherwise restart the breath under the player's
     * finger.
     */
    this.endTurnButton.addEventListener("pointerdown", () => this.pressEndTurn());
    for (const event of ["pointerup", "pointercancel", "pointerleave", "blur"] as const) {
      this.endTurnButton.addEventListener(event, () => this.releaseEndTurn());
    }
    /**
     * And the keyboard gets the same acknowledgement, which it did not have at
     * all. §5 lists the states once for every interactive element; a control
     * whose press is visible to a mouse and invisible to Space is two designs.
     */
    this.endTurnButton.addEventListener("keydown", (event) => {
      if (event.key !== " " && event.key !== "Enter" && event.key !== "Spacebar") return;
      if (event.repeat) return;
      this.pressEndTurn();
    });
    this.endTurnButton.addEventListener("keyup", () => this.releaseEndTurn());
    /*
     * The flare is a sibling of the ring inside the wrap, not a child of the
     * button: the button is the thing that scales down on a press, and a light
     * that shrinks with the object it is lighting is not a light. `.turn-wrap`
     * already establishes a stacking context for the collar at `z-index: -1`,
     * so this sits in the same layer the collar does, behind the ring.
     */
    this.endTurnFlare = el("div", "end-turn-flare");
    this.endTurnFlare.setAttribute("aria-hidden", "true");
    this.timerRing.append(this.endTurnButton, this.timerLabel);
    turnWrap.append(this.endTurnFlare, this.timerRing);
    this.root.appendChild(turnWrap);

    // ---- confluence bar ----------------------------------------------------
    this.confluenceBar = el("div", "confluence-bar");
    this.root.appendChild(this.confluenceBar);

    /**
     * ---- action history ---------------------------------------------------
     *
     * The last plain `.panel` in the game, and now the last one that was.
     *
     * When this HUD was migrated the log could not come with it: the file was
     * another owner's for that wave, and **a material cannot be applied to a
     * selector you do not control** — `.mat-panel` is reachable only by writing
     * the class into the markup. So `battle.css` copied the whole recipe out of
     * `foundation.css` §3 and pinned it to `.history-panel`, with a note saying
     * the real fix was one line here. This is that line. The copy is gone with
     * it, and what remains in the stylesheet is the two things that are genuinely
     * this panel's rather than the material's: it floats over a live 3D board, so
     * its cast is lifted, and it shares the first frame of every match with the
     * mulligan sheet, so its specular band runs out of phase with that sheet's.
     */
    const historyPanel = el("div", "history-panel mat-panel");
    const historyHead = el("div", "history-head");
    historyHead.append(el("span", "eyebrow", "Action Log"));
    const historyToggle = el("button", "btn btn-ghost btn-icon history-toggle");
    historyToggle.innerHTML = icon("chevron-down", { label: "Toggle action log" });
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
    /**
     * Seven Unicode glyphs used to live on this screen and none of them belong
     * to the same drawing.
     *
     * The hand was a full-colour OS emoji sitting in a monochrome neon UI — at
     * 5x it was the first thing the eye landed on in the top-left corner — and
     * the three buttons here were an outline smiley, a solid heavy gear and a
     * solid white flag: three fill conventions and three optical weights inside
     * three identical circles. The foundation contract lists the hand, the deck
     * and the discard glyphs by name as things to delete. These are the same
     * drawings at the same 1.75px stroke in `currentColor`, so they inherit the
     * button's own ink and its disabled state rather than whatever font the
     * operating system happens to have.
     */
    const settingsBtn = el("button", "btn btn-ghost btn-icon");
    settingsBtn.innerHTML = icon("settings", { label: "Settings" });
    settingsBtn.setAttribute("aria-label", "Settings");
    settingsBtn.addEventListener("click", () => this.callbacks.onSettings());

    const emoteBtn = el("button", "btn btn-ghost btn-icon");
    emoteBtn.innerHTML = icon("emote", { label: "Emotes" });
    emoteBtn.setAttribute("aria-label", "Emotes");
    const emoteMenu = el("div", "emote-menu mat-panel");
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

    const concedeBtn = el("button", "btn btn-ghost btn-icon");
    concedeBtn.innerHTML = icon("concede", { label: "Concede" });
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
    // `&& !this.pressed`: an engine event landing between the pointer going down
    // and coming up would otherwise restart the idle breath under the player's
    // finger, and the breath is what eats the press. See the pointerdown handler.
    this.endTurnButton.classList.toggle("ready", yourTurn && !this.pressed);
    this.root.classList.toggle("enemy-turn", !yourTurn);
  }

  /** Whether the pointer or the keyboard is currently holding End Turn down. */
  private pressed = false;

  /**
   * Acknowledge the press, on the frame it happens.
   *
   * Three things at once, which is what §5 asks for and what all three reference
   * games do: the disc scales, the breath stops so the plate can actually darken
   * (see the pointerdown wiring for why that is not a stylesheet's job here),
   * and the flare behind the ring lights. The flare's class is removed and
   * re-added inside a forced reflow so a second press inside 260ms replays it
   * rather than being swallowed by the animation already running — the same
   * trick `announceTurn` uses on the ribbon, and for the same reason.
   */
  private pressEndTurn(): void {
    if (this.endTurnButton.disabled) return;
    this.pressed = true;
    this.endTurnButton.classList.add("pressed");
    this.endTurnButton.classList.remove("ready");
    this.endTurnFlare.classList.remove("lit");
    void this.endTurnFlare.offsetWidth;
    this.endTurnFlare.classList.add("lit");
  }

  /**
   * Let go, and give the button back whichever resting state it is now owed.
   *
   * Read from the view rather than remembered, because the most common thing to
   * happen between the press and the release is the turn ending — and restoring
   * a breathing "ready" glow to a button that has just become the rival's is the
   * exact lie the disabled state exists to prevent.
   */
  private releaseEndTurn(): void {
    if (!this.pressed) return;
    this.pressed = false;
    this.endTurnButton.classList.remove("pressed");
    const view = this.view;
    const yourTurn = view !== null && view.activeSeat === view.seat && view.phase === "main";
    this.endTurnButton.classList.toggle("ready", yourTurn);
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
          ${armor > 0 ? `<span class="armor">${icon("armour")}<span class="num">${armor}</span></span>` : ""}
        </div>
      </div>
      <div class="leader-info">
        <div class="leader-name">${leader?.name ?? "Unknown"}</div>
        <div class="leader-meta">
          <span class="chip" title="Cards in hand">${icon("hand")}<span class="num">${handCount}</span></span>
          <span class="chip" title="Cards in deck">${icon("deck")}<span class="num">${deckCount}</span></span>
          <span class="chip" title="Cards in discard">${icon("discard")}<span class="num">${discardCount}</span></span>
          ${reactionCount > 0 ? `<span class="chip chip-reaction" title="Face-down Reactions">${icon("reaction")}<span class="num">${reactionCount}</span></span>` : ""}
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
      <div class="obs-track mat-well">${pips}</div>
      ${
        /**
         * The last two Unicode glyphs on this HUD, drawn instead of typed.
         *
         * `⛊` (U+26CA) and `⚠` (U+26A0) render in whatever face the operating
         * system happens to have for them: a different stroke weight from every
         * other mark on the screen, a different optical size, full colour on the
         * platforms that ship an emoji presentation for the warning sign, and
         * tofu where the code point is missing. The foundation contract lists
         * exactly this as work to delete, and these were the two survivors.
         */
        obsessed
          ? `<div class="obs-warning">${icon("warning")}<span>Obsessed — takes +1 damage</span></div>`
          : ""
      }`;
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
      button.className = `ability-btn mat-panel act ability-${kind}${enabled ? " ready" : ""}`;
      button.disabled = !enabled;
      button.innerHTML = `
        <span class="ability-cost">${ability.obsessionCost}</span>
        <span class="ability-body">
          <span class="ability-name">${ability.name}</span>
          <span class="ability-text">${richAbilityText(ability.text)}</span>
        </span>`;
      button.title = used
        ? `${ability.name} — already ${spent}`
        : affordable
          ? plainAbilityText(ability.text)
          : `Needs ${ability.obsessionCost} Obsession`;
      button.setAttribute(
        "aria-label",
        `${ability.name}, costs ${ability.obsessionCost} Obsession. ${used ? `Already ${spent}.` : affordable ? "Ready." : "Not enough Obsession."}`
      );
      button.addEventListener("click", () => this.callbacks.onUseAbility(kind));
      node.appendChild(button);
    }
  }

  /**
   * All ten sockets, always.
   *
   * It used to emit `min(cap, max(shown, 1))` crystals, so on turn one the
   * game's primary resource was **one dot** in the corner and the player was
   * given no way to learn that it ramps to ten. Hearthstone's mana row is ten
   * permanent sockets in a carved tray from the first turn, and the empty ones
   * are the whole lesson: they say "this is how big this gets" without a word
   * of tutorial. Three states, and they differ by more than colour (§6): a
   * filled crystal is lit, a spent one is an empty socket inside your current
   * maximum, and a locked one is a socket you have not earned yet, drawn flatter
   * and darker so the ramp reads as a boundary rather than as a gradient.
   */
  private renderHype(view: PlayerView): void {
    const { hype, hypeMax, hypeLockedNextTurn } = view.you;
    const cap = this.content.balance.hype.cap;

    const crystals: string[] = [];
    for (let i = 0; i < cap; i++) {
      const state = i < hype ? "filled" : i < hypeMax ? "spent" : "locked";
      crystals.push(`<span class="hype-crystal ${state}"></span>`);
    }
    this.hypeRow.innerHTML =
      `<span class="hype-sockets">${crystals.join("")}</span>` +
      `<span class="hype-count num">${hype}<span class="hype-of">/${hypeMax}</span></span>` +
      (hypeLockedNextTurn > 0
        ? `<span class="hype-locked-chip mat-chip" title="Overload — this much Hype is locked next turn">${icon("lock")}<span class="num">${hypeLockedNextTurn}</span></span>`
        : "");
    this.hypeRow.setAttribute(
      "aria-label",
      `Hype ${hype} of ${hypeMax}, maximum ${cap}${hypeLockedNextTurn > 0 ? `, ${hypeLockedNextTurn} locked next turn` : ""}`
    );
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
    entry.classList.add(
      event.e === "turnStarted" || event.e === "waveArrived" || event.e === "matchEnded"
        ? "turn"
        : event.e.startsWith("damage")
          ? "damage"
          : "neutral"
    );
    this.historyList.appendChild(entry);
    while (this.historyList.childElementCount > 120) this.historyList.firstElementChild?.remove();
    this.historyList.scrollTop = this.historyList.scrollHeight;
  }

  /** Show the trigger queue as it resolves, so cascades are readable. */
  showTrigger(cardName: string, trigger: string): void {
    const chip = el("div", "trigger-chip mat-chip");
    chip.innerHTML = `<span class="trigger-card">${cardName}</span><span class="trigger-kind">${trigger}</span>`;
    this.triggerRail.appendChild(chip);
    window.setTimeout(() => {
      chip.classList.add("out");
      window.setTimeout(() => chip.remove(), 320);
    }, 900);
  }

  toast(message: string, kind: "info" | "error" = "info"): void {
    const toast = el("div", `toast mat-chip toast-${kind}`, message);
    this.toastLayer.appendChild(toast);
    window.setTimeout(() => {
      toast.classList.add("out");
      window.setTimeout(() => toast.remove(), 300);
    }, 2200);
  }

  /**
   * Name the turn, on a ribbon that rides the mat's centre line and is gone
   * inside §3a's budget.
   *
   * It used to be a dark rounded plate parked over the middle of the play area
   * for 1.1 seconds plus a 320ms fade, twice a turn, with a card nameplate
   * between them: measured end to end, three and a half seconds of chips over
   * the board per handover, during which the board could not be read. The board
   * itself now carries the state (`battleView.setTurnSide` lifts the active half
   * of the mat and brings that seat's practical up, and it *stays* up), so this
   * only has to say the word. A thin ribbon that wipes along the seam does it in
   * 390ms and never covers a card.
   */
  announceTurn(yours: boolean, turn: number): void {
    if (getSettings().animationSpeed === "instant") return;
    this.turnBanner.innerHTML =
      `<span class="turn-banner-text">${yours ? "Your Turn" : "Rival's Turn"}</span>` +
      `<span class="turn-banner-num num">${turn}</span>`;
    this.turnBanner.className = `turn-banner ${yours ? "yours" : "theirs"}`;
    this.turnBanner.hidden = false;
    // A reflow between the reset and the class, so a second handover inside the
    // same second replays the wipe instead of being swallowed by an in-flight one.
    void this.turnBanner.offsetWidth;
    this.turnBanner.classList.add("show");
    window.clearTimeout(this.turnBannerTimer);
    this.turnBannerTimer = window.setTimeout(() => {
      this.turnBanner.classList.remove("show");
      this.turnBannerTimer = window.setTimeout(() => {
        this.turnBanner.hidden = true;
      }, 170);
    }, 220);
  }

  private turnBannerTimer = 0;

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

  /**
   * The thing that was hit, by name.
   *
   * The log used to say "a character took 1" — for an event whose whole purpose
   * is to tell you what happened to *which* thing. Both boards are public
   * information in the view, so there is no reason to be vague; the fallback
   * only fires for something that has already left the board by the time the
   * line is written, which is the one case where a name genuinely is not
   * available.
   */
  const target = (ref: TargetRef): string => {
    if (ref.kind === "leader") return `${who(ref.seat)}${ref.seat === view.seat ? "r" : "'s"} leader`;
    for (const board of [view.you.board, view.opponent.board]) {
      for (const character of board) {
        if (character?.instanceId === ref.instanceId) return name(character.cardId);
      }
    }
    return "a character";
  };

  switch (event.e) {
    case "turnStarted":
      return `— ${who(event.seat)} turn ${event.turn} (${event.hype}/${event.hypeMax} Hype)`;
    case "cardPlayed":
      return `${who(event.seat)} played ${name(event.cardId)} for ${event.cost}`;
    case "attackDeclared":
      return null; // covered by the damage line
    case "damageDealt": {
      const hit = target(event.target);
      const bonus = event.elementalBonus ? " (Current advantage +1)" : "";
      if (event.absorbedByShield) return `Shield absorbed the hit on ${hit}`;
      // Zero damage is not an event; it is an effect that did nothing, and a log
      // line for it teaches the player to stop reading the log.
      if (event.amount <= 0) return null;
      return `${hit} took ${event.amount}${bonus}`;
    }
    case "healed":
      if (event.blocked) return "Healing was blocked";
      // "Restored 0 health" appeared twice in one captured match.
      if (event.amount <= 0) return null;
      return `${target(event.target)} restored ${event.amount} health`;
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
