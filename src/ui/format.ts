/**
 * Every number, date and quantity a player reads, printed the same way.
 *
 * The bug this file exists to kill is small, embarrassing and everywhere.
 * Eleven call sites across the screens call `toLocaleString()` or build an
 * `Intl.DateTimeFormat` with `undefined` as the locale, which means the string
 * is whatever the *machine* is set to. On a French install the Fairness screen
 * prints "1 000 Clout" with a narrow no-break space, and the Patch Notes header
 * reads "7 août 2026" in the middle of an English sentence. Two of the verify
 * scripts already carry comments apologising for it and working around the
 * separator. It is not a translation — the rest of the sentence is still
 * English — it is a half-translated string, which is worse than either.
 *
 * So the locale is pinned. `en-GB`, one constant, no parameter, no override.
 * HYPEBOUND ships in one language; the day it ships in two, this is the single
 * file that changes.
 *
 * ## Why the dates are in UTC
 *
 * Seasons, banners, dailies and the Hype Wave all roll over at a fixed instant
 * that the server decides. If the client rendered those in local time, two
 * players comparing screenshots of the same deadline would see different
 * strings, and the support answer to "my season ended early" would be a
 * timezone lesson. The deadline is a property of the game, not of where you are
 * sitting, so it is printed in the game's timezone. `timeZone` is still
 * overridable per call for the rare thing that genuinely is local — but you
 * almost certainly do not want to, and if you do, say why in a comment.
 *
 * ## Why non-finite input returns a dash rather than "NaN"
 *
 * A currency chip reading "NaN Clout" is a crash that got dressed up as a
 * label; a chip reading "—" is an empty state. Both mean a bug upstream, but
 * only one of them is safe to have on screen while it is being found. Every
 * function here degrades to {@link EMPTY} rather than throwing or printing
 * engine noise, because these are called from render paths where an exception
 * takes the whole screen down with it.
 *
 * ## A note on cost
 *
 * Constructing an `Intl.*` formatter is genuinely expensive — orders of
 * magnitude more than using one. The fixed shapes are lazy module singletons so
 * a cold boot does not build eight of them before the lobby paints, and the
 * override path is memoised by its options. Callers may treat every function
 * here as cheap enough to call per frame, because several of them will.
 */

/** The one locale. Not a default — a constant. See the file header. */
export const LOCALE = "en-GB";

/** The one timezone for anything the game schedules. See the file header. */
export const TIME_ZONE = "UTC";

/**
 * What a value that cannot be printed prints as.
 *
 * An em dash, exported rather than typed out, so that a missing number, a
 * missing date and a missing duration all look like the same kind of absence
 * instead of three different ones.
 */
export const EMPTY = "—";

/** Anything that can name an instant. ISO strings turn up in cloud-save payloads. */
export type DateLike = number | string | Date;

// ---------------------------------------------------------------------------
// formatter cache
// ---------------------------------------------------------------------------

/**
 * A stable key for an options bag.
 *
 * Sorted, because `{ month, day }` and `{ day, month }` are the same formatter
 * and `JSON.stringify` would happily build two of them. Only the override path
 * pays for this; the common shapes below never reach it.
 */
function optionsKey(options: object): string {
  const entries = Object.entries(options).filter(([, value]) => value !== undefined);
  entries.sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
  return JSON.stringify(entries);
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();

function dateFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = optionsKey(options);
  let format = dateFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(LOCALE, options);
    dateFormats.set(key, format);
  }
  return format;
}

const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormat(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = optionsKey(options);
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(LOCALE, options);
    numberFormats.set(key, format);
  }
  return format;
}

// ---------------------------------------------------------------------------
// numbers
// ---------------------------------------------------------------------------

let plainNumber: Intl.NumberFormat | undefined;
let integerNumber: Intl.NumberFormat | undefined;
let signedNumber: Intl.NumberFormat | undefined;

