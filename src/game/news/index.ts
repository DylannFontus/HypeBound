/**
 * The news feed — `03-screens-and-navigation.md` §4.2.2.
 *
 * *"Offline build reads a local news JSON shipped with the build; live feed is an
 * online feature."*
 *
 * ## Numbers in an article are tokens, never typed
 *
 * `{banner.legendaryRate}` resolves from the same balance data the roller uses.
 * A number typed into prose is a number that stops being true the day somebody
 * re-balances, and an article is the one place nobody would ever check — which
 * is precisely the failure `07-economy-and-monetization.md` §6 policy **F1**
 * exists to prevent. `checkNewsData` fails on a token it cannot resolve and on
 * any brace left in the text after resolution, so the choice is between a
 * correct number and a build that does not pass.
 *
 * It is the same rule the pass calibration follows — *re-derived, never a quoted
 * constant* — applied to sentences instead of to tests.
 *
 * ## An article is bound to its subject by id
 *
 * `{subject.ends}` in the season-one article means season one forever, because
 * the article names `s1-first-upload` rather than asking for "the current
 * season". An article that silently re-pointed at the next season would be the
 * worst kind of wrong: still grammatical, still plausible, and about something
 * else entirely.
 */

import type { ContentIndex } from "../../engine/types";
import { collectibleCards } from "../../engine/content";
import { checkInConfig } from "../progression/data";
import { hypeWaveData, seasonById, seasonEnd, seasonStart } from "../progression/hypeWave";
import { bannerById, runEnd, runStart } from "../economy/banner";
import { newsData, type NewsArticleDef, type NewsCategory, type NewsSubject } from "./data";

export {
  newsData,
  patchNotesData,
  resetNewsData,
  NewsDataError,
  NEWS_ROUTES,
  type CardBefore,
  type CardChangeDef,
  type NewsArticleDef,
  type NewsCategory,
  type NewsRoute,
  type NewsSubject,
  type ReleaseDef,
} from "./data";

export {
  releases,
  latestRelease,
  releaseViews,
  economyDiff,
  cardChanges,
  checkPatchNotesData,
  compareVersions,
  unseenVersions,
  CARD_FIELDS,
  DATA_VERSION,
  type CardChangeView,
  type CardFieldChange,
  type EconomyChange,
  type ReleaseView,
} from "./patchNotes";

/**
 * Schedule dates are authored as UTC midnight, so they are formatted in UTC.
 *
 * Formatting them locally renders 2026-07-27T00:00Z as "26 July" for everyone
 * west of Greenwich — a run advertised as ending a day before the data says it
 * does. These are calendar dates in a data file rather than moments in a
 * player's day, and they should read the same everywhere.
 */
const DATE = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const on = (at: number): string => DATE.format(new Date(at));
const pct = (rate: number): string => `${(rate * 100).toFixed(1)}%`;

/**
 * The category §4.2.2 lists that has nothing to put in it.
 *
 * Listed with its reason rather than shipped as an empty chip, because a filter
 * that always finds nothing is indistinguishable from a filter that is broken —
 * the same argument the inbox makes about its silent senders.
 */
export const DEFERRED_CATEGORIES: ReadonlyMap<string, string> = new Map([
  ["Esports", "there is no competitive circuit to report on until ranked play and tournaments exist, which need a server"],
]);

/**
 * Every number an article may quote, resolved from shipped data.
 *
 * Deliberately a flat, closed vocabulary. A general expression language here
 * would let an article compute something the game does not actually do, which is
 * the failure mode this whole approach exists to close.
 */
