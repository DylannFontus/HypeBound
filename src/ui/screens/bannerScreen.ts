/**
 * The Headliner Banner page — `07-economy-and-monetization.md` §4.
 *
 * §4.1 maps its required elements one-to-one onto a brief, and most of them are
 * about *disclosure*: the exact odds, the pity progress, the opening history,
 * the duplicate-conversion rate with a worked example, the rerun calendar. This
 * page exists mostly to tell you the truth about a random number generator
 * before you spend anything on it.
 *
 * Three things it therefore does rather than mentions:
 *
 * **It prints the odds from the object the resolver rolls against.** Not a
 * hand-written table beside the code — the same `balance.economy.banner`, so the
 * numbers shown and the numbers rolled cannot drift apart.
 *
 * **It shows the Encore Meter as a labelled bar with its count.** §4.1 asks for
 * "37 / 50 pulls until your Target Card is guaranteed" and adds "never
 * colour-only", so the number is written out.
 *
 * **It never implies scarcity.** The rerun calendar is on the page, because §4.5
 * is explicit that nothing a banner offers becomes unobtainable.
 *
 * What is absent: §4.1's full-bleed animated key art. There is no art pipeline,
 * so the hero is the featured Legendary's own procedural card, which is at least
 * the card you are being sold.
 */

import type { CardDef, ContentIndex, Rarity } from "../../engine/types";
import type { Screen } from "../shell";
import type { BannerView } from "../../game/economy/banner";
import { publishedOdds, runEnd, runStart, tokenPrice } from "../../game/economy/banner";
import {
  backstageTokens,
  bannerViews,
  getProfile,
  pullBanner,
  pullHistory,
  pullHistoryJson,
  redeemBackstage,
  setTargetCard,
  toggleWishlist,
} from "../../save/profile";
import { renderCardToCanvas } from "../cardRenderer/renderCard";
import { audio } from "../../audio/audio";

export interface BannerCallbacks {
  onBack: () => void;
  onCollection: () => void;
  /** policy F1 names the disclosures page; the banner's own table links to it */
  onFairness: () => void;
}

const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Schedule dates are authored as UTC midnight, so they are formatted in UTC.
 *
 * Formatting them locally renders 2026-07-27T00:00Z as "26 July" for everyone
 * west of Greenwich — a run advertised as ending a day before the data says it
 * does. These are calendar dates in a data file rather than moments in a
 * player's day, and they should read the same everywhere.
 */
const DATE = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
/** A pull happened at a moment in the player's day, so that one stays local. */
const PULLED = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long", year: "numeric" });
const RARITY_LABEL: Record<Rarity, string> = {
  common: "Common",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
};

