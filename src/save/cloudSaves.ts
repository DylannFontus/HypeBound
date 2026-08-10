/**
 * Cloud saves, wired to the five real stores.
 *
 * `cloudSync.ts` decides, `../net/saveClient.ts` transports, and this module is
 * the only place that knows both — which store a section is, and what to do
 * with the answer. Kept separate from the pure core so the destructive
 * decisions stay testable without any of this.
 *
 * ## Nothing here runs on import
 *
 * No timers, no boot-time fetch. `syncNow()` and `startAutoSync()` are called
 * by the lobby once there is a session. That keeps the cold start
 * network-silent, which `scripts/verify-fairness.mjs` asserts by recording
 * every request the page makes and failing if any left the machine.
 *
 * ## The one rule that makes this safe
 *
 * **Nothing overwrites a local save without first archiving it.** Every pull
 * and every merge, whether routine or the result of a player choosing CLOUD,
 * writes the outgoing local copy to an archive key first. It is one slot per
 * section, it lives under `hypebound:` so the export button includes it and the
 * delete button clears it, and it costs one extra copy of a save that is a few
 * kilobytes. Cheap insurance against the only bug in this feature that a player
 * could not forgive.
 *
 * ## Progress made on a second device, and why it used not to come back
 *
 * The reported symptom was that a device never saw what another device had
 * played. Reproduced with two browser contexts against the live Worker, the
 * cause was not the pull: it was that **`syncNow` treated `conflict` as "do
 * nothing", and nothing ever resolved it.** Once both sides had moved once —
 * which takes only a match finished inside the thirty-second upload debounce
 * and a tab that then went away — that device was wedged permanently. Four
 * consecutive passes, every one deciding `conflict`, every one a no-op, in both
 * directions, silently, for ever. It is the worst shape a bug can have: the
 * machinery all works, and the answer is always "nothing to do".
 *
 * Three things fix it, and they are deliberately in that order.
 *
 * **1. Sync follows the player, not just the data.** The old trigger was a
 * local store write plus thirty seconds, so a pull only ever happened as a side
 * effect of a *local* change. A device that was merely returned to never
 * looked. Now coming back — `visibilitychange`, `focus`, `online`, and a slow
 * poll while visible — syncs, and going away pushes whatever is pending instead
 * of waiting out the debounce. That alone makes the reported scenario work,
 * because the two devices stop diverging in the first place.
 *
 * **2. When they diverge anyway, the saves are merged, not chosen between.**
 * Genuine offline play on two devices is a first-class case here — the privacy
 * screen promises the game works offline — so it has to have an answer that is
 * not "pick one afternoon to throw away". See `MERGE_RULES`.
 *
 * **3. One pass at a time, and the link is written a section at a time.** The
 * old code snapshotted the link file, ran the whole pass, and wrote the
 * snapshot back at the end. Two overlapping passes therefore lost each other's
 * agreements, which left the device believing it had agreed a revision it had
 * not — observed in the wild as a link stuck at revision 2 against a server at
 * 3, one match away from wedging.
 *
 * ## What this still will not do
 *
 * It will not resolve `adopt`. That is a different question — "this browser has
 * a save that has nothing to do with this account" — and it genuinely needs a
 * person, which is what `cloudSaveScreen` is for.
 */

import { profileStore } from "./profile";
import { settingsStore } from "./settings";
import { storyStore } from "./storySave";
import { gauntletStore } from "./gauntletSave";
import { doomscrollStore } from "./doomscrollSave";
import type { Store } from "./storage";
import {
  SAVE_SECTIONS,
  SYNC_DEBOUNCE_MS,
  canonicalJson,
  checksumOf,
  decideSync,
  mergeThreeWay,
  type LinkState,
  type ManifestEntry,
  type MergeRules,
  type SaveSection,
  type SyncAction,
} from "./cloudSync";
import { SaveClient } from "../net/saveClient";
import { currentAccount } from "../auth/account";

// ---------------------------------------------------------------------------
// Which store is which section
// ---------------------------------------------------------------------------

/**
 * `Store<object>` rather than the five concrete types.
 *
 * Everything here treats a save as opaque JSON — it is hashed, uploaded and
 * replaced, never read field by field. Typing the map precisely would buy
 * nothing and would force a cast at every use.
 */
