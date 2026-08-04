/**
 * Measure the data screens rather than squinting at them.
 *
 * A screenshot answers "does this look right"; it does not answer "is this
 * panel's padding zero", "did a native Windows widget survive here", "is the
 * content column the same width as it was on the previous screen" or "how much
 * of the frame is empty". Four review rounds were spent guessing at those from
 * pixels. This asks the page.
 *
 * Reports, per route: panels whose contents touch their own border, anything
 * painted outside the viewport, form controls still wearing the OS appearance,
 * the container measure, text clipped by its own box, Unicode used as an icon,
 * and where the lowest painted content sits in the frame.
 *
 *   node scripts/probe/data-screens.mjs profile mastery events
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "../lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const args = process.argv.slice(2);
const sizeArg = args.find((a) => /^\d+x\d+$/.test(a));
const ROUTES = args.filter((a) => a !== sizeArg);
const [width, height] = (sizeArg ?? "1600x900").split("x").map(Number);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width, height } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));

await seedPlayedAccount(page, ORIGIN);

const probe = () => {
  const out = { padless: [], overflow: [], native: [], measure: null, bottom: null, clipped: [], glyphs: [] };
  const screen = document.querySelector(".screen");
  if (!screen) return out;

  for (const el of screen.querySelectorAll(".panel, .mat-panel, .mat-hero, .mat-well")) {
    const cs = getComputedStyle(el);
    const pad = Math.min(
      parseFloat(cs.paddingLeft),
      parseFloat(cs.paddingRight),
      parseFloat(cs.paddingTop),
      parseFloat(cs.paddingBottom)
    );
    const r = el.getBoundingClientRect();
    if (pad < 6 && r.width > 260 && r.height > 60 && cs.overflow === "visible") {
      out.padless.push(
        `${String(el.className).slice(0, 52)} pad=${pad} ${Math.round(r.width)}x${Math.round(r.height)}`
      );
    }
  }

  for (const el of screen.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width > 4 && (r.left < -2 || r.right > innerWidth + 2)) {
      out.overflow.push(`${el.tagName}.${String(el.className).slice(0, 42)} L${Math.round(r.left)} R${Math.round(r.right)}`);
    }
  }
  out.overflow = out.overflow.slice(0, 6);

  for (const el of screen.querySelectorAll("select, input, textarea, progress, meter")) {
    const cs = getComputedStyle(el);
    const app = cs.appearance || cs.webkitAppearance;
    if (app !== "none") out.native.push(`${el.tagName}[${el.type ?? ""}] appearance=${app} cls=${String(el.className).slice(0, 26)}`);
  }
  out.native = [...new Set(out.native)];

  const body = screen.querySelector(".data-body") ?? screen.querySelector("[class*='-body']");
  if (body) {
    const r = body.getBoundingClientRect();
    const cs = getComputedStyle(body);
    out.measure = `${Math.round(r.width)}px @x${Math.round(r.left)} (max ${cs.maxWidth}, pad ${cs.paddingLeft})`;
    out.scroll = `${body.scrollHeight}/${body.clientHeight}`;
  }

  let lowest = 0;
  for (const el of (body ?? screen).querySelectorAll("*")) {
    if (el.children.length) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.opacity === "0" || r.height < 2 || r.width < 2) continue;
    lowest = Math.max(lowest, r.bottom);
  }
  out.bottom = `${Math.round(lowest)}/${innerHeight}`;

  for (const el of screen.querySelectorAll("p, h1, h2, h3, span, li, td, div, button")) {
    if (el.children.length) continue;
    const cs = getComputedStyle(el);
    if (cs.overflow === "visible" || cs.overflowY === "auto" || cs.overflowY === "scroll") continue;
    if (el.scrollHeight > el.clientHeight + 3) {
      out.clipped.push(`${el.tagName}.${String(el.className).slice(0, 26)} "${(el.textContent ?? "").trim().slice(0, 28)}"`);
    }
  }
  out.clipped = out.clipped.slice(0, 5);

  const glyphs = /[\u2190-\u21FF\u2300-\u23FF\u25A0-\u27BF\u2B00-\u2BFF\u{1F300}-\u{1FAFF}]/u;
  for (const el of screen.querySelectorAll("*")) {
    if (el.children.length) continue;
    const t = (el.textContent ?? "").trim();
    if (t && glyphs.test(t)) out.glyphs.push(`${el.tagName}.${String(el.className).slice(0, 22)} "${t.slice(0, 16)}"`);
  }
  out.glyphs = [...new Set(out.glyphs)].slice(0, 6);

  const frenchish = /\b(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre|lun\.|mar\.|mer\.|jeu\.|ven\.|sam\.|dim\.)\b/i;
  out.locale = frenchish.test(screen.textContent ?? "") ? "NON-EN DATE ON SCREEN" : null;

  return out;
};

for (const route of ROUTES) {
  errors.length = 0;
  await page.goto(`${ORIGIN}/#${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(850);
  const r = await page.evaluate(probe);
  const lines = [`\n### ${route}  measure=${r.measure}  scroll=${r.scroll}  content-ends=${r.bottom}`];
  if (r.padless.length) lines.push(`  PADLESS  ${r.padless.join("\n           ")}`);
  if (r.overflow.length) lines.push(`  OVERFLOW ${r.overflow.join("\n           ")}`);
  if (r.native.length) lines.push(`  NATIVE   ${r.native.join(" | ")}`);
  if (r.clipped.length) lines.push(`  CLIPPED  ${r.clipped.join("\n           ")}`);
  if (r.glyphs.length) lines.push(`  GLYPH    ${r.glyphs.join(" | ")}`);
  if (r.locale) lines.push(`  LOCALE   ${r.locale}`);
  if (errors.length) lines.push(`  ERRORS   ${errors.slice(0, 3).join(" | ")}`);
  console.log(lines.join("\n"));
}

await browser.close();
