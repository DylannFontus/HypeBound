/** What the front door's two painters actually cost, cold and warm. */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "../lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
for (let i = 0; i < 6; i++) {
  try {
    await seedPlayedAccount(page, ORIGIN);
    break;
  } catch {
    await page.waitForTimeout(900);
  }
}
await page.goto(`${ORIGIN}/#lobby`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

const out = await page.evaluate(async () => {
  const mod = await import("/src/ui/art/leaderPortrait.ts");
  const assets = await import("/src/ui/art/assetLoader.ts");
  const icons = await import("/src/ui/art/iconAssets.ts");
  const content = await import("/src/engine/content.ts");
  const idx = content.buildContentIndex ? content.buildContentIndex() : null;
  const leaders = idx ? Object.values(idx.leaders) : [];
  const leader = leaders[0];
  const log = [];
  const time = (label, fn) => {
    const t = performance.now();
    const r = fn();
    log.push(`${label.padEnd(38)} ${(performance.now() - t).toFixed(1)}ms`);
    return r;
  };

  // Make sure the board PNG is decoded so the measurement is draw cost only.
  await assets.awaitAsset(icons.boardPath("default"), icons.BOARD_EXTENSIONS);
  const raw = assets.getAsset(icons.boardPath("default"), icons.BOARD_EXTENSIONS);
  log.push(`board natural size ${raw ? raw.naturalWidth + "x" + raw.naturalHeight : "none"}`);
  const art = leader ? true : false;
  log.push(`leader ${leader ? leader.id : "none"} art ${art}`);

  time("paintVenue 1400x784 (queue) cold", () =>
    mod.paintVenue("default", { width: 1400, aspect: 0.56, bias: 0.06, scrim: 0.22, dim: 0.12 })
  );
  time("paintVenue 1400x784 (queue) warm", () =>
    mod.paintVenue("default", { width: 1400, aspect: 0.56, bias: 0.06, scrim: 0.22, dim: 0.12 })
  );
  time("paintVenue 1280x768 (signin)", () =>
    mod.paintVenue("default", { width: 1280, aspect: 0.6, bias: 0.05, scrim: 0.34, dim: 0.22 })
  );
  time("paintVenue 480x269", () => mod.paintVenue("default", { width: 480, aspect: 0.56 }));

  if (leader) {
    const opts = {
      width: 560,
      aspect: 1.78,
      bias: 0.03,
      scrim: 0.16,
      fadeTop: 0.24,
      fadeLeft: 0.26,
      fadeRight: 0.26,
      fadeBottom: 0.05,
      reflect: 0.12,
    };
    time("paintLeaderPortrait 560 cold", () => mod.paintLeaderPortrait(leader, opts));
    time("paintLeaderPortrait 560 warm (blit)", () => mod.paintLeaderPortrait(leader, opts));
    time("paintLeaderPortrait 200 cold", () =>
      mod.paintLeaderPortrait(leader, { ...opts, width: 200 })
    );
    time("paintLeaderPortrait 520 signin cold", () =>
      mod.paintLeaderPortrait(leader, {
        width: 520,
        aspect: 1.52,
        bias: 0.08,
        scrim: 0.5,
        fadeTop: 0.14,
        fadeLeft: 0.2,
        fadeRight: 0.24,
        fadeBottom: 0.12,
        reflect: 0.1,
      })
    );
  }
  return log;
});
console.log(out.join("\n"));
await browser.close();
