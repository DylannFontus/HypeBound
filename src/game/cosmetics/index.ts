/**
 * Cosmetics — the reward layer three progression systems were queuing behind.
 *
 * Faction Mastery, Leader Mastery and the Bias Board are full of card backs,
 * emotes, frames, badges and titles, and until now none of them could be
 * granted, because nothing in the game could display one. Every such row read
 * *"Earned — waiting on the cosmetics layer"*. This is that layer.
 *
 * ## Four rules it follows
 *
 * **A cosmetic exists only if something shows it.** The kinds here — card backs,
 * titles, profile frames, portrait badges and emotes — each have a surface that
 * renders them. The kinds that still have no surface (voice lines with no audio
 * files, intro animations with no intro) stay in `DEFERRED_COSMETICS` with their
 * reason, rather than being granted invisibly. That rule has been in this project
 * since `grantTutorialReward` and has not been relaxed here.
 *
 * **Art is derived, text is authored.** A card back is the faction's colour and
 * its emblem; a frame is its crest ring; a badge is the character's own art. Only
 * the parts that are a joke or a name the design fixed — the ten faction titles,
 * the emote phrases — live in `data/cosmetics.json`. Adding a faction therefore
 * gets a card back, a frame and a title for free.
 *
 * **Per-entity cosmetics are generated, not listed.** §13 asks for a title per
 * leader and per character. Cataloguing several hundred of those by hand would be
 * hundreds of lines that say the same thing, each a chance to name a card that
 * does not exist. They are derived from the content index, so they cannot drift.
 *
 * **Owning and wearing are different.** You own every cosmetic you have earned
 * and wear at most one per slot, so a reward is never lost by equipping something
 * else — and an unknown id in a slot falls back to the default rather than
 * rendering nothing.
 */

import type { CardDef, ContentIndex, FactionId } from "../../engine/types";
import { selectableLeaders } from "../../engine/content";
import { FACTION_COLOR } from "../../ui/cardRenderer/palette";
import { cosmeticsData, type EmblemId } from "./data";
import { eventById } from "../events/data";

/** A slot on the player. One cosmetic of each kind may be worn at a time. */
export type CosmeticKind = "cardBack" | "title" | "frame" | "badge" | "emote";

/** Every slot that is *worn*. Emotes are owned in bulk and all shown at once. */
export const WEARABLE_KINDS: readonly CosmeticKind[] = ["cardBack", "title", "frame", "badge"];

export interface Cosmetic {
  id: string;
  kind: CosmeticKind;
  name: string;
  /** where it came from, in words, for the picker */
  source: string;
  /** the accent colour the surface draws it in */
  color: string;
  /** card backs and frames only — which shape is drawn */
  emblem?: EmblemId;
  /** emotes only — the phrase said in a match */
  phrase?: string;
  /** badges only — the character whose art it uses */
  cardId?: string;
}

/**
 * The six emotes every account starts with.
 *
 * Deliberately not unlockable. A game that starts you with no way to say "well
 * played" is worse than one with no unlockables at all, and §12's social-safety
 * line is that the emote wheel is the *only* channel — gating it would gate
 * communication itself.
 */
export const STARTER_EMOTES: readonly string[] = [
  "Greetings",
  "Well played",
  "Nice",
  "Oops",
  "Threaten",
  "Thanks",
];

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

export const cardBackId = (factionId: string): string => `cardBack:faction:${factionId}`;
export const frameId = (factionId: string): string => `frame:crest:${factionId}`;
export const factionTitleId = (factionId: string): string => `title:faction:${factionId}`;
export const leaderTitleId = (leaderCardId: string): string => `title:leader:${leaderCardId}`;
export const fanTitleId = (cardId: string): string => `title:fan:${cardId}`;
export const badgeId = (cardId: string): string => `badge:character:${cardId}`;
export const factionEmoteId = (factionId: string, set: 1 | 2): string => `emote:faction:${factionId}:${set}`;
export const leaderEmoteId = (leaderCardId: string): string => `emote:leader:${leaderCardId}`;
/** An achievement award. The kind is part of the id and must match the catalogue. */
export const awardId = (kind: "title" | "frame" | "badge" | "cardBack", award: string): string =>
  `${kind}:award:${award}`;
