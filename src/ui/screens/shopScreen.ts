/**
 * The Merch Drop counter.
 *
 * Two jobs, and the first one matters more than the second: **print what is
 * being sold, in full, before anything is bought.** The economy doc makes the
 * pull rates, the Rare floor, the Legendary pity and the duplicate rule binding
 * and requires all of them on the purchase panel itself — so they are rendered
 * from `balance.economy.pack`, the same object the algorithm rolls from. A
 * number cannot be advertised here and be different in the roll.
 *
 * The second job is the reveal, which is the only place in the game where the
 * card renderer is the whole screen. Cards turn one at a time and a duplicate
 * past the playable cap says what it became instead, itemised, because "you
 * already have this" is exactly the moment a player is owed an explanation.
 */

import type { CardDef, ContentIndex, Rarity } from "../../engine/types";
import type { Screen } from "../shell";
import type { DropResult } from "../../game/economy/drops";
import { publishedOdds } from "../../game/economy/drops";
import { canAffordDrop, currentBanner, getProfile, openMerchDrop, profileStore } from "../../save/profile";
import { renderCardToCanvas } from "../cardRenderer/renderCard";
import { CURRENT_PALETTE } from "../cardRenderer/palette";
import { audio } from "../../audio/audio";
import { getSettings } from "../../save/settings";

export interface ShopCallbacks {
  onBack: () => void;
  onOpenCollection: () => void;
  onOpenBanner: () => void;
  /** policy F1 names the disclosures page; the shop's own table links to it */
  onOpenFairness: () => void;
}

const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const RARITY_LABEL: Record<Rarity, string> = {
  common: "Common",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
};

