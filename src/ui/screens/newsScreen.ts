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

export interface NewsCallbacks {
  onBack: () => void;
  onOpen: (screen: NewsRoute) => void;
  onPatchNotes: () => void;
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

export function createNewsScreen(
  content: ContentIndex,
  callbacks: NewsCallbacks,
  options: { articleId?: string } = {}
): Screen {
  const root = document.createElement("div");
  root.className = "screen news-screen";

  /** "" is the All chip. */
  let filter = "";
  let openId: string | null = options.articleId ?? null;

  const render = (): void => {
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

    const chip = (id: string, label: string): string => {
      const count = id ? feed.filter((view) => view.article.def.category === id).length : feed.length;
      return `<button class="btn mastery-tab ${filter === id ? "active" : ""}" data-filter="${esc(id)}">
                ${esc(label)} <span class="muted">${count}</span>
              </button>`;
    };

    const row = (view: NewsView): string => {
      const { article } = view;
      const category = categories.find((entry) => entry.id === article.def.category);
      return `
        <li class="news-row ${view.read ? "" : "unread"} ${article.def.id === openId ? "active" : ""}"
            data-id="${esc(article.def.id)}">
          <span class="mail-dot" aria-hidden="true"></span>
          <span class="news-row-body">
            <span class="news-row-head">
              <span class="news-chip">${esc(category?.name ?? article.def.category)}</span>
              <span class="mail-date muted">${DATE.format(new Date(article.publishedAt))}</span>
            </span>
            <span class="news-row-title">${esc(article.title)}</span>
            <span class="news-row-summary muted">${esc(article.summary)}</span>
          </span>
        </li>`;
    };

    const reader = (view: NewsView | null): string => {
      if (!view) {
        return `<div class="mail-empty">
                  <h2 class="profile-section-title">Nothing under that filter</h2>
                  <p class="muted">Pick another category.</p>
                </div>`;
      }
      const { article } = view;
      const category = categories.find((entry) => entry.id === article.def.category);
      return `
        <article class="news-reading">
          <header class="mail-reading-head">
            <div class="eyebrow">${esc(category?.name ?? article.def.category)} · ${DATE.format(new Date(article.publishedAt))}</div>
            <h2 class="mail-reading-subject">${esc(article.title)}</h2>
          </header>
          <div class="mail-reading-body">
            ${article.body.map((paragraph) => `<p>${esc(paragraph)}</p>`).join("")}
          </div>
          <footer class="mail-actions">
            ${
              article.def.link
                ? `<button class="btn btn-primary" id="news-link" data-screen="${esc(article.def.link.screen)}">${esc(article.def.link.label)} →</button>`
                : ""
            }
            <button class="btn btn-ghost" id="news-patch">Patch notes →</button>
          </footer>
        </article>`;
    };

    const profile = getProfile();
    root.innerHTML = `
      <div class="ambient-bg"></div>
      <header class="screen-header">
        <button class="btn btn-ghost" id="news-back">← Back</button>
        <h1 class="title">News</h1>
        <div class="mastery-wallet">
          <div class="currency" title="The data version this build is running">
            <span class="currency-icon">◆</span><span class="currency-value" id="news-version">${esc(DATA_VERSION())}</span>
          </div>
          <div class="currency"><span class="currency-icon clout">◈</span><span class="currency-value">${profile.clout.toLocaleString()}</span></div>
        </div>
      </header>

      <main class="news-body">
        <nav class="mastery-tabs news-tabs">
          ${chip("", "All")}
          ${categories.map((entry) => chip(entry.id, entry.name)).join("")}
          <button class="btn btn-ghost btn-sm" id="news-read-all" ${unread === 0 ? "disabled" : ""}>Mark all read</button>
        </nav>

        <section class="panel panel-chrome news-list-panel">
          <div class="eyebrow">${visible.length} article${visible.length === 1 ? "" : "s"}${unread > 0 ? ` · ${unread} unread` : ""}</div>
          <ul class="news-list" id="news-list">${visible.map(row).join("")}</ul>
        </section>

        <section class="panel panel-chrome news-reader" id="news-reader">${reader(open)}</section>

        <section class="panel panel-chrome news-note">
          <h3 class="profile-section-title">About this feed</h3>
          <p class="muted">
            Offline, the feed is a file shipped with the build — there is no live service behind
            it and nothing here updates between releases. Every number in an article is read from
            the same data the game runs on rather than typed into the text, so an article cannot
            quote a rate the game does not actually use.
          </p>
          ${[...DEFERRED_CATEGORIES]
            .map(
              ([name, reason]) =>
                `<p class="muted"><strong>${esc(name)}</strong> is missing because ${esc(reason)}.</p>`
            )
            .join("")}
        </section>
      </main>`;

    root.querySelector("#news-back")?.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      callbacks.onBack();
    });
    for (const button of root.querySelectorAll<HTMLElement>(".mastery-tab")) {
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
      delete (window as unknown as { hypeboundNews?: unknown }).hypeboundNews;
    },
  };
}