/** A Hype Wave season's cosmetics. `tint` is 1-based; 1 is the base card back. */
export const seasonCardBackId = (seasonId: string, tint = 1): string =>
  tint <= 1 ? `cardBack:season:${seasonId}` : `cardBack:season:${seasonId}:${tint}`;
export const seasonFrameId = (seasonId: string): string => `frame:season:${seasonId}`;
export const seasonTitleId = (seasonId: string): string => `title:season:${seasonId}`;
export const seasonEmoteId = (seasonId: string, set = false): string =>
  set ? `emote:season:${seasonId}:set` : `emote:season:${seasonId}`;
/** A Headliner Banner's themed card back — the first ×10 reward. */
export const bannerCardBackId = (bannerId: string): string => `cardBack:banner:${bannerId}`;
/** The month's check-in card back (§11 step 10). */
export const checkInCardBackId = (monthId: string): string => `cardBack:checkin:${monthId}`;

/**
 * The check-in cosmetic for a calendar month, 0-based as `Date#getMonth` gives.
 *
 * Wraps, so a rotation shorter than twelve months still resolves — and
 * `checkCosmeticsData` reports the shortfall rather than letting a month
 * silently pay nothing.
 */
export const checkInCosmeticForMonth = (month: number): string => {
  const rotation = cosmeticsData().checkIn.rotation;
  return checkInCardBackId(rotation[((month % rotation.length) + rotation.length) % rotation.length]!.id);
};

const colorOf = (factionId: string): string => FACTION_COLOR[factionId as FactionId] ?? FACTION_COLOR.neutral;

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve an id to a cosmetic, or null if it names nothing.
 *
 * Null rather than a throw, because ids reach this from a save file: an account
 * that earned a cosmetic which a later build removed should lose the cosmetic,
 * not the ability to open its profile.
 */
