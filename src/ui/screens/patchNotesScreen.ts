/**
 * Patch notes — `03-screens-and-navigation.md` §4.2.3.
 *
 * A version list, and per version: cards changed (before → after on real card
 * frames), the `economy.*` diff, rules, systems and fixes. Plus §4.2.3's search
 * and its *"changed since you last played"* band.
 *
 * Three things are deliberate:
 *
 * **The before frame is a real card.** A card change stores only the old values,
 * so the "before" is rendered by patching those onto the shipped card and
 * drawing it through the same renderer everything else uses. Nothing here is a
 * screenshot or a description of a card; both sides are cards.
 *
 * **The economy for the current version is printed in full.** F1 requires the
 * client to display the data version, and F4 requires an automated diff of
 * `economy.*` between releases. With one release there is nothing to diff, so
 * what this shows instead is the snapshot itself — which is the same numbers the
 * build refuses to let drift.
 *
 * **A filter with nothing behind it is not rendered.** The faction/Current
 * filter §4.2.3 asks for appears when there are card changes to filter, and says
 * why it is absent when there are none — the same rule the news categories and
 * the inbox's silent senders follow.
 */

import type { CardDef, ContentIndex, CurrentId, FactionId } from "../../engine/types";
import type { Screen } from "../shell";
import type { CardBefore, CardChangeView, ReleaseView } from "../../game/news";
import { releaseViews } from "../../game/news";
import { markVersionSeen, unseenReleases } from "../../save/profile";
import { renderCardToCanvas } from "../cardRenderer/renderCard";
import { CURRENT_PALETTE } from "../cardRenderer/palette";
import { audio } from "../../audio/audio";

