/**
 * The Inbox — `03-screens-and-navigation.md` §4.5.3.
 *
 * *"System and social messages with attachments. Offline build carries local
 * system mail only (version-migration grants, returning-player rewards, event
 * notices); player-to-player items are online."*
 *
 * ## Mail is derived, not stored
 *
 * Nothing here writes a message. Every message is **generated from a fact the
 * save already contains** — the seasons table, a banner's published run calendar,
 * the Archive Passes the account holds, the moment the Welcome Back package was
 * posted — and the save keeps only what the *player* did to it: read, claimed,
 * deleted.
 *
 * That is the same choice missions made (progress recomputed from an evidence
 * log rather than incremented into counters), for the same reason. A stored
 * message can outlive the thing it describes, and an inbox is exactly the screen
 * where that goes unnoticed: mail nobody re-reads, quietly asserting a season
 * ended on a date it did not. Derived mail cannot say anything the data does not
 * still say, and a message whose fact is corrected corrects itself.
 *
 * ## Two rules that make the retention window honest
 *
 * §4.5.3 wants mail to expire after 30 days. `07-economy-and-monetization.md`
 * §6 policy **F6** forbids "lose-it-if-you-miss-it" grants. Both are binding, so
 * the resolution is that **expiry removes the message, never the grant**: a
 * message with an unclaimed attachment does not expire, and is the one thing in
 * here that outlives its window. Nothing you are owed can be lost by not reading
 * your mail.
 *
 * And nothing is ever claimed for you (§4.2.4: *"No reward is auto-consumed
 * invisibly"*). The Welcome Back package used to be paid straight into the wallet
 * by `syncHypeWave` — 300 Clout appearing with no explanation, which is the
 * inert-reward bug seen from the other side: not a reward that does nothing, but
 * a reward that says nothing. It arrives here as an attachment now.
 */

import type { ContentIndex } from "../../engine/types";
// aliased: the banner module below exports its own runStart/runEnd for a
// different kind of window, and one file cannot hold two of either
import {
  allEvents,
  eventById,
  eventsData,
  runEnd as eventRunEnd,
  runStart as eventRunStart,
} from "../events";
import { checkInCosmeticForMonth, cosmeticById } from "../cosmetics";
import { checkInConfig } from "../progression/data";
import { hypeWaveData, seasonEnd, seasonStart } from "../progression/hypeWave";
import { bannerData, runEnd, runStart } from "../economy/banner";
import { newsArticles } from "../news";

const DAY_MS = 86_400_000;

/**
 * How long a message is generated for, in days (§4.5.3's "mail expires in 30
 * days"). A message holding an unclaimed attachment ignores this — see the note
 * on `expiresAt`.
 */
export const RETENTION_DAYS = 30;

/**
 * The date format lives here rather than in the screen, unlike every other date
 * in this codebase, because a message *is* text: "It returns on 2 November 2026"
 * is one sentence, and splitting it so the screen can own the date would leave
 * half of it in each file. It also means a test can assert that the message
 * actually names the date rather than that it has a slot for one.
 *
 * **UTC**, because these are calendar dates authored in a data file rather than
 * moments in a player's day. Formatted locally, 2026-07-27T00:00Z reads as "26
 * July" for everyone west of Greenwich — a run advertised as ending the day
 * before the data says it does.
 */
const DATE = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
/** The check-in month is *this* month where the player is, so it stays local. */
const MONTH = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const on = (at: number): string => DATE.format(new Date(at));

/** Who sent it. Only `system` can exist offline; the rest need a server. */
export type MailSender = "system";

/** Which fact produced a message — the filter chips on the screen. */
export type MailTopic = "welcome" | "season" | "banner" | "checkin" | "returning" | "news" | "event";

/**
 * What a message can hand over.
 *
 * A union of one, deliberately shaped like the reward unions the pass, mastery
 * and achievements use, so the second kind is an addition rather than a rewrite.
 * Only Clout is attached to anything today, and a kind with no payer is the
 * inert-reward bug waiting to happen — so kinds arrive when senders do.
 */
export type MailReward = { kind: "clout"; amount: number };

/** Where a message points. The route ids the inbox screen knows how to open. */
export type MailRoute = "pass" | "banner" | "missions" | "news" | "events";

export interface MailLink {
  label: string;
  screen: MailRoute;
  /** which thing on that screen — an article id, for the news feed */
  param?: string;
}

