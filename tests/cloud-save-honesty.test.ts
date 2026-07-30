/**
 * The page must not promise the opposite of what the build does.
 *
 * This test exists because the mistake it catches was already made — not
 * carelessly, but by time passing. Every sentence removed from the sign-in
 * screen and the privacy policy in this change was **true when it was written**:
 * there genuinely was no cloud save, the display name genuinely never left the
 * device, and the local delete genuinely could not be undone. A feature shipped
 * and four separate sentences became lies without anybody editing them.
 *
 * So the guard is not "did somebody write something false" — nobody ever means
 * to. It is "does a claim of absence still hold, given what is in the source".
 * The trigger is the existence of `src/save/cloudSaves.ts`; delete that file and
 * these assertions invert, which is the correct behaviour for a page whose job
 * is to describe the build it ships with.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { policiesData } from "../src/game/policies";
import { stripComments } from "./helpers/source";

const read = (relative: string): string => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const exists = (relative: string): boolean => existsSync(fileURLToPath(new URL(relative, import.meta.url)));

/** The feature's presence is what makes the claims false, so it is the premise. */
const CLOUD_SAVES_SHIP = exists("../src/save/cloudSaves.ts");

const privacyText = (): string =>
  [
    ...policiesData().privacy.summary,
    ...policiesData().privacy.requests,
    ...policiesData().privacy.categories.map((category) => `${category.detail} ${category.where ?? ""}`),
  ]
    .join("\n")
    .toLowerCase();

describe("the privacy page describes the build it ships with", () => {
  it("does not say there is no cloud save while there is one", () => {
    expect(CLOUD_SAVES_SHIP, "this test's premise").toBe(true);

    /**
     * Phrased as "claims of absence" rather than as a keyword ban. The page is
     * *required* to talk about cloud saves — it has to say what is uploaded —
     * so searching for the words would fail on the paragraph that fixes the
     * problem. What must not survive is a sentence asserting there is none.
     */
    const denials = [
      "there is no cloud save",
      "there is still no cloud save",
      "no cloud copy to restore",
      "gives you an account, not your collection",
      "gives you an account, not your cards",
    ];
    const text = privacyText();
    for (const denial of denials) {
      expect(text, `privacy policy still says: "${denial}"`).not.toContain(denial);
    }
  });

  it("says what is uploaded, rather than only that something is", () => {
    // A page that says "your save syncs" and stops has told the player nothing
    // they can act on. These are the contents a person would want named.
    const text = privacyText();
    for (const named of ["collection", "decks", "display name", "match history"]) {
      expect(text, `the policy never mentions ${named}`).toContain(named);
    }
  });

  it("admits the uploaded copy is readable by whoever runs the server", () => {
    /**
     * The single most tempting thing to leave out. The server stores saves
     * opaquely and never parses one, which sounds like a privacy guarantee and
     * is not — it is an architecture note. Anyone with access to the storage
     * can read a save, and the page has to say so rather than let "opaque" do
     * misleading work.
     */
    const text = privacyText();
    expect(text).toMatch(/not encrypted|can read it|readable/);
  });

  it("still says the things that remain true", () => {
    const text = privacyText();
    expect(text, "the no-analytics claim went missing").toMatch(/no analytics/);
    expect(text, "the no-payments claim went missing").toMatch(/no payment|takes no payments/);
    expect(text, "offline play still transmits nothing, and should still say so").toMatch(/offline play transmits nothing/);
  });
});

describe("the sign-in screen describes the build it ships with", () => {
  /**
   * The prose, with markup and line breaks taken out.
   *
   * The claim lives in the words a player reads, and in the source those words
   * are interrupted by `<strong>` tags and by wherever the line happened to
   * wrap. Matching raw source makes the test fail when somebody reflows a
   * paragraph, which trains people to weaken it.
   */
  const prose = (): string =>
    stripComments(read("../src/ui/screens/signInScreen.ts"))
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .toLowerCase();

  it("no longer tells the player their save stays on this device", () => {
    const text = prose();
    for (const denial of ["there is no cloud save", "an account, not your cards", "signing in somewhere else gives you an account"]) {
      expect(text, `sign-in screen still says: "${denial}"`).not.toContain(denial);
    }
  });

  it("names what gets uploaded before asking for an email address", () => {
    const text = prose();
    expect(text).toContain("what gets uploaded");
    expect(text, "the screen does not admit the upload is readable by the server").toContain("not encrypted");
  });
});

describe("deleting an account reaches the save", () => {
  it("deletes both objects, and does not short-circuit on the first failure", () => {
    /**
     * `await erase(a) && await erase(b)` would skip the save entirely whenever
     * the record delete failed, leaving the larger of the two behind while
     * honestly reporting a failure. The fix is `Promise.all`, and its absence
     * is invisible in any test that lets both calls succeed.
     */
    const source = stripComments(read("../src/net/playerRecord.ts"));
    expect(source).toContain("/me/saves");
    expect(source).toContain("Promise.all");
  });

  it("is described by the privacy screen as covering the save", () => {
    const source = stripComments(read("../src/ui/screens/privacyScreen.ts")).toLowerCase();
    expect(source, "the delete-account prompt does not mention the uploaded save").toMatch(
      /copy of your save held on the server|uploaded save/
    );
  });
});
