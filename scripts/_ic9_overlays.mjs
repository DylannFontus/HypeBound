/**
 * The material census stopped at the route boundary. What is on the other side?
 *
 * `docs/VISUAL-OVERHAUL-STATE.md` records that all forty-nine routes carry the
 * material system with "no plain panel, no flat fill and no outline-only button
 * anywhere". Every instrument that produced that sentence enumerated *routes* —
 * `shell.register` names, screens with a `[data-nav]` root. A battle overlay is
 * none of those things. It is mounted by `battleScreen.ts::mountOverlay` into
 * the screen rather than registered as one, so a census that walks routes walks
 * straight past the mulligan, the End Turn confirm and the end-of-match
 * sequence — and the end-of-match sequence is the screen a player sees after
 * *every single match*, which is more often than they see most of the
 * forty-nine.
 *
 * So this walks the overlays instead, and asks each visible surface the four
 * questions §1 of the bar asks:
 *
 *   - is the fill a gradient with a light source, or a flat colour?
 *   - is there an edge treatment beyond `border: 1px solid`?
 *   - is there a contact shadow, or only a soft drop (or nothing)?
 *   - does it carry grain?
 *
 * The `mat-*` classes answer all four at once by construction, so the census
 * reports both the class and the computed truth — a surface could in principle
 * satisfy §1 by hand. The point is to find the ones that satisfy none of it.
 *
 *   node scripts/_ic9_overlays.mjs
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
const DIR = "scripts/screenshots/w9/ic9-overlays";
mkdirSync(DIR, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await seedPlayedAccount(page, ORIGIN);

const CENSUS = (root) => {
  const host = document.querySelector(root);
  if (!host) return { error: `no ${root}` };
  const rows = [];
  const walk = (el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    // Only surfaces big enough for §1 to apply — "larger than an icon".
    if (r.width >= 40 && r.height >= 24 && cs.display !== "none" && cs.visibility !== "hidden") {
      const bg = cs.backgroundImage;
      const shadow = cs.boxShadow;
      const flatFill =
        bg === "none" && cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent";
      const gradient = /gradient/.test(bg);
      const grain = /url\(/.test(bg);
      const insetRim = /inset/.test(shadow);
      // a contact shadow is a tight, low-blur, non-inset drop
      const contact = [...shadow.matchAll(/(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px/g)].some(
        (m) => !/inset/.test(shadow.slice(0, m.index)) && Number(m[3]) > 0 && Number(m[3]) <= 6
      );
      const borderOnly =
        !gradient && !insetRim && cs.borderTopWidth !== "0px" && (shadow === "none" || !/rgb/.test(shadow));
      rows.push({
        sel: `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`.slice(0, 62),
        w: Math.round(r.width),
        h: Math.round(r.height),
        mat: [...el.classList].some((c) => c.startsWith("mat-")),
        gradient,
        grain,
        insetRim,
        contact,
        flatFill,
        borderOnly,
        bgColor: cs.backgroundColor,
        border: `${cs.borderTopWidth} ${cs.borderTopStyle}`,
      });
    }
    for (const kid of el.children) walk(kid);
  };
  walk(host);
  return { rows };
};

async function report(label, root) {
  const res = await page.evaluate(CENSUS, root);
  console.log(`\n=== ${label}  (${root}) ===`);
  if (res.error) {
    console.log(`  ${res.error}`);
    return;
  }
  for (const r of res.rows) {
    const flags = [
      r.mat ? "MAT" : "   ",
      r.gradient ? "grad" : "    ",
      r.grain ? "grain" : "     ",
      r.insetRim ? "rim" : "   ",
      r.contact ? "contact" : "       ",
    ].join(" ");
    const verdict = r.mat || r.gradient ? "" : r.borderOnly ? "  <-- §1 VIOLATION: 1px border is the only edge" : r.flatFill ? "  <-- §1 VIOLATION: flat fill" : "";
    console.log(`  ${r.sel.padEnd(62)} ${String(r.w).padStart(4)}x${String(r.h).padStart(3)}  ${flags}${verdict}`);
  }
}

async function click(sel, text) {
  const c = await page.evaluate(
    ({ sel, text }) => {
      const el = [...document.querySelectorAll(sel)].find((e) => !text || new RegExp(text, "i").test(e.textContent ?? ""));
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    },
    { sel, text }
  );
  if (!c) return false;
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: c.x, y: c.y, button: "none", clickCount: 0 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: c.x, y: c.y, button: "left", clickCount: 1 });
  await new Promise((r) => setTimeout(r, 50));
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: c.x, y: c.y, button: "left", clickCount: 1 });
  return true;
}

await page.goto(`${ORIGIN}/?nointro#battle?seed=41&difficulty=casual`, { waitUntil: "networkidle" });
await page.waitForSelector(".mulligan-panel", { timeout: 30000 });
await page.waitForTimeout(1200);
await report("MULLIGAN", ".mulligan-overlay");

await click(".mulligan-actions .btn-primary");
await page.waitForFunction(() => document.querySelectorAll(".hand-card").length > 0, null, { timeout: 25000 });
await page.waitForTimeout(1800);

// The concede confirm — one of the two modals a player sees mid-match.
await click(".battle-hud button, .hud-right button, button", "concede");
await page.waitForTimeout(700);
if (await page.evaluate(() => Boolean(document.querySelector(".confirm-overlay")))) {
  await report("CONCEDE CONFIRM", ".confirm-overlay");
  await page.screenshot({ path: path.join(DIR, "confirm.png") });
  await click(".confirm-overlay .btn-primary");
} else {
  console.log("\n(no concede confirm found — trying the flag button)");
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /concede|forfeit|flag/i.test(x.getAttribute("aria-label") ?? x.title ?? ""));
    b?.click();
  });
  await page.waitForTimeout(700);
  if (await page.evaluate(() => Boolean(document.querySelector(".confirm-overlay")))) {
    await report("CONCEDE CONFIRM", ".confirm-overlay");
    await page.screenshot({ path: path.join(DIR, "confirm.png") });
    await click(".confirm-overlay .btn-primary");
  }
}

await page.waitForFunction(() => Boolean(document.querySelector(".end-overlay")), null, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(2600);
await report("END OF MATCH", ".end-overlay");
await page.screenshot({ path: path.join(DIR, "end-of-match.png") });

/*
 * Do the reward numbers count up, or are they printed?
 *
 * §3a names this specifically — "Numbers count up. Currency, XP, records,
 * mission progress — animated to their value, not printed. Rewards especially."
 * `motion.ts::tickerTo` exists for exactly this. Read the same node eight times
 * across the first second the block is on screen: a counted number changes, a
 * printed one does not.
 */
