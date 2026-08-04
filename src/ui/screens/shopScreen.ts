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
 * The second job is **the reward moment**, and it is why this file was rewritten.
 *
 * ## What it used to be
 *
 * A 180ms opacity cross-fade of five 150px thumbnails inside a small dialog
 * floating in a dimmed void, over in about 1.2 seconds, with no player input at
 * any point. `paint()` rewrote the overlay's `innerHTML` on each of the five
 * steps — fifteen card renders for a five-card pack — which also meant no card
 * could animate, because every already-revealed card's DOM was destroyed and
 * recreated every 260ms. The rarity glow was on the *face-down* card and was
 * removed at the moment of the turn, so the game spoiled the Legendary before
 * you flipped it and then gave the revealed Legendary nothing.
 *
 * All of that now lives in `rewards/packOpening.ts`, as an actual set-piece with
 * a pack you tear. This file's part of the bargain is to hand it the roll and
 * get out of the way.
 *
 * ## And why the right-hand column is a pack rather than a paragraph
 *
 * The screen used to end at 44% of the viewport height with 55% of the right
 * half bare, because a two-column grid with `align-content: start` and nothing
 * tall in it does exactly that. Hearthstone's shop fills the frame with pack art
 * at scale. There is no pack art and there is not going to be any, but there is
 * a card back — a real, rendered, seasonal object — and a drop is five of those.
 * So the hero of this screen is the thing you are buying, at size, lit, floating,
 * with the price under it.
 */

import type { ContentIndex, FactionId, Rarity } from "../../engine/types";
import type { Screen } from "../shell";
import type { DropResult } from "../../game/economy/drops";
import { publishedOdds } from "../../game/economy/drops";
import { canAffordDrop, currentBanner, getProfile, openMerchDrop, profileStore } from "../../save/profile";
import { audio } from "../../audio/audio";
import { icon } from "../art/uiIcons";
import { FACTION_COLOR } from "../cardRenderer/palette";
import { num as formatNumber, plural } from "../format";
import {
  HOUSE_BACK,
  backButton,
  cardBackThumb,
  coinChip,
  coinInline,
  esc,
  railHtml,
  syncWallets,
  WASH,
} from "./rewards/rewardKit";
import { installRewardsTheme } from "./rewards/rewardsTheme";
import { openPack } from "./rewards/packOpening";

export interface ShopCallbacks {
  onBack: () => void;
  onOpenCollection: () => void;
  onOpenBanner: () => void;
  /** policy F1 names the disclosures page; the shop's own table links to it */
  onOpenFairness: () => void;
}

const RARITY_LABEL: Record<Rarity, string> = {
  common: "Common",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
};

