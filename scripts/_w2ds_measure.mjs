/** Measure the data-screen domain: container widths, contrast, tap targets, overflow. */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe"].find((p) => existsSync(p));
const ROUTES = (process.argv[2] ?? "profile,mastery,stats,leaderboards,replays,news,patchnotes,inbox,events,gauntlet,story,tour,doomscroll,remixhub,lab,custom,settings,fairness,privacy,legal,support,cloudsave").split(",");
const SIZE = (process.argv[3] ?? "1600x900").split("x").map(Number);
const SCALE = process.argv[4] ?? null;

const browser = await chromium.launch({ executablePath: CHROME, headless: true, ignoreDefaultArgs: ["--hide-scrollbars"], args: ["--enable-unsafe-swiftshader", "--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: SIZE[0], height: SIZE[1] } });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
page.on("console", (m) => m.type() === "error" && errs.push(m.text()));

await seedPlayedAccount(page);
await page.goto("http://localhost:5173/?nointro#lobby", { waitUntil: "networkidle" });
await page.waitForTimeout(700);
await page.evaluate(async () => {
  const profile = await import("/src/save/profile.ts");
  const { getContent } = await import("/src/engine/content.ts");
  const content = getContent();
  const leaders = Object.keys(content.leaders);
  const modes = ["ai-beginner", "ai-standard", "gauntlet", "story"];
  const res = ["win", "loss", "win", "draw"];
  let t = Date.now() - 40 * 3.6e6;
  for (let i = 0; i < 32; i++) {
    t += 3.1e6;
    profile.recordMatch(null, res[i % 4], { deckName: ["Neon Rush","Gothic Control","Meme Tempo","Corporate Value"][i%4], leaderCardId: leaders[i % leaders.length], opponentLeaderCardId: leaders[(i + 4) % leaders.length], mode: modes[i % 4], content, turns: 6 + (i % 9), now: t });
  }
  (await import("/src/save/storage.ts")).flushAllStores();
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1000);
if (SCALE) {
  await page.evaluate((s) => document.documentElement.style.setProperty("--ui-scale", s), SCALE);
  await page.waitForTimeout(300);
}

const lum = (c) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};

const rows = [];
for (const route of ROUTES) {
  await page.evaluate((r) => { location.hash = `#${r}`; }, route);
  await page.waitForTimeout(1400);
  const out = await page.evaluate(() => {
    const screen = document.querySelector(".screen:not(.screen-out)");
    if (!screen) return { error: "no screen" };
    // widest structural container that is not the screen itself
    const bodies = [...screen.querySelectorAll("main, .data-body, .screen-body, [class*='-body']")]
      .map((n) => ({ cls: n.className.split(" ").slice(0, 2).join("."), w: Math.round(n.getBoundingClientRect().width), l: Math.round(n.getBoundingClientRect().left) }))
      .filter((n) => n.w > 200);
    // horizontal overflow of the page
    const hOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    // clipped text: elements whose scrollHeight exceeds clientHeight with overflow hidden
    let clipped = 0;
    for (const n of screen.querySelectorAll("*")) {
      const cs = getComputedStyle(n);
      if (cs.overflow === "hidden" || cs.overflowY === "hidden") {
        if (n.scrollHeight - n.clientHeight > 4 && n.clientHeight > 20 && n.children.length < 40) clipped++;
      }
    }
    // small tap targets among interactive elements
    const small = [];
    for (const n of screen.querySelectorAll("button, a, input, select, [role=button], [tabindex='0']")) {
      const r = n.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.height < 32) small.push(`${n.tagName.toLowerCase()}.${(n.className||"").toString().split(" ")[0]}=${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    // native, unstyled controls
    const native = [...screen.querySelectorAll("input,select,textarea")].filter((n) => {
      const cs = getComputedStyle(n);
      return cs.appearance !== "none" && cs.webkitAppearance !== "none" && n.type !== "hidden";
    }).map((n) => `${n.tagName.toLowerCase()}[${n.type ?? ""}]`);
    // focusables
    const focusables = screen.querySelectorAll("button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])").length;
    return { bodies, hOverflow, clipped, small: small.slice(0, 8), smallCount: small.length, native: [...new Set(native)], focusables };
  });
  rows.push({ route, ...out });
  console.log(JSON.stringify({ route, ...out }));
}

// contrast sample on a handful of known text nodes
const contrast = await page.evaluate(() => {
  const parse = (s) => (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  const L = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      const c = parse(cs.backgroundColor);
      const a = Number((cs.backgroundColor.match(/[\d.]+/g) ?? [])[3] ?? 1);
      if (a > 0.7 && c.length === 3) return c;
      n = n.parentElement;
    }
    return [10, 6, 20];
  };
  const out = [];
  for (const el of document.querySelectorAll(".screen:not(.screen-out) *")) {
    if (el.children.length) continue;
    const txt = (el.textContent ?? "").trim();
    if (txt.length < 2) continue;
    const cs = getComputedStyle(el);
    const fg = parse(cs.color);
    const bg = bgOf(el);
    const r = (Math.max(L(fg), L(bg)) + 0.05) / (Math.min(L(fg), L(bg)) + 0.05);
    const size = parseFloat(cs.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
    if (r < (large ? 3 : 4.5)) out.push({ txt: txt.slice(0, 34), ratio: Number(r.toFixed(2)), size, colour: cs.color, need: large ? 3 : 4.5 });
  }
  return out.slice(0, 12);
});
console.log("CONTRAST FAILS:", JSON.stringify(contrast, null, 1));
if (errs.length) console.log("CONSOLE ERRORS:", errs.slice(0, 6));
await browser.close();
