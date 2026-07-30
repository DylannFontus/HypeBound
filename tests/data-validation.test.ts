import { describe, expect, it } from "vitest";
import { getContent, collectibleCards } from "../src/engine/content";
import { crossValidate } from "../src/engine/validation";
import { createMatch, instantiateCharacter, refOf } from "../src/engine/state";
import { cleanupDefeated, makeContext, runOps } from "../src/engine/effects";
import { flattenOps } from "../src/game/cardTextAudit";
import type { CardDef, CharacterCardDef, DeckList, EffectOp } from "../src/engine/types";

describe("content data", () => {
  const content = getContent();
  const aCharacter = collectibleCards(content).find((c): c is CharacterCardDef => c.type === "character")!;
  const anyLeader = Object.values(content.leaders).find((l) => !l.token)!;
  const anyDeck = (): DeckList => ({
    name: "test",
    leaderCardId: anyLeader.id,
    cards: Array.from({ length: 30 }, () => aCharacter.id),
  });

  it("loads and validates every data file", () => {
    expect(Object.keys(content.cards).length).toBeGreaterThan(0);
    expect(crossValidate(content)).toEqual([]);
  });

  it("defines all 8 Currents with a legal advantage cycle", () => {
    const ids = Object.keys(content.currents);
    expect(ids).toHaveLength(8);
    // each natural current beats exactly one, prism beats none
    for (const current of Object.values(content.currents)) {
      expect(current.beats.length).toBe(current.id === "prism" ? 0 : 1);
    }
    // the natural cycle is a closed 5-loop: cinder -> gale -> root -> pulse -> tide -> cinder
    expect(content.currents.cinder.beats).toEqual(["gale"]);
    expect(content.currents.gale.beats).toEqual(["root"]);
    expect(content.currents.root.beats).toEqual(["pulse"]);
    expect(content.currents.pulse.beats).toEqual(["tide"]);
    expect(content.currents.tide.beats).toEqual(["cinder"]);
    // halo and veil are mutual
    expect(content.currents.halo.beats).toEqual(["veil"]);
    expect(content.currents.veil.beats).toEqual(["halo"]);
  });

  it("defines all 9 Confluences", () => {
    expect(Object.keys(content.confluences)).toHaveLength(9);
    for (const confluence of Object.values(content.confluences)) {
      expect(confluence.text.length).toBeGreaterThan(10);
    }
  });

  it("gives every Current a Perfect Resonance effect", () => {
    for (const current of Object.values(content.currents)) {
      expect(current.resonance, `${current.id} resonance`).not.toBeNull();
      expect(current.resonance?.ops.length).toBeGreaterThan(0);
    }
  });

  it("keeps every card's Current legal for its faction", () => {
    for (const card of Object.values(content.cards) as CardDef[]) {
      if (card.token || card.type === "leader") continue;
      const faction = content.factions[card.faction];
      expect(faction.currents, `${card.id} (${card.current} in ${card.faction})`).toContain(card.current);
    }
  });

  it("gives every non-token card rules text or a vanilla stat line", () => {
    for (const card of collectibleCards(content)) {
      if (card.effects.length > 0 || card.keywords.length > 0) {
        expect(card.text.trim(), `${card.id} needs rules text`).not.toBe("");
      }
    }
  });

  it("keeps character stats within the balance curve envelope", () => {
    // vanilla budget is roughly 2*cost + 1 total stats; text-heavy cards sit
    // below it. This guards against a card being entered with a typo'd stat.
    for (const card of collectibleCards(content)) {
      if (card.type !== "character") continue;
      const character = card as CharacterCardDef;
      const total = character.attack + character.health;
      const budget = 2 * character.cost + 2;
      expect(total, `${card.id} has ${total} total stats for cost ${character.cost}`).toBeLessThanOrEqual(budget);
    }
  });

  it("defines a leader for every faction that has cards", () => {
    const factionsWithCards = new Set(
      collectibleCards(content)
        .map((c) => c.faction)
        .filter((f) => f !== "neutral")
    );
    for (const faction of factionsWithCards) {
      const leaders = Object.values(content.leaders).filter((l) => l.faction === faction);
      expect(leaders.length, `faction ${faction} needs at least one leader`).toBeGreaterThan(0);
    }
  });

  it("gives every leader both a Fixation and an Ultimate at canonical costs", () => {
    for (const leader of Object.values(content.leaders)) {
      expect(leader.fixation.obsessionCost).toBe(content.balance.obsession.fixationCost);
      expect(leader.ultimate.obsessionCost).toBe(content.balance.obsession.ultimateCost);
      expect(leader.health).toBe(content.balance.leader.startingHealth);
    }
  });

  /**
   * Every shipped `destroy`, run against a real board.
   *
   * The op silently did nothing for its whole life — the last-rites guard read a
   * full-health character as one somebody had just revived — and the fixture
   * test for that lives in boss-twists.test.ts. This is the other half: the
   * shipped things that USE it, found by walking the content rather than by
   * being listed, so a fourth one added tomorrow is covered without an edit.
   */
  it("removes a character everywhere a shipped effect says destroy", () => {
    const sources: { where: string; ops: EffectOp[] }[] = [];
    const collect = (where: string, ops: readonly EffectOp[] | undefined): void => {
      const destroys = flattenOps(ops).filter((op) => op.op === "destroy");
      if (destroys.length > 0) sources.push({ where, ops: destroys });
    };
    for (const card of [...Object.values(content.cards), ...Object.values(content.leaders)]) {
      for (const effect of card.effects ?? []) collect(card.id, effect.ops);
      for (const effect of (card as { passive?: { ops: EffectOp[] }[] }).passive ?? []) collect(card.id, effect.ops);
    }
    for (const current of Object.values(content.currents)) {
      if (current.resonance) collect(`${current.id} Resonance`, current.resonance.ops);
    }
    expect(sources.length, "no shipped effect destroys anything any more").toBeGreaterThan(0);

    for (const source of sources) {
      const state = createMatch({ seed: 7, decks: [anyDeck(), anyDeck()], firstSeat: 0 }, content);
      const theirs = instantiateCharacter(state, content, aCharacter.id, 1, 0);
      state.players[1].board[0] = theirs;
      const mine = instantiateCharacter(state, content, aCharacter.id, 0, 0);
      state.players[0].board[0] = mine;

      const ctx = makeContext(state, content, 0, "test");
      /**
       * Several of these read `select: "triggering"`, which is the target the
       * card's own effect chose. Binding both bodies stands in for that choice,
       * so the check is "a destroy removed somebody" rather than a rerun of the
       * card's targeting rules — which the rules suite already covers.
       */
      ctx.binding = [refOf(theirs), refOf(mine)];
      runOps(ctx, source.ops);
      cleanupDefeated(ctx, null);

      const standing = [...state.players[0].board, ...state.players[1].board].filter(Boolean).length;
      expect(standing, `${source.where}: destroy left both characters standing`).toBeLessThan(2);
    }
  });
});
