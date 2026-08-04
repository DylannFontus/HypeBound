/**
 * The Grand Tour.
 *
 * Ten stops, one per faction, and the rule is one sentence long: **win a match
 * with a faction's loaner deck and the deck is yours** (`07-economy-and-
 * monetization.md` §3.4). This is the screen that makes the starter picker's
 * closing promise — *"you can unlock the other nine by playing them"* — into
 * something a player can actually do.
 *
 * Two things it deliberately shows rather than hides.
 *
 * **The locked stops are drawn in full**, leader and all, exactly like the
 * unlocked ones. A tour is a list of places you have not been yet; greying the
 * name out would leave the player choosing between ten blanks. It is the same
 * reasoning as the Archive's empty slots and the story screen's locked Side
 * Cuts — being able to see the road you have not taken is most of the value.
 *
 * **The completion reward is printed before the first match**, from
 * `balance.economy.grandTour` — the same object that pays it. A screen promising
 * 1,000 Clout while the grant hands over 500 is the failure mode this project
 * has already fixed once, on the shop panel's odds.
 */

import type { AiDifficulty, ContentIndex, FactionId } from "../../engine/types";
import type { Screen } from "../shell";
import { AI_DIFFICULTY_BLURB, AI_DIFFICULTY_LABEL, AI_DIFFICULTY_ORDER } from "../../ai/profiles";
import { claimGrandTourReward, getProfile, tourView } from "../../save/profile";
import { legendaryChoices, loanerDeckFor, tourProgress } from "../../game/progression/grandTour";
import { renderCardToCanvas } from "../cardRenderer/renderCard";
import { CURRENT_PALETTE } from "../cardRenderer/palette";
import { audio } from "../../audio/audio";
import { enter, icon } from "./data/kit";

export interface GrandTourCallbacks {
  onBack: () => void;
  onPlayLoaner: (factionId: FactionId, difficulty: AiDifficulty) => void;
  onOpenCollection: () => void;
  onOpenShop: () => void;
}

/**
 * The opponent tier a loaner match opens on.
 *
 * §3.4 says only *"win 1 match (AI Practice counts)"* — no difficulty floor,
 * where §3.5 states one explicitly for the daily win. The absence is read as
 * meaning what it says, so every tier counts; Casual is merely where the panel
 * opens, because the tour exists to introduce a faction rather than to test one.
 */
const DEFAULT_TIER: AiDifficulty = "casual";