export function createShopScreen(content: ContentIndex, callbacks: ShopCallbacks): Screen {
  const root = document.createElement("div");
  root.className = "screen shop-screen";

  const pack = content.balance.economy.pack;
  const economy = content.balance.economy;
  let revealing: DropResult | null = null;
  let revealed = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const render = (): void => {
    const profile = getProfile();
    const headliner = currentBanner(content);
    const affordable = canAffordDrop(content);
    const toPity = Math.max(0, pack.legendaryPity - profile.drops.sinceLegendary);

    root.innerHTML = `
      <div class="ambient-bg"></div>
      <header class="screen-header">
        <button class="btn btn-ghost" id="shop-back">← Back</button>
        <h1 class="title">Merch Drops</h1>
        <div class="shop-wallet">
          <div class="currency" title="Clout — earned by playing">
            <span class="currency-icon clout">◈</span><span class="currency-value" id="shop-clout">${profile.clout.toLocaleString()}</span>
          </div>
          <div class="currency" title="Signal — craft any card">
            <span class="currency-icon shards">✦</span><span class="currency-value" id="shop-signal">${profile.shards.toLocaleString()}</span>
          </div>
        </div>
      </header>

      <main class="shop-body">
        ${
          headliner
            ? `<section class="panel panel-chrome shop-headliner">
                 <div class="eyebrow">Headliner${headliner.live ? "" : " — between runs"}</div>
                 <h2 class="shop-offer-title">${esc(headliner.banner.name)}</h2>
                 <p class="muted shop-offer-note">${esc(headliner.banner.blurb)}</p>
                 <p class="muted shop-short">
                   Rate-up on ${esc(content.cards[headliner.banner.featuredLegendary]?.name ?? "a Legendary")} and two
                   Epics. Every card on it is already in Drops and crafting — a banner concentrates
                   odds, it never gates.
                 </p>
                 <button class="btn btn-primary" id="shop-banner">Open the banner →</button>
               </section>`
            : ""
        }
        <section class="panel panel-chrome shop-offer">
          <div class="eyebrow">Standard Drop</div>
          <h2 class="shop-offer-title">${economy.packSize} cards</h2>
          <p class="muted shop-offer-note">
            Bought with Clout, which is earned by playing. Never with money.
          </p>
          <button class="btn btn-primary shop-buy" id="shop-buy" ${affordable ? "" : "disabled"}>
            ${
              profile.pendingDrops > 0
                ? `Open a free Drop — ${profile.pendingDrops} left`
                : `<span class="currency-icon clout">◈</span> ${pack.price} — Open a Drop`
            }
          </button>
          ${affordable ? "" : `<p class="muted shop-short">You need ${(pack.price - profile.clout).toLocaleString()} more Clout. Play a match.</p>`}
          ${profile.pendingDrops > 0 ? `<p class="muted shop-short">Free Drops from your starter deck. They cost nothing.</p>` : ""}
          <div class="shop-counter">
            <div class="shop-counter-label">Legendary guaranteed within</div>
            <div class="shop-counter-value" id="shop-pity">${toPity} Drop${toPity === 1 ? "" : "s"}</div>
            <div class="shop-counter-bar"><span style="width:${(profile.drops.sinceLegendary / pack.legendaryPity) * 100}%"></span></div>
          </div>
          <div class="muted shop-opened">${profile.drops.opened.toLocaleString()} opened</div>
        </section>

        <section class="panel shop-odds">
          <div class="eyebrow">What is in a Drop</div>
          <table class="odds-table">
            <thead><tr><th>Rarity</th><th>Chance per card</th></tr></thead>
            <tbody>
              ${publishedOdds(content)
                .map(
                  (row) =>
                    `<tr><td><span class="rarity-dot ${row.rarity}"></span>${RARITY_LABEL[row.rarity]}</td><td>${row.percent}</td></tr>`
                )
                .join("")}
            </tbody>
          </table>
          <ul class="odds-rules">
            <li>At least <strong>1 Rare or better</strong> in every Drop.</li>
            <li>A <strong>Legendary within every ${pack.legendaryPity} Drops</strong>. The counter is above and it is yours, not a rolling average.</li>
            <li>No card appears <strong>twice in the same Drop</strong>.</li>
            <li>You will never open a card you already have the maximum of
                <strong>while any card of that rarity is still missing</strong>.</li>
            <li>Once a rarity is complete, further copies convert to Signal at
                <strong>${Math.round((economy.dupeConversionBonus - 1) * 100)}% above</strong> the normal dismantle value.</li>
          </ul>
          <button class="btn btn-ghost" id="shop-fairness">Full probability disclosures →</button>
        </section>
      </main>

      <div class="shop-reveal" id="shop-reveal" hidden></div>
    `;

    root.querySelector("#shop-banner")?.addEventListener("click", () => callbacks.onOpenBanner());
    root.querySelector("#shop-fairness")?.addEventListener("click", () => callbacks.onOpenFairness());
    root.querySelector("#shop-back")?.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      callbacks.onBack();
    });
    root.querySelector("#shop-buy")?.addEventListener("click", buy);
  };

  const buy = (): void => {
    const result = openMerchDrop(content);
    if (!result) return;
    /**
     * The drop itself, not a button click. This is the one moment in the game
     * that is purely a reward, and it was silent.
     */
    audio.play("sfx.pack.open");
    audio.playMusic("music.packOpening");
    revealing = result;
    revealed = 0;
    render();
    showReveal();
  };

  /** Turn the cards one at a time; a click turns the rest at once. */
  const showReveal = (): void => {
    const overlay = root.querySelector<HTMLElement>("#shop-reveal");
    if (!overlay || !revealing) return;
    const drop = revealing;

    const paint = (): void => {
      overlay.hidden = false;
      overlay.innerHTML = `
        <div class="reveal-panel panel panel-chrome">
          <div class="eyebrow"><span class="ui-icon ui-icon-merch-drop-open" aria-hidden="true">◈</span> Drop opened</div>
          <div class="reveal-cards">
            ${drop.cards
              .map((entry, index) => {
                const card = content.cards[entry.cardId];
                if (!card) return "";
                const palette = CURRENT_PALETTE[card.current];
                const shown = index < revealed;
                return `
                  <div class="reveal-slot ${shown ? "shown" : ""} ${entry.rarity}" data-index="${index}" style="--c:${palette.key}">
                    <div class="reveal-inner">
                      <div class="reveal-back"></div>
                      <div class="reveal-front" data-card="${esc(entry.cardId)}"></div>
                    </div>
                    <div class="reveal-tag">
                      ${
                        entry.convertedToSignal !== undefined
                          ? `<span class="reveal-converted">Converted · +${entry.convertedToSignal} Signal</span>`
                          : entry.isNew
                            ? `<span class="reveal-new">NEW</span>`
                            : `<span class="reveal-dupe">Second copy</span>`
                      }
                    </div>
                  </div>`;
              })
              .join("")}
          </div>
          ${drop.signal > 0 ? `<div class="reveal-signal">+${drop.signal} Signal from cards you already had</div>` : ""}
          <div class="reveal-actions">
            <button class="btn btn-ghost" id="reveal-collection">Open collection</button>
            <button class="btn btn-primary" id="reveal-done" ${revealed < drop.cards.length ? "disabled" : ""}>Done</button>
          </div>
        </div>`;

      // paint the faces that have turned
      for (const slot of overlay.querySelectorAll<HTMLElement>(".reveal-slot.shown .reveal-front")) {
        const cardId = slot.dataset["card"];
        const card = cardId ? content.cards[cardId] : undefined;
        if (!card || slot.childElementCount > 0) continue;
        slot.appendChild(renderCardToCanvas(card as CardDef, 150, { premium: card.rarity === "legendary" }));
      }

      overlay.querySelector("#reveal-done")?.addEventListener("click", close);
      overlay.querySelector("#reveal-collection")?.addEventListener("click", () => {
        close();
        callbacks.onOpenCollection();
      });
      overlay.addEventListener("click", (event) => {
        if ((event.target as HTMLElement).closest(".reveal-actions")) return;
        // a click turns everything still face down
        if (revealed < drop.cards.length) {
          revealed = drop.cards.length;
          paint();
        }
      });
    };

    const step = (): void => {
      revealed += 1;
      /**
       * Sounded per card as it turns, and only for the ones worth sounding.
       * A chime on every common would make the rare reveal mean nothing, which
       * is the opposite of what the sound is for.
       */
      const turned = drop.cards[revealed - 1];
      if (turned && (turned.rarity === "epic" || turned.rarity === "legendary")) {
        audio.play("sfx.pack.rareReveal");
      }
      paint();
      if (revealed < drop.cards.length) timer = setTimeout(step, getSettings().reducedMotion ? 0 : 260);
    };
    paint();
    timer = setTimeout(step, getSettings().reducedMotion ? 0 : 200);
  };

  const close = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    revealing = null;
    revealed = 0;
    // Back to the shop's own soundscape; the opening theme belongs to the
    // reveal and would otherwise keep playing over the store.
    audio.playMusic("music.menu");
    render();
  };

  render();
  const unsubscribe = profileStore.subscribe(() => {
    // keep the wallet honest while a reveal is open, without repainting it
    const clout = root.querySelector("#shop-clout");
    const signal = root.querySelector("#shop-signal");
    if (clout) clout.textContent = getProfile().clout.toLocaleString();
    if (signal) signal.textContent = getProfile().shards.toLocaleString();
  });

  /** Automation hook, the same shape the story and Doomscroll screens expose. */
  (window as unknown as { hypeboundShop?: unknown }).hypeboundShop = {
    price: () => pack.price,
    lastDrop: () => revealing,
    profile: () => getProfile().drops,
    buy,
  };

  return {
    root,
    dispose: () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
      delete (window as unknown as { hypeboundShop?: unknown }).hypeboundShop;
    },
  };
}