const STORES: Record<SaveSection, Store<object>> = {
  profile: profileStore as unknown as Store<object>,
  settings: settingsStore as unknown as Store<object>,
  story: storyStore as unknown as Store<object>,
  gauntlet: gauntletStore as unknown as Store<object>,
  doomscroll: doomscrollStore as unknown as Store<object>,
};

const LINK_KEY = "hypebound:cloud-link";
const archiveKey = (section: SaveSection): string => `hypebound:cloud-archive:${section}`;
const baseKey = (section: SaveSection): string => `hypebound:cloud-base:${section}`;

// ---------------------------------------------------------------------------
// Merge policy — what happens when two devices both played
// ---------------------------------------------------------------------------

/**
 * The policy, stated once, in the place it is enforced.
 *
 * Three kinds of thing live in a save, and only one of them is genuinely
 * contested when two devices both play:
 *
 * - **Things that happened.** A finished match, a Drop that was opened, a pack
 *   pull. These are events with identities, they are additive, and *both*
 *   devices are right. They union. No match played on either device is ever
 *   dropped, which is the one guarantee this whole module exists to make.
 * - **Sums of things that happened.** Clout, Shards, XP, card counts, Mastery,
 *   the achievement tallies. Both devices are right about their own delta, so
 *   the merge takes both: `remote + (local - base)`. A player who earned 200
 *   Clout on the train and 300 at home ends with 500, not with whichever number
 *   synced second.
 * - **A single current state.** The live Gauntlet run, the pending Story
 *   battle, a PRNG's four words, the deck a player is using. There is no
 *   coherent way to have two of these at once, and interleaving their fields
 *   produces a state neither device ever had. These take the account's copy
 *   whole, and the copy being replaced goes to the archive first.
 *
 * Anything not named here falls into the third kind by default. That is
 * deliberate: an unknown field is exactly the one there is no safe rule for,
 * and the default is never worse than the last-writer-wins it replaces.
 *
 * ### Two things it declines to be clever about
 *
 * **`decks` unions by name and `activeDeckIndex` does not move.** The account's
 * decks stay where they are and decks only this device had are appended, so an
 * index into that list still points at the same deck. A deck edited on both
 * devices takes the account's version — a deck list has no id, and guessing
 * from an optional client-clock `editedAt` would be a coin toss dressed up as a
 * rule. The overwritten deck is in the archive.
 *
 * **Nothing is truncated.** `history`, the Drop log and the pull log all have
 * limits, and all three are re-applied by the game on its next write. Copying
 * the limits here would be a second set of constants free to disagree with the
 * first — and briefly holding 70 matches of history is not a defect, whereas
 * trimming to a stale limit and losing the newest match is.
 */
