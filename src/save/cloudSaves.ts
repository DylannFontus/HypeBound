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
 * **Nothing overwrites a local save without first archiving it.** Every pull,
 * whether routine or the result of a player choosing CLOUD, writes the outgoing
 * local copy to an archive key first. It is one slot per section, it lives
 * under `hypebound:` so the export button includes it and the delete button
 * clears it, and it costs one extra copy of a save that is a few kilobytes.
 * Cheap insurance against the only bug in this feature that a player could not
 * forgive.
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
  type LinkState,
  type ManifestEntry,
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

/** Forget every agreement. Called on sign-out so the next account starts clean. */
export function forgetCloudLink(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(LINK_KEY);
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
  unchanged: SaveSection[];
  /** Sections that need the player to choose. Nothing was done to these. */
  awaitingChoice: SaveSection[];
  problems: string[];
}

const emptyReport = (): SyncReport => ({
  pushed: [],
  pulled: [],
  unchanged: [],
  awaitingChoice: [],
  problems: [],
});

/**
 * Run one sync pass.
 *
 * Sections needing a choice are **left alone** and reported. This function
 * never resolves an ambiguity; that is the adoption screen's job, and it is a
 * job with a person in it.
 */
export async function syncNow(client = new SaveClient()): Promise<SyncReport> {
  const report = emptyReport();
  const account = currentAccount();
  if (!account) return report;

  const plan = await planSync(client, account.userId);
  if ("error" in plan) {
    report.problems.push(plan.error);
    return report;
  }

  const link = readLink(account.userId);

  for (const [section, action] of plan.actions) {
    if (action === "in-sync") {
      report.unchanged.push(section);
      continue;
    }
    if (action === "adopt" || action === "conflict") {
      report.awaitingChoice.push(section);
      continue;
    }
    if (action === "push") {
      const done = await pushSection(client, section, link);
      if (done) report.pushed.push(section);
      else report.problems.push(`could not upload ${section}`);
      continue;
    }
    const pulled = await pullSection(client, section, link);
    if (pulled === "pulled") report.pulled.push(section);
    // "pull" was chosen because the manifest said the section is there, so an
    // absent one means it vanished between the manifest and the download.
    else report.problems.push(`could not download ${section}`);
  }

  writeLink(link);
  return report;
}

async function pushSection(client: SaveClient, section: SaveSection, link: LinkFile): Promise<boolean> {
  const store = STORES[section];
  const data = store.get();
  const expected = link.sections[section]?.revision ?? 0;

  const result = await client.push(section, store.version(), data, expected);
  if (result.kind !== "ok") return false;

  link.sections[section] = { revision: result.entry.revision, checksum: result.entry.checksum };
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

async function pullSection(client: SaveClient, section: SaveSection, link: LinkFile): Promise<PullOutcome> {
  const result = await client.pull(section);
  if (result.kind === "absent") return "absent";
  if (result.kind !== "ok") return "failed";

  archiveLocal(section);
  STORES[section].replace(result.data as object);
  STORES[section].flush();
  link.sections[section] = { revision: result.entry.revision, checksum: result.entry.checksum };
  return "pulled";
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

  const link = readLink(account.userId);

  for (const section of SAVE_SECTIONS) {
    if (choice === "cloud") {
      const pulled = await pullSection(client, section, link);
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
    link.sections[section] = current ? { revision: current.revision, checksum: current.checksum } : undefined;

    const done = await pushSection(client, section, link);
    if (done) report.pushed.push(section);
    else report.problems.push(`could not upload ${section}`);
  }

  writeLink(link);
  return report;
}

// ---------------------------------------------------------------------------
// Automatic pushing
// ---------------------------------------------------------------------------

let timer: ReturnType<typeof setTimeout> | null = null;
let unsubscribes: Array<() => void> = [];

/**
 * Upload changes as they happen, slowly and only when they are real.
 *
 * Two gates, and both matter for the same reason. The free plan allows 100,000
 * row writes a day across every player of the game, so a sync that fired on
 * every store mutation would spend that allowance on a player rearranging a
 * deck. The debounce is 30 seconds rather than the store layer's 250 ms, and
 * `syncNow` uploads nothing unless the checksum actually differs — so an idle
 * game writes nothing at all, however long it idles.
 */
export function startAutoSync(client = new SaveClient()): () => void {
  stopAutoSync();

  const schedule = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void syncNow(client);
    }, SYNC_DEBOUNCE_MS);
  };

  unsubscribes = SAVE_SECTIONS.map((section) => STORES[section].subscribe(schedule));
  return stopAutoSync;
}

export function stopAutoSync(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  for (const off of unsubscribes) off();
  unsubscribes = [];
}