function globalTokens(content: ContentIndex): Record<string, string> {
  const { economy } = content.balance;
  const pass = hypeWaveData();
  return {
    "cards.total": String(Object.keys(content.cards).length),
    "cards.collectible": String(collectibleCards(content).length),
    leaders: String(Object.keys(content.leaders).length),
    factions: String(Object.keys(content.factions).filter((id) => id !== "neutral").length),
    currents: String(Object.keys(content.currents).length),
    confluences: String(Object.keys(content.confluences).length),

    "pass.tiers": String(pass.tiers),
    "pass.xpPerTier": pass.xpPerTier.toLocaleString(),
    "pass.encoreClout": String(pass.encoreClout),
    "pass.backstagePrice": pass.backstagePrice.toLocaleString(),
    "pass.archiveRate": `${Math.round(pass.archiveRate * 100)}%`,
    "pass.reboundBonus": `${Math.round(pass.rebound.bonus * 100)}%`,

    "banner.pullPrice": economy.banner.pullPrice.toLocaleString(),
    "banner.hardPity": String(economy.banner.hardPity),
    "banner.epicWindow": String(economy.banner.epicPityWindow),
    "banner.tokensPerPull": String(economy.banner.tokensPerPull),
    "banner.wishlistLimit": String(economy.banner.wishlistLimit),
    "banner.commonRate": pct(economy.banner.rates.common),
    "banner.rareRate": pct(economy.banner.rates.rare),
    "banner.epicRate": pct(economy.banner.rates.epic),
    "banner.legendaryRate": pct(economy.banner.rates.legendary),

    "drop.price": economy.pack.price.toLocaleString(),
    "drop.size": String(economy.packSize),
    "drop.pity": String(economy.pack.legendaryPity),
    "drop.commonRate": pct(economy.pack.rates.common),
    "drop.rareRate": pct(economy.pack.rates.rare),
    "drop.epicRate": pct(economy.pack.rates.epic),
    "drop.legendaryRate": pct(economy.pack.rates.legendary),

    "craft.common": economy.craftCost.common.toLocaleString(),
    "craft.rare": economy.craftCost.rare.toLocaleString(),
    "craft.epic": economy.craftCost.epic.toLocaleString(),
    "craft.legendary": economy.craftCost.legendary.toLocaleString(),

    "missions.dailyClout": String(economy.missions.dailyClout),
    "missions.weeklyClout": String(economy.missions.weeklyClout),
    "missions.rookieDays": String(economy.missions.rookieRoadDays),
    "checkIn.steps": String(checkInConfig().steps.length),
  };
}

/** `{subject.*}` for the one dated thing an article is about, if it names one. */
function subjectTokens(subject: NewsSubject | undefined): Record<string, string> | null {
  if (!subject) return {};
  if (subject.kind === "season") {
    const season = seasonById(subject.id);
    if (!season) return null;
    return {
      "subject.name": `Season ${season.number}: ${season.name}`,
      "subject.starts": on(seasonStart(season)),
      "subject.ends": on(seasonEnd(season)),
    };
  }
  const banner = bannerById(subject.id);
  const runs = banner ? [...banner.runs].sort((a, b) => runStart(a) - runStart(b)) : [];
  const debut = runs[0];
  if (!banner || !debut) return null;
  return {
    "subject.name": banner.name,
    "subject.starts": on(runStart(debut)),
    "subject.ends": on(runEnd(debut)),
    "subject.returns": runs[1] ? on(runStart(runs[1])) : "a date not yet on the calendar",
  };
}

const TOKEN = /\{([a-zA-Z][\w.]*)\}/g;
/** The same pattern without `g`, because `.test` on a global regex is stateful. */
const HAS_TOKEN = /\{[a-zA-Z][\w.]*\}/;

/**
 * Resolve an article's tokens.
 *
 * An unknown token is left visible rather than blanked. A missing number that
 * renders as nothing reads as a finished sentence with a hole in it; one that
 * renders as `{banner.legendaryRate}` is obviously broken, and the tests catch
 * it long before anybody sees either.
 */
export function resolveText(text: string, tokens: Record<string, string>): string {
  return text.replace(TOKEN, (whole, key: string) => tokens[key] ?? whole);
}

export interface NewsArticle {
  def: NewsArticleDef;
  publishedAt: number;
  title: string;
  summary: string;
  body: string[];
}