const PROFILE_MERGE: MergeRules = {
  // Sums. Both devices are right about their own delta.
  clout: { kind: "counter" },
  shards: { kind: "counter" },
  glimmer: { kind: "counter" },
  accountXp: { kind: "counter" },
  pendingDrops: { kind: "counter" },
  rerollTokens: { kind: "counter" },
  "stats.*": { kind: "counter" },
  "collection.*": { kind: "counter" },
  "mastery.faction.*": { kind: "counter" },
  "mastery.leader.*": { kind: "counter" },
  "mastery.affinity.*": { kind: "counter" },
  "achievements.tally.totals.*": { kind: "counter" },
  "banners.tokens": { kind: "counter" },
  "drops.opened": { kind: "counter" },
  "drops.sinceLegendary": { kind: "counter" },
  "missions.dailiesCompleted": { kind: "counter" },
  "missions.weekliesCompleted": { kind: "counter" },
  "remix.wins": { kind: "counter" },
  "dailies.packsPaid": { kind: "counter" },

  /**
   * High-water marks, not sums.
   *
   * `accountLevel` is derived from `accountXp` and adding two levels together
   * would out-run the XP that paid for them; `bests` is by definition the
   * largest single-match value ever seen.
   */
  accountLevel: { kind: "max" },
  "achievements.tally.bests.*": { kind: "max" },

  // Ledgers of ids. Present in either means present in both — and every one of
  // these exists to stop a reward paying twice, so a union is also the safe
  // direction to be wrong in.
  favorites: { kind: "set" },
  locked: { kind: "set" },
  claimedRewards: { kind: "set" },
  unlockedFactions: { kind: "set" },
  tutorialStagesRewarded: { kind: "set" },
  "mastery.claimed": { kind: "set" },
  "achievements.claimed": { kind: "set" },
  "achievements.tally.sets.*": { kind: "set" },
  "cosmetics.owned": { kind: "set" },
  "inbox.read": { kind: "set" },
  "inbox.claimed": { kind: "set" },
  "inbox.deleted": { kind: "set" },
  "news.read": { kind: "set" },
  "news.seenVersions": { kind: "set" },
  "missions.wrappedWeeks": { kind: "set" },

  // Things that happened, with identities.
  history: { kind: "list", id: "id", time: "playedAt" },
  "missions.outcomes": { kind: "list", id: "playedAt", time: "playedAt", newestFirst: false },
  "drops.log": { kind: "list", id: "openedAt", time: "openedAt" },
  "banners.log": { kind: "list", id: "pulledAt", time: "pulledAt" },
  decks: { kind: "list", id: "name" },

  // One current state, taken whole.
  activeDeckIndex: { kind: "remote" },
  "drops.rng": { kind: "remote" },
  "drops.seed": { kind: "remote" },
  "missions.rng": { kind: "remote" },
  "missions.seed": { kind: "remote" },
  "missions.rotation": { kind: "remote" },
  "banners.rng": { kind: "remote" },
  "banners.seed": { kind: "remote" },
  "hypeWave.pass": { kind: "remote" },
};

const MERGE_RULES: Record<SaveSection, MergeRules> = {
  profile: PROFILE_MERGE,

  /**
   * Settings are the one section where a merge means nothing.
   *
   * A preference has no delta and no ledger; it is simply what the player last
   * chose, and the account's copy is the later of the two by construction. The
   * empty path is the whole section, so this is last-writer-wins stated out
   * loud rather than arrived at by accident.
   */
  settings: { "": { kind: "remote" } },

  /**
   * Story: per-chapter progress unions, the in-flight battle does not.
   *
   * `pending` is a battle mid-setup — a chapter, an episode and a flag snapshot
   * that only mean anything together — so it is taken whole. Everything about
   * what has been *finished* merges.
   */
  story: {
    "chapters.*.cleared": { kind: "set" },
    "chapters.*.losses.*": { kind: "counter" },
    pending: { kind: "remote" },
  },

  /** Lifetime totals sum, the best is the best, and a live run is atomic. */
  gauntlet: {
    run: { kind: "remote" },
    runsStarted: { kind: "counter" },
    runsFinished: { kind: "counter" },
    lifetimeClout: { kind: "counter" },
    cardBackProgress: { kind: "counter" },
    bestWins: { kind: "max" },
  },

  doomscroll: {
    run: { kind: "remote" },
    runsStarted: { kind: "counter" },
    runsCleared: { kind: "counter" },
    lifetimeClout: { kind: "counter" },
    bestActsCleared: { kind: "max" },
  },
};

// ---------------------------------------------------------------------------
// Link state — what this device last agreed with the server
// ---------------------------------------------------------------------------

interface LinkFile {
  /** Which account these agreements belong to. */
  accountId: string;
  sections: Partial<Record<SaveSection, LinkState>>;
}

/**
 * Read the link file, discarding it if it belongs to somebody else.
 *
 * Signing out and in as a different account on the same browser must not
 * inherit the previous account's revisions — that would let device A's
 * agreement about account X authorise a silent overwrite of account Y.
 */
function readLink(accountId: string): LinkFile {
  const blank: LinkFile = { accountId, sections: {} };
  if (typeof localStorage === "undefined") return blank;
  try {
    const parsed = JSON.parse(localStorage.getItem(LINK_KEY) ?? "null") as LinkFile | null;
    if (!parsed || parsed.accountId !== accountId) return blank;
    return { accountId, sections: parsed.sections ?? {} };
  } catch {
    return blank;
  }
}

