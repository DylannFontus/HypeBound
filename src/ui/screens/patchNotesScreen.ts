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
import { motionEnabled } from "../motion";
import {
  chip,
  disposeBag,
  economyLabel,
  enter,
  esc,
  fadeOnScroll,
  icon,
  longDate,
  rovingList,
} from "./data/kit";

export interface PatchNotesCallbacks {
  onBack: () => void;
  onCollection: () => void;
}

/**
 * A before → after pair, as a diff rather than as a dump.
 *
 * The Economy table printed the literal string **"undefined"** six times in its
 * BEFORE column, because `change.before` is genuinely undefined on a first
 * release and `String(undefined)` is what a template literal does with that. A
 * viewer who has never seen either build identifies the one with "undefined" on
 * screen in under a second, which is §0's test failed on the first glance.
 *
 * A first release gets an em-dash and a NEW chip. A real change gets an arrow, a
 * strike through the old value, and a signed delta coloured *and* signed, so the
 * direction survives greyscale.
 */
function diffCells(before: unknown, after: unknown): string {
  const isNew = before === undefined || before === null || before === "";
  const from = Number(before);
  const to = Number(after);
  const numeric = !isNew && Number.isFinite(from) && Number.isFinite(to);
  const delta = numeric ? to - from : 0;

  return (
    `<td class="patch-before">${
      isNew ? `<span class="d-new">new</span>` : `<span class="d-was">${esc(String(before))}</span>`
    }</td>` +
    `<td class="patch-after"><span class="d-now">${esc(String(after))}</span>${
      numeric && delta !== 0
        ? ` <span class="${delta > 0 ? "d-delta-up" : "d-delta-down"}">${delta > 0 ? "+" : "−"}${Math.abs(
            Number(delta.toFixed(4))
          )}</span>`
        : ""
    }</td>`
  );
}

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
  const bag = disposeBag();
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
    bag.run();
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

    /*
     * Every section registers itself, so the rail can index the document.
     *
     * 0.2.0 is 2,250px tall beside a 340px release list, which left the left
     * third of the frame empty for 1,900px of scrolling and gave a reader no way
     * back to the top of a section they had passed. An index is the standard
     * answer to both and it is not decoration: these are real anchors into real
     * headings, built from the same array that renders them, so a section that
     * filters itself out of the article also disappears from the contents.
     */
    const sections: { id: string; title: string; count: number | null }[] = [];
    const register = (id: string, title: string, count: number | null): string => {
      sections.push({ id, title, count });
      return id;
    };

    const list = (title: string, entries: string[]): string => {
      const shown = entries.filter(matches);
      if (shown.length === 0) return "";
      const id = register(`patch-s-${title.toLowerCase()}`, title, shown.length);
      return `<section class="patch-section" id="${id}">
                <h3 class="t-heading">${esc(title)}</h3>
                <ul class="patch-list">${shown.map((entry) => `<li>${esc(entry)}</li>`).join("")}</ul>
              </section>`;
    };

    const factions = [...new Set((view?.cards ?? []).map((change) => change.card?.faction).filter(Boolean))] as FactionId[];

    /*
     * The article is built before the page, because the index is built from it.
     *
     * `register()` fills `sections` as each block renders, and a template literal
     * evaluates left to right — so with the rail written above the article in one
     * template, the contents list would always be a frame behind, and on first
     * render it would be empty. Building the article into a string first is the
     * whole fix.
     */
    const article = !view
      ? `<p class="muted">No releases.</p>`
      : `
            <header class="patch-release-head">
              <div class="t-label patch-release-eyebrow">${esc(view.def.version)} · ${esc(longDate(view.releasedAt))}${
                view.current ? " · current" : ""
              }</div>
              <h2 class="mail-reading-subject">${esc(view.def.headline)}</h2>
              <p class="patch-summary">${esc(view.def.summary)}</p>
            </header>

            <section class="patch-section" id="${register("patch-s-cards", "Cards changed", cardRows.length)}">
              <h3 class="t-heading">Cards changed</h3>
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

            <section class="patch-section" id="${register("patch-s-economy", "Economy", view.economy.length)}">
              <h3 class="t-heading">Economy</h3>
              ${
                view.economy.length > 0
                  ? `<table class="patch-table d-table">
                       <thead><tr><th>What changed</th><th>Before</th><th>After</th></tr></thead>
                       <tbody>
                         ${view.economy
                           .map(
                             (change) =>
                               `<tr><td>${esc(economyLabel(change.path))}</td>${diffCells(
                                 change.before,
                                 change.after
                               )}</tr>`
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
            }`;

    root.innerHTML = `
      <div class="ambient-bg"></div>
      <header class="screen-header">
        <button class="btn btn-ghost" id="patch-back">${icon("arrow-left", 16)} Back</button>
        <h1 class="title">Patch Notes</h1>
        <div class="mastery-wallet">
          <div class="currency" title="The data version this build is running">
            ${icon("diamond", 14)}<span class="currency-value num" id="patch-version">${esc(views[0]?.def.version ?? "—")}</span>
          </div>
        </div>
      </header>

      <main class="patch-body data-body data-wide">
        <section class="panel panel-chrome patch-versions">
          <div class="t-label">Releases</div>
          <ul class="patch-version-list">
            ${views
              .map(
                (entry) => `
                  <li>
                    <button type="button"
                            class="patch-version d-row mat-panel act d-enter ${
                              entry.def.version === view?.def.version ? "active is-open" : ""
                            } ${unseen.has(entry.def.version) ? "unseen is-unread" : ""}"
                            data-version="${esc(entry.def.version)}"
                            ${entry.def.version === view?.def.version ? `aria-current="true"` : ""}>
                      ${unseen.has(entry.def.version) ? `<span class="sr-only">New since you last played</span>` : ""}
                      <span class="patch-version-number num">${esc(entry.def.version)}</span>
                      <span class="d-row-body">
                        <span class="d-row-title patch-version-headline">${esc(entry.def.headline)}</span>
                        <span class="d-row-meta">${esc(longDate(entry.releasedAt))}</span>
                      </span>
                      ${
                        unseen.has(entry.def.version)
                          ? `<span class="d-badge">${icon("dot", 11)}New</span>`
                          : `<span></span>`
                      }
                    </button>
                  </li>`
              )
              .join("")}
          </ul>
          <label class="patch-search field-group">
            <span class="t-label">Search</span>
            <input class="field" type="search" id="patch-search" value="${esc(search)}"
                   placeholder="a card, a rule, a fix" />
          </label>
          ${
            factions.length > 0
              ? `<div class="patch-filters d-chips" role="radiogroup" aria-label="Faction">
                   ${chip({ label: "All factions", value: "", active: faction === "", key: "faction" })}
                   ${factions
                     .map((id) =>
                       chip({
                         label: content.factions[id]?.name ?? id,
                         value: id,
                         active: faction === id,
                         key: "faction",
                       })
                     )
                     .join("")}
                 </div>`
              : `<p class="patch-nofilter t-body">
                   A faction filter appears here the moment a card has been re-balanced. None has yet.
                 </p>`
          }

          ${
            sections.length > 1
              ? `<nav class="patch-index" aria-label="In this release">
                   <div class="t-label">In this release</div>
                   <ul>
                     ${sections
                       .map(
                         (section) => `
                           <li>
                             <a class="patch-index-link" href="#${esc(section.id)}" data-jump="${esc(section.id)}">
                               <span>${esc(section.title)}</span>
                               ${
                                 section.count === null
                                   ? ""
                                   : `<span class="patch-index-count num">${section.count}</span>`
                               }
                             </a>
                           </li>`
                       )
                       .join("")}
                   </ul>
                 </nav>`
              : ""
          }
        </section>

        <section class="panel panel-chrome patch-release" id="patch-release">
          ${article}
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

    /*
     * The index scrolls the page rather than jumping it.
     *
     * A bare `href="#id"` would work, and would also rewrite `location.hash` —
     * which is the router's own channel, so clicking "Economy" would navigate to
     * a route called `patch-s-economy` and land on the error screen. The href
     * stays for middle-click and for anyone reading the markup; the handler is
     * what actually runs.
     */
    for (const link of root.querySelectorAll<HTMLAnchorElement>("[data-jump]")) {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        root.querySelector(`#${CSS.escape(link.dataset["jump"] ?? "")}`)?.scrollIntoView({
          behavior: motionEnabled() ? "smooth" : "auto",
          block: "start",
        });
      });
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

    enter(root);
    bag.add(rovingList(root.querySelector<HTMLElement>(".patch-version-list"), ".patch-version"));
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
        <button type="button" class="mat-chip act r-chip patch-card-open">Open in the collection ${icon(
          "chevron-right",
          13
        )}</button>
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
      rows.push(
        `<tr><td>${esc(economyLabel(prefix))}</td><td class="patch-after"><span class="d-now">${esc(
          String(value)
        )}</span></td></tr>`
      );
    };
    walk(view.def.economy, "");
    return `<table class="patch-table d-table">
              <thead><tr><th>What it pays</th><th>${esc(view.def.version)}</th></tr></thead>
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
      bag.run();
      delete (window as unknown as { hypeboundPatch?: unknown }).hypeboundPatch;
    },
  };
}
