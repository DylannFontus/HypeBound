/**
 * Cloud saves — the half with no I/O in it.
 *
 * Everything here is a pure function of its arguments: what the five save
 * stores currently hold, what the server says it holds, and what this device
 * last agreed with the server about. Nothing fetches, nothing writes, nothing
 * reads a clock. The network lives in `../net/saveClient.ts` and the wiring in
 * `cloudSaves.ts`, so the part that decides *whether to overwrite a player's
 * collection* can be tested exhaustively without a server, which is the only
 * way to be confident about a decision that destructive.
 *
 * ## Three places this deliberately departs from multiplayer §12
 *
 * **1. The sections are the stores that exist.** §12.2 lists `profile`,
 * `settings`, `collection`, `decks`, `progression` and `history` at keys like
 * `hb.collection`. No such split was ever built: the save layer has five stores
 * under `hypebound:`, and collection, decks, progression and history all live
 * *inside* `profile`. Inventing the split here would mean refactoring the most
 * load-bearing store in the game as a side effect of adding sync, so the
 * sections are the real stores and the doc gets a correction instead.
 *
 * The cost of that is real and worth naming: §12.2 wants last-writer-wins **per
 * deck id**, so two devices editing different decks both survive. With decks
 * inside `profile` they cannot, and a conflict is a whole-profile conflict.
 *
 * **2. Nothing is server-authoritative, because the server does not run the
 * economy.** §12.2 marks `collection` and `progression` as "Server wins; the
 * local copy is a cache". That presumes pack rolls, crafting and XP execute
 * server-side. They do not — all of it is client-side and offline. Implementing
 * "server wins" today would mean the first sync replacing a real collection
 * with an empty one. So the client authors every section and the server stores
 * it opaquely.
 *
 * **3. There is no `deviceId` or `deviceName`.** §12.1 carries both so the
 * selection screen can say "Chrome on Windows". Two reasons not to. The privacy
 * page states that what the browser reports about itself is read into memory
 * and never sent, and a device name is exactly that being sent. And it is not
 * even the useful thing to show: a player choosing between two saves wants to
 * know *what is in them* — clout, cards, decks, when — and that can be computed
 * from the payload after downloading it. So the metadata is smaller, the
 * privacy claim survives intact, and the comparison gets better.
 *
 * `revision` and `updatedAt` stay server-assigned, exactly as §12.1 says, for
 * the reason §12.1 gives: client clocks are untrusted.
 */

/**
 * The five real stores.
 *
 * Order matters only for display. `profile` first because it is the one a
 * player means when they say "my save".
 */
export const SAVE_SECTIONS = ["profile", "settings", "story", "gauntlet", "doomscroll"] as const;

export type SaveSection = (typeof SAVE_SECTIONS)[number];

export function isSaveSection(value: unknown): value is SaveSection {
  return typeof value === "string" && (SAVE_SECTIONS as readonly string[]).includes(value);
}

/** What the server knows about one section, without sending the payload. */
export interface ManifestEntry {
  readonly section: SaveSection;
  /** The client's own envelope version — the server stores it, never interprets it. */
  readonly version: number;
  /** Server-assigned, monotonic per section. */
  readonly revision: number;
  /** ISO 8601, server clock. */
  readonly updatedAt: string;
  readonly checksum: string;
  readonly bytes: number;
}

export interface CloudEnvelope<T = unknown> {
  readonly version: number;
  readonly data: T;
  readonly meta: ManifestEntry;
}

/**
 * What this device last agreed with the server for one section.
 *
 * Held locally. Its whole job is to tell "the server changed" apart from "I
 * changed", which is the difference between a safe overwrite and a lost
 * afternoon.
 */
export interface LinkState {
  readonly revision: number;
  readonly checksum: string;
}

export type SyncAction =
  /** Identical on both sides, or absent from both. Do nothing. */
  | "in-sync"
  /** Local is ahead. Safe to upload. */
  | "push"
  /** The server is ahead and this device has no unsynced change. Safe to download. */
  | "pull"
  /** Both sides hold real, different saves and nobody has chosen yet. Ask. */
  | "adopt"
  /** Both moved since the last agreement. Never resolved silently. */
  | "conflict";