function writeLink(file: LinkFile): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LINK_KEY, JSON.stringify(file));
  } catch {
    // Storage full or blocked. The next sync recomputes from scratch and, at
    // worst, asks the player a question it did not need to ask.
  }
}

/**
 * Record one section's agreement, without touching the others.
 *
 * Read-modify-write, every time, rather than mutating a snapshot taken at the
 * top of the pass and writing it back at the bottom. The snapshot version had a
 * lost-update bug with real teeth: any second writer — another tab, or an
 * overlapping pass in this one — put back revisions it had read before the
 * first writer stored its own, so the device ended up believing it had agreed
 * a revision it had never seen. That state is one local change away from a
 * permanent conflict, which is exactly the wedge this file exists to have
 * removed.
 */
function agreeLink(accountId: string, section: SaveSection, state: LinkState | undefined): void {
  const file = readLink(accountId);
  if (state) file.sections[section] = state;
  else delete file.sections[section];
  writeLink(file);
}

/** Forget every agreement. Called on sign-out so the next account starts clean. */
export function forgetCloudLink(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(LINK_KEY);
  // The ancestors go with it. A base snapshot is only meaningful against the
  // agreement that produced it, and one left behind from another account would
  // be a merge against a stranger's save.
  for (const section of SAVE_SECTIONS) localStorage.removeItem(baseKey(section));
}

// ---------------------------------------------------------------------------
// The common ancestor
// ---------------------------------------------------------------------------

/**
 * The last payload this device and the server agreed on, per section.
 *
 * Kept because a three-way merge is only as good as its ancestor, and the link
 * file holds a *checksum* — enough to notice a change, useless for working out
 * what the change was. One extra copy of each section, in the same
 * `hypebound:` namespace as the archive so the privacy page's export includes
 * it and its delete clears it.
 *
 * Stamped with the account id, because an ancestor from a different account is
 * worse than none at all: it would make two unrelated saves look like they had
 * diverged from a common point and merge them into a save nobody has ever had.
 */
interface BaseSnapshot {
  accountId: string;
  data: unknown;
}

function writeBase(accountId: string, section: SaveSection, data: unknown): void {
  if (typeof localStorage === "undefined") return;
  try {
    const snapshot: BaseSnapshot = { accountId, data };
    localStorage.setItem(baseKey(section), JSON.stringify(snapshot));
  } catch {
    // No room. `readBase` returns null, the merge degrades its counters to
    // maxima and says so, and nothing is lost that had an identity.
  }
}

function readBase(accountId: string, section: SaveSection): { data: unknown } | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(baseKey(section)) ?? "null") as BaseSnapshot | null;
    if (!parsed || parsed.accountId !== accountId) return null;
    return { data: parsed.data };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export interface SyncPlan {
  readonly actions: ReadonlyMap<SaveSection, SyncAction>;
  /** Both sides hold real, different saves and nobody has chosen. */
  readonly needsChoice: boolean;
  /** Sections where both sides moved since the last agreement. */
  readonly conflicts: readonly SaveSection[];
}

export async function planSync(client: SaveClient, accountId: string): Promise<SyncPlan | { error: string }> {
  const manifest = await client.manifest();
  if (manifest.kind === "signed-out") return { error: "not signed in" };
  if (manifest.kind === "error") return { error: manifest.message };

  const remote = new Map<SaveSection, ManifestEntry>();
  for (const entry of manifest.sections) remote.set(entry.section as SaveSection, entry);

  const link = readLink(accountId);
  const actions = new Map<SaveSection, SyncAction>();
  const conflicts: SaveSection[] = [];
  let needsChoice = false;

  for (const section of SAVE_SECTIONS) {
    const store = STORES[section];
    const action = decideSync({
      localChecksum: await checksumOf(store.get()),
      localIsDefault: canonicalJson(store.get()) === canonicalJson(store.defaults()),
      remote: remote.get(section) ?? null,
      link: link.sections[section] ?? null,
    });
    actions.set(section, action);
    if (action === "adopt") needsChoice = true;
    if (action === "conflict") conflicts.push(section);
  }

  return { actions, needsChoice, conflicts };
}