/**
 * A grouped number: `1,234`, `12,437`, `0.5`.
 *
 * Deliberately a drop-in for the bare `toLocaleString()` calls it replaces —
 * same grouping, same "up to three decimal places" default — so migrating a
 * call site is a swap and not a redesign. Pass `options` for the exceptions.
 *
 * Use this for anything with a fractional part. For things that are counted,
 * use {@link count}, which cannot leak a decimal.
 */
export function num(value: number, options?: Intl.NumberFormatOptions): string {
  if (!Number.isFinite(value)) return EMPTY;
  if (options) return numberFormat(options).format(value);
  plainNumber ??= new Intl.NumberFormat(LOCALE);
  return plainNumber.format(value);
}

/**
 * A whole quantity of things: `3`, `1,235`.
 *
 * The difference from {@link num} is the guarantee, not the output: a count is
 * rounded to an integer before it is printed, so a value that arrived from a
 * division cannot put "2.6666666666666665 cards" on screen. Cards, wins,
 * points, messages, slots — anything you could put a plural noun after.
 */
export function count(value: number): string {
  if (!Number.isFinite(value)) return EMPTY;
  integerNumber ??= new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
  return integerNumber.format(value);
}

/**
 * A delta, with its sign always shown: `+12`, `-3`, `0`.
 *
 * For anything the player reads as a change rather than as a state — rank
 * movement, a stat buff on a card, Clout earned this match. A "+" that appears
 * only sometimes reads as a typo, so `signDisplay: exceptZero` prints it for
 * every non-zero value and leaves a plain `0` alone.
 */
export function signed(value: number): string {
  if (!Number.isFinite(value)) return EMPTY;
  signedNumber ??= new Intl.NumberFormat(LOCALE, { signDisplay: "exceptZero" });
  return signedNumber.format(value);
}

/**
 * A percentage from a **0–1 fraction**: `percent(0.42)` is `"42%"`.
 *
 * The 0–1 versus 0–100 confusion is the classic bug in this function, so the
 * unit is in the name of the parameter and in this sentence. If you have 42,
 * divide it.
 */
