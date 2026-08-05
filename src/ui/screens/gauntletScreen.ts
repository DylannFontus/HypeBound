/**
 * The Gauntlet — `09-game-modes.md` §8.
 *
 * One screen, six phases: the hub, the leader pick, thirty draft picks, the
 * finished deck, the run itself, and the payout. They share a screen because
 * they share one run, and a run that had to be handed between routes would have
 * to be re-read from storage at every boundary.
 *
 * ## The rules panel is not decoration
 *
 * §8.1's rarity table is a promise about odds, and this build's card pool cannot
 * keep the Legendary half of it — no selectable leader has three Legendaries to
 * offer, so a Legendary pick is filled out from Epic. That is printed on this
 * screen, per leader, from `offerReality()`. A draft that quietly hands you
 * Epics after saying Legendary is a draft lying about its own odds, and the
 * whole point of `src/game/fairness/` was that the published number and the
 * rolled number are the same number.
 */

import type { CardDef, ContentIndex } from "../../engine/types";
import type { Screen } from "../shell";
import { renderCardToCanvas } from "../cardRenderer/renderCard";
import { audio } from "../../audio/audio";
import { AI_DIFFICULTY_LABEL } from "../../ai/profiles";
import {
  DEFERRED_GAUNTLET,
  beginRun,
  chooseLeader,
  currentOffer,
  isOver,
  nextFight,
  offerReality,
  pickCard,
  practiceReward,
  redraft,
  retire,
  startRun,
  type GauntletRun,
} from "../../game/gauntlet";
import { RARITY_ORDER, gauntletData } from "../../game/gauntlet/data";
import {
  activeGauntlet,
  beginGauntlet,
  claimGauntlet,
  gauntletStore,
  previewGauntlet,
  saveGauntlet,
} from "../../save/gauntletSave";
import { TARGET_CURVE, curveBucket } from "../../engine/deck";
import { aiCloutRemaining, getProfile } from "../../save/profile";
import { aiDailyCap } from "../../game/economy/income";
import { artAttr, count, countUp, enter, icon, quantify } from "./data/kit";

export interface GauntletCallbacks {
  onBack: () => void;
  /** hand off to the battle route; the run is already saved */
  onFight: () => void;
}

const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const RARITY_LABEL: Record<string, string> = {
  common: "Common",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
};

const percent = (value: number): string => `${Math.round(value * 1000) / 10}%`;

