/** What overflows at --ui-scale 1.4, and by how much. */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const b = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
for (let i = 0; i < 6; i++) {
  try { await seedPlayedAccount(p, ORIGIN); break; } catch { await p.waitForTimeout(900); }
}
for (const route of ["deckbuilder", "collection", "decks", "gallery"]) {
  await p.goto(`${ORIGIN}/#${route}`, { waitUntil: "networkidle" });
  await p.evaluate(() => document.documentElement.style.setProperty("--ui-scale", "1.4"));
  await p.waitForTimeout(1800);
  const out = await p.evaluate(() => {
    const wide = [];
    for (const el of document.querySelectorAll(".screen *")) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > innerWidth + 1) {
        wide.push(`${el.className.toString().slice(0, 40)} right=${Math.round(r.right)}`);
      }
    }
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return `${Math.round(r.left)}..${Math.round(r.right)} (${Math.round(r.width)})`;
    };
    return {
      docWidth: document.documentElement.scrollWidth,
      bodyOverflow: document.body.scrollWidth - innerWidth,
      offenders: wide.slice(0, 8),
      body: box(".builder-body"),
      side: box(".builder-side"),
      foot: box(".builder-side-foot"),
      actions: box(".builder-actions"),
      lastBtn: box(".builder-actions .btn:last-child"),
      cols: (() => {
        const el = document.querySelector(".builder-body");
        return el ? getComputedStyle(el).gridTemplateColumns : null;
      })(),
    };
  });
  console.log(route.padEnd(12), JSON.stringify(out));
}
await b.close();