export function createBannerScreen(content: ContentIndex, callbacks: BannerCallbacks): Screen {
  const root = document.createElement("div");
  root.className = "screen banner-screen";

  let showing: string | null = null;
  /** which panel is open: null, "odds", "history", "shop" or "target" */
  let panel: string | null = null;
  /** the most recent pull, shown as a reveal strip until the next action */
  let lastPull: ReturnType<typeof pullBanner> = null;

  const cardName = (cardId: string): string => content.cards[cardId]?.name ?? cardId;

  const featuredStrip = (view: BannerView): string => {
    const ids = [view.banner.featuredLegendary, ...view.banner.featuredEpics, ...view.banner.spotlightedRares];
    const odds = publishedOdds(content);
    return `
      <div class="banner-featured" id="banner-featured">
        ${ids
          .map((id) => {
            const card = content.cards[id];
            if (!card) return "";
            const row = odds.find((entry) => entry.rarity === card.rarity);
            const rate = card.rarity === "rare" ? null : row ? row.featuredRate : null;
            const wished = view.state.wishlist.includes(id);
            return `
              <figure class="banner-card" data-card="${esc(id)}">
                <div class="banner-card-art" data-art="${esc(id)}"></div>
                <figcaption>
                  <strong>${esc(card.name)}</strong>
                  <span class="muted">${RARITY_LABEL[card.rarity]}${
                    rate !== null ? ` · rate-up ${(rate * 100).toFixed(1)}%` : " · spotlighted"
                  }</span>
                  <button class="btn btn-ghost banner-wish ${wished ? "active" : ""}" data-card="${esc(id)}">
                    ${wished ? "On wishlist" : "Wishlist"}
                  </button>
                </figcaption>
              </figure>`;
          })
          .join("")}
      </div>`;
  };

  const oddsPanel = (): string => `
    <section class="panel panel-chrome banner-panel">
      <h3 class="profile-section-title">Exact rates, per pull</h3>
      <button class="btn btn-ghost btn-sm" id="banner-fairness">Full probability disclosures →</button>
      <table class="stats-deck-table">
        <thead><tr><th>Rarity</th><th>Rate</th><th>Of which featured</th></tr></thead>
        <tbody>
          ${publishedOdds(content)
            .map(
              (row) => `
                <tr>
                  <td>${RARITY_LABEL[row.rarity]}</td>
                  <td>${(row.rate * 100).toFixed(1)}%</td>
                  <td>${row.featuredRate > 0 ? `${(row.featuredRate * 100).toFixed(1)}%` : "—"}</td>
                </tr>`
            )
            .join("")}
        </tbody>
      </table>
      <p class="muted">
        Rolling guarantees, and they persist across sessions, across ×1 and ×10, and across
        this banner's reruns: an Epic or better within every ${content.balance.economy.banner.epicPityWindow}
        pulls, and your Target Card on the ${content.balance.economy.banner.hardPity}th pull since the
        Encore Meter last reset.
      </p>
      <p class="muted">
        A duplicate past the playable cap converts to Signal at
        ${Math.round(content.balance.economy.dupeConversionBonus * 100)}% of its dismantle value —
        an excess Legendary is
        ${Math.round(content.balance.economy.dustValue.legendary * content.balance.economy.dupeConversionBonus)}
        Signal. Conversion only ever happens once every card of that rarity is already at the cap.
      </p>
      <p class="muted">
        The ×10 costs exactly ten pulls and carries no odds advantage. The ten-pull Epic window is a
        rolling counter shared with ×1 pulls, so buying in tens is a convenience, never an edge.
      </p>
    </section>`;

  const historyPanel = (): string => {
    const log = pullHistory();
    return `
      <section class="panel panel-chrome banner-panel">
        <div class="stats-table-head">
          <h3 class="profile-section-title">Opening history</h3>
          <button class="btn btn-ghost" id="banner-export">Export JSON</button>
        </div>
        ${
          log.length === 0
            ? `<p class="muted">Nothing pulled yet.</p>`
            : `<div class="stats-scroll">
                 <table class="stats-deck-table">
                   <thead><tr><th>When</th><th>Banner</th><th>Result</th></tr></thead>
                   <tbody>
                     ${log
                       .slice(0, 40)
                       .map(
                         (entry) => `
                           <tr>
                             <td class="muted">${PULLED.format(new Date(entry.pulledAt))}</td>
                             <td>×${entry.count}</td>
                             <td>${entry.cards
                               .map(
                                 (card) =>
                                   `<span class="banner-pill rarity-${card.rarity}">${esc(cardName(card.cardId))}${
                                     card.convertedToSignal !== undefined ? ` → +${card.convertedToSignal} Signal` : ""
                                   }</span>`
                               )
                               .join(" ")}</td>
                           </tr>`
                       )
                       .join("")}
                   </tbody>
                 </table>
               </div>
               <p class="muted">The newest ${Math.min(log.length, 40)} of ${log.length} kept on this device.</p>`
        }
      </section>`;
  };

  const shopPanel = (view: BannerView): string => {
    const prices = content.balance.economy.banner.tokenPrices;
    const owned = getProfile().collection;
    const affordable = Object.values(content.cards)
      .filter((card) => !card.token && !card.variantOf && card.type !== "leader")
      .filter((card) => (owned[card.id] ?? 0) < (card.rarity === "legendary" ? 1 : 2))
      .filter((card) => tokenPrice(content, card) <= backstageTokens())
      .sort((a, b) => tokenPrice(content, b) - tokenPrice(content, a) || (a.name < b.name ? -1 : 1))
      .slice(0, 24);
    return `
      <section class="panel panel-chrome banner-panel">
        <h3 class="profile-section-title">Backstage Shop</h3>
        <p class="muted">
          Every pull grants a Backstage Token, and tokens never expire. Any card, at a fixed price:
          ${(["common", "rare", "epic", "legendary"] as Rarity[])
            .map((rarity) => `${RARITY_LABEL[rarity]} ${prices[rarity]}`)
            .join(" · ")}.
          Fifty pulls both fill the Encore Meter and bank enough tokens for a Legendary of your choice —
          that double guarantee is deliberate.
        </p>
        ${
          !view.live
            ? `<p class="muted">The shop is open while a banner is running.</p>`
            : affordable.length === 0
              ? `<p class="muted">Nothing you can afford yet — you hold ${backstageTokens()} token${backstageTokens() === 1 ? "" : "s"}.</p>`
              : `<div class="banner-shop">
                   ${affordable
                     .map(
                       (card) => `
                         <button class="btn btn-ghost banner-redeem" data-card="${esc(card.id)}">
                           <span>${esc(card.name)}</span>
                           <span class="muted">${RARITY_LABEL[card.rarity]} · ${tokenPrice(content, card)}</span>
                         </button>`
                     )
                     .join("")}
                 </div>`
        }
      </section>`;
  };

  const targetPanel = (view: BannerView): string => {
    const owned = getProfile().collection;
    const pool = Object.values(content.cards)
      .filter((card) => !card.token && !card.variantOf && card.type !== "leader")
      .filter((card) => card.rarity === "legendary" || card.rarity === "epic")
      .filter((card) => (owned[card.id] ?? 0) < (card.rarity === "legendary" ? 1 : 2))
      .sort((a, b) => (a.name < b.name ? -1 : 1))
      .slice(0, 40);
    return `
      <section class="panel panel-chrome banner-panel">
        <h3 class="profile-section-title">Target Card</h3>
        <p class="muted">
          The Encore Meter counts toward whichever card you set here — any card in the pool, not
          only the featured Legendary. Changing it keeps the count: the guarantee applies to
          whatever is set when the meter fills.
        </p>
        <div class="banner-shop">
          ${pool
            .map(
              (card) => `
                <button class="btn btn-ghost banner-target ${view.state.targetCardId === card.id ? "active" : ""}"
                        data-card="${esc(card.id)}">
                  <span>${esc(card.name)}</span>
                  <span class="muted">${RARITY_LABEL[card.rarity]}</span>
                </button>`
            )
            .join("")}
        </div>
      </section>`;
  };

  const revealStrip = (): string => {
    if (!lastPull) return "";
    return `
      <section class="panel panel-chrome banner-reveal">
        <h3 class="profile-section-title">Pulled</h3>
        <div class="banner-reveal-cards">
          ${lastPull.cards
            .map(
              (card) => `
                <span class="banner-pill rarity-${card.rarity} ${card.featured ? "featured" : ""}">
                  ${esc(cardName(card.cardId))}
                  ${card.isNew ? '<em class="banner-new">new</em>' : ""}
                  ${card.wishlisted ? '<em class="banner-new">wishlist</em>' : ""}
                  ${card.path === "hard-pity" ? '<em class="banner-new">Encore</em>' : ""}
                  ${card.convertedToSignal !== undefined ? `<em class="muted">+${card.convertedToSignal} Signal</em>` : ""}
                </span>`
            )
            .join("")}
        </div>
        <p class="muted">
          +${lastPull.tokens} Backstage Token${lastPull.tokens === 1 ? "" : "s"}${
            lastPull.signal > 0 ? ` · +${lastPull.signal} Signal from conversions` : ""
          }${lastPull.cosmetics.length > 0 ? ` · ${lastPull.cosmetics.map((c) => esc(c.name)).join(", ")}` : ""}
        </p>
      </section>`;
  };

  const render = (): void => {
    const profile = getProfile();
    const views = bannerViews(content);
    const view = views.find((entry) => entry.banner.id === showing) ?? views[0] ?? null;

    root.innerHTML = `
      <div class="ambient-bg"></div>
      <header class="screen-header">
        <button class="btn btn-ghost" id="banner-back">← Back</button>
        <h1 class="title">Headliner</h1>
        <div class="mastery-wallet">
          <div class="currency"><span class="currency-icon clout">◈</span><span class="currency-value">${profile.clout.toLocaleString()}</span></div>
          <div class="currency"><span class="currency-icon shards">✦</span><span class="currency-value">${profile.shards.toLocaleString()}</span></div>
          <div class="currency"><span class="currency-icon glimmer">✧</span><span class="currency-value">${(profile.glimmer ?? 0).toLocaleString()}</span></div>
          <div class="currency"><span class="currency-icon backstage-token">◊</span><span class="currency-value" id="banner-tokens">${backstageTokens()}</span></div>
        </div>
      </header>

      <main class="banner-body">
        ${
          !view
            ? `<section class="panel panel-chrome"><p>No banners are authored.</p></section>`
            : `
        ${
          views.length > 1
            ? `<nav class="mastery-tabs banner-tabs">
                 ${views
                   .map(
                     (entry) =>
                       `<button class="btn mastery-tab ${view.banner.id === entry.banner.id ? "active" : ""}"
                                data-banner="${esc(entry.banner.id)}">
                          ${esc(entry.banner.name)}${entry.live ? "" : " <span class='muted'>not running</span>"}
                        </button>`
                   )
                   .join("")}
               </nav>`
            : ""
        }

        <section class="panel panel-chrome banner-head">
          <div class="eyebrow">Headliner${view.live ? "" : " — between runs"}</div>
          <h2 class="banner-name">${esc(view.banner.name)}</h2>
          <p class="banner-blurb">${esc(view.banner.blurb)}</p>
          <p class="muted">
            ${
              view.live && view.run
                ? `Running until ${DATE.format(new Date(runEnd(view.run)))}.`
                : view.next
                  ? `Next run begins ${DATE.format(new Date(runStart(view.next)))}.`
                  : "No further runs are scheduled."
            }
            Reruns: ${view.banner.runs.map((run) => DATE.format(new Date(runStart(run)))).join(" · ")}.
            Nothing here becomes unobtainable — every card on this banner is already in Merch Drops
            and the crafting catalogue.
          </p>
        </section>

        ${featuredStrip(view)}

        <section class="panel panel-chrome banner-meter">
          <div class="stats-table-head">
            <h3 class="profile-section-title">Encore Meter</h3>
            <span class="muted">Target: ${esc(cardName(view.state.targetCardId))}</span>
          </div>
          <div class="mastery-bar"><span style="width:${Math.min(100, (view.state.sinceTarget / view.hardPity) * 100)}%"></span></div>
          <p class="muted" id="banner-meter-label">
            ${view.state.sinceTarget} / ${view.hardPity} pulls until your Target Card is guaranteed.
            ${view.toEpic <= view.epicWindow ? `An Epic or better within ${view.toEpic} more.` : ""}
          </p>
          <div class="banner-actions">
            <button class="btn btn-primary banner-pull" data-count="1" ${view.live ? "" : "disabled"}>
              ×1 Pull — ${view.freePull ? "free" : `<span class="currency-icon clout">◈</span>${view.pullPrice}`}
            </button>
            <button class="btn btn-primary banner-pull" data-count="10" ${view.live ? "" : "disabled"}>
              ×10 Pull — <span class="currency-icon clout">◈</span>${view.tenPrice}
            </button>
            ${view.firstTenReward ? `<span class="muted">Your first ×10 also grants this banner's card back.</span>` : ""}
          </div>
          <div class="banner-links">
            <button class="btn btn-ghost banner-panel-toggle" data-panel="odds">Exact rates</button>
            <button class="btn btn-ghost banner-panel-toggle" data-panel="target">Change Target</button>
            <button class="btn btn-ghost banner-panel-toggle" data-panel="shop">Backstage Shop</button>
            <button class="btn btn-ghost banner-panel-toggle" data-panel="history">History</button>
          </div>
        </section>

        ${revealStrip()}
        ${panel === "odds" ? oddsPanel() : ""}
        ${panel === "target" ? targetPanel(view) : ""}
        ${panel === "shop" ? shopPanel(view) : ""}
        ${panel === "history" ? historyPanel() : ""}
        `
        }
      </main>`;

    // featured art is drawn, not templated — the same renderer the board uses
    for (const host of root.querySelectorAll<HTMLElement>("[data-art]")) {
      const card = content.cards[host.dataset["art"] ?? ""];
      if (card) host.appendChild(renderCardToCanvas(card, 150));
    }

    root.querySelector("#banner-back")?.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      callbacks.onBack();
    });
    root.querySelector("#banner-fairness")?.addEventListener("click", () => callbacks.onFairness());
    for (const button of root.querySelectorAll<HTMLElement>(".banner-tabs .mastery-tab")) {
      button.addEventListener("click", () => {
        showing = button.dataset["banner"] ?? null;
        lastPull = null;
        render();
      });
    }
    for (const button of root.querySelectorAll<HTMLElement>(".banner-panel-toggle")) {
      button.addEventListener("click", () => {
        panel = panel === button.dataset["panel"] ? null : (button.dataset["panel"] ?? null);
        audio.play("sfx.ui.hover");
        render();
      });
    }
    for (const button of root.querySelectorAll<HTMLElement>(".banner-pull")) {
      button.addEventListener("click", () => {
        if (!view) return;
        const result = pullBanner(content, view.banner.id, Number(button.dataset["count"]) === 10 ? 10 : 1);
        if (result) {
          lastPull = result;
          audio.play("sfx.ui.confirm");
        }
        render();
      });
    }
    for (const button of root.querySelectorAll<HTMLElement>(".banner-wish")) {
      button.addEventListener("click", () => {
        if (view) toggleWishlist(content, view.banner.id, button.dataset["card"] ?? "");
        render();
      });
    }
    for (const button of root.querySelectorAll<HTMLElement>(".banner-target")) {
      button.addEventListener("click", () => {
        if (view) setTargetCard(content, view.banner.id, button.dataset["card"] ?? "");
        panel = null;
        render();
      });
    }
    for (const button of root.querySelectorAll<HTMLElement>(".banner-redeem")) {
      button.addEventListener("click", () => {
        if (redeemBackstage(content, button.dataset["card"] ?? "")) audio.play("sfx.ui.confirm");
        render();
      });
    }
    root.querySelector("#banner-export")?.addEventListener("click", () => {
      const blob = new Blob([pullHistoryJson()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "hypebound-pulls.json";
      link.click();
      URL.revokeObjectURL(url);
    });
  };

  render();

  /** Automation hook, the same shape the other screens expose. */
  (window as unknown as { hypeboundBanner?: unknown }).hypeboundBanner = {
    view: () => {
      const views = bannerViews(content);
      const view = views.find((entry) => entry.banner.id === showing) ?? views[0];
      if (!view) return null;
      return {
        id: view.banner.id,
        live: view.live,
        runs: view.banner.runs.length,
        target: view.state.targetCardId,
        wishlist: view.state.wishlist,
        pulls: view.state.pulls,
        sinceTarget: view.state.sinceTarget,
        sinceEpic: view.state.sinceEpic,
        freePull: view.freePull,
        tokens: backstageTokens(),
      };
    },
    odds: () => publishedOdds(content),
    pull: (count: 1 | 10) => {
      const views = bannerViews(content);
      const view = views.find((entry) => entry.banner.id === showing) ?? views[0];
      if (!view) return null;
      const result = pullBanner(content, view.banner.id, count);
      if (result) lastPull = result;
      render();
      return result;
    },
    wish: (cardId: string) => {
      const views = bannerViews(content);
      const view = views.find((entry) => entry.banner.id === showing) ?? views[0];
      const out = view ? toggleWishlist(content, view.banner.id, cardId) : null;
      render();
      return out;
    },
    target: (cardId: string) => {
      const views = bannerViews(content);
      const view = views.find((entry) => entry.banner.id === showing) ?? views[0];
      const ok = view ? setTargetCard(content, view.banner.id, cardId) : false;
      render();
      return ok;
    },
    redeem: (cardId: string) => {
      const price = redeemBackstage(content, cardId);
      render();
      return price;
    },
    history: () => pullHistory(),
    show: (panelId: string | null) => {
      panel = panelId;
      render();
    },
    refresh: render,
  };

  return {
    root,
    dispose: () => {
      delete (window as unknown as { hypeboundBanner?: unknown }).hypeboundBanner;
    },
  };
}