export function createGauntletScreen(content: ContentIndex, callbacks: GauntletCallbacks): Screen {
  const data = gauntletData();
  const root = document.createElement("div");
  root.className = "screen gauntlet-screen";

  root.innerHTML = `
    <div class="ambient-bg"></div>
    <header class="screen-header">
      <button class="btn btn-ghost" id="gauntlet-back">${icon("arrow-left", 16)} Back</button>
      <h1 class="title">The Gauntlet</h1>
      <div class="mastery-wallet" id="gauntlet-record-chip"></div>
    </header>
    ${/*
       * `.scroll` is deliberately absent, and that is a scrollbar fix.
       *
       * `.data-body` already scrolls. What `.scroll` adds on top is
       * `scrollbar-width: thin; scrollbar-color: …` — and `foundation.css` §1
       * documents the consequence in forty lines: from Chrome 121 a non-initial
       * standard scrollbar property makes the whole `::-webkit-scrollbar` block
       * **inert** for that element, so the game's drawn thumb was replaced by
       * Chrome's own Fluent bar, complete with a stepper arrow at each end.
       * Measured on this route at 8×: a grey-purple triangle above a hairline
       * thumb, which is §7's "tear in the world" with extra steps. Dropping the
       * class hands the element back to the foundation's drawing.
       */ ""}
    <main class="gauntlet-body data-body" id="gauntlet-body"></main>`;

  const body = root.querySelector<HTMLElement>("#gauntlet-body")!;
  const chip = root.querySelector<HTMLElement>("#gauntlet-record-chip")!;

  root.querySelector("#gauntlet-back")?.addEventListener("click", () => callbacks.onBack());

  // -------------------------------------------------------------------------
  // Shared pieces
  // -------------------------------------------------------------------------

  /**
   * The header chip, once, with an icon instead of a code point.
   *
   * Four phases each wrote their own `<div class="currency">` with `▤` in it —
   * a Unicode "square with horizontal fill" standing in for a mode mark, which
   * renders in whatever font the OS has, at the wrong weight, and becomes tofu
   * where the code point is missing. `uiIcons.ts` §C exists to delete exactly
   * this, and it names `▤` in its list.
   */
  function runChip(mark: Parameters<typeof icon>[0], value: string, title = "", raw = false, id = ""): string {
    return `
      <div class="currency"${title ? ` title="${esc(title)}"` : ""}${id ? ` id="${esc(id)}"` : ""}>
        <span class="currency-icon">${icon(mark, 14)}</span>
        <span class="currency-value">${raw ? value : esc(value)}</span>
      </div>`;
  }

  function cardTile(card: CardDef, onPick: (() => void) | null, extra = ""): HTMLElement {
    /*
     * `mat-panel act` rather than a bespoke glass plate.
     *
     * `screens.css` gives this tile `background: var(--glass)` with a 1px border
     * and a hover that moves it 4px and recolours the border — no light source,
     * no press, no focus treatment beyond the browser default, and the three
     * offered cards are the single most-clicked object in the mode. The material
     * brings the bevel and the interaction mixin brings the other five states.
     */
    const tile = document.createElement(onPick ? "button" : "div");
    tile.className = `gauntlet-card-tile mat-panel r-tile${onPick ? " act" : ""}`;
    tile.dataset["card"] = card.id;
    if (onPick) {
      (tile as HTMLButtonElement).type = "button";
      tile.addEventListener("click", () => {
        audio.play("sfx.ui.click");
        onPick();
      });
    }
    tile.appendChild(renderCardToCanvas(card, 200));
    const caption = document.createElement("div");
    caption.className = "gauntlet-tile-caption";
    caption.innerHTML = `<span class="gauntlet-tile-name">${esc(card.name)}</span><span class="t-label">${esc(
      RARITY_LABEL[card.rarity] ?? card.rarity
    )}${extra ? ` · ${esc(extra)}` : ""}</span>`;
    tile.appendChild(caption);
    return tile;
  }

  /**
   * §8.1's two rarity rows, as published.
   *
   * Wrapped in its own scroller, and that wrapper is load-bearing. `screens.css`
   * gives both Gauntlet tables `display: block; overflow-x: auto` so a
   * six-column table cannot force the page sideways at 844px — which works, and
   * costs the table its own layout: a `display: block` table sizes to its
   * content, so the odds table rendered 450px wide inside an 1,100px panel and
   * left the right sixty per cent of the largest object on the screen holding
   * nothing. §2 reads that as content that failed to load.
   *
   * Moving the overflow onto a wrapper gives both halves: the element that
   * scrolls is a div, the table is a table again and fills its panel, and a
   * `min-width` keeps the columns legible rather than letting six of them
   * squeeze into a phone.
   */
  const rarityTable = (): string => `
    <div class="d-tablewrap">
    <table class="d-table patch-table gauntlet-rarity-table">
      <thead><tr><th>Pick</th>${RARITY_ORDER.map((r) => `<th>${esc(RARITY_LABEL[r]!)}</th>`).join("")}</tr></thead>
      <tbody>
        <tr data-row="spotlight">
          <td>Spotlight (${data.draft.spotlightPicks.join(", ")})</td>
          ${RARITY_ORDER.map((r) => `<td class="patch-after num">${percent(data.draft.rarity.spotlight[r])}</td>`).join("")}
        </tr>
        <tr data-row="standard">
          <td>Every other pick</td>
          ${RARITY_ORDER.map((r) => `<td class="patch-after num">${percent(data.draft.rarity.standard[r])}</td>`).join("")}
        </tr>
      </tbody>
    </table>
    </div>`;

  /**
   * What the pool can actually deliver, for one leader or for all of them.
   *
   * The honest half of the rarity table. It is printed next to the odds rather
   * than in a footnote, because the two only mean anything together.
   */
  function realityFor(leaderCardId: string | null): string {
    const rows = offerReality(content);
    const mine = leaderCardId ? rows.find((row) => row.leaderCardId === leaderCardId) : null;
    const shortEverywhere = RARITY_ORDER.filter((rarity) => rows.every((row) => row.short.includes(rarity)));

    if (mine) {
      const lines = RARITY_ORDER.map(
        (rarity) =>
          `<li data-rarity="${rarity}"><strong>${esc(RARITY_LABEL[rarity]!)}</strong>: ${quantify(
            mine.counts[rarity],
            "card"
          )}${
            mine.short.includes(rarity)
              ? ` — fewer than the ${count(data.draft.offerSize)} an offer needs`
              : ""
          }</li>`
      ).join("");
      return `
        <p class="t-body" id="gauntlet-reality">
          ${esc(mine.leaderName)}'s legal pool, by rarity. Where it cannot fill an offer, the rest of that
          pick comes from the nearest rarity below.
        </p>
        <ul class="patch-list gauntlet-reality-list">${lines}</ul>`;
    }

    return `
      <p class="t-body" id="gauntlet-reality">
        <strong>What the card pool can actually offer.</strong>
        ${
          shortEverywhere.length === 0
            ? "Every leader can fill an offer at every rarity."
            : `No leader in this build has ${count(data.draft.offerSize)} ${shortEverywhere
                .map((rarity) => esc(RARITY_LABEL[rarity]!))
                .join(" or ")} cards in its legal pool, so a pick that rolls one is filled out from the
                rarity below. The roll above is still the roll; this is what it can hand you.`
        }
      </p>`;
  }

  /** §8.3's table, with what Practice actually pays beside it. */
  const rewardTable = (): string => `
    <div class="d-tablewrap">
    <table class="d-table patch-table gauntlet-reward-table">
      <thead>
        <tr>
          <th>Wins</th><th>Clout</th><th>Signal</th><th>Packs</th><th>Ticket</th><th>Extra</th>
        </tr>
      </thead>
      <tbody>
        ${data.rewards.rows
          .map((row) => {
            const practice = practiceReward(row.wins);
            const extra: string[] = [];
            if (row.cardBackProgress) extra.push(`card-back token ×${row.cardBackProgress}`);
            if (row.cosmetics?.length) extra.push("Perfect Run title + Gauntlet card back");
            return `
              <tr data-wins="${row.wins}">
                <td class="num">${count(row.wins)}</td>
                <td class="patch-after num">${count(practice.clout)}<span class="muted gauntlet-full"> / ${count(
                  row.clout
                )}</span></td>
                <td class="patch-after num">${count(practice.signal)}<span class="muted gauntlet-full"> / ${count(
                  row.signal
                )}</span></td>
                <td class="gauntlet-excluded num">—<span class="muted gauntlet-full"> / ${
                  row.packs ? count(row.packs) : "—"
                }</span></td>
                <td class="gauntlet-excluded num">—<span class="muted gauntlet-full"> / ${
                  row.tickets ? count(row.tickets) : "—"
                }</span></td>
                <td class="muted">${esc(extra.join("; ")) || "—"}</td>
              </tr>`;
          })
          .join("")}
      </tbody>
    </table>
    </div>
    <p class="t-body">
      The first figure in each column is what a <strong>Practice</strong> run pays; the second is the
      competitive payout. Practice is ${percent(data.practice.scale)} of that, with packs excluded, and
      Tickets are withheld because a Ticket buys a competitive entry and competitive
      Gauntlet needs a server. Clout from Practice shares the same daily AI allowance every mode's
      per-match Clout spends against — <span class="num">${count(aiDailyCap())}</span> a day, of which
      <strong class="num" id="gauntlet-cap-left">${count(aiCloutRemaining(aiDailyCap()))}</strong> is left.
    </p>`;

  /**
   * "What a run pays", written once instead of four times.
   *
   * Four of the six phases ended with the same `<section class="panel"><h2>What
   * a run pays</h2>` wrapper around `rewardTable()`, and one of them had gained
   * a marked head while the others had not — which is how a screen ends up
   * speaking two languages inside itself.
   */
  const paysPanel = (): string => `
    <section class="mat-panel d-enter">
      <div class="settings-head">
        <span class="settings-mark" aria-hidden="true">${icon("chest", 20)}</span>
        <h2 class="t-heading">What a run pays</h2>
      </div>
      ${rewardTable()}
    </section>`;

  const deferredList = (): string => `
    <section class="mat-panel gauntlet-deferred d-enter">
      <div class="settings-head">
        <span class="settings-mark" aria-hidden="true">${icon("lock", 20)}</span>
        <h2 class="t-heading">What the full Gauntlet has that this build does not</h2>
      </div>
      <ul class="patch-list">
        ${[...DEFERRED_GAUNTLET]
          .map(([name, reason]) => `<li data-deferred="${esc(name)}"><strong>${esc(name)}</strong> — ${esc(reason)}</li>`)
          .join("")}
      </ul>
    </section>`;

  /** The drafted deck, grouped by cost, with the curve it is filling. */
  function deckPanel(run: GauntletRun): string {
    const counts = new Map<number, CardDef[]>();
    for (const cardId of run.deck) {
      const card = content.cards[cardId];
      if (!card) continue;
      const bucket = curveBucket(card.cost);
      counts.set(bucket, [...(counts.get(bucket) ?? []), card]);
    }
    const buckets = Object.keys(TARGET_CURVE)
      .map(Number)
      .sort((a, b) => a - b);
    const tallest = Math.max(1, ...buckets.map((bucket) => Math.max(counts.get(bucket)?.length ?? 0, TARGET_CURVE[bucket]!)));

    return `
      <section class="mat-panel gauntlet-deck d-enter">
        <div class="settings-head">
          <span class="settings-mark" aria-hidden="true">${icon("deck", 20)}</span>
          <div class="policy-doc-head">
            <h2 class="t-heading">Your deck</h2>
            <span class="t-label num" id="gauntlet-deck-count" data-digits="7">${count(
              run.deck.length
            )} / ${count(data.draft.picks)}</span>
          </div>
        </div>
        <div class="gauntlet-curve" id="gauntlet-curve">
          ${buckets
            .map((bucket) => {
              const have = counts.get(bucket)?.length ?? 0;
              const want = TARGET_CURVE[bucket]!;
              return `
                <div class="gauntlet-curve-col${have >= want ? " is-full" : ""}" data-cost="${bucket}"
                     title="${have} of a target ${want}">
                  <div class="gauntlet-curve-target" style="bottom:${Math.round((want / tallest) * 100)}%"></div>
                  <div class="gauntlet-curve-count num">${count(have)}</div>
                  <div class="gauntlet-curve-bar" style="height:${Math.round((have / tallest) * 100)}%"></div>
                  <div class="gauntlet-curve-label num">${bucket === 7 ? "7+" : count(bucket)}</div>
                </div>`;
            })
            .join("")}
        </div>
        <ul class="gauntlet-deck-list" id="gauntlet-deck-list">
          ${[...run.deck]
            .map((cardId) => content.cards[cardId])
            .filter((card): card is CardDef => Boolean(card))
            .sort((a, b) => a.cost - b.cost || (a.name < b.name ? -1 : 1))
            .map(
              (card) =>
                `<li data-card="${esc(card.id)}"><span class="gauntlet-deck-cost num">${count(
                  card.cost
                )}</span>${esc(card.name)}</li>`
            )
            .join("")}
        </ul>
      </section>`;
  }

  // -------------------------------------------------------------------------
  // Phases
  // -------------------------------------------------------------------------

  function renderHub(): void {
    const save = gauntletStore.get();
    chip.innerHTML = "";
    body.innerHTML = `
      <section class="mat-panel gauntlet-intro d-enter">
        ${/*
           * The hub's right third was empty, and prose cannot fill it.
           *
           * Every paragraph on this screen is capped at 84ch because that is
           * what a reading measure is; the panel is 1,080px. So at 1600 the
           * largest object on the mode's front door held a column of text and
           * about 320px of nothing, which §2 reads as content that failed to
           * load. The ladder silhouette is the domain's own generator — the same
           * one behind the Leaderboards standing and the empty Match History —
           * and it composes the frame while claiming nothing, which is the right
           * trade on a screen whose whole argument is not overclaiming.
           */ ""}
        <div class="d-key gauntlet-intro-key" ${artAttr("ladder", [520, 700, "#b56cff"])}
             style="--key-aspect:3/4" aria-hidden="true">
          <div class="d-key-scrim"></div>
        </div>
        <div class="t-label">Gauntlet Practice</div>
        <h2 class="t-display">Draft a deck one pick at a time.</h2>
        <p class="t-body mastery-rule">
          Pick a leader from three, then build ${count(data.draft.picks)} cards from
          ${count(data.draft.offerSize)} offers at a time. Ride the deck until
          <strong>${quantify(data.run.winsToRetire, "win")}</strong> or
          <strong>${quantify(data.run.lossesToRetire, "loss", "losses")}</strong>. It draws from the whole
          card pool, not your collection — a brand-new account is on exactly level ground here.
        </p>
        ${
          save.runsStarted === 0
            ? `<p class="t-body"><span class="gauntlet-none">${icon(
                "campfire",
                15
              )} No runs yet — the first one starts free.</span></p>`
            : `<dl class="d-stats gauntlet-record-stats">
                 <div class="d-stat"><dt>Runs started</dt><dd class="num" data-count="${save.runsStarted}" data-digits="4">0</dd></div>
                 <div class="d-stat"><dt>Best run</dt><dd class="num" data-count="${save.bestWins}" data-digits="3">0</dd></div>
                 <div class="d-stat"><dt>Clout banked</dt><dd class="num" data-count="${save.lifetimeClout}" data-digits="7">0</dd></div>
                 <div class="d-stat"><dt>Card-back tokens</dt><dd class="num">${count(save.cardBackProgress)} / ${count(
                   data.cardBack.progressRequired
                 )}</dd></div>
               </dl>`
        }
        <div class="row center">
          <button type="button" class="mat-hero act r-chip gauntlet-cta" id="gauntlet-start">
            ${icon("play", 16)} Start a run
          </button>
        </div>
        <p class="t-body">
          Free entry. Competitive Gauntlet costs <span class="num">${count(data.entry.clout)}</span> Clout
          or one Gauntlet Ticket and needs a server; nothing is charged here.
        </p>
      </section>

      <section class="mat-panel d-enter" id="gauntlet-rules">
        <div class="settings-head">
          <span class="settings-mark" aria-hidden="true">${icon("mode-draft", 20)}</span>
          <h2 class="t-heading">How an offer is built</h2>
        </div>
        <p class="t-body">
          Every offered card is legal for your leader — its faction or Neutral, in one of its Currents.
          Prism may be offered until you have drafted
          <span class="num">${count(content.balance.deck.prismSplashLimit)}</span>, the same splash limit
          constructed decks use, after which it stops appearing. Copies are <strong>not</strong> capped:
          this is the one constructed rule the mode waives, so you may draft the same card as often as it
          is offered.
        </p>
        ${rarityTable()}
        ${realityFor(null)}
      </section>

      ${paysPanel()}

      ${deferredList()}`;

    body.querySelector("#gauntlet-start")?.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      const run = startRun(content, (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0, Date.now());
      beginGauntlet(run);
      render();
    });
  }

  function renderLeaderPick(run: GauntletRun): void {
    chip.innerHTML = runChip("profile", "Pick a leader");
    body.innerHTML = `
      <section class="mat-panel gauntlet-phase d-enter">
        <div class="t-label">Step 1 of 2</div>
        <h2 class="t-display">Choose your leader</h2>
        <p class="t-body">
          Three leaders, three factions. The one you take fixes the run's faction and both Currents, exactly
          as it would in constructed — everything you are offered afterwards is legal for it.
        </p>
        <div class="gauntlet-offer" id="gauntlet-leaders"></div>
      </section>
      <section class="mat-panel d-enter">
        <div class="settings-head">
          <span class="settings-mark" aria-hidden="true">${icon("mode-draft", 20)}</span>
          <h2 class="t-heading">How an offer is built</h2>
        </div>
        ${rarityTable()}${realityFor(null)}
      </section>`;

    const host = body.querySelector<HTMLElement>("#gauntlet-leaders")!;
    for (const leaderCardId of run.leaderChoices) {
      const leader = content.leaders[leaderCardId];
      if (!leader) continue;
      const tile = cardTile(leader as unknown as CardDef, () => {
        const next = chooseLeader(run, leaderCardId);
        saveGauntlet(next);
        render();
      }, content.factions[leader.faction]?.name ?? leader.faction);
      tile.classList.add("gauntlet-leader-tile");
      tile.dataset["leader"] = leaderCardId;
      host.appendChild(tile);
    }
  }

  function renderDraft(run: GauntletRun): void {
    const offer = currentOffer(content, run);
    if (!offer) return;
    const leaderName = content.leaders[run.leaderCardId!]?.name ?? "";

    // the pick you are on, not the cards behind you — the heading says the same
    // number, and a chip reading "0 / 30" on pick one reads as nothing happening
    chip.innerHTML = runChip(
      "deck",
      `<span class="num" id="gauntlet-pick-count" data-digits="5">${count(offer.pick)} / ${count(
        data.draft.picks
      )}</span>`,
      "Which pick you are on",
      true
    );

    const substituted =
      offer.substituted > 0
        ? `<span class="gauntlet-substituted"> — ${esc(leaderName)}'s pool has fewer than ${count(
            data.draft.offerSize
          )}, so ${
            offer.substituted === 1 ? "one card comes" : `${count(offer.substituted)} cards come`
          } from the rarity below</span>`
        : "";

    body.innerHTML = `
      <section class="mat-panel gauntlet-phase d-enter">
        <div class="t-label">${esc(leaderName)} · pick ${count(offer.pick)} of ${count(
          data.draft.picks
        )}</div>
        <h2 class="t-display">${offer.spotlight ? "Spotlight Pick" : "Take one"}</h2>
        <p class="t-body" id="gauntlet-rarity">
          <strong>${esc(RARITY_LABEL[offer.rarity]!)}</strong> pick${
            offer.spotlight ? ` — Spotlight Picks are ${data.draft.spotlightPicks.join(", ")}` : ""
          }${substituted}.
          ${offer.prismOpen ? "" : `Prism is closed: you have drafted the splash limit.`}
        </p>
        <div class="gauntlet-offer" id="gauntlet-offer"></div>
      </section>
      ${deckPanel(run)}`;

    const host = body.querySelector<HTMLElement>("#gauntlet-offer")!;
    for (const cardId of offer.cardIds) {
      const card = content.cards[cardId];
      if (!card) continue;
      const tile = cardTile(card, () => {
        const next = pickCard(content, run, cardId);
        saveGauntlet(next);
        render();
      });
      tile.classList.add("gauntlet-offer-tile");
      host.appendChild(tile);
    }
  }

  function renderReady(run: GauntletRun): void {
    const canRedraft = run.redraftsUsed < data.draft.redrafts;
    chip.innerHTML = runChip("check", "Deck ready");
    body.innerHTML = `
      <section class="mat-panel gauntlet-phase d-enter">
        <div class="t-label">${esc(content.leaders[run.leaderCardId!]?.name ?? "")}</div>
        <h2 class="t-display">${count(data.draft.picks)} cards, drafted.</h2>
        <p class="t-body">
          Once the first match starts the deck is locked for the run. You get one free full re-draft before
          then — it throws this deck away and takes you back to pick one.
        </p>
        <div class="row center">
          <button type="button" class="mat-hero act r-chip gauntlet-cta" id="gauntlet-begin">
            ${icon("play", 16)} Start the run
          </button>
          <!-- Disable-able, so it takes the .act disabled skin rather than
               .btn:disabled's blanket opacity 0.42. See A4. -->
          <button class="mat-panel act r-chip gauntlet-redraft" id="gauntlet-redraft"${canRedraft ? "" : " disabled"}>
            ${icon("refresh", 15)} ${canRedraft ? "Delete and Repost" : "Re-draft already used"}
          </button>
        </div>
      </section>
      ${deckPanel(run)}
      ${paysPanel()}`;

    body.querySelector("#gauntlet-begin")?.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      saveGauntlet(beginRun(run));
      render();
    });
    body.querySelector("#gauntlet-redraft")?.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      saveGauntlet(redraft(run));
      render();
    });
  }

  function renderRun(run: GauntletRun): void {
    const fight = nextFight(content, run);
    const enemy = content.leaders[fight.enemyLeaderCardId];
    const reward = practiceReward(run.wins);

    const pips = (count: number, total: number, kind: string): string =>
      Array.from({ length: total }, (_, index) => `<span class="gauntlet-pip gauntlet-pip-${kind}${index < count ? " is-on" : ""}"></span>`).join(
        ""
      );

    chip.innerHTML = runChip(
      "mode-ranked",
      `<span class="num" data-digits="5">${count(run.wins)}–${count(run.losses)}</span>`,
      "Wins and losses",
      true,
      "gauntlet-record"
    );

    body.innerHTML = `
      <section class="mat-panel gauntlet-phase d-enter">
        <div class="t-label">${esc(content.leaders[run.leaderCardId!]?.name ?? "")}</div>
        <h2 class="t-display">${quantify(run.wins, "win")}, ${quantify(run.losses, "loss", "losses")}</h2>
        <div class="gauntlet-pips" id="gauntlet-pips">
          <span class="t-label">Wins</span>${pips(run.wins, data.run.winsToRetire, "win")}
          <span class="t-label">Losses</span>${pips(run.losses, data.run.lossesToRetire, "loss")}
        </div>
        <p class="t-body" id="gauntlet-next">
          Next: <strong>${esc(enemy?.name ?? fight.enemyLeaderCardId)}</strong> on
          ${esc(AI_DIFFICULTY_LABEL[fight.difficulty])}. The opponent drafts a deck too, through the same
          offers you saw${run.pending ? " — and this is the fight you left, dealt again from the same seed" : ""}.
        </p>
        <div class="row center">
          <button type="button" class="mat-hero act r-chip gauntlet-cta" id="gauntlet-fight">
            ${icon("play", 16)} Play the next match
          </button>
          <button type="button" class="mat-panel act r-chip gauntlet-retire" id="gauntlet-retire">
            Retire for <span class="num">${count(reward.clout)}</span> Clout${
              reward.signal > 0 ? ` + <span class="num">${count(reward.signal)}</span> Signal` : ""
            }
          </button>
        </div>
        ${
          run.fightsEntered > run.wins + run.losses
            ? `<p class="t-body" id="gauntlet-reentry">You left a match without finishing it. It comes back exactly as it was — same opponent, same deck, same opening.</p>`
            : ""
        }
      </section>
      ${deckPanel(run)}
      ${paysPanel()}`;

    body.querySelector("#gauntlet-fight")?.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      callbacks.onFight();
    });
    body.querySelector("#gauntlet-retire")?.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      saveGauntlet(retire(run));
      render();
    });
  }

  function renderDone(run: GauntletRun): void {
    const payout = previewGauntlet(content, run);
    chip.innerHTML = "";
    body.innerHTML = `
      <section class="mat-panel gauntlet-phase d-enter" id="gauntlet-summary">
        <div class="t-label">${run.retiredEarly ? "Retired" : run.wins >= data.run.winsToRetire ? "Perfect run" : "Run over"}</div>
        <h2 class="t-display num">${count(run.wins)}–${count(run.losses)}</h2>
        <div class="gauntlet-summary-grid">
          <div><span class="gauntlet-summary-value num" id="gauntlet-paid-clout" data-count="${payout.clout}" data-digits="5">0</span><span class="t-label">Clout</span></div>
          <div><span class="gauntlet-summary-value num" data-count="${payout.signal}" data-digits="5">0</span><span class="t-label">Signal</span></div>
          <div><span class="gauntlet-summary-value num" data-count="${run.fightsEntered}" data-digits="3">0</span><span class="t-label">matches entered</span></div>
        </div>
        ${
          payout.cloutCapped > 0
            ? `<p class="t-body" id="gauntlet-capped"><span class="num">${count(
                payout.cloutCapped
              )}</span> Clout is held back by today's <span class="num">${count(
                aiDailyCap()
              )}</span>-Clout AI allowance. It is not lost from the table — the table paid it; the day's cap did not have room. The allowance resets tomorrow.</p>`
            : ""
        }
        ${
          payout.cardBackProgress > 0
            ? `<p class="t-body" id="gauntlet-token">+${quantify(
                payout.cardBackProgress,
                "card-back token"
              )} (<span class="num">${count(
                gauntletStore.get().cardBackProgress + payout.cardBackProgress
              )}</span>/<span class="num">${count(data.cardBack.progressRequired)}</span>).</p>`
            : ""
        }
        ${
          payout.cosmetics.length > 0
            ? `<p class="t-body" id="gauntlet-cosmetics">Unlocked: ${esc(payout.cosmetics.join(", "))}.</p>`
            : ""
        }
        <div class="row center">
          <button type="button" class="mat-hero act r-chip gauntlet-cta" id="gauntlet-collect">
            ${icon("chest", 16)} Collect
          </button>
        </div>
      </section>
      ${deckPanel(run)}`;

    body.querySelector("#gauntlet-collect")?.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      claimGauntlet(content, run);
      render();
    });
  }

  // -------------------------------------------------------------------------

  function render(): void {
    const run = activeGauntlet();
    if (!run) renderHub();
    // a run that finished while the board was open lands on the payout
    else if (run.phase === "done" || isOver(run)) renderDone(run);
    else if (run.phase === "leader") renderLeaderPick(run);
    else if (run.phase === "draft") renderDraft(run);
    else if (run.phase === "ready") renderReady(run);
    else renderRun(run);

    /*
     * The cascade and the counters, on every phase, from one place.
     *
     * This screen imported `enter` and never called it — the mode with six full
     * page rewrites in it was the one screen in the domain with no entrance at
     * all, so each phase change replaced four panels on a single frame. Doing it
     * here rather than in each of the six branches is also why a seventh phase
     * cannot forget: `render` is the only way any of them is reached.
     */
    enter(body, ".d-enter", 42);
    countUp(body);
  }

  render();

  /** Automation hook, the same shape the other screens expose. */
  (window as unknown as { hypeboundGauntlet?: unknown }).hypeboundGauntlet = {
    run: () => activeGauntlet(),
    save: () => gauntletStore.get(),
    offer: () => {
      const run = activeGauntlet();
      return run ? currentOffer(content, run) : null;
    },
    reality: () => offerReality(content),
    reward: (wins: number) => practiceReward(wins),
    deferred: () => [...DEFERRED_GAUNTLET].map(([name, reason]) => ({ name, reason })),
    /**
     * Collect a finished run, and report the wallet either side — **from inside
     * the app**.
     *
     * `verify-gauntlet` used to do this itself, importing `claimGauntlet` and
     * `profileStore` inside a `page.evaluate`. Vite serves that evaluate its own
     * copy of a module, so the payout landed in one instance and the balance was
     * read from another: the check reported "promised 56 Clout and banked 0"
     * while the game was paying correctly. Anything that writes to the save has
     * to run where the app's stores live, which is here.
     */
    collect: (wins: number) => {
      const run = activeGauntlet();
      if (!run) return null;
      const finished = { ...run, wins, phase: "done" as const, pending: null };
      saveGauntlet(finished);
      const before = { clout: getProfile().clout, signal: getProfile().shards };
      const payout = claimGauntlet(content, finished);
      const after = { clout: getProfile().clout, signal: getProfile().shards };
      return {
        payout,
        gained: { clout: after.clout - before.clout, signal: after.signal - before.signal },
        left: activeGauntlet(),
      };
    },
    /** drive the draft without 30 clicks, for the browser verification */
    autoDraft: () => {
      let run = activeGauntlet();
      if (!run) return null;
      if (run.phase === "leader") run = chooseLeader(run, run.leaderChoices[0]!);
      while (run.phase === "draft") {
        const offer = currentOffer(content, run);
        if (!offer) break;
        run = pickCard(content, run, offer.cardIds[0]!);
      }
      saveGauntlet(run);
      render();
      return run;
    },
    refresh: render,
  };

  return {
    root,
    resume: render,
    dispose: () => {
      delete (window as unknown as { hypeboundGauntlet?: unknown }).hypeboundGauntlet;
    },
  };
}
