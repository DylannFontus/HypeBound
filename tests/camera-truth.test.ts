/**
 * A test on the measuring instrument is worth more than a test on any feature.
 *
 * `scripts/shot.mjs` is how every visual decision in this project is reviewed.
 * Twice now it has told a reviewer something confidently untrue, and both times
 * the reviewer believed it, wrote it down, and scored against it.
 *
 * **`--use-gl=angle --use-angle=swiftshader`.** Copied in from the `verify-*`
 * scripts, which carry them because a CI box has no GPU. On a machine that does,
 * they force compositing through a software rasteriser: measured on the lobby,
 * 1.6fps and 3337ms per screenshot against 75.2fps and 322ms with them gone. At
 * 1.6fps a `--frames 12x35` burst samples about one frame per 500ms of a 380ms
 * transition, so three consecutive rounds of motion review saw frame 0 as the
 * full outgoing screen and frame 1 as the fully settled destination, concluded
 * "consecutive frames are identical, nothing animates", and marked the work
 * down. The animations were fine. The camera could not see them. Four review
 * rounds were spent on that.
 *
 * **`--hide-scrollbars`.** Playwright passes it to every Chromium it launches,
 * on the reasonable grounds that a scrollbar is chrome rather than content. §7
 * of the AAA bar asks for a scrollbar styled to match and `foundation.css` draws
 * one. With the flag on, every screenshot of every route reported a scroller
 * gutter of 0–2px and painted nothing on its right edge, and a review concluded
 * — reasonably, from the evidence in front of it — that forty lines of scrollbar
 * CSS were dead code. They were not.
 *
 * Neither was a bug in the game. Both were bugs in the instrument, both produced
 * a confident wrong answer rather than an error, and both are one careless
 * copy-paste from returning: the flags still live, correctly, in eighteen
 * `verify-*.mjs` files, and this file is the only thing standing between them
 * and the camera.
 *
 * ## Why this reads the launch call rather than the file
 *
 * The file talks about the flags at length — it has to, or the next person to
 * "tidy up the browser arguments" reintroduces them. A test that searched the
 * source text for `--use-gl=angle` would therefore fail on the explanation and
 * pass on the defect, which is the same class of mistake it is guarding
 * against. So the comments come off first and the assertions are made against
 * the arguments of the `chromium.launch()` call itself.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function source(): string {
  return readFileSync(fileURLToPath(new URL("../scripts/shot.mjs", import.meta.url)), "utf8");
}

/**
 * JavaScript with its comments blanked, offsets preserved.
 *
 * Quotes and template literals are tracked so that a `//` inside a string
 * survives; regular-expression literals are not, because the only two in this
 * file are character classes and neither contains a comment delimiter. If that
 * ever changes the `still launches a browser at all` test below goes red rather
 * than quiet, which is the direction that matters.
 */
function stripComments(js: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < js.length) {
    const c = js[i] as string;
    const next = js[i + 1];
    if (quote !== null) {
      out += c;
      if (c === "\\") {
        out += next ?? "";
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < js.length && js[i] !== "\n") {
        out += " ";
        i += 1;
      }
      continue;
    }
    if (c === "/" && next === "*") {
      const end = js.indexOf("*/", i + 2);
      const stop = end === -1 ? js.length : end + 2;
      out += js.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** The text between the parentheses of `chromium.launch(` … `)`. */
function launchOptions(): string {
  const code = stripComments(source());
  const at = code.indexOf("chromium.launch(");
  expect(at, "scripts/shot.mjs must still launch a browser through playwright").toBeGreaterThan(-1);
  let depth = 0;
  let i = at + "chromium.launch".length;
  const start = i + 1;
  for (; i < code.length; i += 1) {
    if (code[i] === "(") depth += 1;
    else if (code[i] === ")") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return code.slice(start, i);
}

/**
 * Every flag that puts the camera back on a software rasteriser.
 *
 * `--enable-unsafe-swiftshader` is deliberately absent from this list and
 * asserted for below: it *permits* the fallback rather than forcing it, so
 * Chrome still uses the GPU when there is one and still renders the three.js
 * battle route when there is not. The two are one word apart and they are
 * opposites.
 */
const SOFTWARE_RENDERING = [
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--use-gl=swiftshader",
  "--disable-gpu",
  "--disable-gpu-compositing",
  "--disable-accelerated-2d-canvas",
];

describe("the camera tells the truth", () => {
  it("still exists and still launches a browser", () => {
    // Everything below asserts on the *absence* of things, and an absence is
    // trivially satisfied by a file that has been deleted, renamed or rewritten
    // to do nothing. This is the assertion that stops the rest being vacuous.
    const options = launchOptions();
    expect(options).toContain("args:");
    expect(options).toContain("executablePath");
    expect(source()).toContain("--frames");
  });

  it("never forces compositing through software GL", () => {
    const options = launchOptions();
    const reintroduced = SOFTWARE_RENDERING.filter((flag) => options.includes(flag));
    expect(
      reintroduced,
      "measured at 1.6fps against 75.2fps; it is why three rounds of motion review saw nothing move"
    ).toEqual([]);
  });

  it("keeps the flag that permits the fallback without forcing it", () => {
    // Without this the battle route cannot render at all on a machine with no
    // GPU, and the correct fix for that is not the two flags above.
    expect(launchOptions()).toContain("--enable-unsafe-swiftshader");
  });

  it("still tells Playwright not to hide the scrollbars", () => {
    const options = launchOptions();
    expect(
      /ignoreDefaultArgs:\s*\[[^\]]*"--hide-scrollbars"[^\]]*\]/.test(options),
      "foundation.css §7 draws a scrollbar; with Playwright's default flag on, a review " +
        "measured a 0-2px gutter on every route and concluded the CSS was dead"
    ).toBe(true);
    // `true` would drop *every* default argument, including the ones Playwright
    // needs to drive the browser at all. The opt-out has to be the one flag.
    expect(/ignoreDefaultArgs:\s*true/.test(options)).toBe(false);
  });

  /**
   * The two decisions have to stay explained where the code is.
   *
   * Both flags arrived here by copying, from files where they are correct. The
   * only durable defence against that happening again is a comment on the
   * launch call saying why this one is different — and the only durable defence
   * against the comment being deleted in a tidy-up is this assertion.
   */
  it("keeps the reasoning attached to the launch call", () => {
    const js = source();
    const at = js.indexOf("chromium.launch(");
    const preamble = js.slice(Math.max(0, at - 4000), at);
    expect(preamble).toContain("--use-angle=swiftshader");
    expect(preamble).toContain("--hide-scrollbars");
  });

  /**
   * And nothing outside the explanation may name them.
   *
   * A helper that assembled the argument list somewhere else in the file would
   * slip past `launchOptions()` entirely, so the whole of the code — comments
   * blanked — is checked as well.
   */
  it("names no software-GL flag anywhere in its code", () => {
    const code = stripComments(source());
    const found = SOFTWARE_RENDERING.filter((flag) => code.includes(flag));
    expect(found).toEqual([]);
  });

  /**
   * The camera has one more instrument-level promise: it waits for the shell to
   * finish swapping screens before it fires. Without it a burst catches two
   * screens stacked on top of each other, which has been read as a broken
   * layout more than once.
   */
  it("still waits for the screen swap before it fires", () => {
    const code = stripComments(source());
    expect(code).toContain("screen-out");
    expect(code).toContain("waitForFunction");
  });
});
