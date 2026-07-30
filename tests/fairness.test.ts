/**
 * The system hub — `03-screens-and-navigation.md` §4.6.3 to §4.6.6, and the
 * screen `07-economy-and-monetization.md` §6 policy **F1** names by name.
 *
 * F1's enforcement column is the whole argument for how this is built:
 *
 * > *"Odds are data (`balance.json`); the disclosure UI renders from the same
 * > data the roller uses — they cannot diverge."*
 *
 * So the load-bearing test is not that the disclosure page prints 1.5%. It is
 * that the disclosure page, the shop panel and the banner page print **the same
 * thing as each other**, because they are three renderings of one object. Three
 * copies that agree by construction are one copy; three that agree by inspection
 * are a bug waiting for somebody to edit two of them.
 *
 * The other claim worth having is about the attributions: §4.6.5 asks for a
 * licence list *"generated from the dependency manifest"*, and a package added
 * without a credit fails here rather than shipping uncredited.
 */

import { describe, expect, it } from "vitest";
import { getContent } from "../src/engine/content";
import { publishedOdds as dropOdds } from "../src/game/economy/drops";
import { publishedOdds as bannerOdds } from "../src/game/economy/banner";
import {
  asPercent,
  bannerTable,
  checkFairnessData,
  conversionTable,
  dropTable,
  rateHistory,
  RATE_PRECISION,
  workedExamples,
} from "../src/game/fairness";
import {
  attributions,
  buildDiagnostics,
  checkPoliciesData,
  contentHash,
  manifestPackages,
  policiesData,
} from "../src/game/policies";

const content = getContent();
const economy = content.balance.economy;

// ---------------------------------------------------------------------------

describe("what the disclosure page would publish", () => {
  it("says nothing that is not true of the shipped balance", () => {
    const problems = checkFairnessData(content);
    expect(problems, problems.length === 0 ? "" : `\nthe disclosures:\n  ${problems.join("\n  ")}\n`).toEqual([]);
  });

  /**
   * F1's actual promise. Not "the page prints a number" — the page prints the
   * *same* number as the button, because there is one number.
   */
  it("prints exactly what the shop's own panel prints", () => {
    const disclosed = dropTable(content).rows;
    const shop = dropOdds(content);
    expect(disclosed.map((row) => [row.rarity, row.percent])).toEqual(shop.map((row) => [row.rarity, row.percent]));
  });

  it("prints exactly what the banner's own panel prints", () => {
    const disclosed = bannerTable(content).rows;
    const banner = bannerOdds(content);
    expect(disclosed.map((row) => [row.rarity, row.rate, row.featuredRate])).toEqual(
      banner.map((row) => [row.rarity, row.rate, row.featuredRate])
    );
  });

  it("reads the rates out of balance.json rather than holding its own", () => {
    for (const row of dropTable(content).rows) expect(row.rate).toBe(economy.pack.rates[row.rarity]);
    for (const row of bannerTable(content).rows) expect(row.rate).toBe(economy.banner.rates[row.rarity]);
  });

  it("publishes tables that sum to 1", () => {
    for (const table of [dropTable(content), bannerTable(content)]) {
      const total = table.rows.reduce((sum, row) => sum + row.rate, 0);
      expect(Math.abs(total - 1), `${table.id} sums to ${total}`).toBeLessThan(1e-9);
    }
  });

  it("shows every rate to the same precision", () => {
    for (const table of [dropTable(content), bannerTable(content)]) {
      for (const row of table.rows) {
        expect(row.percent).toBe(asPercent(row.rate));
        expect(row.percent.split(".")[1]?.replace("%", "").length ?? 0).toBe(RATE_PRECISION);
      }
    }
  });

  /** A featured share is a slice of a rarity's rate, never an addition to it. */
  it("keeps the featured share inside the rate it belongs to", () => {
    for (const row of bannerTable(content).rows) {
      if (row.featuredRate === undefined) continue;
      expect(row.featuredRate).toBeLessThanOrEqual(row.rate);
      expect(row.featuredRate).toBeGreaterThanOrEqual(0);
    }
  });

  it("publishes a guarantee for every pity rule the code implements", () => {
    const drop = dropTable(content).guarantees.join(" ");
    expect(drop).toContain(String(economy.pack.legendaryPity));
    expect(drop).toContain(String(economy.pack.minRarePerPack));

    const banner = bannerTable(content).guarantees.join(" ");
    expect(banner).toContain(String(economy.banner.hardPity));
    expect(banner).toContain(String(economy.banner.epicPityWindow));
    expect(banner).toContain(String(economy.banner.wishlistLimit));
  });

  /**
   * §4.6.3 asks for pity maths "with a worked example". Writing one in prose
   * would be a number typed into a sentence, so they are computed — and this
   * asserts the arithmetic rather than the wording.
   */
  it("computes its worked examples from the shipped constants", () => {
    const text = workedExamples(content)
      .map((example) => example.answer)
      .join(" ");
    expect(text).toContain(String(economy.pack.legendaryPity));
    expect(text).toContain(String(economy.banner.hardPity));
    // the worst-case Clout figures, which are products rather than constants
    expect(text.replace(/[\s  ,]/g, "")).toContain(String(economy.pack.legendaryPity * economy.pack.price));
    expect(text.replace(/[\s  ,]/g, "")).toContain(String(economy.banner.hardPity * economy.banner.pullPrice));
  });

  it("never publishes a forced conversion worth less than dismantling by hand", () => {
    for (const row of conversionTable(content)) {
      expect(row.converted, row.rarity).toBeGreaterThanOrEqual(row.dismantle);
      expect(row.craft, row.rarity).toBeGreaterThan(0);
      expect(row.tokens, row.rarity).toBeGreaterThan(0);
    }
  });

  /**
   * "The rates have never changed" is a claim this build can support, because
   * the patch notes carry a snapshot per release and the newest one is asserted
   * against the live balance. With one release there is nothing to report.
   */
  it("derives its rate-change log from the patch notes", () => {
    expect(rateHistory()).toEqual([]);
  });
});