// ---------------------------------------------------------------------------
// Doing it
// ---------------------------------------------------------------------------

export interface SyncReport {
  pushed: SaveSection[];
  pulled: SaveSection[];
  /** Both sides had moved, and the two were combined rather than one chosen. */
  merged: SaveSection[];
  unchanged: SaveSection[];
  /** Sections that need the player to choose. Nothing was done to these. */
  awaitingChoice: SaveSection[];
  problems: string[];
}

const emptyReport = (): SyncReport => ({
  pushed: [],
  pulled: [],
  merged: [],
  unchanged: [],
  awaitingChoice: [],
  problems: [],
});

/**
 * One pass at a time, and never a dropped request.
 *
 * A second caller during a pass does not start a second pass — two of these
 * interleaved fight over the same five sections and the same link file — but it
 * is not thrown away either: the flag makes the running pass go round again
 * when it finishes, so a match finished mid-sync is uploaded seconds later
 * rather than waiting for the next debounce. Bounded, because a pass that keeps
 * provoking itself is a bug and looping on it would be a worse one.
 */
let inFlight: Promise<SyncReport> | null = null;
let queued = false;
const MAX_FOLLOW_UP_PASSES = 3;

export function syncNow(client = new SaveClient()): Promise<SyncReport> {
  if (inFlight) {
    queued = true;
    return inFlight;
  }

  const run = (async (): Promise<SyncReport> => {
    try {
      let report = await runSync(client);
      for (let pass = 0; queued && pass < MAX_FOLLOW_UP_PASSES; pass++) {
        queued = false;
        report = await runSync(client);
      }
      return report;
    } finally {
      inFlight = null;
      queued = false;
    }
  })();

  inFlight = run;
  return run;
}

/**
 * Run one sync pass.
 *
 * `adopt` is left alone and reported, because "this browser holds a save with
 * nothing to do with this account" is a question with a person in it. A
 * `conflict` is not that question: it is two saves that share an ancestor, and
 * it is resolved here.
 */
async function runSync(client: SaveClient): Promise<SyncReport> {
  const report = emptyReport();
  const account = currentAccount();
  if (!account) return report;

  const plan = await planSync(client, account.userId);
  if ("error" in plan) {
    report.problems.push(plan.error);
    return report;
  }

  for (const [section, action] of plan.actions) {
    if (action === "in-sync") {
      report.unchanged.push(section);
      continue;
    }
    if (action === "adopt") {
      report.awaitingChoice.push(section);
      continue;
    }
    if (action === "push") {
      const done = await pushSection(client, section, account.userId);
      if (done) report.pushed.push(section);
      else report.problems.push(`could not upload ${section}`);
      continue;
    }
    if (action === "conflict") {
      const outcome = await reconcileSection(client, section, account.userId);
      if (outcome === "merged") report.merged.push(section);
      else report.problems.push(`could not reconcile ${section}`);
      continue;
    }
    const pulled = await pullSection(client, section, account.userId);
    if (pulled === "pulled") report.pulled.push(section);
    // "pull" was chosen because the manifest said the section is there, so an
    // absent one means it vanished between the manifest and the download.
    else report.problems.push(`could not download ${section}`);
  }

  return report;
}

async function pushSection(client: SaveClient, section: SaveSection, accountId: string): Promise<boolean> {
  const store = STORES[section];
  const data = store.get();
  const expected = readLink(accountId).sections[section]?.revision ?? 0;

  const result = await client.push(section, store.version(), data, expected);
  /**
   * A refusal leaves the agreement exactly as it was, on purpose.
   *
   * Nothing was agreed, so recording anything would be a lie — and the
   * particular lie available here, writing down the revision the server said it
   * was at, would claim this device holds a payload it has never seen. The next
   * pass sees both sides moved and reconciles properly.
   */
  if (result.kind !== "ok") return false;

  agreeLink(accountId, section, { revision: result.entry.revision, checksum: result.entry.checksum });
  writeBase(accountId, section, data);
  return true;
}

/**
 * Three outcomes, not two.
 *
 * "The server holds nothing for this section" and "the download failed" both
 * mean no data arrived, and collapsing them is how `adopt` came to report
 * success for a choice it had not carried out: a failed pull was recorded as
 * "nothing to do" and the screen navigated away as though the player's save had
 * been restored. Absent is fine. Failed is not.
 */