export interface SyncInputs {
  /** Checksum of the live local payload. */
  readonly localChecksum: string;
  /** Is the local payload byte-identical to a brand-new save? */
  readonly localIsDefault: boolean;
  /** What the server reports, or null if it holds nothing for this section. */
  readonly remote: ManifestEntry | null;
  /** What this device last synced, or null if it never has. */
  readonly link: LinkState | null;
}

/**
 * What to do with one section.
 *
 * The order of these branches is the safety argument, so it is worth reading as
 * a list of things that must not happen rather than as a decision tree.
 *
 * - **Identical content is never a conflict.** Checked first, before anything
 *   looks at revisions. Two devices that independently reached the same state
 *   have nothing to resolve, and asking would be a prompt about nothing. It also
 *   spares a write, which matters more than it sounds: the free plan allows
 *   100,000 row writes a day across the whole game.
 * - **An untouched local save is never a reason to ask.** A fresh browser
 *   signing in has nothing to lose, so it pulls. Offering "keep this device's
 *   save" when this device's save is an empty collection is a trap with a nice
 *   label on it.
 * - **A missing cloud copy is never a conflict.** Nothing can be overwritten
 *   that is not there.
 * - **Anything else where both sides moved is a `conflict`, and this module
 *   will not resolve it.** Last-writer-wins is what §12.2 nominally asks for,
 *   and it is exactly how an afternoon of offline play disappears when the other
 *   device happens to sync second.
 */
export function decideSync({ localChecksum, localIsDefault, remote, link }: SyncInputs): SyncAction {
  if (remote && remote.checksum === localChecksum) return "in-sync";

  if (!remote) {
    // Nothing in the cloud. Upload unless there is nothing to upload either.
    return localIsDefault && !link ? "in-sync" : "push";
  }

  if (localIsDefault) return "pull";

  if (!link) return "adopt";

  const localMoved = localChecksum !== link.checksum;
  const remoteMoved = remote.revision !== link.revision;

  if (!localMoved && !remoteMoved) return "in-sync";
  if (localMoved && !remoteMoved) return "push";
  if (!localMoved && remoteMoved) return "pull";
  return "conflict";
}

// ---------------------------------------------------------------------------
// Merging two saves that both moved
// ---------------------------------------------------------------------------

/**
 * The algebra. The rules that use it are `cloudSaves.ts`'s, and they are there
 * rather than here because they are knowledge of the save *schema* — the names
 * of the counters, which arrays are ledgers — and this file is the one the
 * Workers bundle is allowed to reach. What crosses the boundary is arithmetic
 * over shapes; what stays on the client is what the shapes mean.
 *
 * ## Why a merge exists at all
 *
 * `decideSync` returns `conflict` and will not pick a winner, and that is still
 * right: nothing about two revision numbers says which afternoon a player would
 * rather keep. But refusing to *decide* was implemented as refusing to *act*,
 * and a device that will not act never syncs again in either direction. That is
 * not neutrality, it is a silent, permanent halt — measured: four consecutive
 * sync passes on a returning device, every one of them `conflict`, every one of
 * them a no-op, while the other device's matches piled up on the server.
 *
 * The way out is not to pick. It is to notice that the two saves are not rival
 * answers to one question, they are one save plus two disjoint sets of things
 * that happened, and most of a save is untouched by either. So:
 *
 * - **A subtree only one side changed is taken from that side.** No rule
 *   needed, and this is nearly all of it — a match moves a dozen fields out of
 *   several hundred.
 * - **Where both sides changed, a rule applies** if there is one: counters take
 *   both deltas, ledgers union, logs union by id.
 * - **Where both sides changed and there is no rule, the account's copy wins.**
 *   Never a value neither device held, and never worse than the
 *   last-writer-wins this replaces.
 *
 * ## The ancestor
 *
 * A three-way merge needs the common ancestor, so `cloudSaves.ts` keeps the
 * last agreed payload per section. When it is missing — storage cleared, or the
 * first sync after this shipped — `hasBase: false` degrades every counter to a
 * maximum instead of a sum. That under-credits a player who earned Clout on
 * both devices, and it is the conservative direction: unions still union, so no
 * *match* is lost, only some arithmetic about it.
 */
