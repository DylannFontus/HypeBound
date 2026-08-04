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
import { enter, icon } from "./data/kit";

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

  function cardTile(card: CardDef, onPick: (() => void) | null, extra = ""): HTMLElement {
    const tile = document.createElement(onPick ? "button" : "div");
    tile.className = "gauntlet-card-tile";
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
    caption.innerHTML = `<span class="gauntlet-tile-name">${esc(card.name)}</span><span class="muted">${esc(
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
          ${RARITY_ORDER.map((r) => `<td class="patch-after">${percent(data.draft.rarity.spotlight[r])}</td>`).join("")}
        </tr>
        <tr data-row="standard">
          <td>Every other pick</td>
          ${RARITY_ORDER.map((r) => `<td class="patch-after">${percent(data.draft.rarity.standard[r])}</td>`).join("")}
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
          `<li data-rarity="${rarity}"><strong>${esc(RARITY_LABEL[rarity]!)}</strong>: ${mine.counts[rarity]} card${
            mine.counts[rarity] === 1 ? "" : "s"
          }${mine.short.includes(rarity) ? ` — fewer than the ${data.draft.offerSize} an offer needs` : ""}</li>`
      ).join("");
      return `
        <p class="muted" id="gauntlet-reality">
          ${esc(mine.leaderName)}'s legal pool, by rarity. Where it cannot fill an offer, the rest of that
          pick comes from the nearest rarity below.
        </p>
        <ul class="patch-list gauntlet-reality-list">${lines}</ul>`;
    }

    return `
      <p class="muted" id="gauntlet-reality">
        <strong>What the card pool can actually offer.</strong>
        ${
          shortEverywhere.length === 0
            ? "Every leader can fill an offer at every rarity."
            : `No leader in this build has ${data.draft.offerSize} ${shortEverywhere
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
                <td>${row.wins}</td>
                <td class="patch-after">${practice.clout}<span class="muted gauntlet-full"> / ${row.clout}</span></td>
                <td class="patch-after">${practice.signal}<span class="muted gauntlet-full"> / ${row.signal}</span></td>
                <td class="gauntlet-excluded">—<span class="muted gauntlet-full"> / ${row.packs || "—"}</span></td>
                <td class="gauntlet-excluded">—<span class="muted gauntlet-full"> / ${row.tickets || "—"}</span></td>
                <td class="muted">${esc(extra.join("; ")) || "—"}</td>
              </tr>`;
          })
          .join("")}
      </tbody>
    </table>
    </div>
    <p class="muted">
      The first figure in each column is what a <strong>Practice</strong> run pays; the second is §8.3's
      competitive row. Practice is ${percent(data.practice.scale)} of the table with packs excluded, which
      is §8.4's rule, and Tickets are withheld because a Ticket buys a competitive entry and competitive
      Gauntlet needs a server. Clout from Practice shares the same daily AI allowance every mode's
      per-match Clout spends against — ${aiDailyCap()} a day, of which
      <strong id="gauntlet-cap-left">${aiCloutRemaining(aiDailyCap())}</strong> is left.
    </p>`;

  const deferredList = (): string => `
    <section class="panel panel-chrome gauntlet-deferred">
      <h2 class="profile-section-title">What §8 asks for and this build does not have</h2>
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
      <section class="panel panel-chrome gauntlet-deck">
        <div class="stats-table-head">
          <h2 class="profile-section-title">Your deck</h2>
          <span class="muted" id="gauntlet-deck-count">${run.deck.length} / ${data.draft.picks}</span>
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
                  <div class="gauntlet-curve-count">${have}</div>
                  <div class="gauntlet-curve-bar" style="height:${Math.round((have / tallest) * 100)}%"></div>
                  <div class="gauntlet-curve-label">${bucket === 7 ? "7+" : bucket}</div>
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
                `<li data-card="${esc(card.id)}"><span class="gauntlet-deck-cost">${card.cost}</span>${esc(
                  card.name
                )}</li>`
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
      <section class="panel panel-chrome gauntlet-intro">
        <div class="t-label">Gauntlet Practice</div>
        <h2 class="title">Draft a deck one pick at a time.</h2>
        <p class="mastery-rule">
          Pick a leader from three, then build ${data.draft.picks} cards from ${data.draft.offerSize} offers at a
          time. Ride the deck until <strong>${data.run.winsToRetire} wins</strong> or
          <strong>${data.run.lossesToRetire} losses</strong>. It draws from the whole card pool, not your
          collection — a brand-new account is on exactly level ground here.
        </p>
        <p class="muted">
          ${
            save.runsStarted === 0
              ? `<span class="gauntlet-none">${icon("campfire", 15)} No runs yet — the first one starts free.</span>`
              : `${save.runsStarted} run${save.runsStarted === 1 ? "" : "s"} started · best ${save.bestWins} win${
                  save.bestWins === 1 ? "" : "s"
                } · ${save.lifetimeClout} Clout banked · ${save.cardBackProgress}/${
                  data.cardBack.progressRequired
                } card-back tokens`
          }
        </p>
        <div class="row center">
          <button class="btn btn-primary" id="gauntlet-start">Start a run</button>
        </div>
        <p class="muted">
          Free entry. Competitive Gauntlet costs ${data.entry.clout} Clout or one Gauntlet Ticket and needs a
          server; nothing is charged here.
        </p>
      </section>

      <section class="panel panel-chrome" id="gauntlet-rules">
        <h2 class="profile-section-title">How an offer is built</h2>
        <p class="muted">
          Every offered card is legal for your leader — its faction or Neutral, in one of its Currents.
          Prism may be offered until you have drafted ${content.balance.deck.prismSplashLimit}, the same
          splash limit constructed decks use, after which it stops appearing. Copies are
          <strong>not</strong> capped: this is the one constructed rule the mode waives, so you may draft
          the same card as often as it is offered.
        </p>
        ${rarityTable()}
        ${realityFor(null)}
      </section>

      <section class="panel panel-chrome">
        <h2 class="profile-section-title">What a run pays</h2>
        ${rewardTable()}
      </section>

      ${deferredList()}`;

    body.querySelector("#gauntlet-start")?.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      const run = startRun(content, (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0, Date.now());
      beginGauntlet(run);
      render();
    });
  }

  function renderLeaderPick(run: GauntletRun): void {
    chip.innerHTML = `<div class="currency"><span class="currency-icon">▤</span><span class="currency-value">Pick a leader</span></div>`;
    body.innerHTML = `
      <section class="panel panel-chrome gauntlet-phase">
        <div class="t-label">Step 1 of 2</div>
        <h2 class="title">Choose your leader</h2>
        <p class="muted">
          Three leaders, three factions. The one you take fixes the run's faction and both Currents, exactly
          as it would in constructed — everything you are offered afterwards is legal for it.
        </p>
        <div class="gauntlet-offer" id="gauntlet-leaders"></div>
      </section>
      <section class="panel panel-chrome"><h2 class="profile-section-title">How an offer is built</h2>${rarityTable()}${realityFor(
        null
      )}</section>`;

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
    chip.innerHTML = `
      <div class="currency" title="Which pick you are on">
        <span class="currency-icon">▤</span>
        <span class="currency-value" id="gauntlet-pick-count">${offer.pick} / ${data.draft.picks}</span>
      </div>`;

    const substituted =
      offer.substituted > 0
        ? `<span class="gauntlet-substituted"> — ${leaderName}'s pool has fewer than ${data.draft.offerSize}, so ${
            offer.substituted === 1 ? "one card comes" : `${offer.substituted} cards come`
          } from the rarity below</span>`
        : "";

    body.innerHTML = `
      <section class="panel panel-chrome gauntlet-phase">
        <div class="t-label">${esc(leaderName)} · pick ${offer.pick} of ${data.draft.picks}</div>
        <h2 class="title">${offer.spotlight ? "Spotlight Pick" : "Take one"}</h2>
        <p class="muted" id="gauntlet-rarity">
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
    chip.innerHTML = `<div class="currency"><span class="currency-icon">▤</span><span class="currency-value">Deck ready</span></div>`;
    body.innerHTML = `
      <section class="panel panel-chrome gauntlet-phase">
        <div class="t-label">${esc(content.leaders[run.leaderCardId!]?.name ?? "")}</div>
        <h2 class="title">${data.draft.picks} cards, drafted.</h2>
        <p class="muted">
          Once the first match starts the deck is locked for the run. You get one free full re-draft before
          then — it throws this deck away and takes you back to pick one.
        </p>
        <div class="row center">
          <button class="btn btn-primary" id="gauntlet-begin">Start the run</button>
          <button class="btn btn-ghost" id="gauntlet-redraft"${canRedraft ? "" : " disabled"}>
            ${canRedraft ? "Delete and Repost" : "Re-draft already used"}
          </button>
        </div>
      </section>
      ${deckPanel(run)}
      <section class="panel panel-chrome"><h2 class="profile-section-title">What a run pays</h2>${rewardTable()}</section>`;

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

    chip.innerHTML = `
      <div class="currency" id="gauntlet-record" title="Wins and losses">
        <span class="currency-icon">▤</span>
        <span class="currency-value">${run.wins}–${run.losses}</span>
      </div>`;

    body.innerHTML = `
      <section class="panel panel-chrome gauntlet-phase">
        <div class="t-label">${esc(content.leaders[run.leaderCardId!]?.name ?? "")}</div>
        <h2 class="title">${run.wins} win${run.wins === 1 ? "" : "s"}, ${run.losses} loss${
          run.losses === 1 ? "" : "es"
        }</h2>
        <div class="gauntlet-pips" id="gauntlet-pips">
          <span class="muted">Wins</span>${pips(run.wins, data.run.winsToRetire, "win")}
          <span class="muted">Losses</span>${pips(run.losses, data.run.lossesToRetire, "loss")}
        </div>
        <p class="muted" id="gauntlet-next">
          Next: <strong>${esc(enemy?.name ?? fight.enemyLeaderCardId)}</strong> on
          ${esc(AI_DIFFICULTY_LABEL[fight.difficulty])}. The opponent drafts a deck too, through the same
          offers you saw${run.pending ? " — and this is the fight you left, dealt again from the same seed" : ""}.
        </p>
        <div class="row center">
          <button class="btn btn-primary" id="gauntlet-fight">Play the next match</button>
          <button class="btn btn-ghost" id="gauntlet-retire">Retire for ${reward.clout} Clout${
            reward.signal > 0 ? ` + ${reward.signal} Signal` : ""
          }</button>
        </div>
        ${
          run.fightsEntered > run.wins + run.losses
            ? `<p class="muted" id="gauntlet-reentry">You left a match without finishing it. It comes back exactly as it was — same opponent, same deck, same opening.</p>`
            : ""
        }
      </section>
      ${deckPanel(run)}
      <section class="panel panel-chrome"><h2 class="profile-section-title">What a run pays</h2>${rewardTable()}</section>`;

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
      <section class="panel panel-chrome gauntlet-phase" id="gauntlet-summary">
        <div class="t-label">${run.retiredEarly ? "Retired" : run.wins >= data.run.winsToRetire ? "Perfect run" : "Run over"}</div>
        <h2 class="title">${run.wins}–${run.losses}</h2>
        <div class="gauntlet-summary-grid">
          <div><span class="gauntlet-summary-value" id="gauntlet-paid-clout">${payout.clout}</span><span class="muted">Clout</span></div>
          <div><span class="gauntlet-summary-value">${payout.signal}</span><span class="muted">Signal</span></div>
          <div><span class="gauntlet-summary-value">${run.fightsEntered}</span><span class="muted">matches entered</span></div>
        </div>
        ${
          payout.cloutCapped > 0
            ? `<p class="muted" id="gauntlet-capped">${payout.cloutCapped} Clout is held back by today's ${aiDailyCap()}-Clout AI allowance. It is not lost from the table — the table paid it; the day's cap did not have room. The allowance resets tomorrow.</p>`
            : ""
        }
        ${
          payout.cardBackProgress > 0
            ? `<p class="muted" id="gauntlet-token">+${payout.cardBackProgress} card-back token (${
                gauntletStore.get().cardBackProgress + payout.cardBackProgress
              }/${data.cardBack.progressRequired}).</p>`
            : ""
        }
        ${
          payout.cosmetics.length > 0
            ? `<p class="muted" id="gauntlet-cosmetics">Unlocked: ${esc(payout.cosmetics.join(", "))}.</p>`
            : ""
        }
        <div class="row center">
          <button class="btn btn-primary" id="gauntlet-collect">Collect</button>
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
    if (!run) {
      renderHub();
      return;
    }
    // a run that finished while the board was open lands on the payout
    if (run.phase === "done" || isOver(run)) {
      renderDone(run);
      return;
    }
    if (run.phase === "leader") renderLeaderPick(run);
    else if (run.phase === "draft") renderDraft(run);
    else if (run.phase === "ready") renderReady(run);
    else renderRun(run);
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