export interface PatchNotesCallbacks {
  onBack: () => void;
  onCollection: () => void;
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

/** The card as it was, for the "before" frame: the shipped card with the old values back on it. */
export function cardAsItWas(card: CardDef, before: CardBefore): CardDef {
  return { ...card, ...(before as Partial<CardDef>) } as CardDef;
}

export function createPatchNotesScreen(content: ContentIndex, callbacks: PatchNotesCallbacks): Screen {
  const root = document.createElement("div");
  root.className = "screen patch-screen";

  const views = releaseViews(content);
  let openVersion = views[0]?.def.version ?? "";
  let search = "";
  /** "" is every faction; only shown when there are card changes to filter. */
  let faction = "";

  const matches = (text: string): boolean =>
    search.trim().length === 0 || text.toLowerCase().includes(search.trim().toLowerCase());

  /**
   * Does a release contain the search term anywhere?
   *
   * The page shows one release at a time, so §4.2.3's search was quietly
   * scoped to whichever one happened to be open — and would report nothing for
   * a term that is plainly in the notes, just in an older release. That was
   * invisible while there was only one release to search, and became a real bug
   * the moment there were two.
   */
  const releaseMatches = (entry: ReleaseView): boolean => {
    if (search.trim().length === 0) return true;
    const def = entry.def;
    const haystack = [
      def.headline,
      def.summary ?? "",
      ...(def.rules ?? []),
      ...(def.systems ?? []),
      ...(def.fixes ?? []),
      ...(def.cards ?? []).map((card) => JSON.stringify(card)),
    ].join(" ");
    return matches(haystack);
  };

  const render = (): void => {
    /**
     * A search follows the term to whichever release holds it.
     *
     * If the open release has no match and another does, the page opens that
     * one instead — a search box that answers "nothing" while the answer is one
     * click away is worse than no search box.
     */
    if (search.trim().length > 0) {
      const open = views.find((entry) => entry.def.version === openVersion);
      if (open && !releaseMatches(open)) {
        const elsewhere = views.find((entry) => releaseMatches(entry));
        if (elsewhere) openVersion = elsewhere.def.version;
      }
    }
    const view: ReleaseView | undefined = views.find((entry) => entry.def.version === openVersion) ?? views[0];
    const unseen = new Set(unseenReleases());
    if (view) markVersionSeen(view.def.version);

    const cardRows = (view?.cards ?? []).filter((change) => {
      if (faction && change.card?.faction !== faction) return false;
      return (
        matches(change.cardId) ||
        matches(change.card?.name ?? "") ||
        matches(change.note ?? "") ||
        change.fields.some((field) => matches(`${field.field} ${field.before} ${field.after}`))
      );
    });

    const list = (title: string, entries: string[]): string => {
      const shown = entries.filter(matches);
      if (shown.length === 0) return "";
      return `<section class="patch-section">
                <h3 class="profile-section-title">${esc(title)}</h3>
                <ul class="patch-list">${shown.map((entry) => `<li>${esc(entry)}</li>`).join("")}</ul>
              </section>`;
    };

    const factions = [...new Set((view?.cards ?? []).map((change) => change.card?.faction).filter(Boolean))] as FactionId[];

    root.innerHTML = `
      <div class="ambient-bg"></div>
      <header class="screen-header">
        <button class="btn btn-ghost" id="patch-back">← Back</button>
        <h1 class="title">Patch Notes</h1>
        <div class="mastery-wallet">
          <div class="currency" title="The data version this build is running">
            <span class="currency-icon">◆</span><span class="currency-value" id="patch-version">${esc(views[0]?.def.version ?? "—")}</span>
          </div>
        </div>
      </header>

      <main class="patch-body">
        <section class="panel panel-chrome patch-versions">
          <div class="eyebrow">Releases</div>
          <ul class="patch-version-list">
            ${views
              .map(
                (entry) => `
                  <li class="patch-version ${entry.def.version === view?.def.version ? "active" : ""} ${
                    unseen.has(entry.def.version) ? "unseen" : ""
                  }" data-version="${esc(entry.def.version)}">
                    <span class="patch-version-number">${esc(entry.def.version)}</span>
                    <span class="patch-version-headline">${esc(entry.def.headline)}</span>
                    <span class="mail-date muted">${DATE.format(new Date(entry.releasedAt))}</span>
                    ${unseen.has(entry.def.version) ? `<span class="mail-flag">New since you last played</span>` : ""}
                  </li>`
              )
              .join("")}
          </ul>
          <label class="patch-search">
            <span class="muted">Search</span>
            <input type="search" id="patch-search" value="${esc(search)}" placeholder="a card, a rule, a fix" />
          </label>
          ${
            factions.length > 0
              ? `<div class="patch-filters">
                   <button class="btn btn-sm ${faction === "" ? "active" : ""}" data-faction="">All factions</button>
                   ${factions
                     .map(
                       (id) =>
                         `<button class="btn btn-sm ${faction === id ? "active" : ""}" data-faction="${esc(id)}">${esc(
                           content.factions[id]?.name ?? id
                         )}</button>`
                     )
                     .join("")}
                 </div>`
              : `<p class="faint patch-nofilter">
                   §4.2.3's faction and Current filter appears when there are card changes to filter.
                   No card has been re-balanced yet.
                 </p>`
          }
        </section>

        <section class="panel panel-chrome patch-release" id="patch-release">
          ${
            !view
              ? `<p class="muted">No releases.</p>`
              : `
            <header class="patch-release-head">
              <div class="eyebrow">${esc(view.def.version)} · ${DATE.format(new Date(view.releasedAt))}${view.current ? " · current" : ""}</div>
              <h2 class="mail-reading-subject">${esc(view.def.headline)}</h2>
              <p class="patch-summary">${esc(view.def.summary)}</p>
            </header>

            <section class="patch-section">
              <h3 class="profile-section-title">Cards changed</h3>
              ${
                cardRows.length === 0
                  ? `<p class="muted">
                       ${
                         (view.cards.length ?? 0) > 0
                           ? "None under this filter."
                           : "None. When a card is re-balanced this shows both sides on real frames — the note records only the old values, and the new ones are read off the card itself, so the two cannot disagree."
                       }
                     </p>`
                  : `<div class="patch-cards">${cardRows.map(cardBlock).join("")}</div>`
              }
            </section>

            <section class="patch-section">
              <h3 class="profile-section-title">Economy</h3>
              ${
                view.economy.length > 0
                  ? `<table class="patch-table">
                       <thead><tr><th>Key</th><th>Before</th><th>After</th></tr></thead>
                       <tbody>
                         ${view.economy
                           .map(
                             (change) =>
                               `<tr><td><code>${esc(change.path)}</code></td><td class="patch-before">${esc(
                                 String(change.before)
                               )}</td><td class="patch-after">${esc(String(change.after))}</td></tr>`
                           )
                           .join("")}
                       </tbody>
                     </table>`
                  : `<p class="muted">
                       Nothing to diff — this is the first release. Below is the economy it shipped
                       with, which is the snapshot the build compares against: change a published
                       rate without adding a release and the tests fail.
                     </p>
                     ${snapshotTable(view)}`
              }
            </section>

            ${list("Rules", view.def.rules)}
            ${list("Systems", view.def.systems)}
            ${list("Fixed", view.def.fixes)}
            ${
              view.empty
                ? `<p class="muted">This release records no changes.</p>`
                : ""
            }`
          }
        </section>
      </main>`;

    for (const change of cardRows) {
      const host = root.querySelector(`.patch-card[data-id="${CSS.escape(change.cardId)}"] .patch-card-art`);
      if (!host || !change.card) continue;
      const before = change.fields.reduce<Record<string, unknown>>((patch, field) => {
        patch[field.field] = field.before;
        return patch;
      }, {});
      host.appendChild(renderCardToCanvas(cardAsItWas(change.card, before as CardBefore), 200));
      host.appendChild(renderCardToCanvas(change.card, 200));
    }

    root.querySelector("#patch-back")?.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      callbacks.onBack();
    });
    for (const entry of root.querySelectorAll<HTMLElement>(".patch-version")) {
      entry.addEventListener("click", () => {
        openVersion = entry.dataset["version"] ?? openVersion;
        audio.play("sfx.ui.hover");
        render();
      });
    }
    for (const button of root.querySelectorAll<HTMLElement>("[data-faction]")) {
      button.addEventListener("click", () => {
        faction = button.dataset["faction"] ?? "";
        render();
      });
    }
    const input = root.querySelector<HTMLInputElement>("#patch-search");
    input?.addEventListener("input", () => {
      search = input.value;
      render();
      // re-rendering replaces the input, so put the caret back where it was
      const again = root.querySelector<HTMLInputElement>("#patch-search");
      again?.focus();
      again?.setSelectionRange(again.value.length, again.value.length);
    });
    for (const link of root.querySelectorAll<HTMLElement>(".patch-card-open")) {
      link.addEventListener("click", () => callbacks.onCollection());
    }
  };

  const cardBlock = (change: CardChangeView): string => {
    const current = change.card?.current;
    const palette = current ? CURRENT_PALETTE[current as CurrentId] : null;
    return `
      <div class="patch-card" data-id="${esc(change.cardId)}">
        <div class="patch-card-head">
          <strong>${esc(change.card?.name ?? change.cardId)}</strong>
          ${palette ? `<span class="lobby-current-dot" style="--c:${palette.key}"></span><span class="muted">${esc(palette.label)}</span>` : ""}
        </div>
        ${change.note ? `<p class="muted">${esc(change.note)}</p>` : ""}
        <ul class="patch-fields">
          ${change.fields
            .map(
              (field) =>
                `<li><span class="patch-field">${esc(field.field)}</span>
                     <span class="patch-before">${esc(String(field.before))}</span>
                     <span class="patch-arrow">→</span>
                     <span class="patch-after">${esc(String(field.after))}</span></li>`
            )
            .join("")}
        </ul>
        <div class="patch-card-art"></div>
        <button class="btn btn-ghost btn-sm patch-card-open">Open in the collection →</button>
      </div>`;
  };

  /** The economy this release shipped with, flattened for reading. */
  const snapshotTable = (view: ReleaseView): string => {
    const rows: string[] = [];
    const walk = (value: unknown, prefix: string): void => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
          walk(entry, prefix ? `${prefix}.${key}` : key);
        }
        return;
      }
      rows.push(`<tr><td><code>${esc(prefix)}</code></td><td class="patch-after">${esc(String(value))}</td></tr>`);
    };
    walk(view.def.economy, "");
    return `<table class="patch-table">
              <thead><tr><th>Key</th><th>${esc(view.def.version)}</th></tr></thead>
              <tbody>${rows.filter((row) => matches(row)).join("")}</tbody>
            </table>`;
  };

  render();

  /** Automation hook, the same shape the other screens expose. */
  (window as unknown as { hypeboundPatch?: unknown }).hypeboundPatch = {
    version: () => views[0]?.def.version ?? null,
    releases: () =>
      views.map((view) => ({
        version: view.def.version,
        headline: view.def.headline,
        releasedAt: view.releasedAt,
        current: view.current,
        cards: view.cards.length,
        economy: view.economy.length,
        rules: view.def.rules.length,
        systems: view.def.systems.length,
        fixes: view.def.fixes.length,
        empty: view.empty,
      })),
    open: (version: string) => {
      openVersion = version;
      render();
      return version;
    },
    search: (text: string) => {
      search = text;
      render();
      return text;
    },
    /**
     * Draw a before/after pair for a card that has not actually changed.
     *
     * Automation only. The diff renderer would otherwise ship untested, because
     * no card has been re-balanced yet and inventing one in `patch-notes.json`
     * to exercise it would put a change in the player-facing record that never
     * happened. This proves the renderer works without ever writing that down.
     */
    previewDiff: (cardId: string, before: Record<string, unknown>) => {
      const card = content.cards[cardId];
      if (!card) return null;
      const was = cardAsItWas(card, before as CardBefore);
      return {
        before: renderCardToCanvas(was, 200).width,
        after: renderCardToCanvas(card, 200).width,
        changed: Object.keys(before).filter(
          (key) => (was as unknown as Record<string, unknown>)[key] !== (card as unknown as Record<string, unknown>)[key]
        ),
      };
    },
    refresh: render,
  };

  return {
    root,
    dispose: () => {
      delete (window as unknown as { hypeboundPatch?: unknown }).hypeboundPatch;
    },
  };
}
