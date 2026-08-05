/**
 * Probability disclosures — `03-screens-and-navigation.md` §4.6.3.
 *
 * The screen `07-economy-and-monetization.md` §6 policy **F1** names by name:
 * *"every random grant's exact odds are displayed adjacent to its purchase
 * button **and on the Probability Disclosures screen**."* The second half of
 * that sentence had not been built.
 *
 * Every figure on this page is derived in `src/game/fairness/` from
 * `balance.economy` — the object the rollers read. There are no numbers in this
 * file, and a test asserts the tables here are element-for-element identical to
 * the ones printed beside the shop's and the banner's own buttons.
 */

import type { ContentIndex } from "../../engine/types";
import type { Screen } from "../shell";
import type { OddsTable } from "../../game/fairness";
import { bannerTable, conversionTable, dropTable, rateHistory, workedExamples } from "../../game/fairness";
import { DATA_VERSION, latestRelease } from "../../game/news";
import { audio } from "../../audio/audio";
import { count, enter, icon, longDate, quantify } from "./data/kit";

export interface FairnessCallbacks {
  onBack: () => void;
  onShop: () => void;
  onBanner: () => void;
  onPatchNotes: () => void;
}

const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Schedule dates are authored as UTC midnight, so they are formatted in UTC —
 * see the note in `src/game/inbox/`.
 */
/**
 * Pinned to en-GB, in UTC, from the one formatter.
 *
 * This was `new Intl.DateTimeFormat(undefined, …)`, which takes the
 * *browser* locale and printed "EFFECTIVE 30 JUILLET 2026" on a page whose
 * every other word is English. The game has no localisation layer, so
 * `undefined` was not correct-by-default localisation — it was uncontrolled
 * formatting, and it made every screenshot machine-dependent.
 */
const DATE = { format: (at: Date): string => longDate(at) };

const RARITY_LABEL: Record<string, string> = {
  legendary: "Legendary",
  epic: "Epic",
  rare: "Rare",
  common: "Common",
};

