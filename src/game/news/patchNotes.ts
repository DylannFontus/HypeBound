/**
 * Patch notes — `03-screens-and-navigation.md` §4.2.3, and the enforcement
 * column of `07-economy-and-monetization.md` §6 policies **F1** and **F4**.
 *
 * §4.2.3 asks for *"a versioned, precise record of every balance and content
 * change"*, with card changes *"rendered on real card frames"*. F4 goes further
 * and says what has to make it true:
 *
 * > *"Odds are versioned data; the client displays the data version; automated
 * > diff of `economy.*` between releases is posted to patch notes."*
 *
 * ## Two rules that make a patch note unable to lie
 *
 * **A card entry stores only the `before`.** The `after` is read off the shipped
 * card — or off the next release that touched the same card, which is the same
 * thing one step earlier. There is no second copy of the new value, so there is
 * nothing for the note and the card to disagree about. A note claiming a cost
 * went to 4 cannot survive the card costing 5, because the note never says 5.
 *
 * **Every release carries the economy it shipped with, and the newest snapshot
 * must equal the live one.** That is what turns F4 from a promise into a
 * mechanism: edit a published rate without adding a release and `npm test`
 * fails. A release that has not shipped can simply have its snapshot updated in
 * place — the check exists to make the change deliberate, not to make it hard.
 */

import type { CardDef, ContentIndex } from "../../engine/types";
import { patchNotesData, type CardBefore, type CardChangeDef, type ReleaseDef } from "./data";

/** Every release, newest first. */
export function releases(): ReleaseDef[] {
  return [...patchNotesData().releases].sort((a, b) => compareVersions(b.version, a.version));
}

export const latestRelease = (): ReleaseDef => releases()[0]!;

/** The data version the client displays, per F4. */
export const DATA_VERSION = (): string => latestRelease().version;

/** Semver-ish compare on the three numeric parts. Returns <0 when a is older. */
export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * §4.2.3's *"changed since you last played"* band, as a pure function.
 *
 * An account that has seen **nothing** is told about nothing. Lighting the band
 * up on somebody's first visit would claim that things changed while they were
 * away, during a period they were not here for — which is both false and the
 * kind of false that manufactures a reason to open a screen.
 *
 * Split out from the profile so it can be tested against more than the one
 * release this build has shipped.
 */
export function unseenVersions(seen: readonly string[], all: readonly string[]): string[] {
  if (seen.length === 0) return [];
  /**
   * Compared against the **newest** version seen, not against the set.
   *
   * Releases are cumulative: reading 0.2.0's notes means you are caught up, and
   * nobody was "away" for 0.1.0 afterwards. Testing set membership instead kept
   * flagging every older release the account had never explicitly opened, which
   * is a permanent unread badge for history somebody has already lived through.
   *
   * It could not show up while the build had one release, because with one
   * release the two readings are the same reading. It appeared the moment there
   * were two — which is what known gap 28 meant by "nothing to diff".
   */
  const newestSeen = seen.reduce((best, version) => (compareVersions(version, best) > 0 ? version : best));
  return all.filter((version) => compareVersions(version, newestSeen) > 0);
}

// ---------------------------------------------------------------------------
// The economy diff
// ---------------------------------------------------------------------------

export interface EconomyChange {
  /** dotted path into `economy`, e.g. `banner.rates.legendary` */
  path: string;
  before: unknown;
  after: unknown;
}

/** Flatten a nested object to dotted paths with primitive leaves. */
function flatten(value: unknown, prefix = ""): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      for (const [path, leaf] of flatten(entry, prefix ? `${prefix}.${key}` : key)) out.set(path, leaf);
    }
    return out;
  }
  out.set(prefix, Array.isArray(value) ? JSON.stringify(value) : value);
  return out;
}

/**
 * What changed in `economy` between two snapshots, as dotted paths.
 *
 * A key that appeared or disappeared is reported too, with `undefined` on the
 * missing side — a removed price is a change somebody should be told about, and
 * comparing only shared keys is how that goes unnoticed.
 */
export function economyDiff(before: Record<string, unknown>, after: Record<string, unknown>): EconomyChange[] {
  const left = flatten(before);
  const right = flatten(after);
  const paths = [...new Set([...left.keys(), ...right.keys()])].sort();
  return paths
    .filter((path) => left.get(path) !== right.get(path))
    .map((path) => ({ path, before: left.get(path), after: right.get(path) }));
}

// ---------------------------------------------------------------------------
// The card diff
// ---------------------------------------------------------------------------

/** The fields a change can name, in the order a card prints them. */
export const CARD_FIELDS = ["cost", "attack", "health", "rarity", "keywords", "text"] as const;

export type CardField = (typeof CARD_FIELDS)[number];

export interface CardFieldChange {
  field: CardField;
  before: string | number;
  after: string | number;
}

export interface CardChangeView {
  cardId: string;
  card: CardDef | null;
  note: string | undefined;
  fields: CardFieldChange[];
}

const fieldOf = (card: CardDef | null, field: CardField): string | number | undefined => {
  if (!card) return undefined;
  const value = (card as unknown as Record<string, unknown>)[field];
  if (Array.isArray(value)) return value.join(", ");
  return typeof value === "string" || typeof value === "number" ? value : undefined;
};

const beforeOf = (before: CardBefore, field: CardField): string | number | undefined => {
  const value = (before as unknown as Record<string, unknown>)[field];
  if (Array.isArray(value)) return value.join(", ");
  return typeof value === "string" || typeof value === "number" ? value : undefined;
};