const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function createGrandTourScreen(content: ContentIndex, callbacks: GrandTourCallbacks): Screen {
  const root = document.createElement("div");
  root.className = "screen tour-screen";

  /** The Legendary highlighted in the completion picker. */
  let chosenLegendary: string | null = null;

  const start = (factionId: FactionId, difficulty: AiDifficulty): void => {
    audio.play("sfx.ui.click");
    callbacks.onPlayLoaner(factionId, difficulty);
  };

  const render = (): void => {
    const progress = tourProgress(content, tourView());
    const owned = getProfile().collection;
    const choices = legendaryChoices(content, owned);
    const anyChoosable = choices.some((choice) => !choice.owned);

    root.innerHTML = `
      <div class="ambient-bg"></div>
      <header class="screen-header">
        <button class="btn btn-ghost" id="tour-back">${icon("arrow-left", 16)} Back</button>
        <h1 class="title">The Grand Tour</h1>
        <div class="tour-count" id="tour-count">${progress.unlocked} of ${progress.total} unlocked</div>
      </header>

      <main class="tour-body data-body">
        <section class="panel panel-chrome tour-intro">
          <p class="tour-rule">
            Win one match with a faction's <strong>loaner deck</strong> and that deck is
            yours to keep — all thirty cards and its Leader, permanently.
          </p>
          <div class="tour-bar"><span style="width:${progress.total ? (progress.unlocked / progress.total) * 100 : 0}%"></span></div>
          <p class="muted tour-prize">
            Finish all ${progress.total} for
            <strong>${progress.reward.clout.toLocaleString()} Clout</strong>,
            <strong>${progress.reward.drops} Merch Drops</strong> and
            <strong>${progress.reward.legendaryChoices} Legendary of your choice</strong>.
          </p>
        </section>

        ${progress.rewardReady ? rewardPanel(progress.reward, choices, anyChoosable) : ""}

        <ul class="tour-list" id="tour-list">
          ${progress.stops
            .map((stop) => {
              const leader = content.leaders[stop.leaderCardId];
              const palette = leader ? CURRENT_PALETTE[leader.primaryCurrent] : CURRENT_PALETTE.prism;
              /*
               * Three states, three marks. The old middle case printed a bare
               * "✓ " glyph — a Unicode tick standing in for an icon, which is
               * what §C exists to delete — and the locked case was the sentence
               * "Not yet won" in grey with nothing to say it was a state rather
               * than a caption.
               */
              const state = stop.isStarter
                ? { mark: icon("star-filled", 13), text: "Your starting deck", tone: "is-starter" }
                : stop.unlocked
                  ? { mark: icon("check", 13), text: "Unlocked — deck in your collection", tone: "is-won" }
                  : { mark: icon("crosshair", 13), text: "Not yet won", tone: "is-locked" };
              return `
                <li class="tour-stop ${stop.unlocked ? "won" : "locked"}" style="--c:${palette.key}">
                  <div class="tour-stop-card" data-leader="${esc(stop.leaderCardId)}"></div>
                  <div class="tour-stop-text">
                    <div class="tour-stop-faction">${esc(stop.factionName)}</div>
                    <div class="tour-stop-leader muted">${esc(leader?.name ?? stop.leaderCardId)}</div>
                    <div class="tour-stop-state tour-none ${state.tone}">${state.mark}<span>${esc(
                      state.text
                    )}</span></div>
                  </div>
                  ${
                    stop.unlocked
                      ? `<div class="tour-stop-deck muted">${esc(stop.deckName)}</div>`
                      : `<button class="btn btn-primary tour-play" data-faction="${esc(stop.factionId)}">Play the loaner</button>`
                  }
                </li>`;
            })
            .join("")}
        </ul>
      </main>

      <div class="difficulty-backdrop" id="tour-difficulty" hidden>
        <div class="difficulty-panel panel panel-chrome">
          <div class="t-label" id="tour-difficulty-eyebrow"></div>
          <h2 class="title">Pick an opponent</h2>
          <p class="muted" id="tour-difficulty-note"></p>
          <div class="difficulty-list" id="tour-difficulty-list"></div>
          <button class="btn btn-ghost" id="tour-difficulty-cancel">Cancel</button>
        </div>
      </div>`;

    // leader portraits, including the ones not yet won
    for (const holder of root.querySelectorAll<HTMLElement>(".tour-stop-card")) {
      const leader = content.leaders[holder.dataset["leader"] ?? ""];
      if (leader) holder.appendChild(renderCardToCanvas(leader, 132, { premium: true }));
    }
    for (const holder of root.querySelectorAll<HTMLElement>(".tour-prize-card")) {
      const card = content.cards[holder.dataset["card"] ?? ""];
      if (card) holder.appendChild(renderCardToCanvas(card, 120, { premium: true }));
    }

    root.querySelector("#tour-back")?.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      callbacks.onBack();
    });

    for (const button of root.querySelectorAll<HTMLElement>(".tour-play")) {
      button.addEventListener("click", () => {
        const factionId = button.dataset["faction"] as FactionId | undefined;
        if (factionId) openDifficulty(factionId);
      });
    }

    /**
     * The panel's dismiss handlers are bound here, once per render, rather than
     * inside `openDifficulty` — which can run several times against the same
     * element and would stack a duplicate listener on every re-open.
     */
    const panel = root.querySelector<HTMLElement>("#tour-difficulty");
    const closePanel = (): void => panel?.setAttribute("hidden", "");
    root.querySelector("#tour-difficulty-cancel")?.addEventListener("click", closePanel);
    panel?.addEventListener("click", (event) => {
      if (event.target === panel) closePanel();
    });

    // ---- the completion reward ---------------------------------------------
    for (const option of root.querySelectorAll<HTMLElement>(".tour-prize-option")) {
      option.addEventListener("click", () => {
        if (option.dataset["owned"] === "true") return;
        chosenLegendary = option.dataset["card"] ?? null;
        audio.play("sfx.ui.hover");
        render();
      });
    }
    root.querySelector("#tour-claim")?.addEventListener("click", () => {
      const reward = claimGrandTourReward(content, anyChoosable && chosenLegendary ? [chosenLegendary] : []);
      if (!reward) return;
      audio.play("sfx.ui.click");
      chosenLegendary = null;
      render();
    });
  };

  /** The reward panel, shown only once every stop is done and nothing is paid. */
  const rewardPanel = (
    reward: { clout: number; drops: number; legendaryChoices: number },
    choices: ReturnType<typeof legendaryChoices>,
    anyChoosable: boolean
  ): string => `
    <section class="panel panel-chrome tour-reward">
      <div class="t-label">Tour complete</div>
      <h2 class="title">All ten, played and won</h2>
      <p class="tour-reward-line">
        <strong>${reward.clout.toLocaleString()} Clout</strong> ·
        <strong>${reward.drops} Merch Drops</strong> ·
        ${
          anyChoosable
            ? `<strong>${reward.legendaryChoices} Legendary</strong>, and you pick which`
            : `<strong>Signal</strong> instead of a Legendary — you already own every one`
        }
      </p>
      ${
        anyChoosable
          ? `<div class="tour-prize-grid">
              ${choices
                .map(
                  (choice) => `
                    <button class="tour-prize-option ${chosenLegendary === choice.card.id ? "chosen" : ""} ${choice.owned ? "owned" : ""}"
                            data-card="${esc(choice.card.id)}" data-owned="${choice.owned}"
                            ${choice.owned ? "disabled" : ""}
                            title="${esc(choice.owned ? `${choice.card.name} — already in your collection` : choice.card.name)}">
                      <span class="tour-prize-card" data-card="${esc(choice.card.id)}"></span>
                      <span class="tour-prize-name">${esc(choice.card.name)}</span>
                      ${choice.owned ? `<span class="tour-prize-owned">Owned</span>` : ""}
                    </button>`
                )
                .join("")}
            </div>`
          : ""
      }
      <button class="btn btn-primary btn-lg" id="tour-claim" ${anyChoosable && !chosenLegendary ? "disabled" : ""}>
        ${anyChoosable && !chosenLegendary ? "Choose a Legendary" : "Claim"}
      </button>
    </section>`;

  const openDifficulty = (factionId: FactionId): void => {
    const panel = root.querySelector<HTMLElement>("#tour-difficulty");
    const list = root.querySelector("#tour-difficulty-list");
    const eyebrow = root.querySelector("#tour-difficulty-eyebrow");
    const note = root.querySelector("#tour-difficulty-note");
    const loaner = loanerDeckFor(content, factionId);
    if (!panel || !list) return;

    if (eyebrow) eyebrow.textContent = loaner?.name ?? content.factions[factionId]?.name ?? factionId;
    if (note) note.textContent = "Any tier counts. You are playing the deck you are playing for.";

    list.innerHTML = "";
    for (const difficulty of AI_DIFFICULTY_ORDER) {
      const tier = difficulty as AiDifficulty;
      const button = document.createElement("button");
      button.className = `btn difficulty-option${tier === DEFAULT_TIER ? " suggested" : ""}`;
      button.innerHTML = `
        <span class="difficulty-name">${AI_DIFFICULTY_LABEL[tier]}</span>
        <span class="difficulty-blurb muted">${AI_DIFFICULTY_BLURB[tier]}</span>`;
      button.addEventListener("click", () => start(factionId, tier));
      list.appendChild(button);
    }

    panel.removeAttribute("hidden");
  };

  render();

  /** Automation hook, the same shape the shop and starter screens expose. */
  (window as unknown as { hypeboundTour?: unknown }).hypeboundTour = {
    progress: () => tourProgress(content, tourView()),
    /** the deck a stop would lend, without playing it */
    loaner: (factionId: FactionId) => loanerDeckFor(content, factionId),
    play: (factionId: FactionId, difficulty: AiDifficulty = DEFAULT_TIER) => start(factionId, difficulty),
    choices: () => legendaryChoices(content, getProfile().collection).map((c) => ({ id: c.card.id, owned: c.owned })),
    claim: (legendaryCardId: string | null) => {
      const reward = claimGrandTourReward(content, legendaryCardId ? [legendaryCardId] : []);
      render();
      return reward;
    },
  };

  return {
    root,
    dispose: () => {
      delete (window as unknown as { hypeboundTour?: unknown }).hypeboundTour;
    },
  };
}
