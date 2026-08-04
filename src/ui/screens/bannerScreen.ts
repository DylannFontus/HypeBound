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
 * ## What the rebuild changed, and why
 *
 * The page had a comment claiming the hero was "the featured Legendary's own
 * procedural card". It was not: the Legendary rendered at 150px in a flat
 * seven-up flex row, identical in size and framing to the two Rare spotlights,
 * distinguished only by a caption. A screen whose most important object is item
 * one of seven at equal weight has nothing for the eye to land on. In MTG Arena
 * the set banner is full-bleed key art with the mythic at three times the size
 * of anything else; in every gacha in the genre the featured unit is most of the
 * screen. So the Legendary is now the hero at ~270px with the banner's own
 * faction colour bled behind it as an atmosphere plane and a slow specular
 * crawling its face, and the other six are a fixed grid of "also spotlighted".
 *
 * **The pull buttons are no longer below the fold.** At the shipped 1600×900
 * they began at y≈1157 — the player landed on a gacha screen and could not see
 * how to pull. They are a pinned bottom rail now, ×10 at hero weight and ×1
 * demoted, and the four ghost buttons under them are one segmented control.
 *
 * **A ×10 is a set-piece, not a receipt.** It used to render as a wrapped row of
 * 24px text chips at the bottom of the document: a Legendary was a text pill
 * with a 1px gold border, the same size as the nine commons beside it. It now
 * goes through the same `openPack` component the shop uses — one reveal in the
 * game, not two, and the weaker one deleted. The text list survives underneath
 * as a collapsed summary, because §4.1 requires the itemisation and because the
 * browser check counts it.
 */

import type { ContentIndex, FactionId, Rarity } from "../../engine/types";
import type { Screen } from "../shell";
import type { BannerView } from "../../game/economy/banner";
import type { CardBackStyle } from "../cosmetics/emblem";
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
import { bannerCardBackId, cosmeticById } from "../../game/cosmetics";
import { renderCardToCanvas } from "../cardRenderer/renderCard";
import { FACTION_COLOR } from "../cardRenderer/palette";
import { audio } from "../../audio/audio";
import { icon } from "../art/uiIcons";
import { date as formatDate, plural } from "../format";
import {
  HOUSE_BACK,
  backButton,
  coinChip,
  coinInline,
  esc,
  railHtml,
  syncWallets,
  WASH,
} from "./rewards/rewardKit";
import { installRewardsTheme } from "./rewards/rewardsTheme";
import { openPack } from "./rewards/packOpening";

export interface BannerCallbacks {
  onBack: () => void;
  onCollection: () => void;
  /** policy F1 names the disclosures page; the banner's own table links to it */
  onFairness: () => void;
}

/**
 * Schedule dates are authored as UTC midnight, so they are formatted in UTC —
 * and in en-GB, which is the whole of `format.ts`'s reason to exist. Formatting
 * them with the browser's locale rendered "17 août 2026" mid-English-sentence on
 * any machine that is not set to English, and rendered 2026-07-27T00:00Z as "26
 * July" for everyone west of Greenwich: a run advertised as ending a day before
 * the data says it does.
 */
const DATE = (value: number): string => formatDate(value, { day: "numeric", month: "long", year: "numeric" });
/** A pull happened at a moment in the player's day, so that one stays local. */
const PULLED = (value: number): string =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date(value));

const RARITY_LABEL: Record<Rarity, string> = {
  common: "Common",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
};

const PANELS = [
  { id: "odds", label: "Exact rates" },
  { id: "target", label: "Target" },
  { id: "shop", label: "Backstage" },
  { id: "history", label: "History" },
] as const;

