/**
 * A strip of card faces, for iterating on the frame design.
 *
 * This used to open the app and wait fifteen seconds for a `window.hypebound`
 * global that was removed from `src/` a long time ago, so the one tool named in
 * two consecutive recons as *the* way to review the most-looked-at art in the
 * game crashed every single time it was run. `preview-cardface.mjs` already does
 * the job properly — it asks the dev server for the renderer module rather than
 * for a global the app has no reason to expose — so this is now a front door
 * onto that, kept because the name is in the recon documents and in people's
 * shell history. A tool that always crashes is worse than no tool: it costs
 * somebody fifteen seconds and a wrong conclusion about why.
 *
 * Usage: node scripts/preview-cards.mjs [cardId ...] [--width n] [--out name]
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const ids = [];
const passthrough = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) {
    passthrough.push(argv[i], argv[i + 1] ?? "");
    i += 1;
  } else {
    ids.push(argv[i]);
  }
}

const args = [path.join(HERE, "preview-cardface.mjs"), "--out", "card-strip", ...passthrough.filter(Boolean)];
if (ids.length > 0) args.push("--ids", ids.join(","));

const run = spawnSync(process.execPath, args, { stdio: "inherit" });
process.exit(run.status ?? 1);
