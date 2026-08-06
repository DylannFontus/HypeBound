/**
 * The formatters — `docs/FOUNDATION-CONTRACT.md` §D2.
 *
 * These are the easiest functions in the codebase to test and among the easiest
 * to get subtly wrong, because the failure mode is not an exception. It is a
 * string that looks fine on the machine that wrote it. Eleven call sites shipped
 * with `undefined` as the locale and nobody noticed for months, because everyone
 * who looked at them was on an `en-GB` machine — the bug only exists on somebody
 * else's computer, which is exactly the kind of bug a test is for.
 *
 * So the assertions here are about **pinning**, not about `Intl` working:
 *
 * - the separator is a comma, not a narrow no-break space
 * - the month is August, not août
 * - a date near midnight stays on the UTC day, whatever the runner's timezone is
 * - the clock is 24-hour, whichever `en-GB` hour cycle this ICU build defaults to
 *
 * A note on how exact the date assertions are. The date *components* are ours
 * and are asserted exactly; the punctuation joining them belongs to CLDR and can
 * legitimately change between ICU releases. Asserting a comma-space between the
 * year and the hour would be testing Unicode's data rather than our code, and
 * would eventually fail on a Node upgrade for no reason anybody could act on.
 */

import { describe, expect, it } from "vitest";
import {
  EMPTY,
  LOCALE,
  TIME_ZONE,
  clock,
  count,
  date,
  dateTime,
  duration,
  list,
  num,
  ordinal,
  percent,
  plural,
  quantity,
  relative,
  signed,
  time,
} from "../src/ui/format";

/** Late on the 7th in UTC — the 8th anywhere east of about UTC+1. */
const LATE_ON_THE_SEVENTH = Date.UTC(2026, 7, 7, 23, 30, 0);
const AFTERNOON = Date.UTC(2026, 7, 7, 14, 5, 0);

describe("the pins themselves", () => {
  it("is en-GB, in UTC", () => {
    expect(LOCALE).toBe("en-GB");
    expect(TIME_ZONE).toBe("UTC");
  });
});

// ---------------------------------------------------------------------------

describe("num", () => {
  it("groups with a comma, which is the whole point", () => {
    expect(num(1234)).toBe("1,234");
    expect(num(12437)).toBe("12,437");
    expect(num(1234567)).toBe("1,234,567");
  });

  it("leaves small numbers alone", () => {
    expect(num(0)).toBe("0");
    expect(num(7)).toBe("7");
  });

  it("keeps a fractional part and a sign", () => {
    expect(num(1234.5)).toBe("1,234.5");
    expect(num(-1234.5)).toBe("-1,234.5");
  });

  it("prints a dash rather than NaN, so a bug upstream is not a crash on screen", () => {
    expect(num(Number.NaN)).toBe(EMPTY);
    expect(num(Number.POSITIVE_INFINITY)).toBe(EMPTY);
    expect(num(Number.NEGATIVE_INFINITY)).toBe(EMPTY);
  });

  it("takes an options override without losing the locale", () => {
    expect(num(1234.567, { maximumFractionDigits: 1 })).toBe("1,234.6");
    expect(num(1234, { useGrouping: false })).toBe("1234");
  });
});

describe("count", () => {
  it("cannot leak a decimal, however it was arrived at", () => {
    expect(count(2.6)).toBe("3");
    expect(count(1234.4)).toBe("1,234");
    expect(count(8 / 3)).toBe("3");
  });

  it("groups like num does", () => {
    expect(count(1200)).toBe("1,200");
  });

  it("dashes on non-finite input", () => {
    expect(count(Number.NaN)).toBe(EMPTY);
  });
});

describe("signed", () => {
  it("always shows the sign except on zero", () => {
    expect(signed(12)).toBe("+12");
    expect(signed(-3)).toBe("-3");
    expect(signed(0)).toBe("0");
  });

  it("still groups", () => {
    expect(signed(2400)).toBe("+2,400");
  });
});

