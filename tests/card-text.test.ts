/**
 * Every card, checked against its own rules text.
 *
 * `PROJECT-STATUS.md` listed this as unverifiable — "a mismatch is a content bug
 * only a human reviewer will catch". That is true of a card's *meaning* and
 * false of most of its wiring, and the difference matters, because the wiring is
 * where the expensive bugs have actually lived: **Flow** shipped firing on one of
 * its four canonical channels, `afterparty` fired on both players' turns for
 * months, and a conditional aura never read its condition. Each of those looked
 * finished, because the keyword existed.
 *
 * The checks live in `src/game/cardTextAudit.ts`. This file is the judgement:
 * every finding is either fixed in the card data or listed below **with a reason
 * written down** — the same assert-against-a-justified-list pattern the
 * deck-pool invariant and the story branch-truth check already use. A warning
 * nobody reads is not a test.
 */

import { describe, expect, it } from "vitest";
import { auditCardText, type TextCheck, type TextFinding } from "../src/game/cardTextAudit";
import { getContent } from "../src/engine/content";

const content = getContent();

/**
 * Findings that are the house style rather than defects, each with its reason.
 *
 * The key is `<card id>:<check>`. Adding a line here is a claim that a human
 * read the card and the effects and found them to agree, so the reason has to
 * say *why* they agree — "false positive" is not a reason.
 */
const ALLOWED: Record<string, string> = {
  // Boss leaders are written as prose, in the second person, about the player.
  // "at the start of your turn" is the PLAYER's turn, which from the boss's seat
  // is `enemyStartOfTurn` — the trigger really is the one the sentence describes.
  "boss-the-recommendation:trigger-word": "boss prose is written from the player's point of view; 'your turn' is the player's, which is the boss's enemyStartOfTurn",
  "boss-the-recommendation:silent-op":
    "the scry is described in prose — 'reads your top two cards and buries the one you could actually cast' — rather than by keyword, because boss text is not templated card text",
  "boss-living-meme:silent-op": "the summon is one bullet of a prose list ('a 1/1 Follower'); boss text names outcomes rather than ops",
  "boss-living-meme:wrong-side": "'2 damage to one of yours' is the player's character seen from the boss's seat — the enemy of the boss",
  "boss-living-meme:targeting": "the randomness is stated as odds — 'each exactly 1 in 5' — rather than with the word 'random'",
  "boss-glitchlord-exe:gate-number": "the threshold is printed as the word 'third' in 'every third card you draw', not as a digit",

  // Text describing something OTHER than the card itself.
  "after-nobody-go-home:trigger-word": "the Afterparty belongs to the 1/1 Hanger-On this event summons, not to the event",
  "after-nobody-go-home:numbers": "the healing belongs to the summoned Hanger-On's own Afterparty, not to this event",
  "meme-same-joke-but-louder:numbers":
    "'deal 1 more damage for each other copy' is a per-copy multiplier in an amount expression, not a second flat damage number",

  // Idioms where the op's number is a game constant the text names in words.
  "grass-sermon-on-the-trail:numbers": "'remove all of your opponent's Obsession' is written as 10, which is the Obsession cap in balance.json",
  "grass-leader-juniper-vale:gate-number":
    "the gate is the printed game term **Obsessed**, which is defined as 8 or more Obsession; the leader prints the name rather than the number",
};

const key = (finding: TextFinding): string => `${finding.cardId}:${finding.check}`;

const format = (findings: TextFinding[]): string =>
  findings
    .map((f) => `  ${f.cardName} (${f.cardId}${f.part === "text" ? "" : ` — ${f.part}`})\n    ${f.message}\n    text: "${f.text}"`)
    .join("\n\n");