type PullOutcome = "pulled" | "absent" | "failed";

async function pullSection(client: SaveClient, section: SaveSection, accountId: string): Promise<PullOutcome> {
  const result = await client.pull(section);
  if (result.kind === "absent") return "absent";
  if (result.kind !== "ok") return "failed";

  archiveLocal(section);
  STORES[section].replace(result.data as object);
  STORES[section].flush();
  agreeLink(accountId, section, { revision: result.entry.revision, checksum: result.entry.checksum });
  writeBase(accountId, section, result.data);
  return "pulled";
}

/**
 * Both sides moved. Combine them, keep them, and put the result back.
 *
 * The order is chosen so that every interruption leaves a state the next pass
 * can finish from:
 *
 * 1. download the account's copy — if this fails nothing has changed;
 * 2. merge it with this device's, against the ancestor;
 * 3. archive what is about to be replaced, then apply the merge locally;
 * 4. **agree with the revision that was merged in, before uploading.** A crash
 *    between here and the upload leaves a device that has absorbed the other
 *    one's work and still has its own to send — which the next pass reads as an
 *    ordinary `push`, not as a fresh conflict;
 * 5. upload. A `409` here means a third write landed in between, and is left
 *    for the next pass to merge again.
 *
 * The merge is a pure function of three payloads, so both devices compute the
 * same result from the same inputs and the pair converges rather than trading
 * revisions.
 */
async function reconcileSection(client: SaveClient, section: SaveSection, accountId: string): Promise<"merged" | "failed"> {
  /**
   * Reconciled against what arrives, never against the manifest that named it.
   *
   * The plan is a snapshot taken one round trip ago and the section may have
   * moved again since. Merging against the *downloaded* revision means the
   * ancestor, the payload and the `If-Match` all describe the same server
   * state, which is what makes a lost race merely a retry.
   */
  const pulled = await client.pull(section);
  if (pulled.kind !== "ok") return "failed";

  const store = STORES[section];
  const base = readBase(accountId, section);
  const merged = mergeThreeWay(
    base?.data,
    store.get(),
    pulled.data,
    MERGE_RULES[section],
    { hasBase: base !== null }
  ) as object;

  archiveLocal(section);
  store.replace(merged);
  store.flush();
  agreeLink(accountId, section, { revision: pulled.entry.revision, checksum: pulled.entry.checksum });
  writeBase(accountId, section, pulled.data);

  // Best effort. The merge is already safe on this device; getting it to the
  // other one is the next pass's problem if this attempt loses a race.
  await pushSection(client, section, accountId);
  return "merged";
}

/**
 * Keep the copy that is about to be replaced.
 *
 * One slot per section, overwritten each time, under `hypebound:` so the
 * privacy screen's export includes it and its delete clears it. A player who
 * pulls the wrong save can still get the old one out of the export, which is
 * the difference between a mistake and a loss.
 */
function archiveLocal(section: SaveSection): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      archiveKey(section),
      JSON.stringify({ archivedAt: new Date().toISOString(), data: STORES[section].get() })
    );
  } catch {
    // If storage is full the archive is skipped rather than the pull failing.
    // Refusing to sync because there is no room for a backup would strand the
    // player on a device that cannot be fixed by syncing.
  }
}

// ---------------------------------------------------------------------------
// Adoption — the one-time wholesale choice (§12.2)
// ---------------------------------------------------------------------------

export type Adoption = "local" | "cloud";

export interface CloudSummary {
  readonly section: SaveSection;
  readonly updatedAt: string;
  readonly bytes: number;
}

/** What the server holds, for the comparison the adoption screen shows. */
export async function cloudSummary(client = new SaveClient()): Promise<readonly CloudSummary[]> {
  const manifest = await client.manifest();
  if (manifest.kind !== "ok") return [];
  return manifest.sections.map((entry) => ({
    section: entry.section as SaveSection,
    updatedAt: entry.updatedAt,
    bytes: entry.bytes,
  }));
}

