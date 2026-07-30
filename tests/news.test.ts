/**
 * News and patch notes — `03-screens-and-navigation.md` §4.2.2 and §4.2.3, and
 * the enforcement column of `07-economy-and-monetization.md` §6 policies **F1**
 * and **F4**.
 *
 * Two claims are load-bearing, and both are about a document being unable to
 * drift away from the thing it describes.
 *
 * **An article cannot quote a number the game does not use.** Every figure in
 * the feed is a token resolved from shipped data at render time. A token that
 * does not resolve fails the data check, so the choice is between a correct
 * number and a build that does not pass — there is no third option where an
 * article quietly says 2% for a year after the rate moved.
 *
 * **A patch note cannot disagree with the card or the balance it describes.** A
 * card entry records only the *before*; the after is read off the card. And the
 * newest release carries a snapshot of `economy.*` that must equal the shipped
 * one, which is what turns F4 — *"no changing odds without a patch note"* — from
 * a promise into something the test suite enforces.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { getContent } from "../src/engine/content";
import { hypeWaveData } from "../src/game/progression/hypeWave";
import {
  cardChanges,
  checkNewsData,
  checkPatchNotesData,
  compareVersions,
  DATA_VERSION,
  DEFERRED_CATEGORIES,
  economyDiff,
  latestRelease,
  newsArticles,
  newsCategories,
  newsData,
  releases,
  releaseViews,
  resolveText,
  unseenVersions,
  type ReleaseDef,
} from "../src/game/news";
import { cardAsItWas } from "../src/ui/screens/patchNotesScreen";
import {
  headlineArticle,
  markAllNewsRead,
  markArticleRead,
  markVersionSeen,
  newsFeed,
  profileStore,
  unreadNews,
  unseenReleases,
} from "../src/save/profile";

const content = getContent();

// ---------------------------------------------------------------------------

describe("the shipped feed", () => {
  it("says nothing that is not true of the shipped data", () => {
    const problems = checkNewsData(content);
    expect(problems, problems.length === 0 ? "" : `\ndata/news.json:\n  ${problems.join("\n  ")}\n`).toEqual([]);
  });

  it("leaves no token unresolved anywhere in it", () => {
    for (const article of newsArticles(content)) {
      for (const text of [article.title, article.summary, ...article.body]) {
        expect(text, `${article.def.id}: "${text}"`).not.toMatch(/\{[a-zA-Z]/);
      }
    }
  });

  /**
   * The point of the whole token mechanism. An article quoting the banner's
   * Legendary rate must quote the *shipped* rate, not a number that was true
   * when somebody typed it.
   */
  it("quotes the same odds the roller rolls", () => {
    const rate = content.balance.economy.banner.rates.legendary;
    const article = newsArticles(content).find((entry) => entry.def.id === "second-funeral-live");
    expect(article).toBeDefined();
    expect(article!.body.join(" ")).toContain(`${(rate * 100).toFixed(1)}%`);

    // and the pass article quotes the shipped tier count
    const season = newsArticles(content).find((entry) => entry.def.id === "season-one-first-upload");
    expect(season!.body.join(" ")).toContain(String(hypeWaveData().tiers));
  });

  it("leaves an unknown token visible rather than blanking it", () => {
    expect(resolveText("a {nope} b", { known: "x" })).toBe("a {nope} b");
    expect(resolveText("a {known} b", { known: "x" })).toBe("a x b");
  });

  it("only ships category chips that have something behind them", () => {
    const shown = newsCategories(content).map((category) => category.id);
    for (const id of shown) {
      expect(newsArticles(content).some((article) => article.def.category === id), id).toBe(true);
    }
    expect(shown.length).toBeGreaterThan(1);
  });

  it("accounts for the category §4.2.2 lists and this build has no content for", () => {
    expect(DEFERRED_CATEGORIES.size).toBeGreaterThan(0);
    for (const [name, reason] of DEFERRED_CATEGORIES) {
      expect(reason.trim().length, name).toBeGreaterThan(10);
      expect(newsData().categories.some((category) => category.name === name), name).toBe(false);
    }
  });

  it("sorts newest first, and every article links somewhere real", () => {
    const feed = newsArticles(content);
    for (let i = 1; i < feed.length; i++) {
      expect(feed[i - 1]!.publishedAt).toBeGreaterThanOrEqual(feed[i]!.publishedAt);
    }
    for (const article of feed) {
      if (!article.def.link) continue;
      expect(article.def.link.label.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("the patch notes", () => {
  it("says nothing that is not true of the shipped data", () => {
    const problems = checkPatchNotesData(content);
    expect(problems, problems.length === 0 ? "" : `\ndata/patch-notes.json:\n  ${problems.join("\n  ")}\n`).toEqual([]);
  });

  /**
   * F4's enforcement, stated as its own test so the failure reads as what it is.
   * Change a published rate without adding a release and this fails.
   */
  it("carries the economy it shipped with, and it matches the build", () => {
    const snapshot = latestRelease().economy;
    const drift = economyDiff(snapshot, content.balance.economy as unknown as Record<string, unknown>);
    expect(
      drift,
      drift.length === 0
        ? ""
        : `\nthe newest release's economy snapshot has drifted from balance.json:\n  ` +
          drift.map((change) => `${change.path}: ${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}`).join("\n  ") +
          `\nPolicy F4 forbids changing published odds without a patch note.\n`
    ).toEqual([]);
  });

  it("orders versions newest first", () => {
    const ordered = releases();
    for (let i = 1; i < ordered.length; i++) {
      expect(compareVersions(ordered[i - 1]!.version, ordered[i]!.version)).toBeGreaterThan(0);
    }
    expect(DATA_VERSION()).toBe(ordered[0]!.version);
  });

  it("compares versions numerically rather than as strings", () => {
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.1", "1.1.0")).toBeLessThan(0);
  });

  it("has something to say in the release it ships", () => {
    const view = releaseViews(content)[0]!;
    expect(view.current).toBe(true);
    expect(view.empty, "the shipped release records nothing at all").toBe(false);
    expect(view.def.summary.length).toBeGreaterThan(20);
  });

  it("diffs an economy key that moved, in both directions", () => {
    const before = { pack: { price: 100, rates: { common: 0.7 } }, packSize: 5 };
    const after = { pack: { price: 120, rates: { common: 0.7 } }, packSize: 5, extra: 1 };
    expect(economyDiff(before, after)).toEqual([
      { path: "extra", before: undefined, after: 1 },
      { path: "pack.price", before: 100, after: 120 },
    ]);
    // and reports nothing when nothing moved
    expect(economyDiff(before, before)).toEqual([]);
  });
});

/**
 * The card diff has no shipped example: nothing has been re-balanced yet, and
 * writing a change into `patch-notes.json` to exercise the code would put a
 * change in the player-facing record that never happened. So it is proved
 * against fixtures instead — which is the whole reason the resolution logic is a
 * pure function taking the release list rather than reading the file itself.
 */
describe("resolving a card change", () => {
  const cardId = Object.values(content.cards).find((card) => !card.token && card.type === "character")!.id;
  const live = content.cards[cardId]!;

  const release = (version: string, releasedAt: string, before: Record<string, unknown>): ReleaseDef => ({
    version,
    releasedAt,
    headline: version,
    summary: version,
    economy: {},
    cards: [{ cardId, before: before as never }],
    rules: [],
    systems: [],
    fixes: [],
  });

  it("reads the after off the shipped card when nothing later touched it", () => {
    const ordered = [release("0.2.0", "2026-08-01T00:00:00.000Z", { cost: live.cost + 2 })];
    const [change] = cardChanges(content, ordered, 0);
    expect(change!.fields).toEqual([{ field: "cost", before: live.cost + 2, after: live.cost }]);
  });

  it("chains through a later release that touched the same field", () => {
    const ordered = [
      release("0.3.0", "2026-09-01T00:00:00.000Z", { cost: 7 }),
      release("0.2.0", "2026-08-01T00:00:00.000Z", { cost: 9 }),
    ];
    // the older release's after is the newer release's before, not the live card
    expect(cardChanges(content, ordered, 1)[0]!.fields).toEqual([{ field: "cost", before: 9, after: 7 }]);
    expect(cardChanges(content, ordered, 0)[0]!.fields).toEqual([{ field: "cost", before: 7, after: live.cost }]);
  });

  it("falls through a later release that touched a different field", () => {
    const ordered = [
      release("0.3.0", "2026-09-01T00:00:00.000Z", { text: "something else" }),
      release("0.2.0", "2026-08-01T00:00:00.000Z", { cost: 9 }),
    ];
    expect(cardChanges(content, ordered, 1)[0]!.fields).toEqual([{ field: "cost", before: 9, after: live.cost }]);
  });

  it("refuses a change that does not change anything", () => {
    const ordered = [release("0.2.0", "2026-08-01T00:00:00.000Z", { cost: live.cost })];
    const change = cardChanges(content, ordered, 0)[0]!;
    expect(change.fields).toEqual([{ field: "cost", before: live.cost, after: live.cost }]);
    // which is what checkPatchNotesData reports, rather than drawing two identical cards
    expect(change.fields.every((field) => String(field.before) === String(field.after))).toBe(true);
  });

  /** The "before" frame is a real card, not a description of one. */
  it("rebuilds the card as it was, leaving everything else alone", () => {
    const was = cardAsItWas(live, { cost: live.cost + 3 });
    expect(was.cost).toBe(live.cost + 3);
    expect(was.name).toBe(live.name);
    expect(was.id).toBe(live.id);
    // and the shipped card is untouched
    expect(content.cards[cardId]!.cost).toBe(live.cost);
  });
});

describe("what the account remembers", () => {
  beforeEach(() => profileStore.reset());

  it("starts with everything unread, and the lobby shows the newest", () => {
    const feed = newsFeed(content);
    expect(feed.every((view) => !view.read)).toBe(true);
    expect(unreadNews(content)).toBe(feed.length);
    expect(headlineArticle(content)?.article.def.id).toBe(feed[0]!.article.def.id);
  });

  it("marks one read, then all of them", () => {
    const id = newsFeed(content)[0]!.article.def.id;
    expect(markArticleRead(content, id)).toBe(true);
    expect(markArticleRead(content, id)).toBe(false);
    expect(unreadNews(content)).toBe(newsFeed(content).length - 1);
    markAllNewsRead(content);
    expect(unreadNews(content)).toBe(0);
  });

  it("remembers only ids the shipped feed still carries", () => {
    markArticleRead(content, "an-article-from-a-build-that-no-longer-exists");
    expect(profileStore.get().news.read).not.toContain("an-article-from-a-build-that-no-longer-exists");
  });

  /**
   * §4.2.3's "changed since you last played" band. A brand-new account has seen
   * nothing, and lighting the band up on a first visit would claim something
   * changed since a time the player was not here for.
   */
  it("does not tell a new account that something changed while they were away", () => {
    expect(unseenReleases()).toEqual([]);
    markVersionSeen(DATA_VERSION());
    expect(unseenReleases()).toEqual([]);
  });

  /**
   * The band compares against the **newest** version seen, not the set of them.
   *
   * Releases are cumulative: somebody who has read 0.2.0's notes is caught up,
   * and was never away for 0.1.0 afterwards. Membership testing kept flagging
   * every older release an account had not explicitly opened — a permanent
   * unread badge for history it had already lived through. That could not show
   * up while the build had one release, because with one release the two
   * readings are identical.
   */
  it("flags a release the account has not opened", () => {
    expect(unseenVersions(["0.1.0"], ["0.2.0", "0.1.0"])).toEqual(["0.2.0"]);
    expect(unseenVersions(["0.2.0", "0.1.0"], ["0.2.0", "0.1.0"])).toEqual([]);
    expect(unseenVersions([], ["0.2.0", "0.1.0"]), "a new account is told nothing changed").toEqual([]);
    // the case a second release created: reading the newest catches you up
    expect(unseenVersions(["0.2.0"], ["0.2.0", "0.1.0"]), "an older release is still flagged").toEqual([]);
    expect(unseenVersions(["0.1.0"], ["0.3.0", "0.2.0", "0.1.0"])).toEqual(["0.3.0", "0.2.0"]);

    markVersionSeen(DATA_VERSION());
    expect(profileStore.get().news.seenVersions).toEqual([DATA_VERSION()]);
    expect(unseenReleases()).toEqual([]);
  });
});
