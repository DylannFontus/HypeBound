/**
 * Customer support — `03-screens-and-navigation.md` §4.6.6.
 *
 * *"Offline build ships FAQ + diagnostic export; live ticketing is online."*
 * That is exactly what this is: a searchable FAQ, and a bug report that produces
 * a real file.
 *
 * The diagnostic is the part worth reading. §4.6.6 asks for *"version, device,
 * validated-data hash, last match seed; PII-free, **shown to the player before
 * sending/exporting**"* — so it is rendered on the page first, in full, and the
 * export button is below it. There is no name, no save data and nothing that
 * identifies anybody in it; the data hash and the match seed are there because
 * "it does not reproduce" is usually "we are not playing the same game".
 */

import type { ContentIndex } from "../../engine/types";
import type { Screen } from "../shell";
import { buildDiagnostics, policiesData } from "../../game/policies";
import { getProfile } from "../../save/profile";
import { audio } from "../../audio/audio";

export interface SupportCallbacks {
  onBack: () => void;
  onPrivacy: () => void;
  onFairness: () => void;
  onCollection: () => void;
}

const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The seed of the most recent match, which usually replays the bug. */
function lastMatchSeed(): number | null {
  const entry = getProfile().history.find((match) => match.record);
  return entry?.record?.config.seed ?? null;
}

export function createSupportScreen(content: ContentIndex, callbacks: SupportCallbacks): Screen {
  const root = document.createElement("div");
  root.className = "screen policy-screen support-screen";
  const { faq } = policiesData().support;

  let query = "";

  const diagnostics = (): ReturnType<typeof buildDiagnostics> =>
    buildDiagnostics(content, { lastMatchSeed: lastMatchSeed(), matchesPlayed: getProfile().stats.matchesPlayed });

  const render = (): void => {
    const needle = query.trim().toLowerCase();
    const shown = needle
      ? faq.filter((entry) =>
          [entry.question, ...entry.answer, ...entry.tags].join(" ").toLowerCase().includes(needle)
        )
      : faq;
    const report = diagnostics();

    root.innerHTML = `
      <div class="ambient-bg"></div>
      <header class="screen-header">
        <button class="btn btn-ghost" id="support-back">← Back</button>
        <h1 class="title">Support</h1>
        <div class="mastery-wallet">
          <div class="currency" title="The data version this build is running">
            <span class="currency-icon">◆</span><span class="currency-value">${esc(report.dataVersion)}</span>
          </div>
        </div>
      </header>

      <main class="policy-body">
        <section class="panel panel-chrome support-faq">
          <div class="stats-table-head">
            <h2 class="profile-section-title">Frequently asked</h2>
            <span class="muted" id="support-count">${shown.length} of ${faq.length}</span>
          </div>
          <label class="patch-search">
            <span class="muted">Search</span>
            <input type="search" id="support-search" value="${esc(query)}" placeholder="save, odds, bug, multiplayer" />
          </label>
          ${
            shown.length === 0
              ? `<p class="muted">Nothing matches “${esc(query)}”. There is no ticket queue in this build — the diagnostic export below is the way to send something on.</p>`
              : `<dl class="fairness-questions" id="support-list">
                   ${shown
                     .map(
                       (entry) => `
                         <dt data-faq="${esc(entry.id)}">${esc(entry.question)}</dt>
                         <dd>${entry.answer.map((line) => `<p>${esc(line)}</p>`).join("")}</dd>`
                     )
                     .join("")}
                 </dl>`
          }
        </section>

        <section class="panel panel-chrome support-report">
          <h2 class="profile-section-title">Report a bug</h2>
          <p class="muted">
            There is no ticket queue offline, so this exports a file you can attach wherever you are
            reporting. It is shown in full below first — there is nothing in it that identifies you,
            and no part of your save.
          </p>
          <table class="patch-table policy-table" id="support-diagnostic">
            <tbody>
              ${Object.entries(report)
                .map(
                  ([key, value]) =>
                    `<tr data-key="${esc(key)}"><td><code>${esc(key)}</code></td><td class="patch-after">${esc(
                      String(value ?? "—")
                    )}</td></tr>`
                )
                .join("")}
            </tbody>
          </table>
          <div class="mail-actions">
            <button class="btn btn-primary" id="support-export">Export the diagnostic</button>
            <button class="btn btn-ghost" id="support-privacy">What is stored about me →</button>
            <button class="btn btn-ghost" id="support-fairness">Probability disclosures →</button>
            <button class="btn btn-ghost" id="support-cards">Card and rules reference →</button>
          </div>
        </section>

        <section class="panel panel-chrome policy-note">
          <h2 class="profile-section-title">Safety, and spending</h2>
          <p class="muted">
            There is no chat, no friends list and no player-to-player messaging in this build, so
            there is nobody to report and nothing to block. Those tools arrive with the server, along
            with the appeal route for anything a moderator does.
          </p>
          <p class="muted">
            There is also nothing to spend money on: this build takes no payments at all, which makes
            spending controls a feature with nothing to control. Session reminders and caps arrive with
            the online build.
          </p>
        </section>
      </main>`;

    root.querySelector("#support-back")?.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      callbacks.onBack();
    });
    root.querySelector("#support-privacy")?.addEventListener("click", () => callbacks.onPrivacy());
    root.querySelector("#support-fairness")?.addEventListener("click", () => callbacks.onFairness());
    root.querySelector("#support-cards")?.addEventListener("click", () => callbacks.onCollection());

    root.querySelector("#support-export")?.addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(diagnostics(), null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "hypebound-diagnostic.json";
      link.click();
      URL.revokeObjectURL(url);
    });

    const input = root.querySelector<HTMLInputElement>("#support-search");
    input?.addEventListener("input", () => {
      query = input.value;
      render();
      const again = root.querySelector<HTMLInputElement>("#support-search");
      again?.focus();
      again?.setSelectionRange(again.value.length, again.value.length);
    });
  };

  render();

  /** Automation hook, the same shape the other screens expose. */
  (window as unknown as { hypeboundSupport?: unknown }).hypeboundSupport = {
    faq: () => faq.map((entry) => ({ id: entry.id, question: entry.question, tags: entry.tags })),
    search: (text: string) => {
      query = text;
      render();
      return root.querySelectorAll("#support-list dt").length;
    },
    diagnostic: () => diagnostics(),
    refresh: render,
  };

  return {
    root,
    dispose: () => {
      delete (window as unknown as { hypeboundSupport?: unknown }).hypeboundSupport;
    },
  };
}
