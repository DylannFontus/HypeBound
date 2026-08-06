/** What is actually animating on each of the four screens, and for how long. */
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
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
for (let i = 0; i < 6; i++) {
  try { await seedPlayedAccount(p, ORIGIN); break; } catch { await p.waitForTimeout(900); }
}
for (const route of ["decks", "gallery", "deckbuilder", "collection"]) {
  await p.goto(`${ORIGIN}/#lobby`, { waitUntil: "networkidle" });
  await p.waitForTimeout(1400);
  const seen = await p.evaluate(async (r) => {
    const names = new Map();
    const on = (e) => {
      const n = e.animationName;
      names.set(n, (names.get(n) ?? 0) + 1);
    };
    document.addEventListener("animationstart", on, true);
    location.hash = "#" + r;
    await new Promise((res) => setTimeout(res, 2200));
    document.removeEventListener("animationstart", on, true);
    // and what is still running two seconds later — the "alive at rest" layer
    const idle = [...document.getAnimations()]
      .map((a) => a.animationName)
      .filter(Boolean);
    return { started: [...names.entries()], idle: [...new Set(idle)] };
  }, route);
  console.log(route.padEnd(12), "entrance:", seen.started.map(([n, c]) => `${n}x${c}`).join(" "));
  console.log("            at rest:", seen.idle.join(" ") || "(nothing)");
}
await b.close();