export interface MailMessage {
  /** stable and derived — the same fact always produces the same id */
  id: string;
  sender: MailSender;
  topic: MailTopic;
  subject: string;
  /** paragraphs of plain text; the screen escapes them */
  body: string[];
  sentAt: number;
  /**
   * When this message stops being generated, or **null** when it is being held
   * open because it still owes the player something. F6's rule, in one field.
   */
  expiresAt: number | null;
  attachment?: MailReward[];
  link?: MailLink;
}

/**
 * The facts mail is derived from that only the save knows.
 *
 * Everything else — seasons, banner runs, the check-in track, the Welcome Back
 * numbers — is read from the shipped data files directly, so a message quotes
 * the same constants the systems act on and the two cannot drift.
 */
export interface MailInput {
  /** when the account was created; the welcome message is dated from it */
  createdAt: number;
  /** when §10.5.4's Welcome Back package was last posted, or 0 */
  welcomeBackAt: number;
  /** season ids the account holds an Archive Pass for */
  archivedSeasonIds: readonly string[];
  /** message ids whose attachment has already been handed over */
  claimed: readonly string[];
  /**
   * Leftover event currency already converted to Clout, per event.
   *
   * The receipt 07 §3 requires — *"auto-converts to Clout at 1 : 5, logged in
   * the inbox"* — is **derived** from these rather than being a message somebody
   * stored, exactly like every other sender in this file. The payout itself
   * belongs to the events module; this is only the record it left behind.
   */
  eventConversions: readonly {
    eventId: string;
    runStart: number;
    tokens: number;
    clout: number;
    at: number;
  }[];
}

/**
 * The senders §4.5.3 names that cannot exist in this build, each with the reason
 * it cannot — the same assert-against-a-justified-allowlist the cosmetics,
 * achievement and pass layers use.
 *
 * The screen prints this list rather than hiding it, because an inbox that is
 * quiet is indistinguishable from an inbox that is broken, and a player who can
 * read *why* nothing arrives from a club is not left wondering whether their
 * mail is going missing.
 */
export const DEFERRED_SENDERS: ReadonlyMap<string, string> = new Map([
  [
    "Version-migration grants",
    "the profile store has one version and no migration chain, so nothing has ever migrated — a compensation grant with nothing to compensate is theatre",
  ],
  [
    "Live event announcements",
    "the Event Hub posts an event opening and its leftover-currency receipt, both derived from the published calendar and the save — what cannot be posted is a notice about an event nobody scheduled in advance, because live-ops scheduling needs the service",
  ],
  ["Purchase receipts", "this build takes no payments, so there is no receipt to send"],
  ["Friend messages and deck shares", "player-to-player mail needs a server"],
  ["Fan Club invites and announcements", "clubs need a server"],
  ["Moderation notices and appeal outcomes", "reports are reviewed server-side; there is nothing to review offline"],
]);

/** Message ids, in one place, so the screen and the tests name the same things. */
export const WELCOME_ID = "welcome";
export const welcomeBackId = (at: number): string => `welcome-back:${at}`;
export const seasonOpenedId = (seasonId: string): string => `season:${seasonId}:opened`;
export const seasonEndedId = (seasonId: string): string => `season:${seasonId}:ended`;
export const bannerOpenedId = (bannerId: string, run: number): string => `banner:${bannerId}:${run}:opened`;
export const bannerEndedId = (bannerId: string, run: number): string => `banner:${bannerId}:${run}:ended`;
export const checkInId = (month: string): string => `checkin:${month}`;
export const newsId = (articleId: string): string => `news:${articleId}`;
export const eventOpenedId = (eventId: string, runStart: number): string => `event:${eventId}:${runStart}:opened`;
export const eventSettledId = (eventId: string, runStart: number): string => `event:${eventId}:${runStart}:settled`;

