/**
 * What edge treatment does this thing *actually* carry?
 *
 * §1 bans "a `border: 1px solid` as the only edge treatment", and the eye cannot
 * tell a bordered button with an inset rim from one without at a glance — which
 * is how a criticism of the deck builder's action pills survived three reviews
 * without anybody checking whether the pills were outline-only or merely *look*
 * flat because the row above them is a hero. This prints the computed
 * background, border, shadow and radius for any selector on any route, so the
 * next such claim can be settled in twenty seconds rather than argued.
 *
 *   node scripts/_r7_edge.mjs deckbuilder ".builder-actions .btn"
 *   node scripts/_r7_edge.mjs lab ".lab-group" 1280x720
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";
const argv = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? true);
};
const positional = argv.filter((a, i) => !a.startsWith("--") && !String(argv[i - 1] ?? "").startsWith("--"));
const [route, sel, size] = positional;
if (!route || !sel) {
  console.error(
    "usage: node scripts/_r7_edge.mjs <route> <selector> [WxH] [--battle] [--click <sel>] [--shot <file>]"
  );
  process.exit(1);
}
const [w, h] = (size ?? "1600x900").split("x").map(Number);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: w, height: h } });
await seedPlayedAccount(page, ORIGIN);
await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" });
await page
  .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 })
  .catch(() => {});

/**
 * `--battle` drives the mulligan and waits for a live board, and `--click`
 * opens whatever the question is about. The two in-battle modals exist for
 * about a third of a second in normal play and are therefore the surfaces
 * nobody has ever photographed; without this, a claim about them can only be
 * checked by reading the class list, which is exactly how a panel that renders
 * as a material got reported as a legacy one.
 */
if (argv.includes("--battle")) {
  await page.waitForSelector(".mulligan-panel", { timeout: 25000 }).catch(() => {});
  const keep = page.locator(".mulligan-actions .btn-primary");
  if (await keep.count()) await keep.first().click().catch(() => {});
  await page
    .waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 30000 })
    .catch(() => {});
}
const click = opt("click");
if (click) {
  await page.locator(String(click)).first().click({ timeout: 8000 }).catch((e) => console.error("click:", e.message));
}
await page.waitForTimeout(1200);

const out = await page.evaluate((s) => {
  return [...document.querySelectorAll(s)].map((e) => {
    const c = getComputedStyle(e);
    const b = e.getBoundingClientRect();
    return {
      text: (e.textContent || "").trim().slice(0, 22),
      cls: String(e.className).slice(0, 70),
      box: `${Math.round(b.width)}x${Math.round(b.height)} @${Math.round(b.left)},${Math.round(b.top)}`,
      bgImage: c.backgroundImage.slice(0, 70),
      bgColor: c.backgroundColor,
      border: `${c.borderTopWidth} ${c.borderTopStyle} ${c.borderTopColor}`,
      shadow: c.boxShadow.slice(0, 120),
      radius: c.borderRadius,
      bottomOverflow: Math.round(b.bottom - window.innerHeight),
      /**
       * The cascade, from the element rather than from a screenshot.
       *
       * `stagger()` writes `--enter-delay` and the keyframe lives on `.d-enter`;
       * a screen can have one without the other and the result is a stagger
       * that animates nothing — which is what the Custom Lobby had. A burst of
       * stills cannot tell that apart from a fast entrance, because each
       * `page.screenshot` costs longer than the animation. The delay and the
       * animation name together can.
       */
      anim: `${c.animationName} delay=${c.animationDelay} dur=${c.animationDuration}`,
      enterDelay: c.getPropertyValue("--enter-delay").trim() || "(unset)",
    };
  });
}, sel);
console.log(JSON.stringify(out, null, 1));

const shot = opt("shot");
if (shot) {
  mkdirSync(path.dirname(String(shot)), { recursive: true });
  await page.screenshot({ path: String(shot) });
  console.error(`wrote ${shot}`);
}
await browser.close();