describe("percent", () => {
  it("takes a 0-1 fraction, not a 0-100 one", () => {
    expect(percent(0.42)).toBe("42%");
    expect(percent(1)).toBe("100%");
    expect(percent(0)).toBe("0%");
  });

  it("rounds to whole percentages by default and to the places asked for", () => {
    expect(percent(0.4256)).toBe("43%");
    expect(percent(0.4256, 1)).toBe("42.6%");
  });

  it("dashes on non-finite input", () => {
    expect(percent(Number.NaN)).toBe(EMPTY);
  });
});

describe("ordinal", () => {
  it("gets the ordinary cases right", () => {
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(3)).toBe("3rd");
    expect(ordinal(4)).toBe("4th");
  });

  it("gets 11, 12 and 13 right, which is where hand-rolled versions break", () => {
    expect(ordinal(11)).toBe("11th");
    expect(ordinal(12)).toBe("12th");
    expect(ordinal(13)).toBe("13th");
    expect(ordinal(21)).toBe("21st");
    expect(ordinal(112)).toBe("112th");
  });

  it("groups a big placing", () => {
    expect(ordinal(1021)).toBe("1,021st");
  });
});

// ---------------------------------------------------------------------------

describe("plural", () => {
  it("picks singular for one and plural for everything else", () => {
    expect(plural(1, "card")).toBe("card");
    expect(plural(0, "card")).toBe("cards");
    expect(plural(2, "card")).toBe("cards");
    expect(plural(1.5, "card")).toBe("cards");
  });

  it("takes an irregular plural when the default s will not do", () => {
    expect(plural(1, "victory", "victories")).toBe("victory");
    expect(plural(3, "victory", "victories")).toBe("victories");
  });

  it("treats a non-finite count as a plural rather than throwing", () => {
    expect(plural(Number.NaN, "card")).toBe("cards");
  });
});

describe("quantity", () => {
  it("is the number and the noun, grouped", () => {
    expect(quantity(1, "card")).toBe("1 card");
    expect(quantity(0, "card")).toBe("0 cards");
    expect(quantity(1200, "card")).toBe("1,200 cards");
    expect(quantity(2, "victory", "victories")).toBe("2 victories");
  });
});

describe("list", () => {
  it("joins with an and, including the awkward lengths", () => {
    expect(list([])).toBe("");
    expect(list(["Cinder"])).toBe("Cinder");
    expect(list(["Cinder", "Static"])).toBe("Cinder and Static");
    expect(list(["Cinder", "Static", "Bloom"])).toBe("Cinder, Static and Bloom");
  });

  it("joins with an or when asked", () => {
    expect(list(["Cinder", "Static"], "or")).toBe("Cinder or Static");
  });
});

// ---------------------------------------------------------------------------

describe("date", () => {
  it("writes the month out in English", () => {
    expect(date(Date.UTC(2026, 7, 7))).toBe("7 August 2026");
    expect(date(Date.UTC(2026, 0, 1))).toBe("1 January 2026");
  });

  it("stays on the UTC day near midnight, whatever timezone the runner is in", () => {
    // The load-bearing assertion in this file. Without the pin this is the 8th
    // on any machine east of roughly UTC+1, and a season deadline shown to two
    // players would disagree by a day.
    expect(date(LATE_ON_THE_SEVENTH)).toBe("7 August 2026");
  });

  it("accepts a Date, a timestamp and an ISO string alike", () => {
    expect(date(new Date(LATE_ON_THE_SEVENTH))).toBe("7 August 2026");
    expect(date("2026-08-07T23:30:00Z")).toBe("7 August 2026");
  });

  it("varies one component and keeps the rest", () => {
    expect(date(LATE_ON_THE_SEVENTH, { month: "short" })).toBe("7 Aug 2026");
  });

  it("dashes rather than throwing on an unparseable instant", () => {
    // `Intl.DateTimeFormat.format` throws a RangeError on an invalid date, and
    // these are called from render paths.
    expect(date(Number.NaN)).toBe(EMPTY);
    expect(date("not a date")).toBe(EMPTY);
    expect(date(new Date("nonsense"))).toBe(EMPTY);
  });
});

