/**
 * Deleting an account, for real, against the live project.
 *
 * The one control on the privacy page a person might genuinely depend on, so it
 * is verified the only way that means anything: make a throwaway account, use
 * it, delete it through the button a player would press, and then prove the
 * login no longer works.
 *
 * The proof is the last step. A delete that returns 200 and leaves the account
 * signed-in-able is exactly the failure this exists to rule out, and only a
 * fresh sign-in attempt can tell the difference.
 *
 * Not part of `npm test`: it creates and destroys real accounts. Run by hand,
 * with a dev server on :5173.
 */

import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const ORIGIN = "http://localhost:5173";
const STAMP = String(Math.floor(Math.random() * 1e9));
const EMAIL = `hypebound-delete-${STAMP}@example.com`;
const PASSWORD = "delete-me-password";

let failures = 0;
const ok = (m) => console.log(`   ok: ${m}`);
const fail = (m) => {
  failures++;
  console.log(`   FAIL: ${m}`);
};

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));

console.log(`\nHYPEBOUND account deletion — ${EMAIL}\n`);

try {
  console.log("1. A throwaway account");
  await page.goto(`${ORIGIN}/#starter`, { waitUntil: "networkidle" });
  await page.waitForSelector(".starter-screen", { timeout: 20000 });
  await page.evaluate(() => window.hypeboundStarter?.choose("neon-idols"));
  await page.waitForSelector(".starter-screen", { state: "detached", timeout: 20000 });

  await page.goto(`${ORIGIN}/#signin`, { waitUntil: "networkidle" });
  await page.waitForSelector(".signin-screen");
  await page.click("#signin-toggle");
  await page.fill("#signin-email", EMAIL);
  await page.fill("#signin-password", PASSWORD);
  await page.click("#signin-submit");
  await page.waitForSelector(".queue-screen", { timeout: 25000 });
  ok("created and signed in");

  console.log("\n2. The privacy page offers deletion only to somebody signed in");
  await page.goto(`${ORIGIN}/#privacy`, { waitUntil: "networkidle" });
  await page.waitForSelector(".privacy-screen");
  const visible = await page.locator("#privacy-delete-online").isVisible();
  if (visible) ok("the button is there");
  else fail("no delete-account button for a signed-in player");

  console.log("\n3. It refuses anything but the typed word");
  await page.evaluate(() => {
    window.__prompts = [];
    window.prompt = (message) => {
      window.__prompts.push(message);
      return "yes";
    };
    window.alert = () => {};
  });
  await page.click("#privacy-delete-online");
  await page.waitForTimeout(1500);
  const asked = await page.evaluate(() => window.__prompts?.[0] ?? "");
  if (/DELETE/.test(asked)) ok("the confirmation says which word to type");
  else fail(`the prompt read "${asked}"`);
  const stillSignedIn = await page.evaluate(() => localStorage.getItem("hypebound-auth:session") !== null);
  if (stillSignedIn) ok('and "yes" did not delete anything');
  else fail("the account was deleted without the typed word");

  console.log("\n4. Deleting it");
  /**
   * The message is stashed in localStorage, not in a variable.
   *
   * The screen reloads itself after deleting, so anything on `window` is gone
   * before it can be read — the first version of this check reported "(nothing)"
   * for a deletion that had in fact succeeded and said so.
   */
  await page.evaluate(() => {
    localStorage.removeItem("__e2e_alert");
    window.prompt = () => "DELETE";
    window.alert = (m) => localStorage.setItem("__e2e_alert", String(m));
  });
  await page.click("#privacy-delete-online");
  await page.waitForFunction(() => localStorage.getItem("__e2e_alert") !== null, { timeout: 30000 }).catch(() => {});
  const said = await page.evaluate(() => localStorage.getItem("__e2e_alert") ?? "(nothing)");
  console.log(`   the page said: "${said}"`);
  if (/account is gone|Deleted\./i.test(said)) ok("it reports success");
  else fail(`it reported: ${said}`);

  console.log("\n5. The proof: the login no longer works");
  const retry = await page.evaluate(
    async ([email, password]) => {
      const { ONLINE } = await import("/src/config.ts");
      const response = await fetch(`${ONLINE.supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: ONLINE.supabaseAnonKey, "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      return { status: response.status, body: await response.json() };
    },
    [EMAIL, PASSWORD]
  );
  if (retry.status >= 400) ok(`signing in again is refused (${retry.status}: ${retry.body?.error_description ?? retry.body?.msg})`);
  else fail(`the account still signs in (${retry.status}) — the delete did not delete`);

  console.log("\n6. The save on this device is untouched");
  const saveIntact = await page.evaluate(() => {
    const raw = localStorage.getItem("hypebound:profile");
    return raw ? (JSON.parse(raw).data?.clout ?? null) : null;
  });
  if (saveIntact !== null) ok(`the local profile survives (clout ${saveIntact}), as the page promises`);
  else fail("deleting the account wiped the local save, which the page says it does not");
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  if (errors.length) {
    console.log(`\n   page errors: ${errors.slice(0, 3).join(" | ")}`);
    failures++;
  }
  await browser.close();
}

console.log(failures === 0 ? "\nPASS — the account is gone and cannot sign in." : `\nFAIL — ${failures} problem(s)`);
process.exit(failures === 0 ? 0 : 1);