export function cosmeticById(content: ContentIndex, id: string): Cosmetic | null {
  const data = cosmeticsData();
  const [kind, scope, entity, extra] = id.split(":");
  if (!kind || !scope || !entity) return null;

  const faction = content.factions[entity as FactionId];
  const leader = content.leaders[entity];
  const card = content.cards[entity];

  switch (`${kind}:${scope}`) {
    case "cardBack:faction": {
      if (!faction || faction.id === "neutral") return null;
      return {
        id,
        kind: "cardBack",
        name: `${faction.name} Card Back`,
        source: `Faction Mastery rank 5 — ${faction.name}`,
        color: colorOf(entity),
        emblem: data.emblems[entity] ?? "starburst",
      };
    }
    case "frame:crest": {
      if (!faction || faction.id === "neutral") return null;
      return {
        id,
        kind: "frame",
        name: `${faction.name} Crest`,
        source: `Faction Mastery rank 18 — ${faction.name}`,
        color: colorOf(entity),
        emblem: data.emblems[entity] ?? "starburst",
      };
    }
    case "title:faction": {
      const title = data.titles[entity];
      if (!faction || !title) return null;
      return {
        id,
        kind: "title",
        name: title,
        source: `Faction Mastery rank 20 — ${faction.name}`,
        color: colorOf(entity),
      };
    }
    case "title:leader": {
      if (!leader || leader.token) return null;
      return {
        id,
        kind: "title",
        name: `Voice of ${leader.name}`,
        source: `Leader Mastery 10 — ${leader.name}`,
        color: colorOf(leader.faction),
      };
    }
    case "title:fan": {
      if (!card || card.type !== "character" || card.token) return null;
      return {
        id,
        kind: "title",
        name: `${card.name}'s #1 Fan`,
        source: `Affinity tier 5 — ${card.name}`,
        color: colorOf(card.faction),
      };
    }
    case "badge:character": {
      if (!card || card.type !== "character" || card.token) return null;
      return {
        id,
        kind: "badge",
        name: card.name,
        source: `Affinity tier 3 — ${card.name}`,
        color: colorOf(card.faction),
        cardId: card.id,
      };
    }
    case "emote:faction": {
      const set = extra === "2" ? 2 : 1;
      const entry = data.emotes.faction[entity];
      if (!faction || !entry) return null;
      return {
        id,
        kind: "emote",
        name: faction.name,
        source: `Faction Mastery rank ${set === 1 ? 12 : 15} — ${faction.name}`,
        color: colorOf(entity),
        phrase: set === 1 ? entry.first : entry.set.join(" · "),
      };
    }
    /**
     * `title:award:…`, `frame:award:…`, `badge:award:…` — the achievement layer.
     *
     * One arm for three slots, because the only difference between them is which
     * slot the award declares itself to be in. Resolving only when the declared
     * kind matches the id's is what stops a title being worn as a frame, which
     * would draw an empty ring around the avatar.
     */
    case "title:award":
    case "frame:award":
    case "badge:award":
    case "cardBack:award": {
      const award = data.awards[entity];
      if (!award || award.kind !== kind) return null;
      return {
        id,
        kind: award.kind,
        name: award.name,
        source: award.source,
        color: award.color,
        ...(award.emblem ? { emblem: award.emblem } : {}),
      };
    }
    /**
     * `…:season:<seasonId>[:n]` — the Hype Wave's cosmetics (08 §10).
     *
     * The trailing number on a card back is a **tint**: the season's emblem in
     * one of its other colours, which is what §10.3 means by listing "card-back
     * tints" among the Backstage track's minor cosmetics. Tint 1 is the base
     * back the free track pays at tier 1, so `cardBack:season:x` and
     * `cardBack:season:x:1` are deliberately the same cosmetic — a season's
     * first colour is not owed twice.
     */
    case "cardBack:season": {
      const season = data.seasons[entity];
      const tint = extra ? Number(extra) : 1;
      if (!season || !Number.isInteger(tint) || tint < 1 || tint > season.tints.length) return null;
      return {
        id,
        kind: "cardBack",
        name: tint === 1 ? `${season.name} Card Back` : `${season.name} Card Back — tint ${tint - 1}`,
        source: tint === 1 ? `Hype Wave: ${season.name}, tier 1` : `Backstage Pass: ${season.name}`,
        color: season.tints[tint - 1]!,
        emblem: season.emblem,
      };
    }
    case "cardBack:checkin": {
      const entry = data.checkIn.rotation.find((month) => month.id === entity);
      if (!entry) return null;
      return {
        id,
        kind: "cardBack",
        name: `${entry.name} Card Back`,
        source: "Stream Check-In — step 10",
        color: entry.color,
        emblem: entry.emblem,
      };
    }
    case "cardBack:banner": {
      const banner = data.banners[entity];
      if (!banner) return null;
      return {
        id,
        kind: "cardBack",
        name: `${banner.name} Card Back`,
        source: `Headliner Banner: ${banner.name}, first ×10 pull`,
        color: banner.color,
        emblem: banner.emblem,
      };
    }
    /**
     * `…:event:<eventId>` — a limited-time event's two cosmetics (09 §14).
     *
     * Resolved from `data/events.json` rather than from a section of
     * `cosmetics.json`, because an event already carries its own accent and
     * emblem and copying them here would be the same fact written twice — the
     * card back is bought in the event shop and the frame is the completion
     * meta-reward, and both are the event's own livery by definition.
     */
    case "cardBack:event": {
      const event = eventById(entity);
      if (!event) return null;
      return {
        id,
        kind: "cardBack",
        name: `${event.name} Card Back`,
        source: `${event.name} event shop`,
        color: event.accent,
        emblem: event.emblem,
      };
    }
    case "frame:event": {
      const event = eventById(entity);
      if (!event) return null;
      return {
        id,
        kind: "frame",
        name: `${event.name} Frame`,
        source: `${event.name} — ${event.completion.missionsRequired} event missions`,
        color: event.accent,
        emblem: event.emblem,
      };
    }
    case "frame:season": {
      const season = data.seasons[entity];
      if (!season) return null;
      return {
        id,
        kind: "frame",
        name: `${season.name} Frame`,
        source: `Backstage Pass: ${season.name}, tier 35`,
        color: season.color,
        emblem: season.emblem,
      };
    }
    case "title:season": {
      const season = data.seasons[entity];
      if (!season) return null;
      return {
        id,
        kind: "title",
        name: season.title,
        source: `Hype Wave: ${season.name}, tier 50`,
        color: season.color,
      };
    }
    case "emote:season": {
      const season = data.seasons[entity];
      if (!season) return null;
      const isSet = extra === "set";
      return {
        id,
        kind: "emote",
        name: season.name,
        source: `Hype Wave: ${season.name}, tier ${isSet ? "20 (Backstage)" : "15"}`,
        color: season.color,
        phrase: isSet ? season.emote.set.join(" · ") : season.emote.first,
      };
    }
    case "emote:leader": {
      const phrase = data.emotes.leader[entity];
      if (!leader || leader.token || !phrase) return null;
      return {
        id,
        kind: "emote",
        name: leader.name,
        source: `Leader Mastery 3 — ${leader.name}`,
        color: colorOf(leader.faction),
        phrase,
      };
    }
    default:
      return null;
  }
}