/** The `YYYY-MM` a moment falls in, matching the profile's own month key. */
const monthOf = (now: number): string => {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

/**
 * Every message the account's facts produce, newest first.
 *
 * Pure, and cheap enough to call on every render: it walks two seasons, six
 * banner runs and one month.
 */
export function buildMail(content: ContentIndex, input: MailInput, now: number): MailMessage[] {
  const claimed = new Set(input.claimed);
  const messages: MailMessage[] = [];

  const post = (message: Omit<MailMessage, "sender" | "expiresAt">): void => {
    const owed = (message.attachment?.length ?? 0) > 0 && !claimed.has(message.id);
    const expiresAt = message.sentAt + RETENTION_DAYS * DAY_MS;
    // sent in the future is not sent: a season or run that has not started yet
    if (message.sentAt > now) return;
    // §4.5.3's window, with F6's exception — a message that owes you something
    // is kept for as long as it takes
    if (!owed && expiresAt <= now) return;
    messages.push({ sender: "system", ...message, expiresAt: owed ? null : expiresAt });
  };

  // -------------------------------------------------------------------------
  // The account itself
  // -------------------------------------------------------------------------

  post({
    id: WELCOME_ID,
    topic: "welcome",
    subject: "Welcome to HYPEBOUND",
    sentAt: input.createdAt,
    body: [
      "This is where the game tells you things it would otherwise decide for you: a season ending, a banner opening, what happens to the pass you did not finish.",
      "Two rules hold everywhere in here. Nothing is ever claimed on your behalf — an attachment sits and waits for you to take it. And a message that still owes you something never expires, however long you leave it. Everything else clears itself out after thirty days.",
      "Nobody can write to you yet. Friend messages, club announcements and moderation notices all need a server, and the screen lists what is missing rather than pretending the quiet is normal.",
    ],
  });

  // -------------------------------------------------------------------------
  // The Hype Wave — §10
  // -------------------------------------------------------------------------

  const { seasons, archiveRate, tiers } = hypeWaveData();
  const archived = new Set(input.archivedSeasonIds);

  for (const season of seasons) {
    const starts = seasonStart(season);
    const ends = seasonEnd(season);

    post({
      id: seasonOpenedId(season.id),
      topic: "season",
      subject: `Season ${season.number}: ${season.name} has begun`,
      sentAt: starts,
      body: [
        `The Hype Wave has reset to tier 1 and this season runs until ${on(ends)}. ${tiers} tiers, each of which pays on the free track and again on the Backstage Pass — and the Encore tiers past ${tiers} keep paying after that.`,
        "Nothing you did not finish last season is lost. An unfinished pass becomes an Archive Pass and carries on earning — see the pass screen, where your archives sit under the live one.",
      ],
      link: { label: "Open the Hype Wave", screen: "pass" },
    });

    /**
     * The end-of-season message is generated **only** when there is an archive
     * for it. Its whole content is "here is what happened to your pass", and a
     * season that ended while the account held nothing has nothing to report —
     * the next season's opening message is the news. This way every one of these
     * is true by construction rather than by carefully worded hedging.
     */
    if (archived.has(season.id)) {
      post({
        id: seasonEndedId(season.id),
        topic: "season",
        subject: `Season ${season.number} has ended — your pass is safe`,
        sentAt: ends,
        body: [
          `${season.name} closed on ${on(ends)} with your pass unfinished, so it has become an Archive Pass.`,
          `It keeps earning ${Math.round(archiveRate * 100)}% of every XP you make, it has no deadline of any kind, and the Backstage Pass can still be bought on it and claimed back through every tier you have already passed.`,
          "There is nothing to do about this and no hurry to do it. It is here because a pass moving without telling you is the sort of thing you should hear from the game rather than notice later.",
        ],
        link: { label: "See your archives", screen: "pass" },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Headliner Banners — §4
  // -------------------------------------------------------------------------

  for (const banner of bannerData().banners) {
    const runs = [...banner.runs].sort((a, b) => runStart(a) - runStart(b));
    runs.forEach((run, index) => {
      const opens = runStart(run);
      const closes = runEnd(run);
      const later = runs.filter((entry) => runStart(entry) > closes);

      post({
        id: bannerOpenedId(banner.id, index),
        topic: "banner",
        subject: index === 0 ? `${banner.name} is live` : `${banner.name} is back`,
        sentAt: opens,
        body: [
          banner.blurb,
          `It runs until ${on(closes)}, and every card on it is in Merch Drops and craftable with Signal on the same day — a banner concentrates the odds and never gates a card behind itself.`,
          later.length > 0
            ? `After this it returns on ${later.map((entry) => on(runStart(entry))).join(", and again on ")}. That calendar was published before the banner first opened and does not move.`
            : "This is the last run currently on the calendar.",
        ],
        link: { label: "Open the banner", screen: "banner" },
      });

      post({
        id: bannerEndedId(banner.id, index),
        topic: "banner",
        subject: `${banner.name} has finished its run`,
        sentAt: closes,
        body: [
          `It ran from ${on(opens)} to ${on(closes)}.`,
          later.length > 0
            ? `It returns on ${on(runStart(later[0]!))}. Your Encore Meter, your wishlist, your Target Card and your pull history all carry over — a rerun is the same banner, not a new one, so nothing you built up counts for less.`
            : "No further run is on the calendar yet.",
        ],
        link: { label: "See the calendar", screen: "banner" },
      });
    });
  }

  // -------------------------------------------------------------------------
  // Stream Check-In — §11
  // -------------------------------------------------------------------------

  const month = new Date(now);
  const cardBack = cosmeticById(content, checkInCosmeticForMonth(month.getMonth()));
  post({
    id: checkInId(monthOf(now)),
    topic: "checkin",
    /**
     * The month is named in the body rather than in the subject, because month
     * names are localised and "juillet's Stream Check-In" is a possessive built
     * on a word from another language. A localised date inside an English
     * sentence is what every other screen already does; a localised date inside
     * an English *word* is not.
     */
    subject: "This month's Stream Check-In is open",
    sentAt: new Date(month.getFullYear(), month.getMonth(), 1).getTime(),
    body: [
      `${MONTH.format(month)} — ${checkInConfig().steps.length} steps, and one of them is yours for each calendar day you open the game.`,
      `There is no streak to keep. Miss a day, miss a fortnight — the next step is still the next step, and the last one is still ${cardBack?.name ?? "this month's card back"}, which is the only place that card back comes from.`,
    ],
    link: { label: "Open Missions", screen: "missions" },
  });

  // -------------------------------------------------------------------------
  // News announcements — §4.2.2 lists the inbox among the feed's entry points
  // -------------------------------------------------------------------------

  /**
   * Only articles with **no subject** are announced here.
   *
   * One fact, one message. An article about a banner run is already covered by
   * the banner sender above, which links to the banner itself rather than to an
   * article about it — and two messages carrying the same headline is how an
   * inbox becomes something people stop opening. What is left is the writing
   * nothing else announces: the dev blogs and the general updates.
   */
  for (const article of newsArticles(content)) {
    if (article.def.subject) continue;
    post({
      id: newsId(article.def.id),
      topic: "news",
      subject: article.title,
      sentAt: article.publishedAt,
      body: [article.summary],
      link: { label: "Read it", screen: "news", param: article.def.id },
    });
  }

  // -------------------------------------------------------------------------
  // The Welcome Back package — §10.5.4
  // -------------------------------------------------------------------------

  if (input.welcomeBackAt > 0) {
    const { welcomeBack } = hypeWaveData();
    post({
      id: welcomeBackId(input.welcomeBackAt),
      topic: "returning",
      subject: "Welcome back",
      sentAt: input.welcomeBackAt,
      body: [
        `You had been away a while — ${welcomeBack.afterDays} days is the line — so here is the package for it. The Clout is attached below and is yours whenever you want it; it is not going anywhere.`,
        `Wave Rebound is already on, and stays on for ${welcomeBack.reboundWeeks === 1 ? "a week" : `${welcomeBack.reboundWeeks} weeks`} whatever pace you were on. That is a ${Math.round(hypeWaveData().rebound.bonus * 100)}% bonus on pass XP while you catch up, and it needed no claiming because it is a rate rather than a grant.`,
        "Two further parts of the package are not built yet: pre-banked daily missions and an extra weekly slot. The mission rotation issues from a pool on a clock and has no way to be handed a mission, so this package is the Clout and the Rebound week.",
      ],
      attachment: [{ kind: "clout", amount: welcomeBack.clout }],
      link: { label: "Open the Hype Wave", screen: "pass" },
    });
  }

  // -------------------------------------------------------------------------
  // Limited-time events — 09 §14
  // -------------------------------------------------------------------------

  /**
   * Two notices per run, both derived rather than stored.
   *
   * The opening is read straight off the published calendar, so it needs nothing
   * from the save at all — `post` already drops anything dated in the future,
   * which is precisely what makes a run that has not started yet invisible.
   *
   * The receipt is 07 §3's requirement in as many words: *"leftover event
   * currency auto-converts to Clout at 1 : 5, logged in the inbox."* It carries
   * no attachment because the Clout was already paid — a message that offered it
   * again would either double-pay or lie about being claimable.
   */
  for (const event of allEvents()) {
    for (const run of event.runs) {
      const startedAt = eventRunStart(run);
      post({
        id: eventOpenedId(event.id, startedAt),
        topic: "event",
        subject: `${event.name} is running`,
        sentAt: startedAt,
        body: [
          event.blurb,
          `It runs until ${new Date(eventRunEnd(run)).toUTCString()}. Event missions pay ${event.currency.name}, and the ${event.name} shop takes them.`,
          "Anything you do not spend converts to Clout when the doors close, and the event returns on a published date — nothing here is missable.",
        ],
        link: { label: "Open the Event Hub", screen: "events" },
      });
    }
  }

  for (const conversion of input.eventConversions) {
    const event = eventById(conversion.eventId);
    if (!event) continue;
    post({
      id: eventSettledId(conversion.eventId, conversion.runStart),
      topic: "event",
      subject: `${conversion.tokens} ${event.currency.name} became ${conversion.clout} Clout`,
      sentAt: conversion.at,
      body: [
        `${event.name} has finished, and you had ${conversion.tokens} ${event.currency.name} left over.`,
        `Event currency never expires into nothing: it converted to ${conversion.clout} Clout at the published rate of 1 : ${eventsData().conversionToClout}, and the Clout is already in your balance.`,
        `Your ${event.name} shop progress is kept exactly as it was. When the event reruns, what you bought stays bought.`,
      ],
      link: { label: "Open the Event Hub", screen: "events" },
    });
  }

  return messages.sort((a, b) => b.sentAt - a.sentAt);
}

/**
 * Everything wrong with the mail the shipped data produces.
 *
 * The point is the same one `checkBannerData` makes: the code proves messages
 * are well-formed, and this proves they are *sendable*. It builds the inbox at
 * every date the data has an opinion about — every season boundary, every run
 * boundary — rather than only at "now", because a message that comes out blank
 * in November is not a bug anybody would find in July.
 */
export function checkInboxData(content: ContentIndex): string[] {
  const problems: string[] = [];

  const moments = new Set<number>();
  for (const season of hypeWaveData().seasons) {
    moments.add(seasonStart(season));
    moments.add(seasonEnd(season));
  }
  for (const banner of bannerData().banners) {
    for (const run of banner.runs) {
      moments.add(runStart(run));
      moments.add(runEnd(run));
    }
  }

  const archivedSeasonIds = hypeWaveData().seasons.map((season) => season.id);
  for (const moment of moments) {
    const messages = buildMail(
      content,
      { createdAt: moment, welcomeBackAt: moment, archivedSeasonIds, claimed: [], eventConversions: [] },
      moment
    );

    const seen = new Set<string>();
    for (const message of messages) {
      const at = `at ${on(moment)}`;
      if (seen.has(message.id)) problems.push(`${message.id}: generated twice ${at}`);
      seen.add(message.id);
      if (!message.subject.trim()) problems.push(`${message.id}: has no subject ${at}`);
      if (message.body.length === 0) problems.push(`${message.id}: has no body ${at}`);
      for (const paragraph of message.body) {
        if (!paragraph.trim()) problems.push(`${message.id}: has an empty paragraph ${at}`);
        /**
         * A template hole that resolved to nothing. Cheap to check and the exact
         * failure a data file with a missing name would produce.
         *
         * Word-bounded and case-sensitive, because these are looking for what
         * `String(undefined)` and `String(NaN)` actually produce — a
         * case-insensitive `NaN` matches "Reso**nan**ce", which is how this
         * first rejected a perfectly good sentence about Perfect Resonance.
         */
        if (/\bundefined\b|\bNaN\b|\{[a-z]+\}/.test(paragraph)) {
          problems.push(`${message.id}: unresolved text — "${paragraph}" ${at}`);
        }
      }
      for (const reward of message.attachment ?? []) {
        if (reward.amount <= 0) problems.push(`${message.id}: attaches ${reward.amount} ${reward.kind} ${at}`);
      }
    }
  }

  if (DEFERRED_SENDERS.size === 0) problems.push("DEFERRED_SENDERS is empty — every sender in §4.5.3 would have to exist");
  for (const [sender, reason] of DEFERRED_SENDERS) {
    if (!reason.trim()) problems.push(`${sender}: deferred with no reason given`);
  }

  return problems;
}