/**
 * Apply the player's choice to every section at once.
 *
 * Wholesale, per §12.2, and for a reason beyond the spec saying so: a
 * section-by-section choice invites a combination nobody wants, like this
 * device's collection with the other device's decks referring to cards it does
 * not contain.
 */
export async function adopt(choice: Adoption, client = new SaveClient()): Promise<SyncReport> {
  const report = emptyReport();
  const account = currentAccount();
  if (!account) return report;

  for (const section of SAVE_SECTIONS) {
    if (choice === "cloud") {
      const pulled = await pullSection(client, section, account.userId);
      if (pulled === "pulled") report.pulled.push(section);
      /**
       * Absent is a real answer here, unlike in `syncNow`. A player can
       * perfectly well have a cloud save with a profile and no Doomscroll run,
       * and refusing the whole adoption over a section nobody has written would
       * strand them. A *failure* is different and is reported, because the
       * screen navigates away on an empty problem list — and navigating away
       * from "use the account's save" without having used it is the worst
       * outcome this feature has.
       */
      else if (pulled === "absent") report.unchanged.push(section);
      else report.problems.push(`could not download ${section}`);
      continue;
    }

    /**
     * Local wins, so the upload must replace whatever is there — which means
     * pushing against the server's *current* revision rather than this device's
     * remembered one. This is the single place a deliberate overwrite happens,
     * and it happens because a person asked for it in as many words.
     */
    const manifest = await client.manifest();
    const current = manifest.kind === "ok" ? manifest.sections.find((entry) => entry.section === section) : undefined;
    agreeLink(
      account.userId,
      section,
      current ? { revision: current.revision, checksum: current.checksum } : undefined
    );

    const done = await pushSection(client, section, account.userId);
    if (done) report.pushed.push(section);
    else report.problems.push(`could not upload ${section}`);
  }

  return report;
}

// ---------------------------------------------------------------------------
// Automatic syncing
// ---------------------------------------------------------------------------

/**
 * How long a "the player came back" sync has to wait behind the last one.
 *
 * Alt-tabbing fires `visibilitychange` and `focus` together and does it as fast
 * as a person can flick between windows, so without a floor this would be a
 * manifest read per flick. Fifteen seconds is short enough that returning to a
 * device always syncs before the player can start a match, and long enough that
 * the ten seconds of window-shuffling before that costs one read.
 */
const RETURN_SYNC_MIN_MS = 15_000;

/**
 * A slow poll, and why there is one at all.
 *
 * The events cover a device that was put down and picked up. They do not cover
 * a tab that simply stays open and visible on a second monitor while the player
 * uses the other device — no visibility change, no focus, no local write, and
 * so, before this, no sync for as long as it stayed open. Measured: 45 seconds
 * idle, the server moving from revision 3 to 4, and not one request.
 *
 * Five minutes, only while the document is visible, and it costs a manifest
 * read — the cheap half of the API, and one that uploads nothing unless a
 * checksum actually differs. An always-open tab is roughly 288 reads a day
 * against a free allowance measured in millions, and a hidden one is zero.
 */
const IDLE_POLL_MS = 5 * 60_000;

let timer: ReturnType<typeof setTimeout> | null = null;
let returnTimer: ReturnType<typeof setTimeout> | null = null;
let poll: ReturnType<typeof setInterval> | null = null;
let unsubscribes: Array<() => void> = [];
let detachListeners: Array<() => void> = [];
let pendingUpload = false;
let lastReturnSync = 0;

/**
 * Keep the two devices together, without spending the write allowance.
 *
 * The debounce is thirty seconds rather than the store layer's 250 ms because
 * the free plan allows 100,000 row writes a day across every player of the
 * game, and `syncNow` uploads nothing unless the checksum actually differs — so
 * an idle game writes nothing at all, however long it idles.
 *
 * What is new here is that a store write is no longer the *only* thing that
 * starts a sync, which was the whole reason a returning device did not pull. A
 * sync now also happens when the player comes back and when they leave:
 *
 * - **coming back** (`visibilitychange` to visible, window `focus`, `online`,
 *   and the slow poll) runs a full pass, rate-limited, so the first thing a
 *   device does on being picked up is find out what the other one did;
 * - **going away** (`visibilitychange` to hidden, `pagehide`) does not wait out
 *   the remaining debounce. Thirty seconds is long enough to finish a match and
 *   lock the phone inside, and that window is precisely how two devices come to
 *   diverge. `visibilitychange` is used rather than `pagehide` alone because it
 *   is the one that still fires with the page alive enough to make the request.
 */
