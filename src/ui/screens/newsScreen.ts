/**
 * News — `03-screens-and-navigation.md` §4.2.2.
 *
 * Article list with category chips and unread markers, a reader pane with the
 * deep-link buttons the design asks for, and a shortcut to the patch notes.
 *
 * The feed is `data/news.json`, and the thing worth knowing about it is that
 * **the numbers in an article are tokens resolved from live data**, not text.
 * `{banner.legendaryRate}` reads the same balance the roller reads. An article
 * is the one place a stale number would never be spotted, so there is no way to
 * type one — see `src/game/news/`.
 */

import type { ContentIndex } from "../../engine/types";
import type { Screen } from "../shell";
import type { NewsRoute } from "../../game/news";
import { DEFERRED_CATEGORIES, DATA_VERSION, newsCategories } from "../../game/news";
import { getProfile, markAllNewsRead, markArticleRead, newsFeed, unreadNews, type NewsView } from "../../save/profile";
import { audio } from "../../audio/audio";
import {
  artAttr,
  chip,
  cloutIcon,
  count,
  disposeBag,
  enter,
  esc,
  fadeOnScroll,
  icon,
  longDate,
  quantify,
  rovingList,
} from "./data/kit";

export interface NewsCallbacks {
  onBack: () => void;
  onOpen: (screen: NewsRoute) => void;
  onPatchNotes: () => void;
}

/**
 * A hue per category, so the feed has a colour language of its own.
 *
 * Category is the only axis an article varies on, so it is the axis the hero
 * art is generated from — an Event article and a Dev Blog are visibly two
 * different rooms without either of them needing a painting made for it.
 */
const CATEGORY_ACCENT: Record<string, string> = {
  event: "#ff5fa2",
  update: "#52c8ff",
  devblog: "#ffb347",
  "dev-blog": "#ffb347",
  balance: "#c77dff",
  esports: "#35d0d8",
};

const accentFor = (categoryId: string): string => CATEGORY_ACCENT[categoryId] ?? "#b56cff";

