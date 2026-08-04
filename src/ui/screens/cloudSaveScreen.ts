/**
 * Two saves, one account, and a choice that has to be made by a person.
 *
 * Reached only when both this device and the account hold real, different
 * saves — see `decideSync`. Every case that can be resolved without asking is
 * resolved without asking, so arriving here means the answer genuinely is not
 * derivable: somebody played on two devices, and no rule about revisions knows
 * which afternoon they would rather keep.
 *
 * ## It shows contents, not device names
 *
 * Multiplayer §12.1 carries a `deviceName` so this screen can say "Chrome on
 * Windows". It does not, for two reasons. The privacy page says what the
 * browser reports about itself is read into memory and never sent, and a device
 * name is precisely that being sent. And it is the wrong thing to show anyway —
 * a person choosing between two saves wants to know what is *in* them. So the
 * cloud copy is downloaded and summarised, and the comparison is level, clout,
 * cards, decks and matches on both sides.
 *
 * ## The asymmetry is deliberate and stated
 *
 * Choosing the cloud save archives this device's copy first, so it survives in
 * the export. Choosing this device's save overwrites the account's copy, and
 * there is no archive on the server — so that direction, and only that one,
 * asks twice.
 */

import type { Screen } from "../shell";
import { audio } from "../../audio/audio";
import { LOCALE } from "../format";
import { count, enter, icon } from "./data/kit";
import { adopt, type Adoption } from "../../save/cloudSaves";
import { SaveClient } from "../../net/saveClient";
import { profileStore } from "../../save/profile";

export interface CloudSaveCallbacks {
  /** Fired once a choice has been applied. */
  onResolved: () => void;
  onBack: () => void;
}

interface Summary {
  level: number;
  clout: number;
  cards: number;
  decks: number;
  matches: number;
  updated: string;
}

const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Summarise a profile payload, defensively.
 *
 * The cloud copy may have been written by a different version of the game, so
 * every field is read as if it might be missing. A summary that throws would
 * take away the only screen that can resolve the situation.
 */
function summarise(profile: unknown, updated: string): Summary {
  const p = (profile ?? {}) as Record<string, unknown>;
  const collection = (p.collection ?? {}) as Record<string, number>;
  const stats = (p.stats ?? {}) as Record<string, number>;
  return {
    level: Number(p.accountLevel ?? 0),
    clout: Number(p.clout ?? 0),
    cards: Object.values(collection).reduce((sum, n) => sum + (Number(n) || 0), 0),
    decks: Array.isArray(p.decks) ? p.decks.length : 0,
    matches: Number(stats.matchesPlayed ?? 0),
    updated,
  };
}

/**
 * en-GB, not the browser.
 *
 * `undefined` here printed "il y a 3 heures" inside an English sentence on any
 * machine not set to English. The game has no i18n layer, so the locale is a
 * constant like every other date in the build — `format.ts` owns the value.
 */
const RELATIVE = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });

/** "3 hours ago", from an ISO string. */
function ago(iso: string, nowMs = Date.now()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "unknown";
  const seconds = Math.round((then - nowMs) / 1000);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return RELATIVE.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

/**
 * One side of the comparison.
 *
 * The absent side used to be the sentence "Nothing to compare — this side has no
 * save." dropped into a 1,100×190px plate, which is the blank grid §5 names. It
 * is the same size and the same shape as the side that *does* have a save, so
 * the two read as a pair; the difference between them is a designed empty rather
 * than a missing table. The numbers all go through `format.ts` — `toLocaleString`
 * with no locale is the same uncontrolled formatting the dates had, and 5000
 * comes out as "5 000" here and "5,000" three screens away depending on the OS.
 */
function card(title: string, note: string, summary: Summary | null): string {
  if (!summary) {
    return `
      <section class="panel panel-chrome cloud-save-card">
        <h2 class="t-heading">${esc(title)}</h2>
        <p class="muted">${esc(note)}</p>
        <div class="empty cloud-save-none">
          ${icon("info", 34)}
          <h3 class="t-heading">Nothing on this side</h3>
          <p class="t-body">There is no save here to compare against, so there is nothing to lose by keeping the other one.</p>
        </div>
      </section>`;
  }
  return `
    <section class="panel panel-chrome cloud-save-card">
      <h2 class="t-heading">${esc(title)}</h2>
      <p class="muted">${esc(note)}</p>
      <table class="d-table patch-table cloud-save-table">
        <tbody>
          <tr><td>Level</td><td class="patch-after num">${count(summary.level)}</td></tr>
          <tr><td>Clout</td><td class="patch-after num">${count(summary.clout)}</td></tr>
          <tr><td>Cards</td><td class="patch-after num">${count(summary.cards)}</td></tr>
          <tr><td>Decks</td><td class="patch-after num">${count(summary.decks)}</td></tr>
          <tr><td>Matches</td><td class="patch-after num">${count(summary.matches)}</td></tr>
          <tr><td>Last change</td><td class="muted">${esc(summary.updated)}</td></tr>
        </tbody>
      </table>
    </section>`;
}

export function createCloudSaveScreen(callbacks: CloudSaveCallbacks, client = new SaveClient()): Screen {
  const root = document.createElement("div");
  root.className = "screen cloud-save-screen";
  let busy = false;

  const render = (cloud: Summary | null, loading: boolean): void => {
    const local = summarise(profileStore.get(), "on this device");

    root.innerHTML = `
      <div class="ambient-bg"></div>
      <header class="screen-header">
        <button class="btn btn-ghost" id="cloud-back">${icon("arrow-left", 16)} Back</button>
        <h1 class="title">Two saves</h1>
      </header>

      <main class="cloud-save-body data-body data-doc">
        <section class="panel panel-chrome cloud-save-lead">
          <p>
            This device has a save, and so does your account. They are not the same, and
            nothing here can safely guess which one you meant to keep — so pick one.
          </p>
          <p class="muted">
            Whichever you choose becomes the save on every device you sign in on. This is
            asked once.
          </p>
        </section>

        <div class="cloud-save-compare">
          ${card("On this device", "What is in this browser right now.", local)}
          ${
            loading
              ? /*
                 * A skeleton, not the word "Fetching".
                 *
                 * §A4 lists loading as one of the six states and rules out a
                 * spinner; `.skeleton` is module A's shimmer and it has the shape
                 * of the table that is about to arrive, so the plate does not
                 * change size when the fetch lands.
                 */
                `<section class="panel panel-chrome cloud-save-card">
                   <h2 class="t-heading">In your account</h2>
                   <p class="muted">Reading what the server is holding.</p>
                   <div class="cloud-save-skeleton" aria-hidden="true">
                     ${'<span class="skeleton"></span>'.repeat(6)}
                   </div>
                 </section>`
              : card("In your account", "What the server is holding.", cloud)
          }
        </div>

        <section class="panel panel-chrome cloud-save-actions">
          <div class="mail-actions">
            <button class="btn btn-primary" id="cloud-keep-local" ${loading ? "disabled" : ""}>
              Keep this device's save
            </button>
            <button class="btn btn-primary" id="cloud-keep-cloud" ${loading || !cloud ? "disabled" : ""}>
              Use the account's save
            </button>
          </div>
          <p class="muted">
            <strong>Keeping this device's save</strong> replaces the copy in your account.
            There is no archive on the server, so that copy is gone — which is why this one
            asks twice.
          </p>
          <p class="muted">
            <strong>Using the account's save</strong> replaces what is in this browser. The
            copy being replaced is kept here first and is included in the export on the
            privacy page, so it is recoverable.
          </p>
          <p class="signin-status" id="cloud-status" role="status" aria-live="polite" hidden></p>
        </section>
      </main>`;

    enter(root, ".panel", 40);

    root.querySelector("#cloud-back")?.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      callbacks.onBack();
    });
    root.querySelector("#cloud-keep-local")?.addEventListener("click", () => void choose("local"));
    root.querySelector("#cloud-keep-cloud")?.addEventListener("click", () => void choose("cloud"));
  };

  const say = (message: string): void => {
    const status = root.querySelector<HTMLElement>("#cloud-status");
    if (!status) return;
    status.textContent = message;
    status.hidden = message.length === 0;
  };

  const choose = async (which: Adoption): Promise<void> => {
    if (busy) return;

    /**
     * The confirmation is on one branch only, because only one branch destroys
     * something that cannot be got back. Putting it on both would make it a
     * ritual, and a ritual is a thing people click through.
     */
    if (which === "local") {
      const sure = window.confirm(
        "This replaces the save in your account with the one on this device.\n\n" +
          "The account's copy is not archived anywhere and cannot be recovered. Continue?"
      );
      if (!sure) return;
    }

    busy = true;
    say(which === "cloud" ? "Downloading your account's save…" : "Uploading this device's save…");
    audio.play("sfx.ui.confirm");

    const report = await adopt(which, client);
    busy = false;

    if (report.problems.length > 0) {
      say(`Not finished: ${report.problems.join("; ")}. Nothing else was changed.`);
      return;
    }
    callbacks.onResolved();
  };

  render(null, true);

  void (async () => {
    const result = await client.pull("profile");
    if (result.kind === "ok") {
      render(summarise(result.data, ago(result.entry.updatedAt)), false);
    } else {
      // Absent, corrupt or unreachable all land here. The screen still works —
      // "keep this device's save" is a valid answer to "we could not read the
      // other one", and it is the only safe one.
      render(null, false);
      say(
        result.kind === "corrupt"
          ? "The account's save did not survive the download intact, so it is not offered."
          : result.kind === "absent"
            ? "Your account has no profile saved."
            : "Could not read your account's save."
      );
    }
  })();

  /** Automation hook, the same shape the other screens expose. */
  (window as unknown as { hypeboundCloudSave?: unknown }).hypeboundCloudSave = {
    choose: (which: Adoption) => choose(which),
    status: () => root.querySelector("#cloud-status")?.textContent ?? "",
  };

  return {
    root,
    dispose: () => {
      delete (window as unknown as { hypeboundCloudSave?: unknown }).hypeboundCloudSave;
    },
  };
}