export function createFairnessScreen(content: ContentIndex, callbacks: FairnessCallbacks): Screen {
  const root = document.createElement("div");
  root.className = "screen fairness-screen";

  const drop = dropTable(content);
  const banner = bannerTable(content);
  const history = rateHistory();
  const release = latestRelease();

  const table = (odds: OddsTable, note: string): string => {
    const featured = odds.rows.some((row) => (row.featuredRate ?? 0) > 0);
    return `
      <section class="mat-panel fairness-table d-enter" data-table="${esc(odds.id)}">
        <div class="settings-head">
          <span class="settings-mark" aria-hidden="true">${icon("merch-drop", 20)}</span>
          <div class="policy-doc-head">
            <h2 class="t-heading">${esc(odds.name)}</h2>
            <span class="t-label">
              <span class="num">${count(odds.price)}</span> Clout · ${quantify(odds.cards, "card")}
            </span>
          </div>
        </div>
        <p class="t-body">${esc(note)}</p>
        <table class="d-table patch-table fairness-odds">
          <thead>
            <tr><th>Rarity</th><th>Per card</th>${featured ? "<th>Of which featured</th>" : ""}</tr>
          </thead>
          <tbody>
            ${odds.rows
              .map(
                (row) => `
                  <tr data-rarity="${esc(row.rarity)}">
                    <td>${esc(RARITY_LABEL[row.rarity] ?? row.rarity)}</td>
                    <td class="patch-after num">${esc(row.percent)}</td>
                    ${featured ? `<td class="patch-after num">${esc(row.featuredPercent ?? "—")}</td>` : ""}
                  </tr>`
              )
              .join("")}
          </tbody>
        </table>
        <h3 class="t-label fairness-guarantee-head">Guarantees</h3>
        <ul class="patch-list">${odds.guarantees.map((line) => `<li class="t-body">${esc(line)}</li>`).join("")}</ul>
      </section>`;
  };

  root.innerHTML = `
    <div class="ambient-bg"></div>
    <header class="screen-header">
      <button class="btn btn-ghost" id="fairness-back">${icon("arrow-left", 16)} Back</button>
      <h1 class="title">Probability Disclosures</h1>
      <div class="mastery-wallet">
        <div class="currency" title="The data version these rates belong to">
          <span class="currency-icon">${icon("diamond", 14)}</span><span class="currency-value" id="fairness-version">${esc(DATA_VERSION())}</span>
        </div>
      </div>
    </header>

    <main class="fairness-body data-body data-doc">
      <section class="mat-panel fairness-intro d-enter">
        <p class="t-body mastery-rule">
          <strong>These are the numbers the game rolls with.</strong> This page and the roller read
          the same data; they are not two copies that could disagree. A test asserts the tables here
          are identical to the ones printed beside the Merch Drop and banner buttons.
        </p>
        <p class="t-body">
          Rates for version <strong id="fairness-release">${esc(release.version)}</strong>, effective
          ${DATE.format(new Date(release.releasedAt))}. They are fixed for the lifetime of the product
          they belong to: there is no per-player tuning and no engagement-reactive luck, and the only
          things that ever move a roll are the guarantees printed below each table.
        </p>
      </section>

      ${table(
        drop,
        "Every card in a Drop is rolled independently against this table, then passed through duplicate protection."
      )}
      ${table(
        banner,
        "Every pull is rolled against this table. The featured column is the share of that rarity which is one of the banner's featured cards — it is a slice of the same rate, never an addition to it."
      )}

      <section class="mat-panel fairness-conversion d-enter">
        <div class="settings-head">
          <span class="settings-mark" aria-hidden="true">${icon("shards", 20)}</span>
          <div class="policy-doc-head">
            <h2 class="t-heading">What a card is worth</h2>
            <span class="t-label">Signal, and Backstage Tokens</span>
          </div>
        </div>
        <p class="t-body">
          A duplicate you cannot keep is converted at a better rate than dismantling one yourself,
          because you did not choose to receive it.
        </p>
        <table class="d-table patch-table">
          <thead>
            <tr><th>Rarity</th><th>Dismantle</th><th>Forced conversion</th><th>Craft</th><th>Backstage Tokens</th></tr>
          </thead>
          <tbody>
            ${conversionTable(content)
              .map(
                (row) => `
                  <tr>
                    <td>${esc(RARITY_LABEL[row.rarity] ?? row.rarity)}</td>
                    <td class="num">${count(row.dismantle)}</td>
                    <td class="patch-after num">${count(row.converted)}</td>
                    <td class="num">${count(row.craft)}</td>
                    <td class="num">${count(row.tokens)}</td>
                  </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </section>

      <section class="mat-panel fairness-faq d-enter">
        <div class="settings-head">
          <span class="settings-mark" aria-hidden="true">${icon("help", 20)}</span>
          <h2 class="t-heading">In plain language</h2>
        </div>
        <dl class="fairness-questions">
          ${workedExamples(content)
            .map((example) => `<dt>${esc(example.question)}</dt><dd>${esc(example.answer)}</dd>`)
            .join("")}
        </dl>
      </section>

      <section class="mat-panel fairness-history d-enter">
        <div class="settings-head">
          <span class="settings-mark" aria-hidden="true">${icon("log", 20)}</span>
          <div class="policy-doc-head">
            <h2 class="t-heading">Rates last changed</h2>
            <span class="t-label" id="fairness-changes">${quantify(history.length, "change")}</span>
          </div>
        </div>
        ${
          history.length === 0
            ? `<p class="t-body">
                 <strong>Never.</strong> Every release carries a snapshot of the economy it shipped with,
                 and the newest snapshot has to equal the numbers this build actually runs on or the tests
                 fail — so this is a claim the build can support rather than one it merely makes.
               </p>`
            : `<table class="d-table patch-table">
                 <thead><tr><th>Version</th><th>Key</th><th>Before</th><th>After</th></tr></thead>
                 <tbody>
                   ${history
                     .map(
                       (change) => `
                         <tr>
                           <td>${esc(change.version)}</td>
                           <td><code>${esc(change.path)}</code></td>
                           <td class="patch-before">${esc(String(change.before))}</td>
                           <td class="patch-after">${esc(String(change.after))}</td>
                         </tr>`
                     )
                     .join("")}
                 </tbody>
               </table>`
        }
        <div class="mail-actions">
          <button type="button" class="mat-panel act r-chip" id="fairness-patch">
            ${icon("log", 15)} Patch notes ${icon("chevron-right", 14)}
          </button>
          <button type="button" class="mat-panel act r-chip" id="fairness-shop">
            ${icon("merch-drop", 15)} Merch Drops ${icon("chevron-right", 14)}
          </button>
          <button type="button" class="mat-panel act r-chip" id="fairness-banner">
            ${icon("star", 15)} The banner ${icon("chevron-right", 14)}
          </button>
        </div>
      </section>
    </main>`;

  /*
   * The cascade this screen never had.
   *
   * Six panels — the intro, two odds tables, the conversion table, the worked
   * examples and the change log — arrived on one frame, which §3a names as the
   * single biggest perceived-quality gap between a hobby menu and a shipped one.
   * `stagger` is a no-op under reduced motion.
   */
  enter(root, ".d-enter", 40);

  const bind = (id: string, handler: () => void): void => {
    root.querySelector(`#${id}`)?.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      handler();
    });
  };
  bind("fairness-back", callbacks.onBack);
  bind("fairness-patch", callbacks.onPatchNotes);
  bind("fairness-shop", callbacks.onShop);
  bind("fairness-banner", callbacks.onBanner);

  /** Automation hook, the same shape the other screens expose. */
  (window as unknown as { hypeboundFairness?: unknown }).hypeboundFairness = {
    version: () => DATA_VERSION(),
    tables: () => [drop, banner],
    conversion: () => conversionTable(content),
    examples: () => workedExamples(content),
    history: () => history,
    /** Every rate as the page actually rendered it, read back off the DOM. */
    printed: () =>
      [...root.querySelectorAll<HTMLElement>(".fairness-table")].map((section) => ({
        id: section.dataset["table"],
        rows: [...section.querySelectorAll<HTMLElement>("tbody tr")].map((row) => ({
          rarity: row.dataset["rarity"],
          percent: row.querySelector("td:nth-child(2)")?.textContent?.trim(),
        })),
      })),
  };

  return {
    root,
    dispose: () => {
      delete (window as unknown as { hypeboundFairness?: unknown }).hypeboundFairness;
    },
  };
}