/**
 * What a release's card changes actually say, resolving each `after`.
 *
 * `ordered` is the newest-first release list; `index` is the release being
 * viewed. For each field, the `after` is the `before` recorded by the earliest
 * *later* release that touched the same field — walking the array from
 * `index - 1` towards 0 finds that one first — and the live card when nothing
 * later touched it.
 */
export function cardChanges(content: ContentIndex, ordered: ReleaseDef[], index: number): CardChangeView[] {
  const release = ordered[index];
  if (!release) return [];

  return release.cards.map((change: CardChangeDef) => {
    const card = content.cards[change.cardId] ?? null;

    const fields = CARD_FIELDS.flatMap<CardFieldChange>((field) => {
      const before = beforeOf(change.before, field);
      if (before === undefined) return [];

      let after: string | number | undefined;
      for (let later = index - 1; later >= 0; later--) {
        const touched = ordered[later]!.cards.find((entry) => entry.cardId === change.cardId);
        const value = touched ? beforeOf(touched.before, field) : undefined;
        if (value !== undefined) {
          after = value;
          break;
        }
      }
      after ??= fieldOf(card, field);
      if (after === undefined) return [];
      return [{ field, before, after }];
    });

    return { cardId: change.cardId, card, note: change.note, fields };
  });
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface ReleaseView {
  def: ReleaseDef;
  releasedAt: number;
  /** true for the release currently shipped */
  current: boolean;
  cards: CardChangeView[];
  /** `economy.*` against the release before it; empty for the first release */
  economy: EconomyChange[];
  /** true when this release records no change of any kind */
  empty: boolean;
}

export function releaseViews(content: ContentIndex): ReleaseView[] {
  const ordered = releases();
  return ordered.map((def, index) => {
    const older = ordered[index + 1];
    const cards = cardChanges(content, ordered, index);
    const economy = older ? economyDiff(older.economy, def.economy) : [];
    return {
      def,
      releasedAt: Date.parse(def.releasedAt),
      current: index === 0,
      cards,
      economy,
      empty:
        cards.length === 0 &&
        economy.length === 0 &&
        def.rules.length === 0 &&
        def.systems.length === 0 &&
        def.fixes.length === 0,
    };
  });
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

/** Deep equality over the JSON shapes a snapshot can hold. */
function sameShape(a: unknown, b: unknown): boolean {
  return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
}

/** Key-order-independent copy, so a reordered file is not a false alarm. */
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !key.startsWith("_"))
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, entry]) => [key, sorted(entry)])
    );
  }
  return value;
}

/**
 * Everything wrong with `data/patch-notes.json`, checked against real content.
 *
 * The schema proves the file is well-formed. This proves it is *true* — and one
 * of these is not a data check at all but F4's enforcement: **the newest
 * release's economy snapshot must equal the shipped economy.**
 */
export function checkPatchNotesData(content: ContentIndex): string[] {
  const problems: string[] = [];
  const ordered = releases();
  const seen = new Set<string>();

  for (let index = 0; index < ordered.length; index++) {
    const release = ordered[index]!;
    if (seen.has(release.version)) problems.push(`${release.version}: duplicate version`);
    seen.add(release.version);

    const older = ordered[index + 1];
    if (older) {
      if (compareVersions(release.version, older.version) <= 0) {
        problems.push(`${release.version}: is not newer than ${older.version}`);
      }
      if (Date.parse(release.releasedAt) <= Date.parse(older.releasedAt)) {
        problems.push(`${release.version}: released on or before ${older.version}`);
      }
    }
    if (!Number.isFinite(Date.parse(release.releasedAt))) {
      problems.push(`${release.version}: unreadable releasedAt`);
    }

    for (const change of release.cards) {
      if (!content.cards[change.cardId]) {
        problems.push(`${release.version}: "${change.cardId}" is not a card`);
        continue;
      }
      if (Object.keys(change.before).length === 0) {
        problems.push(`${release.version}: "${change.cardId}" changed nothing`);
      }
    }

    /**
     * A "change" whose before and after are the same is worse than no entry: it
     * tells a player something moved when nothing did, and it is exactly what a
     * copy-pasted row looks like.
     */
    for (const view of cardChanges(content, ordered, index)) {
      const declared = Object.keys(release.cards.find((entry) => entry.cardId === view.cardId)?.before ?? {}).length;
      if (view.fields.length === 0 && declared > 0) {
        problems.push(`${release.version}: "${view.cardId}" names fields that resolve to nothing`);
      }
      for (const field of view.fields) {
        if (String(field.before) === String(field.after)) {
          problems.push(`${release.version}: "${view.cardId}" says ${field.field} changed, but it is still ${field.after}`);
        }
      }
    }
  }

  /**
   * F4's enforcement, and the reason this file is worth having at all.
   *
   * The message says what to do rather than only what is wrong, because the
   * right fix depends on whether the newest release has shipped — and only a
   * person knows that.
   */
  const newest = ordered[0];
  if (newest && !sameShape(newest.economy, content.balance.economy)) {
    const drift = economyDiff(newest.economy, content.balance.economy as unknown as Record<string, unknown>);
    problems.push(
      `${newest.version}: the economy snapshot does not match the shipped balance — ` +
        drift.map((change) => `${change.path} ${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}`).join(", ") +
        `. Policy F4 forbids changing published odds without a patch note: add a new release, ` +
        `or update ${newest.version}'s snapshot if it has not shipped yet.`
    );
  }

  return problems;
}