describe("dateTime", () => {
  it("carries the UTC day and a 24-hour clock", () => {
    const printed = dateTime(LATE_ON_THE_SEVENTH);
    expect(printed).toContain("7 Aug 2026");
    expect(printed).toContain("23:30");
  });

  it("can lead with a weekday", () => {
    expect(dateTime(LATE_ON_THE_SEVENTH, { weekday: "short" })).toContain("Fri");
  });

  it("dashes on an unparseable instant", () => {
    expect(dateTime(Number.NaN)).toBe(EMPTY);
  });
});

describe("time", () => {
  it("is 24-hour, whichever way this ICU build leans", () => {
    // `en-GB` has been both h12 and h23 across ICU releases; `hourCycle` is
    // pinned so a Node upgrade cannot start printing "2:05 pm" mid-sentence.
    expect(time(AFTERNOON)).toBe("14:05");
    expect(time(LATE_ON_THE_SEVENTH)).toBe("23:30");
    expect(time(Date.UTC(2026, 7, 7, 9, 0))).toBe("09:00");
  });
});

describe("relative", () => {
  const now = Date.UTC(2026, 7, 7, 12, 0, 0);

  it("names the nearest unit", () => {
    expect(relative(now - 3 * 3_600_000, now)).toBe("3 hours ago");
    expect(relative(now - 20 * 60_000, now)).toBe("20 minutes ago");
  });

  it("uses the words English has for one unit away", () => {
    expect(relative(now - 86_400_000, now)).toBe("yesterday");
    expect(relative(now + 86_400_000, now)).toBe("tomorrow");
  });

  it("looks forward as readily as back", () => {
    expect(relative(now + 2 * 86_400_000, now)).toBe("in 2 days");
  });

  it("says just now rather than in 0 seconds", () => {
    expect(relative(now - 5_000, now)).toBe("just now");
    expect(relative(now, now)).toBe("just now");
  });

  it("dashes on an unparseable instant", () => {
    expect(relative("nonsense", now)).toBe(EMPTY);
  });
});

// ---------------------------------------------------------------------------

describe("duration", () => {
  const MINUTE = 60_000;
  const HOUR = 3_600_000;
  const DAY = 86_400_000;

  it("prints two units from the largest non-zero one", () => {
    expect(duration(2 * DAY + 4 * HOUR)).toBe("2 days, 4 hours");
    expect(duration(HOUR + 2 * MINUTE)).toBe("1 hour, 2 minutes");
    expect(duration(90_000)).toBe("1 minute, 30 seconds");
  });

  it("drops a zero unit rather than printing 0 hours", () => {
    expect(duration(3 * DAY)).toBe("3 days");
    expect(duration(HOUR)).toBe("1 hour");
  });

  it("floors, because overstating a deadline is the one error a deadline must not make", () => {
    expect(duration(119_000)).toBe("1 minute, 59 seconds");
    expect(duration(2 * HOUR - 1)).toBe("1 hour, 59 minutes");
  });

  it("singularises", () => {
    expect(duration(DAY + HOUR)).toBe("1 day, 1 hour");
    expect(duration(1_000)).toBe("1 second");
  });

  it("can be held to one unit for a tight row", () => {
    expect(duration(90_000, { units: 1 })).toBe("1 minute");
    expect(duration(2 * DAY + 4 * HOUR, { units: 1 })).toBe("2 days");
  });

  it("clamps a negative span to zero rather than printing a past deadline", () => {
    expect(duration(-5_000)).toBe("0 seconds");
    expect(duration(0)).toBe("0 seconds");
  });

  it("dashes on non-finite input", () => {
    expect(duration(Number.NaN)).toBe(EMPTY);
  });
});

describe("clock", () => {
  it("keeps the seconds two digits so the width never changes", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(7_000)).toBe("0:07");
    expect(clock(90_000)).toBe("1:30");
    expect(clock(600_000)).toBe("10:00");
  });

  it("shows hours only when there are hours", () => {
    expect(clock(3_723_000)).toBe("1:02:03");
    expect(clock(3_599_000)).toBe("59:59");
  });

  it("floors, so a rope reads 0:00 through its final second", () => {
    expect(clock(59_999)).toBe("0:59");
    expect(clock(999)).toBe("0:00");
  });

  it("clamps and dashes at the edges", () => {
    expect(clock(-100)).toBe("0:00");
    expect(clock(Number.NaN)).toBe(EMPTY);
  });
});
