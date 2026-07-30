/**
 * The cosmetics layer.
 *
 * Three progression systems were queuing behind this one, so the tests that
 * matter most are the ones that keep the two halves honest with each other:
 *
 * **Every reward resolves.** A mastery rank names a cosmetic by a `ref` with
 * `{id}` in it, and the id it produces has to name something real on every track
 * it can appear on — all ten factions, all twenty leaders. A ref that resolves on
 * nine factions and not the tenth is a reward that silently becomes a deferral
 * for exactly one faction's players.
 *
 * **Every emblem draws something.** A card back that resolves, validates, is
 * granted and is equipped, and then renders an empty rectangle, is the inert
 * reward with extra steps. Each emblem is drawn through a recording context and
 * its geometry compared, so a missing or duplicated `case` cannot ship.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { getContent, selectableLeaders } from "../src/engine/content";
import {
  allCosmetics,
  badgeId,
  cardBackId,
  cosmeticById,
  checkCosmeticsData,
  emotePhrases,
  equipped,
  factionEmoteId,
  factionTitleId,
  fanTitleId,
  frameId,
  leaderEmoteId,
  leaderTitleId,
  ownedCosmetics,
  STARTER_EMOTES,
  unlockedEmotes,
  WEARABLE_KINDS,
  type CosmeticKind,
} from "../src/game/cosmetics";
import { cosmeticsData, EMBLEMS } from "../src/game/cosmetics/data";
import { drawEmblem, hexToRgb } from "../src/ui/cosmetics/emblem";
import { factionMasteryConfig, leaderMasteryConfig, affinityConfig } from "../src/game/progression/data";
import { xpForRank } from "../src/game/progression/mastery";
import {
  claimMasteryRank,
  emoteWheel,
  equipCosmetic,
  myCosmetics,
  ownsCosmetic,
  profileStore,
  wearing,
} from "../src/save/profile";

const content = getContent();
const factions = Object.values(content.factions).filter((faction) => faction.id !== "neutral");
const leaders = selectableLeaders(content);

describe("the catalogue", () => {
  it("has no content problem", () => {
    expect(checkCosmeticsData(content)).toEqual([]);
  });

  it("gives every faction a card back, a frame, a title and two emote sets", () => {
    for (const faction of factions) {
      expect(cosmeticById(content, cardBackId(faction.id)), faction.id).toBeTruthy();
      expect(cosmeticById(content, frameId(faction.id)), faction.id).toBeTruthy();
      expect(cosmeticById(content, factionTitleId(faction.id)), faction.id).toBeTruthy();
      expect(cosmeticById(content, factionEmoteId(faction.id, 1)), faction.id).toBeTruthy();
      expect(cosmeticById(content, factionEmoteId(faction.id, 2)), faction.id).toBeTruthy();
    }
  });

  it("gives every selectable leader a title and an emote", () => {
    for (const leader of leaders) {
      expect(cosmeticById(content, leaderTitleId(leader.id)), leader.id).toBeTruthy();
      expect(cosmeticById(content, leaderEmoteId(leader.id)), leader.id).toBeTruthy();
    }
  });

  it("uses §13's exact faction titles", () => {
    // the design names all ten; getting one wrong is a silent rename
    expect(cosmeticById(content, factionTitleId("neon-idols"))!.name).toBe("Center Stage");
    expect(cosmeticById(content, factionTitleId("touch-grass-order"))!.name).toBe("Actually Went Outside");
    expect(cosmeticById(content, factionTitleId("digital-demons"))!.name).toBe("Cursed Hardware");
  });

  it("builds the dynamic titles §13 describes rather than listing them", () => {
    const leader = leaders[0]!;
    expect(cosmeticById(content, leaderTitleId(leader.id))!.name).toBe(`Voice of ${leader.name}`);
    const character = Object.values(content.cards).find((card) => card.type === "character" && !card.token)!;
    expect(cosmeticById(content, fanTitleId(character.id))!.name).toBe(`${character.name}'s #1 Fan`);
  });

  it("refuses ids that name nothing, rather than throwing", () => {
    expect(cosmeticById(content, "cardBack:faction:not-a-faction")).toBeNull();
    expect(cosmeticById(content, "cardBack:faction:neutral")).toBeNull();
    expect(cosmeticById(content, "title:leader:boss-king-ratio")).toBeNull();
    expect(cosmeticById(content, "nonsense")).toBeNull();
    expect(cosmeticById(content, "")).toBeNull();
    expect(cosmeticById(content, "badge:character:idols-lumi-starcall")).toBeNull();
  });

  it("says where each cosmetic came from", () => {
    for (const cosmetic of allCosmetics(content)) {
      expect(cosmetic.source.length, cosmetic.id).toBeGreaterThan(8);
      expect(cosmetic.name.length, cosmetic.id).toBeGreaterThan(0);
    }
  });

  it("drops an owned id that no longer names anything", () => {
    const real = cardBackId("neon-idols");
    expect(ownedCosmetics(content, [real, "cardBack:faction:deleted-faction"]).map((c) => c.id)).toEqual([real]);
  });
});

describe("every reward a track can pay resolves", () => {
  /**
   * The coverage test, and the sharpest one in the file.
   *
   * `{id}` is substituted with the track's own entity, so a single reward row
   * produces ten ids on the faction track and twenty on the leader track. Each
   * has to name something real — a ref that resolves for nine factions and not
   * the tenth turns into a silent deferral for one faction's players only.
   */
  const refsOf = (config: ReturnType<typeof factionMasteryConfig>): string[] =>
    Object.values(config.rewards)
      .flat()
      .flatMap((reward) => (reward.kind === "cosmetic" && reward.ref ? [reward.ref] : []));

  it("resolves every faction-track cosmetic on all ten factions", () => {
    const refs = refsOf(factionMasteryConfig());
    expect(refs.length).toBeGreaterThan(0);
    const broken: string[] = [];
    for (const ref of refs) {
      for (const faction of factions) {
        const id = ref.replace("{id}", faction.id);
        if (!cosmeticById(content, id)) broken.push(id);
      }
    }
    expect(broken).toEqual([]);
  });

  it("resolves every leader-track cosmetic on all twenty leaders", () => {
    const refs = refsOf(leaderMasteryConfig());
    expect(refs.length).toBeGreaterThan(0);
    const broken: string[] = [];
    for (const ref of refs) {
      for (const leader of leaders) {
        const id = ref.replace("{id}", leader.id);
        if (!cosmeticById(content, id)) broken.push(id);
      }
    }
    expect(broken).toEqual([]);
  });

  it("resolves every Bias Board cosmetic on a real character", () => {
    const characters = Object.values(content.cards)
      .filter((card) => card.type === "character" && !card.token && !card.variantOf)
      .slice(0, 25);
    const refs = affinityConfig()
      .tiers.flatMap((tier) => tier.rewards)
      .flatMap((reward) => (reward.kind === "cosmetic" && reward.ref ? [reward.ref] : []));
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      for (const card of characters) {
        expect(cosmeticById(content, ref.replace("{id}", card.id)), ref).toBeTruthy();
      }
    }
  });

  it("lands each ref in the slot its reward names", () => {
    // a `cosmetic: "title"` reward that granted a card back would equip into the
    // wrong slot and read as a bug in the picker rather than in the data
    for (const [config, entities] of [
      [factionMasteryConfig(), factions.map((faction) => faction.id)],
      [leaderMasteryConfig(), leaders.map((leader) => leader.id)],
    ] as const) {
      for (const rewards of Object.values(config.rewards)) {
        for (const reward of rewards) {
          if (reward.kind !== "cosmetic" || !reward.ref) continue;
          for (const entity of entities) {
            const cosmetic = cosmeticById(content, reward.ref.replace("{id}", entity));
            expect(cosmetic?.kind, `${reward.ref} on ${entity}`).toBe(reward.cosmetic);
          }
        }
      }
    }
  });
});