describe("cards do what they say", () => {
  const findings = auditCardText(content);
  const unexplained = findings.filter((f) => !(key(f) in ALLOWED));

  it("has no card whose text and effects disagree", () => {
    expect(
      unexplained.length,
      unexplained.length === 0
        ? ""
        : `\n${unexplained.length} card(s) say one thing and do another:\n\n${format(unexplained)}\n\n` +
          `Fix the card, or — if the two really do agree — add "<id>:<check>" to ALLOWED in this file with the reason.\n`
    ).toBe(0);
  });

  /**
   * The allowlist has to stay a record of judgements, not a place findings go to
   * die. An entry that no longer matches anything is a card that was fixed or
   * renamed, and leaving it behind would silently excuse a future defect on the
   * same card and check.
   */
  it("has no stale entries in the allowlist", () => {
    const live = new Set(findings.map(key));
    const stale = Object.keys(ALLOWED).filter((k) => !live.has(k));
    expect(
      stale,
      stale.length === 0 ? "" : `\nALLOWED excuses ${stale.length} finding(s) that no longer happen:\n  ${stale.join("\n  ")}\n\nDelete them.\n`
    ).toEqual([]);
  });

  /**
   * A checker that finds nothing is indistinguishable from a checker that is not
   * running. These are the shapes it must be able to see, asserted against
   * deliberately broken copies of real cards rather than against the pool, which
   * is (correctly) clean.
   */
  describe("catches what it is for", () => {
    const bend = (cardId: string, change: (card: Record<string, unknown>) => void): TextFinding[] => {
      const clone = structuredClone(content);
      const card = (clone.cards[cardId] ?? clone.leaders[cardId]) as unknown as Record<string, unknown>;
      expect(card, `${cardId} is not in the content index any more`).toBeTruthy();
      change(card);
      return auditCardText(clone).filter((f) => f.cardId === cardId && !(key(f) in ALLOWED));
    };
    const checks = (findings: TextFinding[]): TextCheck[] => [...new Set(findings.map((f) => f.check))];

    it("a keyword the card holds but never prints", () => {
      const found = bend("meme-anon-poster", (card) => {
        card["text"] = "Summon a 1/2 **Anon**.";
      });
      expect(checks(found)).toContain("keyword-not-printed");
    });

    it("a number that no effect uses", () => {
      const found = bend("viral-hot-take", (card) => {
        card["text"] = String(card["text"]).replace("Deal 1 damage", "Deal 4 damage");
      });
      expect(checks(found)).toContain("numbers");
    });

    it("an ability the text never mentions — the Flow shape", () => {
      const found = bend("idols-stage-tech", (card) => {
        card["text"] = "On play: if you control an Idol, nothing happens.";
      });
      expect(checks(found)).toContain("silent-op");
    });

    it("a trigger word naming a different trigger", () => {
      const found = bend("viral-algorithm-boost", (card) => {
        const effects = card["effects"] as { trigger: string }[];
        effects[0]!.trigger = "startOfTurn";
      });
      expect(checks(found)).toContain("trigger-word");
    });

    it("a summoned token whose printed stats are not its stats", () => {
      const found = bend("viral-notification-ping", (card) => {
        card["text"] = "Summon a 3/3 Follower.";
      });
      expect(checks(found)).toContain("summon-stats");
    });

    it("a target picked at random that the text presents as a choice", () => {
      const found = bend("viral-hot-take", (card) => {
        const effects = card["effects"] as { target?: { select?: string } }[];
        effects[0]!.target = { ...(effects[0]!.target ?? {}), select: "random" };
      });
      expect(checks(found)).toContain("targeting");
    });

    it("a sweep the text describes as one character", () => {
      const found = bend("viral-hot-take", (card) => {
        card["text"] = "Deal 1 damage to an enemy character and apply **Scorched** to it.";
        const effects = card["effects"] as { target?: { select?: string } }[];
        effects[0]!.target = { ...(effects[0]!.target ?? {}), select: "all" };
      });
      expect(checks(found)).toContain("targeting");
    });

    it("an effect that lands on the wrong side of the board", () => {
      const found = bend("viral-hot-take", (card) => {
        card["text"] = "Deal 1 damage to a friendly character and apply **Scorched** to it.";
        const effects = card["effects"] as { target?: { side?: string } }[];
        effects[0]!.target = { ...(effects[0]!.target ?? {}), side: "enemy" };
      });
      expect(checks(found)).toContain("wrong-side");
    });
  });
});
