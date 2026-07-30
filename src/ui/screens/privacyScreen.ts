/**
 * Privacy info — `03-screens-and-navigation.md` §4.6.4.
 *
 * The controls §4.6.4 asks for are **real, or absent with a reason**:
 *
 * - *Export my data* writes out every `hypebound:` key in local storage, which
 *   is genuinely everything the game knows about you. It is the strongest form
 *   the claim "we hold nothing else" can take: here is all of it.
 * - *Delete local data* is a typed confirmation, because it cannot be undone —
 *   there is no cloud copy to restore from, and the page says so before asking.
 * - *Analytics opt-out* is **not here.** There is no analytics SDK in the build,
 *   and a switch that turns off something that does not exist implies the
 *   something exists. The data table says so in the row where it would sit.
 */

import type { Screen } from "../shell";
import { currentAccount, deleteAccount } from "../../auth/account";
import { deleteMyServerData } from "../../net/playerRecord";
import { policiesData } from "../../game/policies";
import { audio } from "../../audio/audio";

export interface PrivacyCallbacks {
  onBack: () => void;
  onSupport: () => void;
  onLegal: () => void;
}

const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const DATE = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** Everything this game has stored about you, as a single JSON document. */
export function exportSave(): string {
  const out: Record<string, unknown> = {};
  if (typeof localStorage !== "undefined") {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith("hypebound:")) continue;
      try {
        out[key] = JSON.parse(localStorage.getItem(key) ?? "null");
      } catch {
        out[key] = localStorage.getItem(key);
      }
    }
  }
  return JSON.stringify(out, null, 2);
}

/** How many bytes of you there are. */
export function saveSize(): number {
  return exportSave().length;
}