/** The phrases an emote cosmetic adds to the wheel. */
export function emotePhrases(content: ContentIndex, id: string): string[] {
  const data = cosmeticsData();
  const [kind, scope, entity, extra] = id.split(":");
  if (kind !== "emote" || !scope || !entity) return [];
  if (scope === "faction") {
    const entry = data.emotes.faction[entity];
    if (!entry) return [];
    return extra === "2" ? [...entry.set] : [entry.first];
  }
  if (scope === "leader") {
    const phrase = data.emotes.leader[entity];
    return phrase ? [phrase] : [];
  }
  if (scope === "season") {
    const season = data.seasons[entity];
    if (!season) return [];
    return extra === "set" ? [...season.emote.set] : [season.emote.first];
  }
  return [];
}

/** Every emote phrase available, starters first, in a stable order. */
export function unlockedEmotes(content: ContentIndex, owned: readonly string[]): string[] {
  const phrases = [...STARTER_EMOTES];
  for (const id of [...owned].sort()) {
    for (const phrase of emotePhrases(content, id)) {
      if (!phrases.includes(phrase)) phrases.push(phrase);
    }
  }
  return phrases;
}

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

/**
 * Every cosmetic the game can currently grant.
 *
 * Generated from content rather than listed, which is what makes the coverage
 * test possible in both directions: every id a reward can hand out appears here,
 * and everything here can be earned by something.
 */