describe("emblems", () => {
  /**
   * A recording 2D context, rather than a real canvas.
   *
   * There is no canvas in this test environment and adding a native one would
   * be a compiler toolchain to prove a shape is not empty. Recording the drawing
   * commands is a closer test anyway: what must be true is that each emblem
   * *issues geometry*, and that no two issue the same geometry — which is what a
   * missing or duplicated `case` in `drawEmblem` would break.
   */
  const record = (emblem: string): string[] => {
    const ops: string[] = [];
    const log =
      (name: string) =>
      (...args: unknown[]): void => {
        ops.push(`${name}(${args.map((value) => (typeof value === "number" ? value.toFixed(1) : value)).join(",")})`);
      };
    const ctx = {
      save: log("save"),
      restore: log("restore"),
      beginPath: log("beginPath"),
      closePath: log("closePath"),
      moveTo: log("moveTo"),
      lineTo: log("lineTo"),
      arc: log("arc"),
      ellipse: log("ellipse"),
      quadraticCurveTo: log("quadraticCurveTo"),
      stroke: log("stroke"),
      fill: log("fill"),
      strokeRect: log("strokeRect"),
      globalAlpha: 1,
      lineWidth: 1,
      strokeStyle: "#fff",
      fillStyle: "#fff",
    } as unknown as CanvasRenderingContext2D;
    drawEmblem(ctx, emblem as never, 100, 100);
    return ops;
  };

  /** Path-producing commands only — `save`/`restore` alone would draw nothing. */
  const geometry = (ops: string[]): string[] =>
    ops.filter((op) => !op.startsWith("save") && !op.startsWith("restore"));

  it("draws something for every emblem the data can name", () => {
    /**
     * The inert-reward guard for art. A missing `case` in `drawEmblem` produces
     * a card back that resolves, validates, is granted, is equipped — and is a
     * blank rectangle. Nothing else in the stack would notice.
     */
    for (const emblem of EMBLEMS) {
      const ops = geometry(record(emblem));
      expect(ops.length, `${emblem} issued no geometry`).toBeGreaterThan(4);
      expect(ops.some((op) => op.startsWith("stroke") || op.startsWith("fill")), `${emblem} never painted`).toBe(true);
    }
  });

  it("gives every emblem its own case, not the fallback", () => {
    /**
     * Two checks in one, because dropping a `case` produces both symptoms: the
     * emblem stops being distinct *and* silently becomes the house diamond, and
     * the second is what makes the first hard to notice by eye.
     */
    const signatures = EMBLEMS.map((emblem) => geometry(record(emblem)).join("|"));
    expect(new Set(signatures).size).toBe(EMBLEMS.length);
    const fallback = geometry(record("not-an-emblem")).join("|");
    expect(signatures, "an emblem fell through to the house diamond").not.toContain(fallback);
  });

  it("gives each of the ten factions a different emblem", () => {
    /**
     * The catalogue half of the same idea. `EMBLEMS` being ten distinct shapes
     * does not stop two factions from being *assigned* the same one — which
     * makes the reward for mastering the tenth faction a card back you already
     * had, in a different colour.
     */
    const assigned = factions.map((faction) => cosmeticsData().emblems[faction.id]);
    expect(new Set(assigned).size).toBe(factions.length);
    expect(checkCosmeticsData(content)).toEqual([]);
  });

  it("falls back to the house diamond rather than drawing nothing", () => {
    expect(geometry(record("not-an-emblem")).length).toBeGreaterThan(4);
  });

  it("leaves the context as it found it", () => {
    // every emblem fiddles with globalAlpha and strokeStyle; a missing
    // save/restore pair would leak that into whatever is drawn next
    for (const emblem of EMBLEMS) {
      const ops = record(emblem);
      expect(ops[0], emblem).toBe("save()");
      expect(ops[ops.length - 1], emblem).toBe("restore()");
    }
  });

  it("uses an emblem the renderer knows for every faction", () => {
    const known = new Set<string>(EMBLEMS);
    for (const [factionId, emblem] of Object.entries(cosmeticsData().emblems)) {
      expect(known.has(emblem), `${factionId} uses unknown emblem ${emblem}`).toBe(true);
    }
  });

  it("parses colours, and survives one it cannot", () => {
    expect(hexToRgb("#ff5fa2")).toEqual([255, 95, 162]);
    expect(hexToRgb("ff5fa2")).toEqual([255, 95, 162]);
    expect(hexToRgb("rebeccapurple")).toEqual([181, 108, 255]);
  });
});