export function percent(fraction: number, decimals = 0): string {
  if (!Number.isFinite(fraction)) return EMPTY;
  return numberFormat({
    style: "percent",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(fraction);
}

/**
 * Suffixes for English ordinals, keyed by the rule `Intl` picks.
 *
 * English only uses three of these, but the record is total so that a locale
 * change cannot produce an `undefined` suffix — and so the mapping is written
 * down rather than living inside a chain of `% 100` conditions that everybody
 * has to re-derive. (11th, 12th and 13th are the cases hand-rolled versions
 * get wrong; `Intl.PluralRules` already knows.)
 */
const ORDINAL_SUFFIX: Record<Intl.LDMLPluralRule, string> = {
  one: "st",
  two: "nd",
  few: "rd",
  other: "th",
  zero: "th",
  many: "th",
};

let ordinalRules: Intl.PluralRules | undefined;

/** A placing: `1st`, `2nd`, `11th`, `1,021st`. Ladder rank, Grand Tour finish. */
export function ordinal(value: number): string {
  if (!Number.isFinite(value)) return EMPTY;
  const whole = Math.trunc(value);
  ordinalRules ??= new Intl.PluralRules(LOCALE, { type: "ordinal" });
  return `${count(whole)}${ORDINAL_SUFFIX[ordinalRules.select(whole)]}`;
}

// ---------------------------------------------------------------------------
// words
// ---------------------------------------------------------------------------

let cardinalRules: Intl.PluralRules | undefined;

/**
 * The right noun for a quantity: `plural(1, "card")` is `"card"`, `plural(0,
 * "card")` is `"cards"`.
 *
 * `many` defaults to `one + "s"` because the overwhelming majority of them are
 * regular and the alternative is 40-odd call sites repeating `"cards"` next to
 * `"card"`. Irregulars pass it explicitly: `plural(n, "victory", "victories")`.
 *
 * It asks `Intl.PluralRules` rather than testing `n === 1`, which is the same
 * answer for every whole number in English and the *correct* answer for the
 * edges — `1.0` is "one", `1.5` is not, and English says "0 cards".
 */
export function plural(value: number, one: string, many = `${one}s`): string {
  cardinalRules ??= new Intl.PluralRules(LOCALE);
  const safe = Number.isFinite(value) ? value : 0;
  return cardinalRules.select(safe) === "one" ? one : many;
}

/**
 * The number and its noun together: `"3 cards"`, `"1 card"`, `"1,204 cards"`.
 *
 * This is what almost every call site actually wanted, and writing it out by
 * hand is how the codebase ended up with thirty copies of
 * `${n} card${n === 1 ? "" : "s"}` — thirty chances to forget the grouping on
 * the number, which most of them did.
 */
export function quantity(value: number, one: string, many?: string): string {
  return `${count(value)} ${plural(value, one, many)}`;
}

let conjunctionList: Intl.ListFormat | undefined;
let disjunctionList: Intl.ListFormat | undefined;

/**
 * A readable list: `"Cinder, Static and Bloom"`.
 *
 * Joining with `", "` and hoping is how you get "Cinder, Static, Bloom" in a
 * sentence that needed an "and", and hand-rolling the last-item case is how you
 * get "Cinder and " for a one-item list. `Intl.ListFormat` handles the empty,
 * one and two-item cases too.
 */
export function list(items: readonly string[], type: "and" | "or" = "and"): string {
  if (items.length === 0) return "";
  if (type === "or") {
    disjunctionList ??= new Intl.ListFormat(LOCALE, { style: "long", type: "disjunction" });
    return disjunctionList.format(items);
  }
  conjunctionList ??= new Intl.ListFormat(LOCALE, { style: "long", type: "conjunction" });
  return conjunctionList.format(items);
}

// ---------------------------------------------------------------------------
// dates and times
// ---------------------------------------------------------------------------

/**
 * Coerce anything instant-shaped into a `Date`, or `null` if it is not one.
 *
 * The `null` matters more than the coercion. `Intl.DateTimeFormat.format`
 * *throws* a `RangeError` on an invalid date, and every date on these screens
 * comes out of a save file, a cloud payload or a content JSON — all three of
 * which can hold a string somebody typed. A render path is the worst place in
 * the app to throw, so an unparseable instant becomes {@link EMPTY} instead.
 */
function toDate(value: DateLike): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/**
 * The base every date shape starts from.
 *
 * `hourCycle` is pinned as hard as the locale is, and for a subtler reason.
 * `en-GB` has been both 12-hour and 24-hour in different ICU releases, so a
 * build that omitted it would print "2:30 pm" or "14:30" depending on which
 * Node or which Chrome was running — including in the tests, which would then
 * pass on one machine and fail on another for no reason anybody could see.
 */
const DATE_BASE: Intl.DateTimeFormatOptions = { timeZone: TIME_ZONE, hourCycle: "h23" };

/**
 * A calendar day, written out: `"7 August 2026"`.
 *
 * The long month is deliberate — this is the shape used on Patch Notes, Privacy,
 * News and the Fairness page, where a date is being *stated* rather than listed,
 * and "07/08/2026" is ambiguous to half the internet.
 *
 * Pass `options` to vary a component and keep the rest: `date(d, { month:
 * "short" })` gives `"7 Aug 2026"`.
 */
export function date(value: DateLike, options?: Intl.DateTimeFormatOptions): string {
  const when = toDate(value);
  if (!when) return EMPTY;
  return dateFormat({
    day: "numeric",
    month: "long",
    year: "numeric",
    ...DATE_BASE,
    ...options,
  }).format(when);
}

/**
 * A day and a clock time: `"7 Aug 2026, 14:30"`.
 *
 * Short month here where {@link date} uses long, because this string is twice
 * as long already and it lives in table rows and list items rather than in
 * prose. Add `{ weekday: "short" }` for the "when does this end" shapes, which
 * read better with a day name in front.
 */
export function dateTime(value: DateLike, options?: Intl.DateTimeFormatOptions): string {
  const when = toDate(value);
  if (!when) return EMPTY;
  return dateFormat({
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...DATE_BASE,
    ...options,
  }).format(when);
}

/** Just the clock time of an instant: `"14:30"`. For "resets at" lines. */
export function time(value: DateLike, options?: Intl.DateTimeFormatOptions): string {
  const when = toDate(value);
  if (!when) return EMPTY;
  return dateFormat({ hour: "2-digit", minute: "2-digit", ...DATE_BASE, ...options }).format(when);
}

let relativeTime: Intl.RelativeTimeFormat | undefined;

/**
 * Largest-first, so the first unit that fits is the one that gets used.
 *
 * Months and years are the average length rather than the real one. That is
 * fine and would not be if this returned a duration: "3 months ago" is a
 * gesture at the past, and nobody reading it is going to check.
 */
const RELATIVE_UNITS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 31_557_600_000],
  ["month", 2_629_800_000],
  ["week", 604_800_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/**
 * How long ago, or how far off: `"3 hours ago"`, `"yesterday"`, `"in 2 days"`.
 *
 * `numeric: "auto"` is what turns -1 day into "yesterday" rather than "1 day
 * ago", which is the whole reason to use `Intl` here instead of subtracting.
 * Under a minute is "just now" — every alternative ("0 minutes ago", "in 0
 * seconds") is worse.
 */
export function relative(value: DateLike, now: DateLike = Date.now()): string {
  const when = toDate(value);
  const from = toDate(now);
  if (!when || !from) return EMPTY;

  const delta = when.getTime() - from.getTime();
  relativeTime ??= new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(delta) >= size) return relativeTime.format(Math.round(delta / size), unit);
  }
  return "just now";
}