export type MergeRule =
  /** A number that accumulates. `remote + (local - base)`, so both deltas land. */
  | { readonly kind: "counter" }
  /** A high-water mark. The larger of the two. */
  | { readonly kind: "max" }
  /** An unordered ledger of primitives. Union, remote's order first. */
  | { readonly kind: "set" }
  /**
   * A list of records with an identity. Union by `id`, remote winning a tie.
   *
   * `time` sorts the result when the list has an order; without it the union
   * keeps remote's order and appends what only local had, which is what makes
   * this safe for `decks` — the entries the account's copy already had do not
   * move, so an index stored elsewhere still points at the same one.
   *
   * Nothing is truncated. Every one of these lists is trimmed by the game on
   * its next write, so a union that is briefly over the limit heals itself, and
   * duplicating the limits here would be two constants free to disagree.
   */
  | { readonly kind: "list"; readonly id: string; readonly time?: string; readonly newestFirst?: boolean }
  /** Take the account's copy whole. For live run state, PRNG state, anything atomic. */
  | { readonly kind: "remote" };

/**
 * Rules by dotted path, with `*` standing in for a map key.
 *
 * Lookup tries the exact path, then replaces trailing segments with `*` one at
 * a time — so `mastery.faction.idols` finds `mastery.faction.*`. The empty
 * string is the root, which is how a whole section opts out of merging.
 */
export type MergeRules = Readonly<Record<string, MergeRule>>;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function ruleFor(path: string, rules: MergeRules): MergeRule | undefined {
  const exact = rules[path];
  if (exact) return exact;
  if (path === "") return undefined;
  const parts = path.split(".");
  for (let keep = parts.length - 1; keep >= 1; keep--) {
    const pattern = [...parts.slice(0, keep), ...parts.slice(keep).map(() => "*")].join(".");
    const rule = rules[pattern];
    if (rule) return rule;
  }
  return undefined;
}

export interface MergeOptions {
  /** False when the common ancestor is unavailable; counters degrade to maxima. */
  readonly hasBase?: boolean;
}

/**
 * Three-way merge of one save section.
 *
 * `base` is what both sides last agreed on, `local` is this device's copy and
 * `remote` is the account's. Pure: no clock, no storage, no randomness, so the
 * same three inputs always produce the same output on both devices — which
 * matters, because both of them are going to run it.
 */
export function mergeThreeWay(
  base: unknown,
  local: unknown,
  remote: unknown,
  rules: MergeRules,
  options: MergeOptions = {},
  path = ""
): unknown {
  const asLocal = canonicalJson(local);
  const asRemote = canonicalJson(remote);
  if (asLocal === asRemote) return remote;

  const asBase = canonicalJson(base);
  // Only one side moved. This is most of a save, and it needs no policy.
  if (asBase === asLocal) return remote;
  if (asBase === asRemote) return local;

  const rule = ruleFor(path, rules);
  if (rule) return applyRule(rule, base, local, remote, options);

  if (isPlainObject(local) && isPlainObject(remote)) {
    const merged: Record<string, unknown> = {};
    const baseObject = isPlainObject(base) ? base : {};
    for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
      const value = mergeThreeWay(
        baseObject[key],
        local[key],
        remote[key],
        rules,
        options,
        path === "" ? key : `${path}.${key}`
      );
      if (value !== undefined) merged[key] = value;
    }
    return merged;
  }

  /**
   * Two scalars, or two arrays with no rule. The account's copy wins.
   *
   * Element-wise merging of an unruled array is the one thing this must never
   * do: a deck's card list, a PRNG's four words and a run's node path are all
   * arrays whose elements only mean anything together.
   */
  return remote;
}