describe("emotes", () => {
  it("keeps the six starters whatever else is unlocked", () => {
    const wheel = unlockedEmotes(content, [factionEmoteId("neon-idols", 1), leaderEmoteId(leaders[0]!.id)]);
    for (const starter of STARTER_EMOTES) expect(wheel).toContain(starter);
  });

  it("adds a phrase per unlock rather than replacing", () => {
    const base = unlockedEmotes(content, []).length;
    expect(base).toBe(STARTER_EMOTES.length);
    const one = unlockedEmotes(content, [factionEmoteId("neon-idols", 1)]);
    expect(one.length).toBe(base + 1);
    const two = unlockedEmotes(content, [factionEmoteId("neon-idols", 1), factionEmoteId("neon-idols", 2)]);
    expect(two.length).toBe(base + 1 + emotePhrases(content, factionEmoteId("neon-idols", 2)).length);
  });

  it("gives set II more than one phrase, as §4.2's 'set' implies", () => {
    for (const faction of factions) {
      expect(emotePhrases(content, factionEmoteId(faction.id, 2)).length, faction.id).toBeGreaterThan(1);
    }
  });

  it("never repeats a phrase on the wheel", () => {
    /**
     * Driven by a **duplicated id**, not just by the shipped catalogue.
     *
     * Against real data every phrase is already distinct — `checkCosmeticsData`
     * enforces that — so scoring the catalogue alone passes happily with the
     * de-duplication deleted. Handing the same unlock in twice is the input that
     * can actually produce a repeat.
     */
    const one = factionEmoteId("neon-idols", 1);
    const wheel = unlockedEmotes(content, [one, one, factionEmoteId("neon-idols", 2)]);
    expect(new Set(wheel).size).toBe(wheel.length);

    const everything = allCosmetics(content)
      .filter((cosmetic) => cosmetic.kind === "emote")
      .map((cosmetic) => cosmetic.id);
    const full = unlockedEmotes(content, everything);
    expect(new Set(full).size).toBe(full.length);
  });

  it("authors no phrase twice across the whole catalogue", () => {
    // the reason the de-duplication above is a safety net rather than the fix:
    // a repeated phrase is an unlock you earn and never see
    const problems = checkCosmeticsData(content).filter((problem) => problem.includes("both say"));
    expect(problems).toEqual([]);
  });

  it("ignores an id that is not an emote", () => {
    expect(emotePhrases(content, cardBackId("neon-idols"))).toEqual([]);
  });
});