/** The unit ladder `duration` walks, largest first. */
const DURATION_UNITS: ReadonlyArray<readonly [string, number]> = [
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
  ["second", 1],
];

export interface DurationOptions {
  /** How many units to print, at most. Two reads well; one is for tight rows. */
  units?: 1 | 2;
}

/**
 * A span of time, in prose: `"3 days, 4 hours"`, `"45 minutes"`, `"12 seconds"`.
 *
 * **Floors, never rounds.** This is nearly always printing time *remaining* —
 * an event window, a season, a pity timer — and a countdown that rounds up says
 * "2 hours" when there are 119 minutes left. Overstating a deadline is the one
 * error a deadline must not make, so the last partial unit is dropped rather
 * than credited.
 *
 * Two units by default, taken from the largest non-zero one downwards, with
 * zeros inside the window dropped: 3 days and no hours is `"3 days"`, not
 * `"3 days, 0 hours"`.
 *
 * For a live match timer you want {@link clock}, not this.
 */
export function duration(ms: number, options?: DurationOptions): string {
  if (!Number.isFinite(ms)) return EMPTY;
  const limit = options?.units ?? 2;
  const total = Math.max(0, Math.floor(ms / 1000));

  // Each unit takes what is left over from the one above it: days from the
  // whole span, hours from the remainder after whole days, and so on.
  let remainder = total;
  const amounts = DURATION_UNITS.map(([, size]) => {
    const amount = Math.floor(remainder / size);
    remainder -= amount * size;
    return amount;
  });

  const first = amounts.findIndex((amount) => amount > 0);
  if (first === -1) return quantity(0, "second");

  const parts: string[] = [];
  for (let index = first; index < Math.min(first + limit, amounts.length); index += 1) {
    const amount = amounts[index]!;
    if (amount > 0) parts.push(quantity(amount, DURATION_UNITS[index]![0]));
  }
  return parts.join(", ");
}

/**
 * A digital clock: `"1:30"`, `"0:07"`, `"1:02:03"`.
 *
 * The turn timer and the rope. Seconds are always two digits so the string does
 * not change width as it counts down past ten — the same reason the number
 * roles in the design system are tabular. Hours only appear when there are any.
 */
export function clock(ms: number): string {
  if (!Number.isFinite(ms)) return EMPTY;
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  return `${hours > 0 ? `${hours}:` : ""}${mm}:${String(seconds).padStart(2, "0")}`;
}
