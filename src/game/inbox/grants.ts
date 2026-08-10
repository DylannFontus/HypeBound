/**
 * Operator grants — the one fact in the save that a player did not put there.
 *
 * Every other message in this folder is derived from something the game itself
 * recorded: a season boundary, a banner run, a package the Hype Wave posted. A
 * compensation grant has no such fact to derive from, because the fact *is* a
 * person deciding to send one. So it is the single exception to "mail is
 * derived, not stored" — and the exception is kept as small as it can be: what
 * is stored is the decision (how much, why, when), and the message is still
 * derived from that, so a grant cannot say anything the record does not say.
 *
 * ## Why this file has no imports, and must not gain any
 *
 * `scripts/grant.mjs` runs in bare Node with no bundler. It loads this module
 * directly, through Node's type stripping, so that the terminal tool and the
 * game agree on **one** definition of what a grant is, what makes one invalid
 * and what the player will read — rather than two definitions free to drift the
 * way `SAVE_SECTIONS` would have if `server/src/shared/saves.ts` had copied the
 * list instead of re-exporting it.
 *
 * Node resolves relative specifiers strictly, so a single extensionless
 * `import` here would break the tool at a distance, in a way the browser build
 * would never notice. Hence: no imports, no `Intl`, no locale. The prose below
 * writes numbers unformatted, which is what the event-conversion messages next
 * door already do, and it never states a date, because the message header
 * already renders `sentAt`.
 *
 * ## Why the topic is `welcome` rather than `grant`
 *
 * `MailTopic` is consumed by two `Record<MailTopic, …>` maps in
 * `src/ui/screens/inboxScreen.ts` — an icon and a row label — so a seventh
 * topic is not an additive change to this folder, it is a compile error in a
 * screen. `welcome` renders as "System" with the profile mark, which is the
 * honest sender for mail an operator sent by hand, so the reachable answer and
 * the correct answer happen to coincide.
 */

/**
 * The most one grant may carry.
 *
 * A speed bump, not a policy. The mistake this exists to catch is a trailing
 * zero — `--clout 50000` for `5000` — and a cap that refuses outright turns
 * that from a silent overpayment into an error message. Genuinely wanting more
 * than a million means sending two, deliberately, which is the point.
 */
export const GRANT_CLOUT_CAP = 1_000_000;

/** How long a reason may be. Long enough to be a sentence, short enough to read on a row. */
export const GRANT_REASON_MAX = 120;
const GRANT_REASON_MIN = 4;

/**
 * Ids are constrained rather than free text because they are spliced into a
 * namespaced message id. A colon or a space in here would produce an id that
 * collides with, or is indistinguishable from, another sender's.
 */
const GRANT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/i;

/**
 * The same shape `checkInboxData` looks for in body text: a template hole that
 * resolved to nothing. A reason is player-visible prose, so it is held to the
 * standard the rest of the mail is held to — and catching it here means the
 * tool refuses the grant instead of the data check failing days later.
 */
const UNRESOLVED = /\bundefined\b|\bNaN\b|\{[a-z]+\}/;

/** Anything that would break a single-line row. Written as escapes so this source stays printable. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * What the save stores, and the whole of it.
 *
 * Deliberately not a message: no subject, no body, no expiry. Those are derived
 * below, so correcting the wording of a grant corrects every grant already
 * sitting in every account's inbox, and a record cannot outlive the sentence it
 * was written against.
 */
export interface MailGrantRecord {
  /** Unique per account. `grantMailId` namespaces it into the message id. */
  readonly id: string;
  /** Clout handed over when the attachment is taken. Never paid on arrival. */
  readonly clout: number;
  /** Why it was sent, in the operator's words. Shown to the player verbatim. */
  readonly reason: string;
  /** Epoch milliseconds. The message is dated from this. */
  readonly issuedAt: number;
}

/** The message id a grant produces. Namespaced, so no other sender can collide with it. */
export const grantMailId = (id: string): string => `grant:${id}`;

/**
 * Everything wrong with a grant record, as sentences.
 *
 * Returns a list rather than throwing, and a list rather than a boolean, so the
 * terminal tool can print every problem at once instead of making the operator
 * discover them one run at a time. `checkInboxData` runs the same function over
 * a synthetic record, which is what keeps this honest: the rules cannot quietly
 * stop matching what the derivation below assumes.
 */
