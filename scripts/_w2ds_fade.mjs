import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe"].find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath: CHROME, headless: true, ignoreDefaultArgs: ["--hide-scrollbars"], args: ["--enable-unsafe-swiftshader", "--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await seedPlayedAccount(page);
await page.goto("http://localhost:5173/?nointro#news", { waitUntil: "networkidle" });
await page.waitForTimeout(1600);
console.log(JSON.stringify(await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll(".d-fade")) {
    const cs = getComputedStyle(el);
    out.push({ cls: el.className, a: cs.getPropertyValue("--fade-a").trim(), b: cs.getPropertyValue("--fade-b").trim(), scrollTop: el.scrollTop, over: el.scrollHeight - el.clientHeight, mask: (cs.maskImage||cs.webkitMaskImage).slice(0,90) });
  }
  return out;
}), null, 1));
await browser.close();