/**
 * Every article, newest first, with its numbers resolved.
 *
 * An article whose subject names something that no longer exists is **dropped**
 * rather than rendered with holes in it — the same call `cosmeticById` makes for
 * an id a later build removed. `checkNewsData` reports it, so it fails a test
 * rather than only going quiet.
 */
export function newsArticles(content: ContentIndex): NewsArticle[] {
  const tokens = globalTokens(content);
  return newsData()
    .articles.flatMap((def) => {
      const subject = subjectTokens(def.subject);
      if (!subject) return [];
      const all = { ...tokens, ...subject };
      return [
        {
          def,
          publishedAt: Date.parse(def.publishedAt),
          title: resolveText(def.title, all),
          summary: resolveText(def.summary, all),
          body: def.body.map((paragraph) => resolveText(paragraph, all)),
        },
      ];
    })
    .sort((a, b) => b.publishedAt - a.publishedAt);
}

/** The categories that have something in them, in file order. */
export function newsCategories(content: ContentIndex): NewsCategory[] {
  const used = new Set(newsArticles(content).map((article) => article.def.category));
  return newsData().categories.filter((category) => used.has(category.id));
}

/**
 * Everything wrong with `data/news.json`, checked against real content.
 *
 * The schema proves the file is well-formed. This proves it is *true*: that every
 * number in it resolves, that every link goes somewhere, and that every chip on
 * the filter bar has something behind it.
 */
export function checkNewsData(content: ContentIndex): string[] {
  const problems: string[] = [];
  const file = newsData();
  const categories = new Set(file.categories.map((category) => category.id));
  const tokens = globalTokens(content);
  const seen = new Set<string>();

  for (const def of file.articles) {
    if (seen.has(def.id)) problems.push(`${def.id}: duplicate id`);
    seen.add(def.id);

    if (!categories.has(def.category)) problems.push(`${def.id}: unknown category "${def.category}"`);
    if (!Number.isFinite(Date.parse(def.publishedAt))) problems.push(`${def.id}: unreadable publishedAt`);

    const subject = subjectTokens(def.subject);
    if (!subject) {
      problems.push(`${def.id}: subject ${def.subject?.kind} "${def.subject?.id}" does not exist`);
      continue;
    }
    const all = { ...tokens, ...subject };

    for (const [label, text] of [
      ["title", def.title],
      ["summary", def.summary],
      ...def.body.map((paragraph, index) => [`body[${index}]`, paragraph] as const),
    ] as const) {
      const resolved = resolveText(text, all);
      const unresolved = [...resolved.matchAll(TOKEN)].map((match) => match[0]);
      if (unresolved.length > 0) problems.push(`${def.id}: ${label} has unresolved ${unresolved.join(", ")}`);
      if (resolved.includes("{") || resolved.includes("}")) problems.push(`${def.id}: ${label} has a stray brace`);
      if (resolved.trim().length === 0) problems.push(`${def.id}: ${label} is empty`);
    }

    /**
     * An article that quotes no live number and links nowhere is a paragraph in a
     * JSON file. It is allowed — a dev blog may legitimately be pure prose — but
     * one that does neither *and* names a subject is almost certainly a token
     * that was meant to be there and was typed as plain text instead.
     */
    if (def.subject && !def.body.concat(def.title, def.summary).some((text) => HAS_TOKEN.test(text))) {
      problems.push(`${def.id}: names a subject but quotes nothing from it — was a token typed as plain text?`);
    }
  }

  for (const category of file.categories) {
    const count = file.articles.filter((article) => article.category === category.id).length;
    if (count === 0) problems.push(`category "${category.id}" has no articles — a chip that filters to nothing`);
  }

  for (const [name, reason] of DEFERRED_CATEGORIES) {
    if (!reason.trim()) problems.push(`${name}: deferred with no reason given`);
    if (categories.has(name.toLowerCase())) problems.push(`${name} is both shipped and deferred`);
  }

  return problems;
}
