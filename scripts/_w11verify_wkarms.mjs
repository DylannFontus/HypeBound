/**
 * Is the thing that pins WebKit the compositing load the iPad fix went after?
 *
 * `_w11verify_wkwhy.mjs` established that every HYPEBOUND route runs at 0.8-1.1
 * fps in Playwright's WebKit while a blank page in the same context runs at 63,
 * with **no WebGL context anywhere** and the document visible — so it is not the
 * renderer and it is not rAF throttling. The remaining candidate is the one the
 * wave-10 work named: the full-bleed composited surfaces that
 * `transitions.css` and `atmosphere.ts` create on every screen.
 *
 * That is a hypothesis with an experiment attached, and nobody ran it. This
 * runs it, on the plainest route in the game (`#fairness` is a text document),
 * so nothing else can be blamed:
 *
 *   A. as shipped
 *   B. reduced motion — which, after this pass, also releases `will-change`
 *   C. the atmosphere element detached entirely
 *   D. every animation and every `will-change` in the document killed outright
 *
 * If D is fast and A is not, the cause is compositing and the fix is on the
 * right axis but has not gone far enough. If D is also slow, the cause is
 * something else entirely and the wave-10 attribution is wrong.
 *
 * The arms run in one browser, one context, one page, in sequence, and A is
 * measured again at the end — because a monotonic slowdown across a long run
 * would otherwise read as an arm being fast.
 */
import { webkit } from "playwright-core";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const ROUTE = "fairness";

const COUNT = (ms) => `
  (() => new Promise((resolve) => {
    let frames = 0, worst = 0, last = performance.now();
    const t0 = last;
    const tick = () => {
      const now = performance.now();
      worst = Math.max(worst, now - last);
      last = now;
      frames++;
      if (now - t0 < ${ms}) requestAnimationFrame(tick);
      else resolve({ fps: +(frames / ((now - t0) / 1000)).toFixed(1), worstGapMs: Math.round(worst) });
    };
    requestAnimationFrame(tick);
  }))()`;

const browser = await webkit.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, hasTouch: true });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("  page error:", e.message.slice(0, 120)));

await page.setContent("<h1>control</h1>");
console.log("control (blank page)        " + JSON.stringify(await page.evaluate(COUNT(1000))));

await seedPlayedAccount(page);

const land = async () => {
  await page.goto(`${ORIGIN}/#${ROUTE}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
};

const arm = async (label, prepare, argument) => {
  await land();
  if (prepare) await page.evaluate(prepare, argument);
  await page.waitForTimeout(1200);
  const r = await page.evaluate(COUNT(2000));
  console.log(`${label.padEnd(28)}${JSON.stringify(r)}`);
};

await arm("A. as shipped", null);

await page.emulateMedia({ reducedMotion: "reduce" });
await arm("B. reduced motion", null);
await page.emulateMedia({ reducedMotion: "no-preference" });

await arm("C. atmosphere detached", () => {
  document.querySelectorAll(".atmosphere").forEach((n) => n.remove());
});

await arm("D. no animation, no layers", () => {
  const style = document.createElement("style");
  style.textContent = `*, *::before, *::after {
    animation: none !important;
    transition: none !important;
    will-change: auto !important;
    filter: none !important;
    backdrop-filter: none !important;
  }`;
  document.head.appendChild(style);
});


/** Closures do not cross into the page, so the rule travels as an argument. */
const only = (label, css) =>
  arm(
    label,
    (rule) => {
      const style = document.createElement("style");
      style.textContent = rule;
      document.head.appendChild(style);
    },
    css
  );

await only("E. animation:none only", `*,*::before,*::after{animation:none !important}`);
await only("F. will-change:auto only", `*,*::before,*::after{will-change:auto !important}`);
await only("G. filter:none only", `*,*::before,*::after{filter:none !important;backdrop-filter:none !important}`);
await only("H. transition:none only", `*,*::before,*::after{transition:none !important}`);

/**
 * B above emulated . Almost every reduced-motion rule
 * in this project keys on  instead, written
 * from the in-game setting — so B says what a Safari user with the OS switch on
 * gets, and this says what the game's own setting gets. They are not the same
 * claim and reporting one as the other would be its own instrument error.
 */
await arm("I. data-reduced-motion attr", () => {
  document.documentElement.setAttribute("data-reduced-motion", "true");
});

await arm("A again (drift check)", null);

await browser.close();
