/**
 * The Inbox — `03-screens-and-navigation.md` §4.5.3.
 *
 * The inbox is a screen that can lie in a way no other screen can, because
 * nobody re-reads mail. A message asserting a season ended on a date it did not,
 * or offering a reward that was quietly paid three weeks ago, would sit there
 * being wrong indefinitely and never be checked against anything.
 *
 * So the design here is that **mail is derived, never stored**, and these tests
 * are mostly about what that buys:
 *
 * - every message traces back to a fact in the data or the save, and a fact that
 *   has not happened yet produces nothing;
 * - the same fact always produces the same message id, so read/claimed/deleted
 *   stay attached to the right thing across reloads;
 * - §4.5.3's thirty-day retention and §6 policy **F6** ("no lose-it-if-you-miss-it
 *   grants") are both honoured, which is only possible if expiry removes the
 *   *message* and never the *grant*;
 * - nothing is claimed for you (§4.2.4), and nothing that owes you something can
 *   be deleted by accident.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { getContent } from "../src/engine/content";
import {
  bannerData,
  runEnd,
  runStart,
} from "../src/game/economy/banner";
import { hypeWaveData, seasonEnd, seasonStart } from "../src/game/progression/hypeWave";
import { checkInConfig } from "../src/game/progression/data";
import { checkInCosmeticForMonth, cosmeticById } from "../src/game/cosmetics";
import {
  buildMail,
  bannerEndedId,
  bannerOpenedId,
  checkInboxData,
  checkInId,
  DEFERRED_SENDERS,
  RETENTION_DAYS,
  seasonEndedId,
  seasonOpenedId,
  WELCOME_ID,
  welcomeBackId,
  type MailInput,
} from "../src/game/inbox";
import {
  claimMail,
  deleteMail,
  deleteReadMail,
  getProfile,
  inboxViews,
  markAllMailRead,
  markMailRead,
  monthKey,
  profileStore,
  PROFILE_VERSION,
  syncHypeWave,
  unreadMail,
} from "../src/save/profile";

const content = getContent();
const DAY = 86_400_000;
const wave = hypeWaveData();
const S1 = wave.seasons[0]!;
const S2 = wave.seasons[1]!;
const BANNER = bannerData().banners[0]!;

const input = (over: Partial<MailInput> = {}): MailInput => ({
  createdAt: 0,
  welcomeBackAt: 0,
  archivedSeasonIds: [],
  claimed: [],
  eventConversions: [],
  ...over,
});

const idsAt = (now: number, over: Partial<MailInput> = {}): string[] =>
  buildMail(content, input(over), now).map((message) => message.id);

/** The same facts `inboxViews` derives from, for asserting against the ledgers. */
const mailInputOf = (profile: ReturnType<typeof getProfile>): MailInput => ({
  createdAt: profile.createdAt,
  welcomeBackAt: profile.hypeWave.welcomeBackAt,
  archivedSeasonIds: profile.hypeWave.archives.map((archive) => archive.seasonId),
  claimed: profile.inbox.claimed,
  eventConversions: Object.values(profile.events?.state ?? {}).flatMap((state) =>
    (state.conversions ?? []).map((entry) => ({ eventId: state.eventId, ...entry }))
  ),
});

// ---------------------------------------------------------------------------

describe("the mail the shipped data produces", () => {
  it("says nothing that is not true of it", () => {
    const problems = checkInboxData(content);
    expect(problems, problems.length === 0 ? "" : `\nthe inbox:\n  ${problems.join("\n  ")}\n`).toEqual([]);
  });

  it("names every deferred sender with the reason it is silent", () => {
    expect(DEFERRED_SENDERS.size).toBeGreaterThan(0);
    for (const [sender, reason] of DEFERRED_SENDERS) {
      expect(sender.trim().length, sender).toBeGreaterThan(0);
      expect(reason.trim().length, sender).toBeGreaterThan(10);
    }
  });

  /**
   * The staleness guard on the one sender §4.5.3 names that cannot exist here.
   * A version-migration grant needs a migration, and there has only ever been
   * one version of the profile store. The day that stops being true this fails
   * and says what to go and build.
   */
  it("still has nothing to compensate for", () => {
    expect(
      PROFILE_VERSION,
      "the profile store's schema moved — §4.5.3's version-migration mail now has something to say, " +
        "so build that sender and take it out of DEFERRED_SENDERS"
    ).toBe(1);
    expect([...DEFERRED_SENDERS.keys()]).toContain("Version-migration grants");
  });
});