await page.goto(`${ORIGIN}/?nointro#battle?seed=42&difficulty=casual`, { waitUntil: "networkidle" });
await page.waitForSelector(".mulligan-panel", { timeout: 30000 });
await page.waitForTimeout(1000);
await click(".mulligan-actions .btn-primary");
await page.waitForFunction(() => document.querySelectorAll(".hand-card").length > 0, null, { timeout: 25000 });
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) =>
    /concede/i.test((x.getAttribute("aria-label") ?? "") + (x.title ?? "") + (x.textContent ?? ""))
  );
  b?.click();
});
await page.waitForTimeout(500);
await page.evaluate(() => {
  const b = [...document.querySelectorAll(".confirm-overlay button")].find((x) => /concede/i.test(x.textContent ?? ""));
  b?.click();
});
const samples = [];
const t0 = Date.now();
for (let i = 0; i < 26; i += 1) {
  samples.push({
    t: Date.now() - t0,
    v: await page.evaluate(() =>
      [...document.querySelectorAll(".end-reward-value")].map((e) => (e.textContent ?? "").trim()).join(" | ")
    ),
  });
  await new Promise((r) => setTimeout(r, 90));
}
const seen = samples.filter((s) => s.v);
const distinct = [...new Set(seen.map((s) => s.v))];
console.log(
  `\nREWARD NUMBERS: ${seen.length} samples over ${seen.at(-1)?.t ?? 0}ms once the block existed, ${distinct.length} distinct value(s): ${distinct.join("  ->  ")}`
);
console.log(
  distinct.length <= 1
    ? "  -> PRINTED. §3a asks rewards especially to count up; motion.ts::tickerTo already exists."
    : "  -> counted up."
);

console.log(`\nshots in ${DIR}`);
await browser.close();