function applyRule(rule: MergeRule, base: unknown, local: unknown, remote: unknown, options: MergeOptions): unknown {
  switch (rule.kind) {
    case "counter": {
      if (typeof local !== "number" || typeof remote !== "number") return remote ?? local;
      if (options.hasBase === false) return Math.max(local, remote);
      const from = typeof base === "number" ? base : 0;
      // Clamped at zero because a spend recorded on both sides could otherwise
      // take a currency negative, and no screen in the game renders that.
      return Math.max(0, remote + (local - from));
    }
    case "max":
      if (typeof local !== "number" || typeof remote !== "number") return remote ?? local;
      return Math.max(local, remote);
    case "set": {
      if (!Array.isArray(local) || !Array.isArray(remote)) return remote ?? local;
      const seen = new Set(remote.map((item) => canonicalJson(item)));
      const union = [...remote];
      for (const item of local) {
        const key = canonicalJson(item);
        if (seen.has(key)) continue;
        seen.add(key);
        union.push(item);
      }
      return union;
    }
    case "list": {
      if (!Array.isArray(local) || !Array.isArray(remote)) return remote ?? local;
      /**
       * Remote first, and remote wins a shared id.
       *
       * Both halves matter. Remote wins because the account's copy is the later
       * of the two by revision. Remote goes *first* because a `Map` keeps the
       * order of first insertion, so the entries the account already had stay
       * exactly where they were and this device's extras are appended — which
       * is the property that lets `decks` be merged at all, given that
       * `activeDeckIndex` is an index into it.
       */
      const byId = new Map<string, unknown>();
      for (const entry of remote) byId.set(identityOf(entry, rule.id), entry);
      for (const entry of local) {
        const key = identityOf(entry, rule.id);
        if (!byId.has(key)) byId.set(key, entry);
      }
      const union = [...byId.values()];
      if (!rule.time) return union;
      const time = rule.time;
      const direction = rule.newestFirst === false ? 1 : -1;
      return union.sort((a, b) => direction * (numberAt(a, time) - numberAt(b, time)));
    }
    case "remote":
      return remote;
  }
}

/**
 * The key an entry unions on.
 *
 * An entry missing the id field falls back to its whole canonical form, so it
 * survives the union as itself rather than colliding with every other entry
 * that is also missing it — which would silently collapse a log to one row.
 */
function identityOf(entry: unknown, field: string): string {
  if (isPlainObject(entry)) {
    const value = entry[field];
    if (typeof value === "string" || typeof value === "number") return `${field}:${String(value)}`;
  }
  return `raw:${canonicalJson(entry)}`;
}

function numberAt(entry: unknown, field: string): number {
  if (!isPlainObject(entry)) return 0;
  const value = entry[field];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

// ---------------------------------------------------------------------------
// Canonical form and checksums
// ---------------------------------------------------------------------------

/**
 * JSON with object keys sorted, at every depth.
 *
 * `JSON.stringify` preserves insertion order, so two saves holding identical
 * data serialise differently depending on the order fields happened to be
 * written — and a checksum over that would report a change every time a store
 * was rebuilt from `fillDefaults`, which reorders keys by construction. That
 * would turn every boot into an upload.
 *
 * Arrays keep their order, because in a save an array's order *is* data: deck
 * card order, match history, the sequence of cleared chapters.
 *
 * `undefined` members are dropped rather than encoded, matching what
 * `JSON.stringify` does to them, so the checksum agrees with the bytes that
 * actually get uploaded.
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, member]) => member !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`).join(",")}}`;
}

/**
 * SHA-256 of the canonical form, hex.
 *
 * `crypto.subtle` rather than a hand-rolled hash because it exists in both
 * places this runs — the browser and workerd — and because a checksum is the
 * only thing standing between "these two saves are the same" and an overwrite.
 */
export async function checksumOf(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Caps
// ---------------------------------------------------------------------------

/**
 * §12.3's per-section cap, enforced on both sides.
 *
 * The client checks so it can say something useful instead of showing a 413,
 * and the server checks because a client check is a courtesy rather than a
 * control.
 */
export const SECTION_BYTE_CAP = 512 * 1024;

/**
 * How long to wait after a change before uploading.
 *
 * The store layer debounces localStorage at 250 ms, which is right for a write
 * that costs nothing. A cloud write is a row against a 100,000-per-day
 * allowance shared by every player, so this is three orders of magnitude
 * slower — and every upload is gated on the checksum actually differing, so an
 * idle game uploads nothing at all no matter how long it idles.
 */
export const SYNC_DEBOUNCE_MS = 30_000;
