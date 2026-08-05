/**
 * Under reduced motion, the reward screens hold still. All of them. Everywhere.
 *
 * §3 makes this a hard requirement rather than a nicety — *"prefers-reduced-motion
 * must kill the decorative layer and keep the functional one"* — and the way it
 * fails is by attrition. The domain's stylesheet had a reduced-motion block, and
 * it worked, and it was written as a **list of selectors**: the pack, the hint,
 * the hero's atmosphere plane, four breathes. Two decorative loops were simply
 * never added to it, and the result was worse than either state on its own — a
 * shop pack frozen perfectly still above a contact shadow that kept pulsing and
 * scaling underneath it, and a hero glow drifting behind static type. Measured
 * with `getAnimations()` under `prefers-reduced-motion: reduce`: six animations
 * still running at rest, two of them this domain's own.
 *
 * A list cannot be trusted to stay complete, so this asserts the outcome instead
 * of the list. Mount each of the five routes with the setting on, let everything
 * settle, and fail if **anything** is still animating.
 *
 * ## What is allowed to move, and why the allowance is narrow
 *
 * `atmosphere.ts` owns the persistent world behind every screen, and it is
 * module E's to answer for rather than this domain's — it is also, deliberately,
 * the one thing that is never unmounted, so it is not "on" the route under test.
 * Everything with an `atm-` class is therefore excluded by name.
 *
 * Nothing else is. In particular there is no allowance for "it is only a small
 * one": a two-pixel contact shadow breathing under a still object is exactly the
 * defect this file was written after.
 *
 * ## The instrument
 *
 * The same bargain `never-a-blank-frame.test.ts` strikes: a real browser against
 * the running dev server, an honest skip where there is neither, and one
 * unconditional assertion so the skip cannot go unnoticed.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { chromium, type Browser } from "playwright-core";

const ORIGIN = "http://localhost:5173";

const BROWSERS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

async function unavailable(): Promise<string | null> {
  if (BROWSERS.find((path) => existsSync(path)) === undefined) return "no Chrome or Edge on this machine";
  try {
    const response = await fetch(ORIGIN, { signal: AbortSignal.timeout(2500) });
    if (!response.ok) return `the dev server answered ${response.status}`;
  } catch {
    return `nothing is serving ${ORIGIN}`;
  }
  return null;
}

const REASON = await unavailable();
const OPTED_OUT = process.env["CI"] !== undefined || process.env["HYPEBOUND_NO_BROWSER"] !== undefined;

describe("the instrument", () => {
  it("is plugged in, or the environment has said it will not be", () => {
    expect(
      REASON === null || OPTED_OUT,
      `${REASON}. This suite drives the running dev server with a real browser; start ` +
        `\`npm run dev\` and re-run, or set HYPEBOUND_NO_BROWSER=1 to opt out deliberately.`
    ).toBe(true);
  });
});

/** The five the rewards domain owns, by hash route. */
const ROUTES = ["shop", "banner", "pass", "missions", "achievements"] as const;

/**
 * How long after arrival to look.
 *
 * Long enough for the entrance to be over and for the deferred art queue in
 * `rewardArt.ts` to have delivered — a picture crossfading in is an animation,
 * and one that is still running when the probe reads would be a false failure
 * on a real screen. Everything this test is hunting is `infinite`, so waiting
 * longer can only make the answer more honest.
 */
const SETTLE_MS = 3200;

let browser: Browser | null = null;

beforeAll(async () => {
  if (REASON !== null) return;
  const executablePath = BROWSERS.find((path) => existsSync(path));
  browser = await chromium.launch({
    ...(executablePath === undefined ? {} : { executablePath }),
    headless: true,
    args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
  });
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

describe.skipIf(REASON !== null)("reduced motion", () => {
  for (const route of ROUTES) {
    it(
      `leaves nothing moving on #${route}`,
      async () => {
        const page = await browser!.newPage({
          viewport: { width: 1600, height: 900 },
          reducedMotion: "reduce",
        });
        try {
          await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" });
          await page
            .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20_000 })
            .catch(() => {});
          await page.waitForTimeout(SETTLE_MS);

          const flag = await page.evaluate(() => document.documentElement.dataset["reducedMotion"]);
          expect(flag, "the setting never reached the document").toBe("true");

          const moving = await page.evaluate(() => {
            const describe_ = (animation: Animation): string => {
              const effect = animation.effect as KeyframeEffect | null;
              const target = effect?.target ?? null;
              const name = (animation as unknown as { animationName?: string }).animationName ?? animation.id ?? "?";
              const where =
                target === null
                  ? "(no target)"
                  : `${target.tagName.toLowerCase()}.${[...target.classList].join(".")}${effect?.pseudoElement ?? ""}`;
              return `${name} on ${where}`;
            };
            return document
              .getAnimations()
              .filter((animation) => animation.playState === "running")
              .filter((animation) => {
                const target = (animation.effect as KeyframeEffect | null)?.target ?? null;
                if (target === null) return true;
                // The persistent world behind every screen belongs to module E.
                return target.closest('[class*="atm-"]') === null;
              })
              .map(describe_);
          });

          expect(moving, `still animating on #${route}:\n  ${moving.join("\n  ")}`).toEqual([]);
        } finally {
          await page.close();
        }
      },
      90_000
    );
  }
});