describe("privacy, legal and support", () => {
  it("says nothing that is not true of the manifest", () => {
    const problems = checkPoliciesData();
    expect(problems, problems.length === 0 ? "" : `\ndata/policies.json:\n  ${problems.join("\n  ")}\n`).toEqual([]);
  });

  /** §4.6.5: the licence list is generated from the dependency manifest. */
  it("credits every dependency, and credits nothing that is not one", () => {
    const credited = attributions().map((entry) => entry.package).sort();
    expect(credited).toEqual(manifestPackages());
    for (const entry of attributions()) {
      expect(entry.version, entry.package).not.toBe("—");
      expect(entry.license.length, entry.package).toBeGreaterThan(1);
    }
  });

  it("separates what ships to a player from what only builds the game", () => {
    const runtime = attributions().filter((entry) => entry.runtime).map((entry) => entry.package);
    expect(runtime).toEqual(["three", "zod"]);
  });

  /**
   * The one category of fake content that could actually hurt somebody. A
   * not-written document must carry an explanation and must not carry text that
   * could be mistaken for terms.
   */
  it("ships no legalese nobody wrote", () => {
    const documents = policiesData().legal.documents;
    const missing = documents.filter((document) => document.status === "not-written");
    expect(missing.length, "terms and an EULA are still undrafted").toBeGreaterThan(0);
    for (const document of missing) {
      expect(document.body ?? [], document.id).toEqual([]);
      expect((document.note ?? "").length, document.id).toBeGreaterThan(40);
    }
    for (const document of documents.filter((entry) => entry.status === "written")) {
      expect(document.body?.length, document.id).toBeGreaterThan(0);
      expect(document.version, document.id).toBeDefined();
    }
  });

  /** A category cannot say nothing is collected and also say where it is kept. */
  it("does not claim to both collect and not collect a thing", () => {
    for (const category of policiesData().privacy.categories) {
      if (category.collected) expect(category.where, category.name).toBeDefined();
      else expect(category.where, category.name).toBeUndefined();
    }
    // and the ones this build genuinely has none of are marked as such
    const uncollected = policiesData()
      .privacy.categories.filter((category) => !category.collected)
      .map((category) => category.name);
    expect(uncollected).toContain("Telemetry and analytics");
    expect(uncollected).toContain("Purchases");
  });

  it("builds a diagnostic that identifies the build and not the player", () => {
    const report = buildDiagnostics(content, { lastMatchSeed: 4242, matchesPlayed: 7 }, 0);
    expect(report.contentHash).toMatch(/^[0-9a-f]{8}$/);
    expect(report.lastMatchSeed).toBe(4242);
    expect(report.cards).toBe(Object.keys(content.cards).length);

    // nothing in it is a name, a collection or a save
    const text = JSON.stringify(report).toLowerCase();
    for (const forbidden of ["displayname", "collection", "decks", "clout", "email"]) {
      expect(text, `the diagnostic mentions ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("hashes the content stably, and differently when a card moves", () => {
    expect(contentHash(content)).toBe(contentHash(content));
    const id = Object.keys(content.cards)[0]!;
    const bent = { ...content, cards: { ...content.cards, [id]: { ...content.cards[id]!, cost: 99 } } };
    expect(contentHash(bent)).not.toBe(contentHash(content));
  });

  it("answers the questions a player actually arrives with", () => {
    const questions = policiesData().support.faq;
    const tags = new Set(questions.flatMap((entry) => entry.tags));
    for (const wanted of ["save", "odds", "bug", "purchases"]) expect([...tags], wanted).toContain(wanted);
    for (const entry of questions) expect(entry.answer.join(" ").length, entry.id).toBeGreaterThan(60);
  });
});