describe("mail is derived from facts, not written", () => {
  it("does not announce a season before it starts", () => {
    expect(idsAt(seasonStart(S1) - DAY)).not.toContain(seasonOpenedId(S1.id));
    expect(idsAt(seasonStart(S1))).toContain(seasonOpenedId(S1.id));
  });

  it("does not announce a banner run before it opens", () => {
    const run = BANNER.runs[0]!;
    expect(idsAt(runStart(run) - DAY)).not.toContain(bannerOpenedId(BANNER.id, 0));
    expect(idsAt(runStart(run))).toContain(bannerOpenedId(BANNER.id, 0));
    expect(idsAt(runStart(run))).not.toContain(bannerEndedId(BANNER.id, 0));
    expect(idsAt(runEnd(run))).toContain(bannerEndedId(BANNER.id, 0));
  });

  /**
   * The end-of-season message exists to say what happened to *your* pass, so it
   * is generated only when there is an Archive Pass for it. Every one of them is
   * therefore true by construction rather than by careful hedging.
   */
  it("only reports a season ending when there is an archive to report", () => {
    expect(idsAt(seasonEnd(S1))).not.toContain(seasonEndedId(S1.id));
    expect(idsAt(seasonEnd(S1), { archivedSeasonIds: [S1.id] })).toContain(seasonEndedId(S1.id));
  });

  it("gives the same fact the same id every time", () => {
    const first = idsAt(seasonStart(S2) + DAY, { archivedSeasonIds: [S1.id] });
    const second = idsAt(seasonStart(S2) + DAY, { archivedSeasonIds: [S1.id] });
    expect(first).toEqual(second);
    expect(new Set(first).size).toBe(first.length);
  });

  it("posts the current month's check-in, and names the card back it ends on", () => {
    const now = seasonStart(S1) + DAY;
    const messages = buildMail(content, input(), now);
    const checkIn = messages.find((message) => message.id === checkInId(monthKey(now)));
    expect(checkIn).toBeDefined();
    const back = cosmeticById(content, checkInCosmeticForMonth(new Date(now).getMonth()));
    const text = checkIn!.body.join(" ");
    expect(text).toContain(back!.name);
    expect(text).toContain(String(checkInConfig().steps.length));
    // §11's defining absence, said out loud
    expect(text.toLowerCase()).toContain("streak");
  });

  it("names the published rerun date when a run ends", () => {
    const runs = [...BANNER.runs].sort((a, b) => runStart(a) - runStart(b));
    const ended = buildMail(content, input(), runEnd(runs[0]!)).find(
      (message) => message.id === bannerEndedId(BANNER.id, 0)
    );
    expect(ended).toBeDefined();
    const year = String(new Date(runStart(runs[1]!)).getFullYear());
    expect(ended!.body.join(" ")).toContain(year);
  });

  it("sorts newest first", () => {
    const messages = buildMail(content, input({ archivedSeasonIds: [S1.id] }), seasonStart(S2) + DAY);
    for (let i = 1; i < messages.length; i++) {
      expect(messages[i - 1]!.sentAt).toBeGreaterThanOrEqual(messages[i]!.sentAt);
    }
  });
});

