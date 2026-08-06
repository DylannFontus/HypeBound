/**
 * Photograph the queue screen, which will not render without a session.
 *
 * `shot.mjs` cannot reach it. `#queue` bounces to sign-in when `currentAccount()`
 * is null, and `--eval` runs *after* that bounce, so the camera photographs the
 * sign-in screen and a reviewer concludes the queue looks exactly like sign-in.
 * The session therefore has to exist before the app's module graph reads storage
 * for the first time, which is what `addInitScript` is for.
 *
 * The token is deliberately not a real one: the socket is refused, the screen
 * settles into its disconnected state, and every layer this file exists to
 * photograph — the room, the floor, the sweep, the leader on the plinth — is
 * painted regardless of what the server says.
 *
 *   node scripts/shot-queue.mjs --out queue-after --size 1280x720
 *   node scripts/shot-queue.mjs --eval "document.querySelector('#queue-offer').hidden=false"
 */
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync } from "node:fs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? true);
};
const outName = String(flag("out", "queue"));
const outDir = String(flag("dir", path.join(HERE, "screenshots", "review")));
const [vw, vh] = String(flag("size", "1600x900")).split("x").map(Number);
const settle = Number(flag("wait", 1400));
const evalJs = flag("eval", null);
const freeze = flag("freeze", null);
const burst = (() => {
  const raw = flag("frames", null);
  if (!raw) return null;
  const [n, ms] = String(raw).split("x").map(Number);
  return { count: n || 1, interval: ms || 150 };
})();

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });

const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

try {
  /**
   * A started account, through the game's own picker.
   *
   * `lib/account.mjs` also fills the collection from the card files, which this
   * screen has no use for — the queue only needs a legal starter deck so that
   * `content.leaders[deck.leaderCardId]` resolves and a face reaches the plinth.
   */
  await page.goto(`${ORIGIN}/#starter`, { waitUntil: "networkidle" });
  if (await page.locator(".starter-screen").count()) {
    await page.evaluate(() => window.hypeboundStarter?.choose("neon-idols"));
    await page.waitForSelector(".starter-screen", { state: "detached", timeout: 20000 }).catch(() => {});
  }
  await page.evaluate(() => {
    localStorage.setItem(
      "hypebound-auth:session",
      JSON.stringify({
        accessToken: "camera-only-not-a-real-token",
        refreshToken: "camera-only-not-a-real-token",
        expiresAtMs: Date.now() + 3_600_000,
        account: { userId: "camera", email: "camera@example.com" },
      })
    );
  });
  /**
   * A full document load, not a hash change.
   *
   * `page.goto` to a URL that differs from the current one only by its fragment
   * is a same-document navigation, so the session written above would never be
   * read by a freshly-booted module graph — the camera would photograph whatever
   * screen the app was already on. Reloading is what makes the hash a boot route.
   */
  await page.goto(`${ORIGIN}/#queue`);
  await page.reload({ waitUntil: "networkidle" });
  await page
    .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 })
    .catch(() => {});
  if (evalJs) await page.evaluate((s) => new Function(s)(), String(evalJs));
  if (freeze !== null) {
    await page.addStyleTag({
      content: `*, *::before, *::after { animation-delay: -${Number(freeze)}ms !important; animation-play-state: paused !important; }`,
    });
  }
  await page.waitForTimeout(settle);

  const clip = flag("clip", null);
  const shoot = async (name) => {
    const file = path.join(outDir, `${name}.png`);
    const target = clip ? page.locator(String(clip)).first() : page;
    await target.screenshot({ path: file });
    console.log(file);
  };
  if (burst) {
    for (let i = 0; i < burst.count; i++) {
      await shoot(`${outName}-${i}`);
      if (i < burst.count - 1) await page.waitForTimeout(burst.interval);
    }
  } else {
    await shoot(outName);
  }
  /* Which screen was actually photographed, because "#queue bounced to sign-in"
     and "#queue rendered" produce two very different pictures and only one of
     them is the subject. */
  console.log(
    JSON.stringify(
      await page.evaluate(() => ({
        hash: location.hash,
        screens: [...document.querySelectorAll(".screen")].map((s) => s.className),
        state: document.querySelector("#queue-state")?.textContent?.trim(),
      }))
    )
  );
  /* The 401s are expected: the token above is not a real one. They are printed
     rather than swallowed so a *different* failure is still visible. */
  if (errors.length) console.log(`${errors.length} console error(s):\n  ${errors.slice(0, 6).join("\n  ")}`);
} finally {
  await browser.close();
}