export function createBannerScreen(content: ContentIndex, callbacks: BannerCallbacks): Screen {
  installRewardsTheme();

  const root = document.createElement("div");
  root.className = "screen banner-screen";

  let showing: string | null = null;
  /** which panel is open: null, "odds", "history", "shop" or "target" */
  let panel: string | null = null;
  /** the most recent pull, itemised under the spotlights until the next action */
  let lastPull: ReturnType<typeof pullBanner> = null;
  let opening: { close: () => void } | null = null;

  const cardName = (cardId: string): string => content.cards[cardId]?.name ?? cardId;
  const accentOf = (view: BannerView): string =>
    FACTION_COLOR[view.banner.factionId as FactionId] ?? "#b56cff";

  /** The pack the banner's cards arrive in: its own card back, where it has one. */
  const backOf = (view: BannerView): CardBackStyle => {
    const cosmetic = cosmeticById(content, bannerCardBackId(view.banner.id));
    if (cosmetic?.kind !== "cardBack") return HOUSE_BACK;
    return { color: cosmetic.color, emblem: cosmetic.emblem ?? "diamond" };
  };

  /* ---------------------------------------------------------------------
     the hero
     --------------------------------------------------------------------- */

  const heroSection = (view: BannerView): string => {
    const legendary = content.cards[view.banner.featuredLegendary];
    const odds = publishedOdds(content);
    const rate = odds.find((entry) => entry.rarity === "legendary")?.featuredRate ?? 0;
    return `
      <section class="rw-hero mat-panel" style="--rw-accent:${esc(accentOf(view))}">
        <figure class="banner-card" data-card="${esc(view.banner.featuredLegendary)}">
          <div class="banner-card-art" data-art="${esc(view.banner.featuredLegendary)}" data-hero="1"></div>
        </figure>
        <div class="rw-hero-copy banner-head">
          <span class="t-label">Headliner${view.live ? "" : " — between runs"}</span>
          <h2 class="t-display">${esc(view.banner.name)}</h2>
          <p class="rw-note" style="font-size:var(--fs-md)">${esc(view.banner.blurb)}</p>
          <div class="rw-hero-meta">
            <span class="rw-tok mat-chip" data-state="claimable" style="--mat-fill:linear-gradient(var(--light-sweep), rgb(255 220 150 / 0.34) 0%, rgb(70 46 12 / 0.95) 100%);color:var(--rarity-legendary)">
              ${icon("star-filled")}<span>${esc(legendary?.name ?? "Legendary")}</span>
            </span>
            <span class="rw-tok mat-chip" data-state="available">
              ${icon("rarity")}<span>rate-up ${(rate * 100).toFixed(1)}%</span>
            </span>
          </div>
          <p class="rw-note rw-quiet">
            ${
              view.live && view.run
                ? `Running until ${DATE(runEnd(view.run))}.`
                : view.next
                  ? `Next run begins ${DATE(runStart(view.next))}.`
                  : "No further runs are scheduled."
            }
            Reruns: ${view.banner.runs.map((run) => DATE(runStart(run))).join(" · ")}.
            Nothing here becomes unobtainable — every card on this banner is already in Merch Drops
            and the crafting catalogue.
          </p>
        </div>
      </section>`;
  };

  const spotlightSection = (view: BannerView): string => {
    const ids = [...view.banner.featuredEpics, ...view.banner.spotlightedRares];
    const odds = publishedOdds(content);
    return `
      <section class="mat-panel rw-panel-pad">
        <div class="rw-section-head">
          <h3 class="rw-section-title t-heading">${icon("sparkle")}<span>Also spotlighted</span></h3>
          <span class="rw-note rw-quiet">Every one of these is in Drops and crafting too.</span>
        </div>
        <div class="rw-spotlight banner-featured" id="banner-featured">
          ${ids
            .map((id) => {
              const card = content.cards[id];
              if (!card) return "";
              const row = odds.find((entry) => entry.rarity === card.rarity);
              const rate = card.rarity === "rare" ? null : (row?.featuredRate ?? null);
              const wished = view.state.wishlist.includes(id);
              return `
                <figure class="banner-card mat-panel act" data-card="${esc(id)}">
                  <div class="banner-card-art" data-art="${esc(id)}"></div>
                  <figcaption>
                    <strong>${esc(card.name)}</strong>
                    <span class="rw-note rw-quiet" style="font-size:var(--fs-xs)">${RARITY_LABEL[card.rarity]}${
                      rate !== null ? ` · rate-up ${(rate * 100).toFixed(1)}%` : " · spotlighted"
                    }</span>
                    <button class="rw-wish mat-chip act banner-wish" data-card="${esc(id)}" aria-pressed="${wished}">
                      ${icon(wished ? "star-filled" : "star")}<span>${wished ? "Wishlisted" : "Wishlist"}</span>
                    </button>
                  </figcaption>
                </figure>`;
            })
            .join("")}
        </div>
      </section>`;
  };

  /* ---------------------------------------------------------------------
     the disclosure panels — unchanged in substance, restyled
     --------------------------------------------------------------------- */

  const oddsPanel = (): string => `
    <section class="banner-panel mat-panel rw-panel-pad rw-stack">
      <h3 class="t-heading" style="margin:0">Exact rates, per pull</h3>
      <table class="rw-odds-table">
        <thead><tr><th>Rarity</th><th>Rate</th><th>Of which featured</th></tr></thead>
        <tbody>
          ${publishedOdds(content)
            .map(
              (row) => `
                <tr>
                  <td><span class="rw-odds-name"><span class="rw-rarity-dot" style="--rar-key:var(--rarity-${row.rarity})"></span>${RARITY_LABEL[row.rarity]}</span></td>
                  <td class="num">${(row.rate * 100).toFixed(1)}%</td>
                  <td class="num">${row.featuredRate > 0 ? `${(row.featuredRate * 100).toFixed(1)}%` : "—"}</td>
                </tr>`,
            )
            .join("")}
        </tbody>
      </table>
      <p class="rw-note">
        Rolling guarantees, and they persist across sessions, across ×1 and ×10, and across
        this banner's reruns: an Epic or better within every ${content.balance.economy.banner.epicPityWindow}
        pulls, and your Target Card on the ${content.balance.economy.banner.hardPity}th pull since the
        Encore Meter last reset.
      </p>
      <p class="rw-note">
        A duplicate past the playable cap converts to Signal at
        ${Math.round(content.balance.economy.dupeConversionBonus * 100)}% of its dismantle value —
        an excess Legendary is
        ${Math.round(content.balance.economy.dustValue.legendary * content.balance.economy.dupeConversionBonus)}
        Signal. Conversion only ever happens once every card of that rarity is already at the cap.
      </p>
      <p class="rw-note">
        The ×10 costs exactly ten pulls and carries no odds advantage. The ten-pull Epic window is a
        rolling counter shared with ×1 pulls, so buying in tens is a convenience, never an edge.
      </p>
      <button class="mat-panel act rw-back" id="banner-fairness">
        ${icon("info")}<span>Full probability disclosures</span>${icon("chevron-right")}
      </button>
    </section>`;

  const historyPanel = (): string => {
    const log = pullHistory();
    return `
      <section class="banner-panel mat-panel rw-panel-pad rw-stack">
        <div class="rw-spread">
          <h3 class="t-heading" style="margin:0">Opening history</h3>
          <button class="mat-panel act rw-back" id="banner-export">${icon("log")}<span>Export JSON</span></button>
        </div>
        ${
          log.length === 0
            ? `<p class="rw-note">Nothing pulled yet.</p>`
            : `<div class="stats-scroll">
                 <table class="rw-odds-table">
                   <thead><tr><th>When</th><th>Banner</th><th>Result</th></tr></thead>
                   <tbody>
                     ${log
                       .slice(0, 40)
                       .map(
                         (entry) => `
                           <tr>
                             <td class="rw-quiet">${PULLED(entry.pulledAt)}</td>
                             <td class="num">×${entry.count}</td>
                             <td><span class="rw-summary-list">${entry.cards
                               .map(
                                 (card) =>
                                   `<span class="banner-pill mat-chip rarity-${card.rarity}">${esc(cardName(card.cardId))}${
                                     card.convertedToSignal !== undefined ? ` → +${card.convertedToSignal} Signal` : ""
                                   }</span>`,
                               )
                               .join("")}</span></td>
                           </tr>`,
                       )
                       .join("")}
                   </tbody>
                 </table>
               </div>
               <p class="rw-note rw-quiet">The newest ${Math.min(log.length, 40)} of ${log.length} kept on this device.</p>`
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
      <section class="banner-panel mat-panel rw-panel-pad rw-stack">
        <h3 class="t-heading" style="margin:0">Backstage Shop</h3>
        <p class="rw-note">
          Every pull grants a Backstage Token, and tokens never expire. Any card, at a fixed price:
          ${(["common", "rare", "epic", "legendary"] as Rarity[])
            .map((rarity) => `${RARITY_LABEL[rarity]} ${prices[rarity]}`)
            .join(" · ")}.
          Fifty pulls both fill the Encore Meter and bank enough tokens for a Legendary of your choice —
          that double guarantee is deliberate.
        </p>
        ${
          !view.live
            ? `<p class="rw-note">The shop is open while a banner is running.</p>`
            : affordable.length === 0
              ? `<p class="rw-note">Nothing you can afford yet — you hold ${backstageTokens()} ${plural(backstageTokens(), "token")}.</p>`
              : `<div class="rw-spotlight">
                   ${affordable
                     .map(
                       (card) => `
                         <button class="mat-panel act banner-redeem rw-tile" data-card="${esc(card.id)}"
                                 style="grid-template-rows:auto auto;min-width:0;padding:var(--sp-3)">
                           <strong style="font-size:var(--fs-sm)">${esc(card.name)}</strong>
                           <span class="rw-note rw-quiet" style="font-size:var(--fs-xs)">${RARITY_LABEL[card.rarity]} · ${tokenPrice(content, card)}</span>
                         </button>`,
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
      <section class="banner-panel mat-panel rw-panel-pad rw-stack">
        <h3 class="t-heading" style="margin:0">Target Card</h3>
        <p class="rw-note">
          The Encore Meter counts toward whichever card you set here — any card in the pool, not
          only the featured Legendary. Changing it keeps the count: the guarantee applies to
          whatever is set when the meter fills.
        </p>
        <div class="rw-spotlight">
          ${pool
            .map(
              (card) => `
                <button class="mat-panel act banner-target rw-tile" data-card="${esc(card.id)}"
                        aria-pressed="${view.state.targetCardId === card.id}"
                        style="grid-template-rows:auto auto;min-width:0;padding:var(--sp-3)">
                  <strong style="font-size:var(--fs-sm)">${esc(card.name)}</strong>
                  <span class="rw-note rw-quiet" style="font-size:var(--fs-xs)">${RARITY_LABEL[card.rarity]}</span>
                </button>`,
            )
            .join("")}
        </div>
      </section>`;
  };

  /**
   * The itemised pull, kept as a summary rather than as the reveal.
   *
   * §4.1 requires the disclosure and the browser check counts the pills, but a
   * list of names is what you read *after* the moment, not the moment itself.
   * Collapsed by default, open on request.
   */
  const pullSummary = (): string => {
    if (!lastPull) return "";
    return `
      <section class="mat-panel rw-panel-pad banner-reveal">
        <details>
          <summary class="rw-spread" style="cursor:pointer;list-style:none">
            <span class="rw-section-title t-heading">${icon("list")}<span>Your last pull, itemised</span></span>
            <span class="rw-note rw-quiet">
              +${lastPull.tokens} Backstage ${plural(lastPull.tokens, "Token")}${
                lastPull.signal > 0 ? ` · +${lastPull.signal} Signal from conversions` : ""
              }${lastPull.cosmetics.length > 0 ? ` · ${lastPull.cosmetics.map((c) => esc(c.name)).join(", ")}` : ""}
            </span>
          </summary>
          <div class="rw-summary-list banner-reveal-cards" style="margin-top:var(--sp-3)">
            ${lastPull.cards
              .map(
                (card) => `
                  <span class="banner-pill mat-chip rarity-${card.rarity} ${card.featured ? "featured" : ""}">
                    ${esc(cardName(card.cardId))}
                    ${card.isNew ? '<em class="banner-new" style="color:var(--success)">new</em>' : ""}
                    ${card.wishlisted ? '<em class="banner-new" style="color:var(--accent-gold)">wishlist</em>' : ""}
                    ${card.path === "hard-pity" ? '<em class="banner-new" style="color:var(--accent-bright)">Encore</em>' : ""}
                    ${card.convertedToSignal !== undefined ? `<em class="rw-quiet">+${card.convertedToSignal} Signal</em>` : ""}
                  </span>`,
              )
              .join("")}
          </div>
        </details>
      </section>`;
  };

  /* ---------------------------------------------------------------------
     the pinned pull rail
     --------------------------------------------------------------------- */

  const pullRail = (view: BannerView): string => {
    const toTarget = Math.max(0, view.hardPity - view.state.sinceTarget);
    return `
      <section class="rw-pullrail mat-panel">
        <div class="rw-stack-tight">
          <div class="rw-meter-head">
            <span class="t-label">Encore Meter — ${esc(cardName(view.state.targetCardId))}</span>
            <span class="num">${view.state.sinceTarget} / ${view.hardPity}</span>
          </div>
          ${railHtml({
            value: view.state.sinceTarget,
            max: view.hardPity,
            label: "Pulls until the Encore guarantee",
            ticks: [
              { at: 0.5, kind: "step", title: "Halfway" },
              { at: 1, kind: "promise", title: "Your Target Card is guaranteed here" },
            ],
          })}
          <p class="rw-note rw-quiet" id="banner-meter-label">
            ${view.state.sinceTarget} / ${view.hardPity} pulls until your Target Card is guaranteed${
              toTarget === 0 ? " — the next pull is it" : ""
            }.
            ${view.toEpic <= view.epicWindow ? `An Epic or better within ${view.toEpic} more.` : ""}
          </p>
          <div class="rw-seg mat-well" role="group" aria-label="Banner details">
            ${PANELS.map(
              (entry) =>
                `<button type="button" class="banner-panel-toggle" data-panel="${entry.id}" aria-pressed="${panel === entry.id}">${entry.label}</button>`,
            ).join("")}
          </div>
        </div>
        <div class="rw-pull-actions">
          <button class="rw-pull1 mat-panel act banner-pull" data-count="1" ${view.live ? "" : "disabled"}>
            ${icon("sparkle")}
            <span>×1</span>
            <span class="rw-pull-price">${view.freePull ? "free" : coinInline("clout", view.pullPrice)}</span>
          </button>
          <button class="rw-pull10 mat-hero act banner-pull" data-count="10" ${view.live ? "" : "disabled"}>
            ${icon("merch-drop")}
            <span>×10 Pull</span>
            <span class="rw-pull-price">${coinInline("clout", view.tenPrice)}</span>
          </button>
        </div>
        ${
          view.firstTenReward
            ? `<p class="rw-note rw-quiet" style="grid-column:1/-1;margin:0">Your first ×10 also grants this banner's card back.</p>`
            : ""
        }
      </section>`;
  };

  /* ---------------------------------------------------------------------
     render
     --------------------------------------------------------------------- */

  const render = (): void => {
    const profile = getProfile();
    const views = bannerViews(content);
    const view = views.find((entry) => entry.banner.id === showing) ?? views[0] ?? null;

    root.innerHTML = `
      ${WASH}
      <header class="screen-header">
        ${backButton("banner-back")}
        <h1 class="title">Headliner</h1>
        <div class="rw-wallet">
          ${coinChip("clout", profile.clout)}
          ${coinChip("shards", profile.shards)}
          ${coinChip("glimmer", profile.glimmer ?? 0)}
          ${coinChip("token", backstageTokens())}
        </div>
      </header>

      <main class="banner-body rw-banner-body">
        ${
          !view
            ? `<section class="mat-panel rw-panel-pad"><p class="rw-note">No banners are authored.</p></section>`
            : `
          ${
            views.length > 1
              ? `<nav class="rw-tabs banner-tabs" role="tablist">
                   ${views
                     .map(
                       (entry) =>
                         `<button class="rw-tab mat-panel act" role="tab" aria-selected="${view.banner.id === entry.banner.id}"
                                  data-banner="${esc(entry.banner.id)}">
                            ${esc(entry.banner.name)}${entry.live ? "" : ` <span class="rw-quiet">not running</span>`}
                          </button>`,
                     )
                     .join("")}
                 </nav>`
              : `<div></div>`
          }
          <div class="rw-banner-scroll">
            ${heroSection(view)}
            ${spotlightSection(view)}
            ${pullSummary()}
            ${panel === "odds" ? oddsPanel() : ""}
            ${panel === "target" ? targetPanel(view) : ""}
            ${panel === "shop" ? shopPanel(view) : ""}
            ${panel === "history" ? historyPanel() : ""}
          </div>
          ${pullRail(view)}`
        }
      </main>`;

    // featured art is drawn, not templated — the same renderer the board uses
    for (const host of root.querySelectorAll<HTMLElement>("[data-art]")) {
      const card = content.cards[host.dataset["art"] ?? ""];
      if (!card) continue;
      const canvas = renderCardToCanvas(card, host.dataset["hero"] ? 320 : 200);
      // the renderer writes an inline width, which outranks the stylesheet; the
      // tiles are fluid, so the inline value has to be handed back
      canvas.style.width = "100%";
      canvas.style.height = "auto";
      host.appendChild(canvas);
    }

    root.querySelector("#banner-back")?.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      callbacks.onBack();
    });
    root.querySelector("#banner-fairness")?.addEventListener("click", () => callbacks.onFairness());
    for (const button of root.querySelectorAll<HTMLElement>(".banner-tabs .rw-tab")) {
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
        pull(view, Number(button.dataset["count"]) === 10 ? 10 : 1);
      });
    }
    for (const button of root.querySelectorAll<HTMLElement>(".banner-wish")) {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
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

    syncWallets(root);
  };

  /**
   * Pull, and take the result full-screen.
   *
   * The same component the shop uses, with ten slots instead of five. One reveal
   * in the game rather than two, and the weaker of the two — a wrapped row of
   * text pills four hundred pixels below the fold — deleted rather than kept
   * beside it.
   */
  const pull = (view: BannerView, count: 1 | 10): void => {
    const result = pullBanner(content, view.banner.id, count);
    if (!result) {
      audio.play("sfx.ui.click", { volume: 0.4 });
      return;
    }
    lastPull = result;
    audio.playMusic("music.packOpening");
    // not re-rendered here: the overlay is about to cover it, and the rebuild is
    // a measurable stall on the frame the player pressed Pull. See the shop.
    opening = openPack({
      content,
      cards: result.cards.map((card) => ({
        cardId: card.cardId,
        rarity: card.rarity,
        isNew: card.isNew,
        convertedToSignal: card.convertedToSignal,
        featured: card.featured,
        wishlisted: card.wishlisted,
        guaranteed: card.path === "hard-pity",
      })),
      eyebrow: view.banner.name,
      title: count === 10 ? "Ten pulls" : "One pull",
      tearLabel: count === 10 ? "Break the seal" : "Pull",
      accent: accentOf(view),
      back: backOf(view),
      summary: [
        { label: `Backstage ${plural(result.tokens, "Token")}`, value: result.tokens, coin: "token" },
        ...(result.signal > 0 ? [{ label: "Signal from conversions", value: result.signal, coin: "shards" as const }] : []),
      ],
      ...(result.cosmetics.length > 0
        ? { note: `Also granted: ${result.cosmetics.map((entry) => entry.name).join(", ")}` }
        : {}),
      onCollection: () => callbacks.onCollection(),
      onClose: () => {
        opening = null;
        audio.playMusic("music.menu");
        render();
      },
      walletHost: root,
    });
  };

  render();

  /**
   * Automation hook, the same shape the other screens expose.
   *
   * `pull` here deliberately does **not** open the set-piece. It is the seam the
   * browser check drives twenty times in a row to prove the pity maths, and a
   * modal that has to be dismissed between each one would be testing the modal.
   * The button path opens it; the hook does the transaction.
   */
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
      opening?.close();
      delete (window as unknown as { hypeboundBanner?: unknown }).hypeboundBanner;
    },
  };
}