describe("retention, and the one thing that outlives it", () => {
  const OPEN = runStart(BANNER.runs[0]!);

  it("clears a message after the stated window", () => {
    expect(idsAt(OPEN + (RETENTION_DAYS - 1) * DAY)).toContain(bannerOpenedId(BANNER.id, 0));
    expect(idsAt(OPEN + (RETENTION_DAYS + 1) * DAY)).not.toContain(bannerOpenedId(BANNER.id, 0));
  });

  /**
   * F6: no grant may be lost by not acting. §4.5.3 wants mail gone after 30
   * days. Both are binding, so expiry removes the message and never the grant —
   * a message holding something unclaimed simply does not expire.
   */
  it("keeps a message holding an unclaimed attachment, however long it takes", () => {
    const posted = OPEN;
    const late = posted + 400 * DAY;
    const id = welcomeBackId(posted);

    const held = buildMail(content, input({ welcomeBackAt: posted }), late).find((message) => message.id === id);
    expect(held, "an unclaimed attachment expired — F6 forbids exactly this").toBeDefined();
    expect(held!.expiresAt, "a held message must say it has no expiry").toBeNull();
    expect(held!.attachment?.[0]).toEqual({ kind: "clout", amount: wave.welcomeBack.clout });

    // once taken, it is ordinary mail again and clears like everything else
    expect(idsAt(late, { welcomeBackAt: posted, claimed: [id] })).not.toContain(id);
  });

  it("dates a message's expiry from when it was sent", () => {
    const messages = buildMail(content, input(), OPEN + DAY);
    const opened = messages.find((message) => message.id === bannerOpenedId(BANNER.id, 0))!;
    expect(opened.expiresAt).toBe(opened.sentAt + RETENTION_DAYS * DAY);
  });
});

describe("the inbox on a real profile", () => {
  const NOW = seasonStart(S1) + 2 * DAY;

  /**
   * `defaults()` stamps `createdAt` from the wall clock, and these tests run on
   * a clock they control that sits in the past. Without backdating the account,
   * its welcome message would be dated in the future and correctly refuse to be
   * generated — which is the derivation working, not a bug to route around.
   */
  beforeEach(() => {
    profileStore.reset();
    profileStore.update((draft) => {
      draft.createdAt = NOW - DAY;
    });
  });

  it("starts with the welcome message, unread", () => {
    const views = inboxViews(content, NOW);
    expect(views.some((view) => view.message.id === WELCOME_ID)).toBe(true);
    expect(views.every((view) => !view.read)).toBe(true);
    expect(unreadMail(content, NOW)).toBe(views.length);
  });

  it("marks read once, and counts down the badge", () => {
    const before = unreadMail(content, NOW);
    expect(markMailRead(content, WELCOME_ID, NOW)).toBe(true);
    expect(markMailRead(content, WELCOME_ID, NOW)).toBe(false);
    expect(unreadMail(content, NOW)).toBe(before - 1);
  });

  it("marks everything read in one go", () => {
    const before = unreadMail(content, NOW);
    expect(markAllMailRead(content, NOW)).toBe(before);
    expect(unreadMail(content, NOW)).toBe(0);
    expect(markAllMailRead(content, NOW)).toBe(0);
  });

  it("deletes a message and keeps it deleted", () => {
    expect(deleteMail(content, WELCOME_ID, NOW)).toBe(true);
    expect(inboxViews(content, NOW).some((view) => view.message.id === WELCOME_ID)).toBe(false);
    // and again, on a fresh read of the same store
    expect(inboxViews(content, NOW).some((view) => view.message.id === WELCOME_ID)).toBe(false);
    expect(deleteMail(content, WELCOME_ID, NOW)).toBe(false);
  });

  it("clears read mail and leaves unread mail alone", () => {
    markMailRead(content, WELCOME_ID, NOW);
    const unreadBefore = unreadMail(content, NOW);
    expect(deleteReadMail(content, NOW)).toBe(1);
    expect(unreadMail(content, NOW)).toBe(unreadBefore);
    expect(inboxViews(content, NOW).some((view) => view.message.id === WELCOME_ID)).toBe(false);
  });

  /**
   * `read` and `deleted` are pruned to the ids mail still generates, so they are
   * bounded by the number of live messages rather than by an arbitrary limit —
   * and pruning is done against the *undeleted* set, or a deletion would be
   * forgotten the instant it took effect and the message would come back.
   */
  it("keeps its ledgers bounded without resurrecting anything", () => {
    markAllMailRead(content, NOW);
    deleteMail(content, WELCOME_ID, NOW);
    expect(getProfile().inbox.read.length).toBeGreaterThan(0);

    // walk more than a year forward: everything above has aged out
    const later = NOW + 400 * DAY;
    markAllMailRead(content, later);

    const profile = getProfile();
    const generated = new Set(buildMail(content, mailInputOf(profile), later).map((message) => message.id));
    for (const id of profile.inbox.read) expect(generated, `${id} is remembered but no longer generated`).toContain(id);
    for (const id of profile.inbox.deleted) expect(generated, `${id} is remembered but no longer generated`).toContain(id);
    expect(profile.inbox.deleted).not.toContain(WELCOME_ID);
    expect(inboxViews(content, later).some((view) => view.message.id === WELCOME_ID)).toBe(false);
  });
});

