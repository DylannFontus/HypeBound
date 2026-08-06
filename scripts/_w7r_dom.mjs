/** Print the box of every child of a selector, live. Attribution, not scoring. */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => existsSync(p));
const [route, sel, size, js] = process.argv.slice(2);
const [w, h] = (size ?? "1600x900").split("x").map(Number);
const browser = await chromium.launch({ executablePath: CHROME, headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"], args: ["--enable-unsafe-swiftshader", "--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: w, height: h } });
await seedPlayedAccount(page, "http://localhost:5173");
await page.goto(`http://localhost:5173/?nointro#${route}`, { waitUntil: "load" });
await page.waitForTimeout(2200);
if (js) { await page.evaluate(js); await page.waitForTimeout(300); }
const rows = await page.evaluate((s) => {
  const host = document.querySelector(s);
  if (!host) return [{ note: `no match for ${s}` }];
  const cs = getComputedStyle(host);
  const out = [{ note: `HOST ${host.className} display=${cs.display} cols=${cs.gridTemplateColumns} rows=${cs.gridTemplateRows}` }];
  for (const c of host.children) {
    const r = c.getBoundingClientRect();
    const s2 = getComputedStyle(c);
    out.push({ cls: c.className.slice(0, 60), x: Math.round(r.x), y: Math.round(r.y),
      w: Math.round(r.width), h: Math.round(r.height), gc: s2.gridColumn, disp: s2.display, ov: s2.overflow });
  }
  return out;
}, sel);
for (const r of rows) console.log(r.note ?? `${String(r.cls).padEnd(62)} ${String(r.w).padStart(5)}x${String(r.h).padStart(4)} @${String(r.x).padStart(5)},${String(r.y).padStart(5)}  gc=${r.gc} ${r.disp} ov=${r.ov}`);
await browser.close();