export function createPrivacyScreen(callbacks: PrivacyCallbacks): Screen {
  const root = document.createElement("div");
  root.className = "screen policy-screen privacy-screen";
  const { privacy } = policiesData();

  const render = (): void => {
    const bytes = saveSize();
    root.innerHTML = `
      <div class="ambient-bg"></div>
      <header class="screen-header">
        <button class="btn btn-ghost" id="privacy-back">← Back</button>
        <h1 class="title">Privacy</h1>
        <div class="mastery-wallet">
          <div class="currency" title="Policy version">
            <span class="currency-icon">◆</span><span class="currency-value">${esc(privacy.version)}</span>
          </div>
        </div>
      </header>

      <main class="policy-body">
        <section class="panel panel-chrome policy-summary">
          <div class="eyebrow">In plain language · effective ${DATE.format(new Date(privacy.effectiveDate))}</div>
          ${privacy.summary.map((line) => `<p>${esc(line)}</p>`).join("")}
        </section>

        <section class="panel panel-chrome policy-table-panel">
          <h2 class="profile-section-title">What is and is not collected</h2>
          <table class="patch-table policy-table">
            <thead><tr><th>Category</th><th>Collected</th><th>Detail</th><th>Where</th></tr></thead>
            <tbody>
              ${privacy.categories
                .map(
                  (category) => `
                    <tr data-collected="${category.collected}">
                      <td><strong>${esc(category.name)}</strong></td>
                      <td class="${category.collected ? "patch-after" : "muted"}">${category.collected ? "Yes" : "No"}</td>
                      <td>${esc(category.detail)}</td>
                      <td class="muted">${esc(category.where ?? "—")}</td>
                    </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </section>

        <section class="panel panel-chrome policy-controls">
          <h2 class="profile-section-title">Your controls</h2>
          <p class="muted">
            Your save is <strong id="privacy-size">${bytes.toLocaleString()}</strong> bytes in this browser.
            The export is the whole of it — not a summary, not a subset.
          </p>
          <div class="mail-actions">
            <button class="btn btn-primary" id="privacy-export">Export my data</button>
            <button class="btn btn-ghost" id="privacy-show">Show it here</button>
            <button class="btn btn-ghost" id="privacy-delete">Delete everything on this device</button>
            <button class="btn btn-ghost" id="privacy-delete-online" hidden>Delete my account</button>
          </div>
          <p class="muted" id="privacy-online-note" hidden>
            This erases the match results this game's server recorded — wins, losses and the leaders
            involved — <strong>and then deletes the account itself</strong>, email address and all.
            It cannot be undone and there is nobody to ask to reverse it.
          </p>
          <p class="muted" id="privacy-online-note-2" hidden>
            Your save stays where it is: the collection, decks and progress on this device are not
            part of the account and are not touched. Use the button above for those.
          </p>
          <pre class="policy-dump" id="privacy-dump" hidden></pre>
        </section>

        <section class="panel panel-chrome policy-note">
          <h2 class="profile-section-title">Children</h2>
          ${privacy.children.map((line) => `<p class="muted">${esc(line)}</p>`).join("")}
          <h2 class="profile-section-title">Data requests</h2>
          ${privacy.requests.map((line) => `<p class="muted">${esc(line)}</p>`).join("")}
          <div class="mail-actions">
            <button class="btn btn-ghost" id="privacy-support">Customer support →</button>
            <button class="btn btn-ghost" id="privacy-legal">Legal information →</button>
          </div>
        </section>
      </main>`;

    root.querySelector("#privacy-back")?.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      callbacks.onBack();
    });
    root.querySelector("#privacy-support")?.addEventListener("click", () => callbacks.onSupport());
    root.querySelector("#privacy-legal")?.addEventListener("click", () => callbacks.onLegal());

    root.querySelector("#privacy-show")?.addEventListener("click", () => {
      const dump = root.querySelector<HTMLElement>("#privacy-dump");
      if (!dump) return;
      dump.textContent = exportSave();
      dump.hidden = !dump.hidden;
    });

    root.querySelector("#privacy-export")?.addEventListener("click", () => {
      const blob = new Blob([exportSave()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "hypebound-save.json";
      link.click();
      URL.revokeObjectURL(url);
    });

    /**
     * A typed confirmation rather than an OK button. There is no cloud copy and
     * no undo, so the friction is the feature — and the word to type is the one
     * the button does, not a generic "yes".
     */
    root.querySelector("#privacy-delete")?.addEventListener("click", () => {
      const typed = window.prompt(
        "This erases your collection, decks, progress and settings on this device. There is no cloud copy and no way to undo it.\n\nType DELETE to confirm."
      );
      if (typed !== "DELETE") return;
      /**
       * Both prefixes, and the asymmetry with `exportSave()` is deliberate.
       *
       * The save lives under `hypebound:`. A signed-in session lives under
       * `hypebound-auth:`, deliberately outside that prefix so the export —
       * which walks every `hypebound:` key into a downloadable file, and which
       * this screen will print into the page — cannot put a bearer token in a
       * text file the player might send to somebody.
       *
       * That is right for the export and wrong for this button, because this
       * one says *everything on this device*. So the two operations differ on
       * purpose: the export is "what this game knows about you", and the delete
       * is "everything, including the credential".
       */
      const doomed = Object.keys(localStorage).filter(
        (entry) => entry.startsWith("hypebound:") || entry.startsWith("hypebound-auth:")
      );
      for (const key of doomed) localStorage.removeItem(key);
      window.location.hash = "#lobby";
      window.location.reload();
    });

    /**
     * Deleting what the *server* holds — shown only when there is an account.
     *
     * A signed-out player has no online data, and a button offering to delete
     * nothing is a button that suggests something is being kept.
     */
    const online = root.querySelector<HTMLElement>("#privacy-delete-online");
    const onlineNote = root.querySelector<HTMLElement>("#privacy-online-note");
    if (currentAccount()) {
      online?.removeAttribute("hidden");
      onlineNote?.removeAttribute("hidden");
      root.querySelector("#privacy-online-note-2")?.removeAttribute("hidden");
    }

    online?.addEventListener("click", () => {
      void (async () => {
        // The same word as the local delete, for the same reason: no undo, so
        // the friction is the feature.
        const typed = window.prompt(
          "This deletes your account and every match result recorded against it. It cannot be undone. Your save on this device is not affected.\n\nType DELETE to confirm."
        );
        if (typed !== "DELETE") return;
        /**
         * The game's own data first, the account second, and the order is not
         * arbitrary: erasing the account invalidates nothing about the token
         * (the Worker verifies a signature, not a user row), but leaving the
         * results behind for an account that no longer exists would be keeping
         * data about a person who asked to be forgotten.
         */
        const recordGone = await deleteMyServerData();
        const account = await deleteAccount();
        window.alert(
          account.ok
            ? recordGone
              ? "Deleted. Your account is gone and so are the match results recorded against it."
              : "Your account is deleted, but the match results could not be reached and may still be held. Sign-in will no longer work; contact is not yet possible, which is a gap this page admits to."
            : `Nothing was deleted: ${account.message}`
        );
        window.location.hash = "#lobby";
        window.location.reload();
      })();
    });
  };

  render();

  /** Automation hook, the same shape the other screens expose. */
  (window as unknown as { hypeboundPrivacy?: unknown }).hypeboundPrivacy = {
    categories: () => policiesData().privacy.categories,
    exportText: () => exportSave(),
    size: () => saveSize(),
    version: () => policiesData().privacy.version,
    refresh: render,
  };

  return {
    root,
    dispose: () => {
      delete (window as unknown as { hypeboundPrivacy?: unknown }).hypeboundPrivacy;
    },
  };
}