describe("the Welcome Back attachment — §10.5.4", () => {
  const NOW = seasonStart(S1) + 20 * DAY;

  beforeEach(() => {
    profileStore.reset();
    profileStore.update((draft) => {
      draft.createdAt = NOW - 30 * DAY;
    });
  });

  /** Post it the way the game does: sync, come back after the stated absence. */
  const comeBack = (): void => {
    syncHypeWave(NOW - 20 * DAY);
    syncHypeWave(NOW);
  };

  it("arrives as mail rather than as money", () => {
    const before = getProfile().clout;
    comeBack();
    expect(getProfile().clout, "the package paid itself — §4.2.4 forbids that").toBe(before);

    const view = inboxViews(content, NOW).find((entry) => entry.message.topic === "returning");
    expect(view, "coming back after the stated absence posted no mail").toBeDefined();
    expect(view!.claimable).toBe(true);
    expect(view!.message.attachment?.[0]).toEqual({ kind: "clout", amount: wave.welcomeBack.clout });
  });

  it("pays exactly once when taken, and marks itself read", () => {
    comeBack();
    const id = welcomeBackId(getProfile().hypeWave.welcomeBackAt);
    const before = getProfile().clout;

    const grant = claimMail(content, id, NOW);
    expect(grant?.clout).toBe(wave.welcomeBack.clout);
    expect(getProfile().clout).toBe(before + wave.welcomeBack.clout);
    expect(claimMail(content, id, NOW), "claimed twice").toBeNull();
    expect(getProfile().clout).toBe(before + wave.welcomeBack.clout);

    const view = inboxViews(content, NOW).find((entry) => entry.message.id === id)!;
    expect(view.read).toBe(true);
    expect(view.claimed).toBe(true);
    expect(view.claimable).toBe(false);
  });

  it("refuses to be thrown away while it still owes something", () => {
    comeBack();
    const id = welcomeBackId(getProfile().hypeWave.welcomeBackAt);
    expect(deleteMail(content, id, NOW), "deleted mail holding an unclaimed grant").toBe(false);
    expect(inboxViews(content, NOW).some((entry) => entry.message.id === id)).toBe(true);

    // "clear read" must not sweep it up either
    markAllMailRead(content, NOW);
    deleteReadMail(content, NOW);
    expect(inboxViews(content, NOW).some((entry) => entry.message.id === id)).toBe(true);

    claimMail(content, id, NOW);
    expect(deleteMail(content, id, NOW)).toBe(true);
  });

  it("says what the package actually delivers, including the part that is missing", () => {
    comeBack();
    const message = inboxViews(content, NOW).find((entry) => entry.message.topic === "returning")!.message;
    const text = message.body.join(" ");
    expect(text).toContain(String(wave.welcomeBack.afterDays));
    // the forced Rebound is a rate, applied immediately and never claimed
    expect(getProfile().hypeWave.forcedReboundUntil).toBeGreaterThan(NOW);
    expect(text.toLowerCase()).toContain("rebound");
    // §10.5.4's other two parts are deferred; the message says so rather than implying it paid
    expect(text.toLowerCase()).toContain("not built yet");
  });

  it("is a new message the next time it is due, not the old one again", () => {
    comeBack();
    const first = welcomeBackId(getProfile().hypeWave.welcomeBackAt);
    claimMail(content, first, NOW);

    const later = NOW + 60 * DAY;
    syncHypeWave(later);
    const second = welcomeBackId(getProfile().hypeWave.welcomeBackAt);
    expect(second).not.toBe(first);
    const view = inboxViews(content, later).find((entry) => entry.message.id === second);
    expect(view?.claimable, "a second absence posted nothing claimable").toBe(true);
  });
});
