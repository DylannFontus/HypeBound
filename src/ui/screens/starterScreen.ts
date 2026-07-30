/**
 * Pick a faction, get its deck.
 *
 * The first screen a new account sees, and the reason it exists is worth stating:
 * accounts used to be created holding **every card in the game**. That made the
 * collection meaningless to grow and Merch Drops incapable of granting anything,
 * so the economy model's own answer applies instead — one faction's 30-card
 * starter deck now, the rest earned (`07-economy-and-monetization.md` §3.4).
 *
 * The choice is presented as a choice, not a formality: each faction shows its
 * Leader, its Currents and what the deck actually plays like, because picking
 * one and finding out later that it is the control deck is a bad first hour.
 */

import type { ContentIndex, FactionId } from "../../engine/types";
import type { Screen } from "../shell";
import { starterDecks } from "../../game/progression/data";
import { grantStarterDeck, STARTER_DROPS } from "../../save/profile";
import { CURRENT_PALETTE } from "../cardRenderer/palette";
import { renderCardToCanvas } from "../cardRenderer/renderCard";
import { audio } from "../../audio/audio";

export interface StarterCallbacks {
  onChosen: () => void;
}

const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function createStarterScreen(content: ContentIndex, callbacks: StarterCallbacks): Screen {
  const root = document.createElement("div");
  root.className = "screen starter-screen";

  const decks = starterDecks().filter((deck) => content.factions[deck.factionId]);
  let selected: FactionId | null = decks[0]?.factionId ?? null;

  const render = (): void => {
    const chosen = decks.find((deck) => deck.factionId === selected);
    const leader = chosen ? content.leaders[chosen.leaderCardId] : undefined;
    const palette = leader ? CURRENT_PALETTE[leader.primaryCurrent] : CURRENT_PALETTE.prism;
    const faction = chosen ? content.factions[chosen.factionId] : undefined;

    root.innerHTML = `
      <div class="ambient-bg"></div>
      <header class="starter-head">
        <div class="eyebrow">Welcome</div>
        <h1 class="title">Pick the deck you start with</h1>
        <p class="muted starter-sub">
          A complete 30-card deck and its Leader, free and yours to keep, plus
          ${STARTER_DROPS} Merch Drops. You can unlock the other nine by playing them.
        </p>
      </header>

      <main class="starter-body">
        <ul class="starter-list" role="listbox" aria-label="Starter decks">
          ${decks
            .map((deck) => {
              const deckLeader = content.leaders[deck.leaderCardId];
              const deckFaction = content.factions[deck.factionId];
              const dot = deckLeader ? CURRENT_PALETTE[deckLeader.primaryCurrent].key : "#888";
              return `
                <li>
                  <button class="starter-option ${deck.factionId === selected ? "selected" : ""}"
                          data-faction="${esc(deck.factionId)}" role="option"
                          aria-selected="${deck.factionId === selected}">
                    <span class="starter-dot" style="--c:${dot}"></span>
                    <span class="starter-option-text">
                      <span class="starter-option-name">${esc(deckFaction?.name ?? deck.factionId)}</span>
                      <span class="starter-option-leader muted">${esc(deckLeader?.name ?? "")}</span>
                    </span>
                  </button>
                </li>`;
            })
            .join("")}
        </ul>

        <section class="panel panel-chrome starter-detail" style="--c:${palette.key}">
          <div class="eyebrow" style="color:${palette.key}">${esc(faction?.name ?? "")}</div>
          <h2 class="starter-leader-name">${esc(leader?.name ?? "")}</h2>
          <div class="starter-leader-title muted">${esc(leader?.title ?? "")}</div>
          <div class="starter-leader-card" id="starter-card"></div>
          <p class="starter-identity">${esc(faction?.tagline ?? "")}</p>
          <div class="starter-actions">
            <button class="btn btn-primary btn-lg" id="starter-confirm">
              Start with ${esc(faction?.name ?? "this deck")}
            </button>
          </div>
        </section>
      </main>
    `;

    const holder = root.querySelector<HTMLElement>("#starter-card");
    if (holder && leader) holder.appendChild(renderCardToCanvas(leader, 210, { premium: true }));

    for (const button of root.querySelectorAll<HTMLElement>(".starter-option")) {
      button.addEventListener("click", () => {
        selected = (button.dataset["faction"] ?? null) as FactionId | null;
        audio.play("sfx.ui.hover");
        render();
      });
    }
    root.querySelector("#starter-confirm")?.addEventListener("click", () => {
      if (!selected) return;
      audio.play("sfx.ui.click");
      grantStarterDeck(content, selected);
      callbacks.onChosen();
    });
  };

  render();

  /** Automation hook, the same shape the other screens expose. */
  (window as unknown as { hypeboundStarter?: unknown }).hypeboundStarter = {
    options: () => decks.map((deck) => deck.factionId),
    choose: (factionId: FactionId) => {
      grantStarterDeck(content, factionId);
      callbacks.onChosen();
    },
  };

  return {
    root,
    dispose: () => {
      delete (window as unknown as { hypeboundStarter?: unknown }).hypeboundStarter;
    },
  };
}
