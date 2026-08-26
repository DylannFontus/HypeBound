/**
 * Look inside the packaged .exe, which no other instrument in this repo can do.
 *
 * Every existing check drives a browser. The desktop app is the same engine
 * (WebView2 *is* Chromium/Edge) but not the same *environment*, and one
 * difference had been silently breaking it: Tauri appends a per-response
 * `nonce-…` to `style-src`, and CSP says a directive carrying a nonce ignores
 * `'unsafe-inline'`. Nine modules install a stylesheet at runtime. All nine
 * were dropped in the .exe and all nine passed every browser test, because the
 * web build has no CSP at all.
 *
 * The symptom was three steps downstream and looked like an art bug: `.hb-icon`
 * takes its `width: 1em` from one of those sheets, so with it dead every icon
 * sized from its host laid out at 0x0, the size gate in `iconAssets.ts`
 * measured 0 against a `minPx` of 14, correctly withheld `hb-mark-fits`, and
 * the wallet showed a bare number. Nothing on that chain was broken.
 *
 * So this asserts the two things that failure actually consisted of, on real
 * routes in the real binary:
 *
 *   1. every `<style>` in the document has a live `.sheet`
 *   2. no `.hb-icon` lays out at zero
 *
 *   node scripts/verify-desktop.mjs            (build first: npm run desktop:build)
 *   node scripts/verify-desktop.mjs --keep     (leave the app running)
 */

import { chromium } from "playwright-core";
import { spawn, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const EXE = path.resolve("src-tauri/target/release/HYPEBOUND.exe");
const PORT = 9223;
const KEEP = process.argv.includes("--keep");

/**
 * Routes that render standalone. A match route is deliberately absent: it needs
 * a game in progress, and a screen that fails to mount would be reported as a
 * screen with no icons rather than as a screen that was never reached.
 */
const ROUTES = [
  "lobby", "play", "collection", "shop", "decks", "missions", "mastery",
  "achievements", "inbox", "news", "events", "profile", "pass", "patchnotes",
];

if (!existsSync(EXE)) {
  console.error(`no binary at ${EXE} — run: npm run desktop:build`);
  process.exit(2);
}

execSync('taskkill /F /IM HYPEBOUND.exe /T 2>nul || exit 0', { shell: "cmd.exe", stdio: "ignore" });

const child = spawn(EXE, [], {
  detached: false,
  stdio: "ignore",
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
});

const stop = () => {
  if (KEEP) return;
  try { execSync(`taskkill /F /PID ${child.pid} /T 2>nul || exit 0`, { shell: "cmd.exe", stdio: "ignore" }); } catch {}
};

/** Wait for the webview's debugging port rather than sleeping a guessed amount. */
async function waitForCdp(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return await r.json();
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`webview never opened a debugging port on ${PORT}`);
}

let failures = 0;
try {
  const version = await waitForCdp();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const context = browser.contexts()[0];
  const page = context.pages().find((p) => !p.url().startsWith("devtools")) ?? context.pages()[0];
  console.log(`HYPEBOUND.exe  ${version.Browser}`);
  console.log(`origin: ${await page.evaluate(() => location.origin)}`);

  /*
   * Calibration, in the spirit of `verify-mobile.mjs`: plant the exact defect
   * and require the instrument to report it. Without this, a run where the CSP
   * had been removed entirely would print fourteen clean routes and mean
   * nothing at all — the check would be measuring an environment that can no
   * longer produce the failure.
   */
  const calibration = await page.evaluate(() => {
    const probe = document.createElement("style");
    probe.id = "hb-csp-calibration";
    probe.textContent = ".hb-csp-calibration-probe { color: red }";
    document.head.appendChild(probe);
    const dropped = !probe.sheet;
    probe.remove();
    const nonced = [...document.querySelectorAll("style")].some((s) => s.nonce);
    return { dropped, nonced };
  });

  if (!calibration.nonced) {
    console.error("CALIBRATION FAILED: no nonce anywhere in the document.");
    console.error("  The CSP this guards against is not in force, so a pass here proves nothing.");
    failures++;
  } else if (!calibration.dropped) {
    console.error("CALIBRATION FAILED: a nonce-less <style> was accepted.");
    console.error("  The policy changed; this instrument can no longer see the failure it exists for.");
    failures++;
  } else {
    console.log("calibration: a nonce-less <style> is dropped, so this run can detect the defect\n");
  }

  console.log("  route          styles  dead  icons  zero-sized");
  for (const route of ROUTES) {
    await page.evaluate((r) => { location.hash = "#" + r; }, route);
    await page.waitForTimeout(1200);

    const seen = await page.evaluate(() => {
      const styles = [...document.querySelectorAll("style")];
      const icons = [...document.querySelectorAll(".hb-icon")];
      return {
        hash: location.hash.replace("#", ""),
        styles: styles.length,
        dead: styles.filter((s) => !s.sheet).map((s) => s.id || "(anonymous)"),
        icons: icons.length,
        // `offsetParent`-less nodes are in a collapsed panel, not a broken icon.
        zero: icons
          .filter((e) => e.getBoundingClientRect().width === 0 && e.getClientRects().length > 0)
          .map((e) => [...e.classList].find((c) => c.startsWith("hb-mark-")) ?? "(unmarked)"),
      };
    });

    const bad = seen.dead.length > 0 || seen.zero.length > 0;
    if (bad) failures++;
    const flag = bad ? "  <-- " : "";
    const detail = bad
      ? `${seen.dead.length ? "dead: " + seen.dead.join(",") + " " : ""}${seen.zero.length ? "zero: " + [...new Set(seen.zero)].slice(0, 4).join(",") : ""}`
      : "";
    console.log(
      `  ${route.padEnd(14)} ${String(seen.styles).padStart(5)} ${String(seen.dead.length).padStart(5)} ` +
      `${String(seen.icons).padStart(6)} ${String(seen.zero.length).padStart(10)}${flag}${detail}`,
    );
  }

  await browser.close();
} catch (error) {
  console.error("verify-desktop failed:", error.message);
  failures++;
} finally {
  stop();
}

console.log(failures === 0
  ? "\nOK — every stylesheet applied and every icon laid out"
  : `\nFAILED — ${failures} problem(s)`);
process.exit(failures === 0 ? 0 : 1);