export function createNewsScreen(
  content: ContentIndex,
  callbacks: NewsCallbacks,
  options: { articleId?: string } = {}
): Screen {
  const root = document.createElement("div");
  root.className = "screen news-screen";

  /** "" is the All chip. */
  let filter = "";
  const bag = disposeBag();
  let openId: string | null = options.articleId ?? null;

  const render = (): void => {
    bag.run();
    let feed = newsFeed(content);

    if (openId !== null && !feed.some((view) => view.article.def.id === openId)) openId = null;
    const shown = filter ? feed.filter((view) => view.article.def.category === filter) : feed;
    if (openId === null || !shown.some((view) => view.article.def.id === openId)) {
      openId = shown[0]?.article.def.id ?? null;
    }

    // whatever is showing has been read, before the counts are taken
    if (openId !== null && !feed.find((view) => view.article.def.id === openId)?.read) {
      markArticleRead(content, openId);
      feed = newsFeed(content);
    }

    const visible = filter ? feed.filter((view) => view.article.def.category === filter) : feed;
    const open: NewsView | null = feed.find((view) => view.article.def.id === openId) ?? null;
    const categories = newsCategories(content);
    const unread = unreadNews(content);

    const filterChip = (id: string, label: string): string =>
      chip({
        label,
        value: id,
        active: filter === id,
        key: "filter",
        count: id ? feed.filter((view) => view.article.def.category === id).length : feed.length,
        accent: id ? accentFor(id) : undefined,
      });

    /**
     * A row is a focusable button with a thumbnail.
     *
     * It used to be an `<li>` with a click listener — no tabindex, no role, no
     * keydown handler anywhere in the file — so the whole feed was unreachable
     * from a keyboard and a screen reader announced it as list text. The unread
     * dot was `aria-hidden` with no text alternative, so read and unread were
     * indistinguishable to anyone not looking at a 6px circle.
     */
    const row = (view: NewsView): string => {
      const { article } = view;
      const category = categories.find((entry) => entry.id === article.def.category);
      const accent = accentFor(article.def.category);
      const open = article.def.id === openId;
      return `
        <li>
          <button type="button"
                  class="news-row d-row mat-panel act d-enter ${view.read ? "" : "unread is-unread"} ${open ? "active is-open" : ""}"
                  data-id="${esc(article.def.id)}" style="--row-accent:${esc(accent)}"
                  ${open ? 'aria-current="true"' : ""}>
            ${view.read ? "" : '<span class="sr-only">Unread</span>'}
            <span class="news-thumb" aria-hidden="true"
                  ${artAttr("key", [accent, 160, 160, article.def.id, "diamond", 0, 0.09])}></span>
            <span class="d-row-body">
              <span class="news-row-head">
                <span class="news-chip" style="--c:${esc(accent)}">${esc(category?.name ?? article.def.category)}</span>
                <span class="mail-date">${esc(longDate(article.publishedAt))}</span>
              </span>
              <span class="d-row-title news-row-title">${esc(article.title)}</span>
              <span class="d-row-sub news-row-summary">${esc(article.summary)}</span>
            </span>
            <span class="d-dot" aria-hidden="true"></span>
          </button>
        </li>`;
    };

    const reader = (view: NewsView | null): string => {
      if (!view) {
        return `<div class="empty d-enter">
                  ${icon("filter", 38)}
                  <h3 class="t-heading">Nothing under that filter</h3>
                  <p class="t-body">Pick another category — the feed is short and nothing in it expires.</p>
                </div>`;
      }
      const { article } = view;
      const category = categories.find((entry) => entry.id === article.def.category);
      const accent = accentFor(article.def.category);
      return `
        <article class="news-reading" style="--row-accent:${esc(accent)}">
          <header class="news-hero d-key"
                  ${artAttr("key", [accent, 1024, 340, `hero:${article.def.id}`, "diamond", 0, 0.06])}
                  style="--key-aspect:3.2/1">
            <div class="d-key-scrim"></div>
            <div class="d-key-caption">
              <span class="t-label news-hero-eyebrow">
                ${esc(category?.name ?? article.def.category)} · ${esc(longDate(article.publishedAt))}
              </span>
              <h2 class="mail-reading-subject t-display">${esc(article.title)}</h2>
            </div>
          </header>
          <div class="mail-reading-body news-reading-body" id="news-reading-body">
            ${article.body.map((paragraph) => `<p>${esc(paragraph)}</p>`).join("")}
          </div>
          <footer class="mail-actions">
            ${
              article.def.link
                ? `<button type="button" class="mat-hero act r-chip" id="news-link" data-screen="${esc(
                    article.def.link.screen
                  )}">${esc(article.def.link.label)} ${icon("chevron-right", 14)}</button>`
                : ""
            }
            <button type="button" class="mat-chip act r-chip" id="news-patch">
              ${icon("log", 14)} Patch notes
            </button>
          </footer>
        </article>`;
    };

    const profile = getProfile();
    root.innerHTML = `
      <div class="ambient-bg"></div>
      <header class="screen-header">
        <button class="btn btn-ghost" id="news-back">${icon("arrow-left", 16)} Back</button>
        <h1 class="title">News</h1>
        <div class="mastery-wallet">
          <div class="currency" title="The data version this build is running">
            ${icon("diamond", 14)}<span class="currency-value num" id="news-version">${esc(DATA_VERSION())}</span>
          </div>
          <div class="currency">${cloutIcon(15)}<span class="currency-value num">${count(profile.clout)}</span></div>
        </div>
      </header>

      <main class="news-body data-body data-wide">
        <nav class="news-tabs d-chips" role="radiogroup" aria-label="Category">
          ${filterChip("", "All")}
          ${categories.map((entry) => filterChip(entry.id, entry.name)).join("")}
          <button type="button" class="mat-chip act r-chip" id="news-read-all" ${unread === 0 ? "disabled" : ""}>
            ${icon("check", 14)} Mark all read
          </button>
        </nav>

        <section class="panel panel-chrome news-list-panel">
          <div class="t-label news-list-count">
            ${quantify(visible.length, "article")}${unread > 0 ? ` · ${count(unread)} unread` : ""}
          </div>
          <ul class="news-list" id="news-list">${visible.map(row).join("")}</ul>
        </section>

        <section class="panel panel-chrome news-reader" id="news-reader">${reader(open)}</section>

        <section class="panel panel-chrome news-note">
          <h3 class="t-heading">About this feed</h3>
          <p class="t-body">
            Offline, the feed is a file shipped with the build — there is no live service behind
            it and nothing here updates between releases. Every number in an article is read from
            the same data the game runs on rather than typed into the text, so an article cannot
            quote a rate the game does not actually use.
          </p>
          ${[...DEFERRED_CATEGORIES]
            .map(
              ([name, reason]) =>
                `<p class="t-body"><strong>${esc(name)}</strong> is missing because ${esc(reason)}.</p>`
            )
            .join("")}
        </section>
      </main>`;

    root.querySelector("#news-back")?.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      callbacks.onBack();
    });
    for (const button of root.querySelectorAll<HTMLElement>(".news-tabs .d-chip")) {
      button.addEventListener("click", () => {
        filter = button.dataset["filter"] ?? "";
        audio.play("sfx.ui.hover");
        render();
      });
    }
    for (const entry of root.querySelectorAll<HTMLElement>(".news-row")) {
      entry.addEventListener("click", () => {
        openId = entry.dataset["id"] ?? openId;
        audio.play("sfx.ui.hover");
        render();
      });
    }
    root.querySelector("#news-read-all")?.addEventListener("click", () => {
      if (markAllNewsRead(content) > 0) audio.play("sfx.ui.click");
      render();
    });
    root.querySelector("#news-patch")?.addEventListener("click", () => callbacks.onPatchNotes());
    root.querySelector("#news-link")?.addEventListener("click", (event) => {
      const screen = (event.currentTarget as HTMLElement).dataset["screen"] as NewsRoute | undefined;
      if (screen === "patchnotes") callbacks.onPatchNotes();
      else if (screen) callbacks.onOpen(screen);
    });

    enter(root);
    bag.add(rovingList(root.querySelector<HTMLElement>("#news-list"), ".news-row"));
    bag.add(fadeOnScroll(root.querySelector<HTMLElement>("#news-list")));
  };

  render();

  /** Automation hook, the same shape the other screens expose. */
  (window as unknown as { hypeboundNews?: unknown }).hypeboundNews = {
    version: () => DATA_VERSION(),
    list: () =>
      newsFeed(content).map((view) => ({
        id: view.article.def.id,
        category: view.article.def.category,
        title: view.article.title,
        summary: view.article.summary,
        body: view.article.body,
        publishedAt: view.article.publishedAt,
        read: view.read,
        link: view.article.def.link ?? null,
      })),
    unread: () => unreadNews(content),
    open: (id: string) => {
      openId = id;
      filter = "";
      render();
      return id;
    },
    filter: (category: string) => {
      filter = category;
      render();
      return category;
    },
    readAll: () => {
      const count = markAllNewsRead(content);
      render();
      return count;
    },
    deferred: () => [...DEFERRED_CATEGORIES].map(([name, reason]) => ({ name, reason })),
    refresh: render,
  };

  return {
    root,
    dispose: () => {
      bag.run();
      delete (window as unknown as { hypeboundNews?: unknown }).hypeboundNews;
    },
  };
}
