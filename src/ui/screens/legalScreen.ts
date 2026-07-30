/**
 * Legal info — `03-screens-and-navigation.md` §4.6.5.
 *
 * §4.6.5 asks for Terms of Service and an EULA. **Neither has been drafted**, so
 * neither is shown: a document carries a status, and a `not-written` one renders
 * as an explanation of what is missing and why.
 *
 * That is deliberate rather than lazy. Placeholder legalese is the one category
 * of fake content that can actually hurt somebody — it reads as binding, and
 * nobody wrote it. It is the leaderboards screen's rule (*no fake ladder*)
 * applied where the stakes are highest.
 *
 * The attributions are real and are generated from `package.json`. A dependency
 * added without a credit fails `npm test`.
 */

import type { Screen } from "../shell";
import { attributions, policiesData } from "../../game/policies";
import { audio } from "../../audio/audio";

export interface LegalCallbacks {
  onBack: () => void;
  onPrivacy: () => void;
}

const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const DATE = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function createLegalScreen(callbacks: LegalCallbacks): Screen {
  const root = document.createElement("div");
  root.className = "screen policy-screen legal-screen";
  const { documents } = policiesData().legal;
  const credits = attributions();

  root.innerHTML = `
    <div class="ambient-bg"></div>
    <header class="screen-header">
      <button class="btn btn-ghost" id="legal-back">← Back</button>
      <h1 class="title">Legal</h1>
    </header>

    <main class="policy-body">
      ${documents
        .map(
          (document) => `
            <section class="panel panel-chrome policy-doc ${document.status}" data-doc="${esc(document.id)}">
              <div class="stats-table-head">
                <h2 class="profile-section-title">${esc(document.title)}</h2>
                <span class="muted">
                  ${
                    document.status === "written"
                      ? `v${esc(document.version ?? "1.0")} · ${DATE.format(new Date(document.effectiveDate ?? 0))}`
                      : "Not written"
                  }
                </span>
              </div>
              ${
                document.status === "written"
                  ? (document.body ?? []).map((line) => `<p>${esc(line)}</p>`).join("")
                  : `<p class="policy-missing">${esc(document.note ?? "")}</p>`
              }
              ${
                document.id === "attribution"
                  ? `<table class="patch-table policy-table">
                       <thead><tr><th>Package</th><th>Version</th><th>Licence</th><th>Used for</th></tr></thead>
                       <tbody>
                         ${credits
                           .map(
                             (entry) => `
                               <tr data-package="${esc(entry.package)}">
                                 <td><code>${esc(entry.package)}</code></td>
                                 <td class="muted">${esc(entry.version)}</td>
                                 <td>${esc(entry.license)}</td>
                                 <td class="muted">${esc(entry.use)}${entry.runtime ? "" : " (build and test only)"}</td>
                               </tr>`
                           )
                           .join("")}
                       </tbody>
                     </table>`
                  : ""
              }
            </section>`
        )
        .join("")}

      <section class="panel panel-chrome policy-note">
        <p class="muted">
          Two of the four documents above have not been written, and this page says so rather than
          filling the space with text nobody drafted. They are required before this build is
          distributed to anybody.
        </p>
        <div class="mail-actions">
          <button class="btn btn-ghost" id="legal-privacy">Privacy →</button>
        </div>
      </section>
    </main>`;

  root.querySelector("#legal-back")?.addEventListener("click", () => {
    audio.play("sfx.ui.click");
    callbacks.onBack();
  });
  root.querySelector("#legal-privacy")?.addEventListener("click", () => callbacks.onPrivacy());

  /** Automation hook, the same shape the other screens expose. */
  (window as unknown as { hypeboundLegal?: unknown }).hypeboundLegal = {
    documents: () => documents.map((entry) => ({ id: entry.id, title: entry.title, status: entry.status })),
    attributions: () => credits,
  };

  return {
    root,
    dispose: () => {
      delete (window as unknown as { hypeboundLegal?: unknown }).hypeboundLegal;
    },
  };
}
