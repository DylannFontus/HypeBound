/**
 * `data/cards/lore.txt` — the Story tab in the card gallery.
 *
 * The file is written by hand and is meant to stay that way, so the checks here
 * are the ones a hand-edited file actually needs: that every block points at a
 * real card, that every card resolves to something printable, and that the
 * format's small promises (a `TITLE:` line, a quoted line, paragraph breaks)
 * still hold. A block naming a card that no longer exists is invisible in the
 * game — it simply never shows — which is exactly why it is a test.
 */

import { describe, expect, it } from "vitest";
import { loreFor, loreIds } from "../src/game/cardLore";
import { collectibleCards, getContent } from "../src/engine/content";

const content = getContent();
const cards = Object.values(content.cards);

describe("card lore", () => {
  it("only names cards that exist", () => {
    const known = new Set(Object.keys(content.cards));
    const strays = loreIds().filter((id) => !known.has(id));
    expect(
      strays,
      strays.length === 0
        ? ""
        : `\ndata/cards/lore.txt has ${strays.length} block(s) for cards that do not exist:\n` +
          strays.map((id) => `  === ${id}`).join("\n") +
          "\n\nA card id was probably mistyped, or the card was renamed. Fix the id or delete the block.\n"
    ).toEqual([]);
  });

  it("has a block for every card, so nobody has to add one by hand", () => {
    const written = new Set(loreIds());
    const missing = cards.filter((card) => !written.has(card.id)).map((card) => `${card.name} (${card.id})`);
    expect(
      missing,
      missing.length === 0 ? "" : `\n${missing.length} card(s) have no block in lore.txt:\n  ${missing.join("\n  ")}\n`
    ).toEqual([]);
  });

  it("gives every card something printable, written or not", () => {
    for (const card of cards) {
      const lore = loreFor(card);
      expect(lore.title, `${card.name} has no title`).toBeTruthy();
      expect(lore.body.length, `${card.name} has no body`).toBeGreaterThan(0);
      for (const paragraph of lore.body) expect(paragraph.trim().length).toBeGreaterThan(0);
    }
  });

  it("falls back to the card's printed flavour for the quote", () => {
    // Every collectible card ships with flavour text, so an untouched lore file
    // still has something worth reading on every card in the game. Cards whose
    // block writes its own quote are the exception, and the point.
    const flavoured = collectibleCards(content).filter((card) => card.flavor);
    expect(flavoured.length).toBeGreaterThan(0);

    const overridden = flavoured.filter((card) => loreFor(card).quote !== card.flavor);
    for (const card of flavoured) {
      if (overridden.includes(card)) continue;
      expect(loreFor(card).quote, `${card.name} lost its flavour text`).toBe(card.flavor);
    }
    // and an override really does override, rather than being appended or lost
    for (const card of overridden) {
      const quote = loreFor(card).quote;
      expect(quote, `${card.name} has an empty written quote`).toBeTruthy();
      expect(quote).not.toBe(card.flavor);
    }
  });

  it("reads a fully written block — title, paragraphs and quote", () => {
    const novice = content.cards["grass-trailhead-novice"];
    expect(novice, "the worked example in lore.txt was renamed or removed").toBeTruthy();
    const lore = loreFor(novice!);
    expect(lore.written).toBe(true);
    expect(lore.title).toBe("Week One");
    // a blank line makes a paragraph break; wrapped lines inside one do not
    expect(lore.body).toHaveLength(2);
    expect(lore.body[0]).toContain("complained about the incline");
    expect(lore.body[1]).toBe("Nobody teaches the socks. The socks are learned.");
    expect(lore.quote).toBe("Ask her about drainage. Go on. Ask her.");
  });

  it("marks unwritten cards as unwritten", () => {
    // the placeholder must never be mistaken for authored lore — the screen
    // shows a "write it here" hint off exactly this flag
    const someCard = cards[0]!;
    const lore = loreFor(someCard);
    if (!lore.written) expect(lore.body.join(" ")).toContain("No lore written");
  });
});