describe("owning and wearing", () => {
  beforeEach(() => profileStore.reset());

  const setRank = (rank: number): void => {
    profileStore.update((draft) => {
      draft.mastery.faction["neon-idols"] = Math.max(1, xpForRank(factionMasteryConfig(), rank));
    });
  };

  it("wears the first cosmetic of a kind automatically", () => {
    setRank(5);
    claimMasteryRank(content, "faction", "neon-idols", 5);
    expect(wearing(content, "cardBack")?.id).toBe(cardBackId("neon-idols"));
  });

  it("does not replace something already chosen", () => {
    /**
     * Both card backs are earned **through the claim path**, because that is the
     * only path that auto-equips. An earlier version of this test pushed the
     * second one straight into `owned`, which never runs the auto-equip code at
     * all — so it passed against a build that replaced the worn cosmetic every
     * time a new one arrived.
     */
    setRank(5);
    profileStore.update((draft) => {
      draft.mastery.faction["gothic-royalty"] = xpForRank(factionMasteryConfig(), 5);
    });
    claimMasteryRank(content, "faction", "neon-idols", 5);
    expect(wearing(content, "cardBack")?.id).toBe(cardBackId("neon-idols"));

    claimMasteryRank(content, "faction", "gothic-royalty", 5);
    expect(ownsCosmetic(cardBackId("gothic-royalty"))).toBe(true);
    expect(wearing(content, "cardBack")?.id, "the second card back took the slot").toBe(cardBackId("neon-idols"));
  });

  it("equips something owned, and refuses something not", () => {
    setRank(5);
    claimMasteryRank(content, "faction", "neon-idols", 5);
    expect(equipCosmetic(content, "cardBack", cardBackId("gothic-royalty"))).toBe(false);
    expect(wearing(content, "cardBack")?.id).toBe(cardBackId("neon-idols"));
    expect(equipCosmetic(content, "cardBack", cardBackId("neon-idols"))).toBe(true);
  });

  it("refuses a cosmetic that belongs in another slot", () => {
    setRank(20);
    claimMasteryRank(content, "faction", "neon-idols", 5);
    expect(equipCosmetic(content, "title", cardBackId("neon-idols"))).toBe(false);
    expect(wearing(content, "title")).toBeNull();
  });

  it("takes a slot back to its default", () => {
    setRank(5);
    claimMasteryRank(content, "faction", "neon-idols", 5);
    expect(equipCosmetic(content, "cardBack", null)).toBe(true);
    expect(wearing(content, "cardBack")).toBeNull();
  });

  it("shows the default rather than nothing when a worn id stops resolving", () => {
    profileStore.update((draft) => {
      draft.cosmetics.owned.push("cardBack:faction:deleted");
      draft.cosmetics.equipped.cardBack = "cardBack:faction:deleted";
    });
    expect(wearing(content, "cardBack")).toBeNull();
    expect(myCosmetics(content)).toEqual([]);
  });

  it("never wears something that was un-owned", () => {
    // ownership is the authority; the equipped slot is only a preference
    profileStore.update((draft) => {
      draft.cosmetics.equipped.cardBack = cardBackId("neon-idols");
    });
    expect(ownsCosmetic(cardBackId("neon-idols"))).toBe(false);
    expect(wearing(content, "cardBack")).toBeNull();
  });

  it("keeps emotes out of the wearable slots", () => {
    // an emote joins the wheel; it is not worn, so it has no slot to occupy
    expect(WEARABLE_KINDS).not.toContain("emote");
    setRank(12);
    claimMasteryRank(content, "faction", "neon-idols", 12);
    expect(emoteWheel(content).length).toBe(STARTER_EMOTES.length + 1);
    for (const kind of WEARABLE_KINDS) expect(wearing(content, kind)).toBeNull();
  });

  it("survives a save written before cosmetics existed", () => {
    profileStore.update((draft) => {
      delete (draft as unknown as { cosmetics?: unknown }).cosmetics;
    });
    expect(myCosmetics(content)).toEqual([]);
    expect(emoteWheel(content)).toEqual([...STARTER_EMOTES]);
    for (const kind of WEARABLE_KINDS) expect(wearing(content, kind)).toBeNull();
    expect(equipCosmetic(content, "cardBack", null)).toBe(true);
  });
});

describe("the equipped resolver", () => {
  const owned = [cardBackId("neon-idols"), factionTitleId("neon-idols")];

  it("returns what is worn when it is owned and of the right kind", () => {
    const slots: Partial<Record<CosmeticKind, string>> = { cardBack: cardBackId("neon-idols") };
    expect(equipped(content, "cardBack", slots, owned)?.id).toBe(cardBackId("neon-idols"));
  });

  it("returns null for an empty slot", () => {
    expect(equipped(content, "title", {}, owned)).toBeNull();
  });

  it("returns null when the slot holds the wrong kind", () => {
    const slots: Partial<Record<CosmeticKind, string>> = { title: cardBackId("neon-idols") };
    expect(equipped(content, "title", slots, owned)).toBeNull();
  });

  it("returns null when the id is not owned", () => {
    const slots: Partial<Record<CosmeticKind, string>> = { badge: badgeId("x") };
    expect(equipped(content, "badge", slots, owned)).toBeNull();
  });
});