export function checkGrantRecord(record: MailGrantRecord, now: number): string[] {
  const problems: string[] = [];

  if (typeof record.id !== "string" || !GRANT_ID.test(record.id)) {
    problems.push(`id must be 1–64 characters of letters, digits and hyphens, starting with a letter or digit (got ${JSON.stringify(record.id)})`);
  }

  if (!Number.isInteger(record.clout)) {
    problems.push(`clout must be a whole number (got ${JSON.stringify(record.clout)})`);
  } else if (record.clout < 1) {
    problems.push(`clout must be at least 1 — an attachment worth nothing is an inert reward, and the inbox refuses to draw one`);
  } else if (record.clout > GRANT_CLOUT_CAP) {
    problems.push(`clout is ${record.clout}, above the ${GRANT_CLOUT_CAP} cap on a single grant — send two if that was deliberate`);
  }

  const reason = typeof record.reason === "string" ? record.reason.trim() : "";
  if (reason.length < GRANT_REASON_MIN) {
    problems.push(`reason must be at least ${GRANT_REASON_MIN} characters — it is what the player is told, and "" tells them nothing`);
  } else if (reason.length > GRANT_REASON_MAX) {
    problems.push(`reason is ${reason.length} characters, above the ${GRANT_REASON_MAX} the message has room for`);
  }
  if (CONTROL_CHARS.test(reason)) problems.push("reason contains a control character or line break");
  if (UNRESOLVED.test(reason)) {
    problems.push(`reason reads like an unresolved template — "${reason}" contains undefined, NaN or a {placeholder}`);
  }

  if (!Number.isInteger(record.issuedAt) || record.issuedAt <= 0) {
    problems.push(`issuedAt must be epoch milliseconds (got ${JSON.stringify(record.issuedAt)})`);
  } else if (record.issuedAt > now + 86_400_000) {
    problems.push("issuedAt is more than a day in the future — a message dated ahead of now is never posted at all");
  }

  return problems;
}

/** What `buildMail` posts for one grant: the fields `post()` fills the rest around. */
export interface GrantMessageParts {
  readonly id: string;
  readonly topic: "welcome";
  readonly subject: string;
  readonly body: string[];
  readonly sentAt: number;
  readonly attachment: { kind: "clout"; amount: number }[];
}

/**
 * The message one grant produces.
 *
 * The third paragraph is not filler. A player who sees currency they did not
 * earn should be told where it came from, and telling them *how* it got here —
 * from outside the game, as mail they had to open — is the same guarantee the
 * server side enforces, stated in the one place the person affected by it will
 * actually read.
 */
export function grantMessage(record: MailGrantRecord): GrantMessageParts {
  const reason = record.reason.trim().replace(/[.\s]+$/, "");
  return {
    id: grantMailId(record.id),
    topic: "welcome",
    subject: `A grant of ${record.clout} Clout`,
    body: [
      `${record.clout} Clout is attached below. It was sent by hand rather than earned in a match, and the reason recorded with it is “${reason}”.`,
      "Nothing has been added to your balance. Take it with the button below and it pays in like any other reward — and if you leave it, it stays, because a message that still owes you something never expires.",
      "Grants like this one are sent from outside the game. There is no screen in HYPEBOUND that can add currency to an account, which is why this arrived as mail you have to open rather than as a number that changed on its own.",
    ],
    sentAt: record.issuedAt,
    attachment: [{ kind: "clout", amount: record.clout }],
  };
}

/**
 * The grants worth deriving a message from, in the order they were issued.
 *
 * Invalid records are dropped rather than repaired, and a repeated id keeps the
 * first record only. Both matter for the same reason: a save is bytes somebody
 * else wrote, and two messages sharing an id would give the claim ledger one
 * key for two attachments — pay one and the other reads as taken. Refusing to
 * draw the second is the failure that loses nobody anything.
 */
export function usableGrants(grants: readonly MailGrantRecord[], now: number): MailGrantRecord[] {
  const seen = new Set<string>();
  const usable: MailGrantRecord[] = [];
  for (const record of grants) {
    if (!record || typeof record !== "object") continue;
    if (checkGrantRecord(record, now).length > 0) continue;
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    usable.push(record);
  }
  return usable.sort((a, b) => a.issuedAt - b.issuedAt);
}