export function createShopScreen(content: ContentIndex, callbacks: ShopCallbacks): Screen {
  installRewardsTheme();

  const root = document.createElement("div");
  root.className = "screen shop-screen";

  const pack = content.balance.economy.pack;
  const economy = content.balance.economy;
  /** the roll currently on screen, kept for the automation hook */
  let lastDrop: DropResult | null = null;
  let opening: { close: () => void } | null = null;

  const render = (): void => {
    const profile = getProfile();
    const headliner = currentBanner(content);
    const affordable = canAffordDrop(content);
    const toPity = Math.max(0, pack.legendaryPity - profile.drops.sinceLegendary);
    const free = profile.pendingDrops > 0;

    root.innerHTML = `
      ${WASH}
      <header class="screen-header">
        ${backButton("shop-back")}
        <h1 class="title">Merch Drops</h1>
        <div class="rw-wallet">
          ${coinChip("clout", profile.clout)}
          ${coinChip("shards", profile.shards)}
        </div>
      </header>

      <main class="shop-body rw-shop-body">
        <div class="rw-shop-left">
          ${
            headliner
              ? `<section class="mat-panel rw-panel-pad rw-stack" style="--rw-accent:${esc(FACTION_COLOR[headliner.banner.factionId as FactionId] ?? "#b56cff")}">
                   <div class="rw-spread">
                     <span class="t-label">Headliner${headliner.live ? "" : " — between runs"}</span>
                     ${icon("star-filled", { size: 16 })}
                   </div>
                   <h2 class="t-heading" style="margin:0">${esc(headliner.banner.name)}</h2>
                   <p class="rw-note">${esc(headliner.banner.blurb)}</p>
                   <p class="rw-note rw-quiet">
                     Rate-up on ${esc(content.cards[headliner.banner.featuredLegendary]?.name ?? "a Legendary")} and two
                     Epics. Every card on it is already in Drops and crafting — a banner concentrates
                     odds, it never gates.
                   </p>
                   <button class="mat-panel act rw-back" id="shop-banner">
                     ${icon("sparkle")}<span>Open the banner</span>${icon("chevron-right")}
                   </button>
                 </section>`
              : ""
          }

          <section class="shop-odds mat-panel rw-panel-pad rw-stack">
            <span class="t-label">What is in a Drop</span>
            <table class="rw-odds-table odds-table">
              <thead><tr><th>Rarity</th><th>Chance per card</th></tr></thead>
              <tbody>
                ${publishedOdds(content)
                  .map(
                    (row) =>
                      `<tr><td><span class="rw-odds-name"><span class="rw-rarity-dot" style="--rar-key:var(--rarity-${row.rarity})"></span>${RARITY_LABEL[row.rarity]}</span></td><td class="num">${row.percent}</td></tr>`,
                  )
                  .join("")}
              </tbody>
            </table>
            <ul class="rw-rules">
              <li>${icon("check")}<span>At least <strong>1 Rare or better</strong> in every Drop.</span></li>
              <li>${icon("star")}<span>A <strong>Legendary within every ${pack.legendaryPity} Drops</strong>. The counter is beside the button and it is yours, not a rolling average.</span></li>
              <li>${icon("close")}<span>No card appears <strong>twice in the same Drop</strong>.</span></li>
              <li>${icon("lock")}<span>You will never open a card you already have the maximum of <strong>while any card of that rarity is still missing</strong>.</span></li>
              <li>${icon("shards")}<span>Once a rarity is complete, further copies convert to Signal at <strong>${Math.round((economy.dupeConversionBonus - 1) * 100)}% above</strong> the normal dismantle value.</span></li>
            </ul>
            <button class="mat-panel act rw-back" id="shop-fairness">
              ${icon("info")}<span>Full probability disclosures</span>${icon("chevron-right")}
            </button>
          </section>
        </div>

        <section class="rw-shop-hero mat-panel">
          <div class="rw-stack-tight">
            <span class="t-label">Standard Drop</span>
            <h2 class="t-display" style="font-size:var(--fs-2xl);margin:0">${economy.packSize} cards</h2>
            <p class="rw-note">Bought with Clout, which is earned by playing. Never with money.</p>
          </div>

          <div class="rw-shop-pack">
            <div class="rw-pack-still" aria-hidden="true">
              <img src="${cardBackThumb(HOUSE_BACK, 0.55)}" alt="">
            </div>
          </div>

          <div class="rw-shop-buyrow">
            <div class="rw-meter" style="width:min(100%,420px)">
              <div class="rw-meter-head">
                <span class="t-label">Legendary guaranteed within</span>
                <span class="num" id="shop-pity">${toPity} ${plural(toPity, "Drop")}</span>
              </div>
              ${railHtml({
                value: profile.drops.sinceLegendary,
                max: pack.legendaryPity,
                label: "Progress toward the guaranteed Legendary",
                ticks: [{ at: 1, kind: "promise", title: "The guarantee" }],
                fill: "linear-gradient(var(--light-sweep), #ffe6a8 0%, var(--rarity-legendary) 55%, #a86a12 100%)",
              })}
            </div>

            <button class="rw-buy mat-hero act" id="shop-buy" ${affordable ? "" : "disabled"}>
              ${icon("merch-drop")}
              <span>${free ? `Open a free Drop — ${profile.pendingDrops} left` : "Open a Drop"}</span>
              ${free ? "" : coinInline("clout", pack.price)}
            </button>

            ${
              affordable
                ? ""
                : `<p class="rw-note rw-quiet">You need ${formatNumber(pack.price - profile.clout)} more Clout. Play a match.</p>`
            }
            ${free ? `<p class="rw-note rw-quiet">Free Drops from your starter deck. They cost nothing.</p>` : ""}
            <p class="rw-note rw-quiet"><span class="num" style="min-width:0">${formatNumber(profile.drops.opened)}</span> opened</p>
          </div>
        </section>
      </main>
    `;

    root.querySelector("#shop-banner")?.addEventListener("click", () => callbacks.onOpenBanner());
    root.querySelector("#shop-fairness")?.addEventListener("click", () => callbacks.onOpenFairness());
    root.querySelector("#shop-back")?.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      callbacks.onBack();
    });
    root.querySelector("#shop-buy")?.addEventListener("click", buy);

    syncWallets(root);
  };

  /**
   * Buy one, and hand the roll to the set-piece.
   *
   * The music change belongs here rather than inside the overlay: the opening
   * theme is about *this purchase*, and an overlay that started and stopped the
   * soundtrack would fight the banner screen the moment it used the same
   * component.
   */
  const buy = (): void => {
    const result = openMerchDrop(content);
    if (!result) return;
    audio.playMusic("music.packOpening");
    lastDrop = result;
    /*
     * The screen underneath is *not* re-rendered here. It is about to be covered
     * by a full-viewport overlay, and rebuilding it costs a card render and a
     * full `innerHTML` on the exact frame the player pressed the button — which
     * a long-task observer caught as part of a 376ms stall. It is rendered on
     * close instead, when the wallet also needs to count.
     */
    const newCards = result.cards.filter((entry) => entry.isNew).length;
    opening = openPack({
      content,
      cards: result.cards.map((entry) => ({
        cardId: entry.cardId,
        rarity: entry.rarity,
        isNew: entry.isNew,
        convertedToSignal: entry.convertedToSignal,
      })),
      eyebrow: "Merch Drop",
      title: `${result.cards.length} cards`,
      tearLabel: "Tear it open",
      back: HOUSE_BACK,
      summary: [
        ...(newCards > 0
          ? [{ label: newCards === 1 ? "card is new to you" : "cards are new to you", value: newCards, icon: "collection" as const }]
          : [{ label: "every card was one you already had", icon: "collection" as const }]),
        ...(result.signal > 0 ? [{ label: "Signal from duplicates", value: result.signal, coin: "shards" as const }] : []),
      ],
      onCollection: () => callbacks.onOpenCollection(),
      onClose: () => {
        opening = null;
        // Back to the shop's own soundscape; the opening theme belongs to the
        // reveal and would otherwise keep playing over the store.
        audio.playMusic("music.menu");
        render();
      },
      walletHost: root,
    });
  };

  render();

  /**
   * Keep the wallet honest while a pack is open, without repainting the screen
   * under it. The chips count rather than jump, because `syncWallets` reads the
   * value the player last saw off the chip itself.
   */
  const unsubscribe = profileStore.subscribe(() => {
    const profile = getProfile();
    for (const [kind, value] of [
      ["clout", profile.clout],
      ["shards", profile.shards],
    ] as const) {
      const chip = root.querySelector<HTMLElement>(`[data-wallet="${kind}"]`);
      if (chip) chip.dataset["value"] = String(value);
    }
    syncWallets(root);
  });

  /** Automation hook, the same shape the story and Doomscroll screens expose. */
  (window as unknown as { hypeboundShop?: unknown }).hypeboundShop = {
    price: () => pack.price,
    lastDrop: () => lastDrop,
    profile: () => getProfile().drops,
    buy,
  };

  return {
    root,
    dispose: () => {
      opening?.close();
      unsubscribe();
      delete (window as unknown as { hypeboundShop?: unknown }).hypeboundShop;
    },
  };
}
