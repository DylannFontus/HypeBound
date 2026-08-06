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
import { ago as relativeTime, count, enter, icon } from "./data/kit";
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
 * "3 hours ago", from an ISO string — `format.ts`'s, not a second copy.
 *
 * This file used to build its own `Intl.RelativeTimeFormat` and walk its own
 * three-rung unit ladder. It was already pinned to `LOCALE`, so the locale bug
 * was fixed; what remained was a *duplicate formatter*, and it was a shorter one
 * — day, hour, minute and nothing above — so a save last touched a fortnight ago
 * read "14 days ago" here and "2 weeks ago" everywhere else in the game. Module
 * D owns this. The kit re-exports it as `ago` and the only thing left local is
 * turning an unparseable string into "unknown" rather than an em-dash, because
 * on this screen the word has to be readable inside a sentence.
 */
function ago(iso: string, nowMs = Date.now()): string {
  return Number.isFinite(Date.parse(iso)) ? relativeTime(Date.parse(iso), nowMs) : "unknown";
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
      <section class="mat-panel cloud-save-card d-enter">
        <h2 class="t-heading">${esc(title)}</h2>
        <p class="t-body">${esc(note)}</p>
        <div class="empty cloud-save-none">
          ${icon("info", 34)}
          <h3 class="t-heading">Nothing on this side</h3>
          <p class="t-body">There is no save here to compare against, so there is nothing to lose by keeping the other one.</p>
        </div>
      </section>`;
  }
  return `
    <section class="mat-panel cloud-save-card d-enter">
      <h2 class="t-heading">${esc(title)}</h2>
      <p class="t-body">${esc(note)}</p>
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
        <section class="mat-panel cloud-save-lead d-enter">
          <div class="settings-head">
            <span class="settings-mark" aria-hidden="true">${icon("profile", 20)}</span>
            <h2 class="t-heading">Pick the one you meant to keep</h2>
          </div>
          <p class="t-body">
            This device has a save, and so does your account. They are not the same, and
            nothing here can safely guess which one you meant to keep — so pick one.
          </p>
          <p class="t-body">
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
                `<section class="mat-panel cloud-save-card d-enter">
                   <h2 class="t-heading">In your account</h2>
                   <p class="t-body">Reading what the server is holding.</p>
                   <div class="cloud-save-skeleton" aria-hidden="true">
                     ${'<span class="skeleton"></span>'.repeat(6)}
                   </div>
                 </section>`
              : card("In your account", "What the server is holding.", cloud)
          }
        </div>

        <section class="mat-panel cloud-save-actions d-enter">
          <!--
            Both of these can be disabled, so both of them are on the
            foundation's material rather than on .btn.

            .btn:disabled in base.css is opacity 0.42 and nothing else, which is
            a straight A4 violation on all three counts — it changes neither the
            fill nor the border nor the icon — and measured on "Use the
            account's save" (white ink, the whole element at 0.42, the hero
            gradient showing through underneath) the label came out at about
            4.0:1, under the floor. The .act disabled branch is the compliant
            one: it re-fills the plate on the panel's violet axis, re-tunes the
            rim and the lip, drops to the panel grain, re-points the ink to
            --text-dim and drains the icon on its own. 7.05:1 on that plate.

            Only one of the two is a hero, because only one of them is the safe
            answer here; the other is the destructive one and reads as such.
            That is also §6's one-hero rule, which two identical primary pills
            side by side were breaking.
          -->
          <div class="mail-actions">
            <button class="mat-hero act r-chip cloud-save-btn" id="cloud-keep-cloud" ${
              loading || !cloud ? "disabled" : ""
            }>
              Use the account's save
            </button>
            <button class="mat-panel act r-chip cloud-save-btn" id="cloud-keep-local" ${loading ? "disabled" : ""}>
              Keep this device's save
            </button>
          </div>
          <p class="t-body">
            <strong>Keeping this device's save</strong> replaces the copy in your account.
            There is no archive on the server, so that copy is gone — which is why this one
            asks twice.
          </p>
          <p class="t-body">
            <strong>Using the account's save</strong> replaces what is in this browser. The
            copy being replaced is kept here first and is included in the export on the
            privacy page, so it is recoverable.
          </p>
          <p class="signin-status" id="cloud-status" role="status" aria-live="polite" hidden></p>
        </section>
      </main>`;

    /*
     * `.d-enter`, not `.mat-panel`.
     *
     * `enter()` writes `--enter-delay` onto whatever it is handed, and `d-rise`
     * — the keyframe that consumes it — is attached to `.d-enter` and nothing
     * else. Staggering the materials therefore wrote four delays onto four
     * elements with no animation on them, so this route had no entrance at all
     * while looking, in the source, exactly like the ten that do. Measured with
     * `--enter-delay` read back off the DOM: 0 risers on arrival.
     */
    enter(root, ".d-enter", 40);

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