export function allCosmetics(content: ContentIndex): Cosmetic[] {
  const out: Cosmetic[] = [];
  const push = (id: string): void => {
    const cosmetic = cosmeticById(content, id);
    if (cosmetic) out.push(cosmetic);
  };

  for (const faction of Object.values(content.factions)) {
    if (faction.id === "neutral") continue;
    push(cardBackId(faction.id));
    push(frameId(faction.id));
    push(factionTitleId(faction.id));
    push(factionEmoteId(faction.id, 1));
    push(factionEmoteId(faction.id, 2));
  }
  for (const leader of selectableLeaders(content)) {
    push(leaderTitleId(leader.id));
    push(leaderEmoteId(leader.id));
  }
  // achievement awards — few enough to list, and each belongs to nobody
  for (const [award, entry] of Object.entries(cosmeticsData().awards)) {
    push(awardId(entry.kind, award));
  }
  // every month's check-in card back
  for (const month of cosmeticsData().checkIn.rotation) push(checkInCardBackId(month.id));
  // every banner's themed card back
  for (const bannerId of Object.keys(cosmeticsData().banners)) push(bannerCardBackId(bannerId));
  // every Hype Wave season's set, tints included
  for (const [seasonId, season] of Object.entries(cosmeticsData().seasons)) {
    for (let tint = 1; tint <= season.tints.length; tint++) push(seasonCardBackId(seasonId, tint));
    push(seasonFrameId(seasonId));
    push(seasonTitleId(seasonId));
    push(seasonEmoteId(seasonId));
    push(seasonEmoteId(seasonId, true));
  }
  /**
   * Character badges and fan titles are **not** enumerated here.
   *
   * There are several hundred collectible characters and each has two, so
   * listing them would triple the size of every picker for cosmetics almost
   * nobody has earned. They resolve on demand from an owned id instead — the
   * profile picker shows what you own, not what exists.
   */
  return out;
}

/** Resolve a list of owned ids to cosmetics, dropping any that no longer exist. */
export function ownedCosmetics(content: ContentIndex, owned: readonly string[]): Cosmetic[] {
  return owned
    .map((id) => cosmeticById(content, id))
    .filter((cosmetic): cosmetic is Cosmetic => cosmetic !== null);
}

/** What a slot should render, honouring the equipped id when it still resolves. */
export function equipped(
  content: ContentIndex,
  kind: CosmeticKind,
  equippedIds: Readonly<Record<string, string | null | undefined>>,
  owned: readonly string[]
): Cosmetic | null {
  const id = equippedIds[kind];
  if (!id) return null;
  // wearing something you no longer own is not a thing; nor is wearing a card
  // back in the title slot
  if (!owned.includes(id)) return null;
  const cosmetic = cosmeticById(content, id);
  return cosmetic && cosmetic.kind === kind ? cosmetic : null;
}