export function startAutoSync(client = new SaveClient()): () => void {
  stopAutoSync();

  const schedule = (): void => {
    pendingUpload = true;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      pendingUpload = false;
      void syncNow(client);
    }, SYNC_DEBOUNCE_MS);
  };

  /**
   * Sync at once, and keep the pending flag until something actually lands.
   *
   * The flag is cleared by success, not by the attempt. A push that goes out as
   * the page is being backgrounded is the one most likely to fail — the radio
   * is off, the tunnel, the aeroplane — and clearing "there is work to send" on
   * the attempt would mean the work quietly stopped being tracked. On a failure
   * the ordinary debounce takes over as a retry, which costs nothing while
   * offline because the request never leaves the machine.
   */
  const runNow = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    void syncNow(client).then((report) => {
      if (report.problems.length === 0) pendingUpload = false;
      else if (pendingUpload) schedule();
    });
  };

  const onLeaving = (): void => {
    if (pendingUpload) runNow();
  };

  /**
   * The rate limit defers a return; it never drops one.
   *
   * Two corrections, both of which had teeth, and the second of which was
   * caught by the verification script failing in exactly the shape of the
   * original bug.
   *
   * It counts *returns* rather than syncs, because charging a background-push
   * against it would leave a device that pushed on the way out unable to pull
   * on the way back in.
   *
   * And a rate-limited return is queued for when the limit expires, rather than
   * thrown away. Discarding it looks harmless — another event will come along —
   * but "another event" may be the player putting the device down again, and
   * then nothing happens until the five-minute poll. Measured before this
   * correction: a device came back to the foreground, was thirteen seconds
   * inside the limit, and sat for a further thirty seconds holding a save it
   * knew was stale. A limit is supposed to smooth a burst, not lose it.
   */
  const onReturning = (): void => {
    const waitFor = RETURN_SYNC_MIN_MS - (Date.now() - lastReturnSync);
    if (waitFor <= 0) {
      lastReturnSync = Date.now();
      runNow();
      return;
    }
    if (returnTimer !== null) return;
    returnTimer = setTimeout(() => {
      returnTimer = null;
      lastReturnSync = Date.now();
      runNow();
    }, waitFor);
  };

  /**
   * Coming back onto the network is not alt-tabbing, and is not rate-limited.
   *
   * It happens rarely, it is the single moment at which a device that has been
   * playing offline has something to say and something to hear, and making it
   * wait behind a limit designed for window-shuffling is how an offline
   * afternoon stays stranded.
   */
  const onOnline = (): void => runNow();

  unsubscribes = SAVE_SECTIONS.map((section) => STORES[section].subscribe(schedule));

  if (typeof document !== "undefined") {
    const onVisibility = (): void => {
      if (document.visibilityState === "hidden") onLeaving();
      else onReturning();
    };
    document.addEventListener("visibilitychange", onVisibility);
    detachListeners.push(() => document.removeEventListener("visibilitychange", onVisibility));
  }

  if (typeof window !== "undefined") {
    window.addEventListener("focus", onReturning);
    window.addEventListener("online", onOnline);
    window.addEventListener("pagehide", onLeaving);
    detachListeners.push(() => window.removeEventListener("focus", onReturning));
    detachListeners.push(() => window.removeEventListener("online", onOnline));
    detachListeners.push(() => window.removeEventListener("pagehide", onLeaving));
  }

  poll = setInterval(() => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    onReturning();
  }, IDLE_POLL_MS);

  return stopAutoSync;
}

export function stopAutoSync(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  if (returnTimer !== null) clearTimeout(returnTimer);
  returnTimer = null;
  if (poll !== null) clearInterval(poll);
  poll = null;
  pendingUpload = false;
  for (const off of unsubscribes) off();
  unsubscribes = [];
  for (const detach of detachListeners) detach();
  detachListeners = [];
}
