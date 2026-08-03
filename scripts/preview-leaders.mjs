/**
 * Every leader plaque on one sheet, in colour or in greyscale.
 *
 * The greyscale pass is the point of the tool. A leader's Current has to survive
 * a monitor with its saturation at zero, and after the eight wildly different
 * silhouettes were collapsed into one plaque family with a twelve-pixel
 * modulation, the burden of that moved onto the glyph in the name banner's left
 * cap and the chasing on the wings. `--mono` is how you check it still works.
 *
 * Like `preview-cards.mjs`, this waited fifteen seconds for a `window.hypebound`
 * global that `src/` stopped exposing long ago, and therefore crashed every time
 * it ran. It now drives `preview-cardface.mjs`, which loads the renderer module
 * from the dev server directly.
 *
 * Usage: node scripts/preview-leaders.mjs [--mono] [--width n]
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const mono = argv.includes("--mono");
const width = argv.includes("--width") ? argv[argv.indexOf("--width") + 1] : "360";

const args = [
  path.join(HERE, "preview-cardface.mjs"),
  "--set",
  "leaders",
  "--width",
  String(width),
  "--out",
  mono ? "leaders-mono" : "leaders",
];
if (mono) args.push("--mono");

const run = spawnSync(process.execPath, args, { stdio: "inherit" });
process.exit(run.status ?? 1);