/** Everything wrong with the catalogue, checked against real content. */
export function checkCosmeticsData(content: ContentIndex): string[] {
  const problems: string[] = [];
  const data = cosmeticsData();
  const factions = Object.values(content.factions).filter((faction) => faction.id !== "neutral");

  for (const faction of factions) {
    if (!data.titles[faction.id]) problems.push(`${faction.id}: no §13 title`);
    if (!data.emblems[faction.id]) problems.push(`${faction.id}: no card-back emblem`);
    if (!data.emotes.faction[faction.id]) problems.push(`${faction.id}: no emotes`);
  }
  for (const [factionId, entry] of Object.entries(data.emotes.faction)) {
    if (!content.factions[factionId as FactionId]) problems.push(`emotes: ${factionId} is not a faction`);
    if (entry.set.length === 0) problems.push(`${factionId}: emote set II is empty`);
  }
  const leaderIds = new Set(selectableLeaders(content).map((leader) => leader.id));
  for (const leaderId of Object.keys(data.emotes.leader)) {
    if (!leaderIds.has(leaderId)) problems.push(`emotes: ${leaderId} is not a selectable leader`);
  }
  for (const leaderId of leaderIds) {
    if (!data.emotes.leader[leaderId]) problems.push(`${leaderId}: no leader emote`);
  }
  for (const cosmetic of allCosmetics(content)) {
    if (cosmetic.kind === "emote" && !cosmetic.phrase) problems.push(`${cosmetic.id}: an emote with no phrase`);
  }

  /**
   * Two factions must not share an emblem, and two emotes must not share a
   * phrase.
   *
   * Both are duplicates that nothing else would catch. Identical emblems mean
   * two factions' card backs are the same picture in different colours — the
   * reward for mastering the tenth faction being a thing you already had. And a
   * repeated phrase is a wheel entry you unlock twice and see once, which reads
   * as the unlock having failed.
   */
  /**
   * An award's emblem is drawn by the frame ring and by nothing else.
   *
   * A title is text and a badge is an initial in a chip, so an emblem on either
   * is a field that validates, ships, and is never looked at — and a frame
   * *without* one is a bare coloured ring, which is what a player with no frame
   * already sees. Both directions are the same bug: the data says something the
   * screen does not.
   */
  const EMBLEM_DRAWN: ReadonlySet<CosmeticKind> = new Set<CosmeticKind>(["frame", "cardBack"]);
  for (const [award, entry] of Object.entries(data.awards)) {
    if (EMBLEM_DRAWN.has(entry.kind) && !entry.emblem) {
      problems.push(`award ${award}: a ${entry.kind} with no emblem draws an empty ${entry.kind === "frame" ? "ring" : "rectangle"}`);
    }
    if (!EMBLEM_DRAWN.has(entry.kind) && entry.emblem) {
      problems.push(`award ${award}: nothing draws a ${entry.kind}'s emblem`);
    }
    if (!cosmeticById(content, awardId(entry.kind, award))) problems.push(`award ${award}: does not resolve`);
  }

  /**
   * A season's tints must be distinct, and the first one is the base card back.
   *
   * Two identical tints are two Backstage tiers paying the same picture, which
   * reads as the second unlock having failed — the same bug the duplicate-emblem
   * check exists for, one level down.
   */
  for (const [seasonId, season] of Object.entries(data.seasons)) {
    if (new Set(season.tints).size !== season.tints.length) problems.push(`season ${seasonId}: repeated tint`);
    if (!cosmeticById(content, seasonTitleId(seasonId))) problems.push(`season ${seasonId}: title does not resolve`);
    if (cosmeticById(content, seasonCardBackId(seasonId, season.tints.length + 1))) {
      problems.push(`season ${seasonId}: a tint past the end resolves`);
    }
  }

  /**
   * §11's rotation should cover a calendar year.
   *
   * Shorter than twelve and the thirteenth month hands out a card back the
   * player already owns, which pays nothing and looks like a bug. Saying so here
   * is the honest alternative to letting somebody find out in month thirteen.
   */
  const rotation = data.checkIn.rotation;
  if (rotation.length < 12) problems.push(`check-in: ${rotation.length} months authored; a year needs 12`);
  if (new Set(rotation.map((month) => month.id)).size !== rotation.length) {
    problems.push("check-in: two months share an id");
  }

  const seenEmblems = new Map<string, string>();
  for (const [factionId, emblem] of Object.entries(data.emblems)) {
    const owner = seenEmblems.get(emblem);
    if (owner) problems.push(`${factionId} and ${owner} share the "${emblem}" emblem`);
    else seenEmblems.set(emblem, factionId);
  }

  const seenPhrases = new Map<string, string>();
  for (const phrase of STARTER_EMOTES) seenPhrases.set(phrase, "the starter wheel");
  const everyPhrase: [string, string][] = [
    ...Object.entries(data.emotes.faction).flatMap(([id, entry]): [string, string][] =>
      [entry.first, ...entry.set].map((phrase) => [phrase, id])
    ),
    ...Object.entries(data.emotes.leader).map(([id, phrase]): [string, string] => [phrase, id]),
    ...Object.entries(data.seasons).flatMap(([id, season]): [string, string][] =>
      [season.emote.first, ...season.emote.set].map((phrase) => [phrase, id])
    ),
  ];
  for (const [phrase, owner] of everyPhrase) {
    const already = seenPhrases.get(phrase);
    if (already) problems.push(`${owner} and ${already} both say "${phrase}"`);
    else seenPhrases.set(phrase, owner);
  }

  return problems;
}

/** A character card, for the badge picker. */
export const badgeCard = (content: ContentIndex, cosmetic: Cosmetic): CardDef | null =>
  cosmetic.cardId ? (content.cards[cosmetic.cardId] ?? null) : null;
