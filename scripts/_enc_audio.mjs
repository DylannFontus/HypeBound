/**
 * What the audio actually weighs per second, decoded rather than parsed.
 *
 * This exists because the first attempt to answer the question lied. Reading
 * the MPEG frame header off the front of each file reported **64 kbps**, which
 * would have made the 58.6 MB of music unimprovable — you cannot usefully
 * re-encode 64 kbps — and the audio category would have been written off as
 * "long, not heavy". `verify:art` then decoded the same file and reported
 * 180.00 seconds, which at 5.34 MB is 249 kbps, four times the header's claim.
 *
 * The header was not corrupt. A VBR MP3 begins with a Xing/LAME info frame
 * whose own header carries a placeholder bitrate, and a naive scan for the
 * first sync word finds exactly that frame. The parse was correct about the
 * bytes it read and wrong about what they meant, with no error anywhere — the
 * house pattern.
 *
 * So: duration comes from `decodeAudioData`, the same call the game makes, and
 * bitrate is derived from file size over decoded duration. There is nothing to
 * misinterpret in a division.
 */

import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AUDIO = path.join(ROOT, "public", "assets", "audio");
const PORT = 4184;

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

function walk(dir, prefix = "") {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

const files = walk(AUDIO);

const server = createServer((req, res) => {
  const rel = decodeURIComponent((req.url ?? "/").split("?")[0]).replace(/^\/+/, "");
  const file = path.join(AUDIO, rel);
  if (rel === "" ) {
    res.writeHead(200, { "Content-Type": "text/html" }).end("<!doctype html><title>a</title>");
    return;
  }
  if (!file.startsWith(AUDIO) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end("no");
    return;
  }
  res.writeHead(200, { "Content-Type": "audio/mpeg" });
  createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(PORT, resolve));

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});

try {
  const page = await browser.newPage();
  await page.goto(`http://localhost:${PORT}/`);
  const decoded = await page.evaluate(async (names) => {
    const context = new AudioContext();
    const out = [];
    for (const name of names) {
      try {
        const bytes = await (await fetch(`/${name}`)).arrayBuffer();
        const buffer = await context.decodeAudioData(bytes);
        out.push({ name, seconds: buffer.duration, channels: buffer.numberOfChannels, rate: buffer.sampleRate });
      } catch (error) {
        out.push({ name, seconds: 0, error: String(error).slice(0, 60) });
      }
    }
    return out;
  }, files);

  const rows = decoded.map((d) => ({ ...d, bytes: statSync(path.join(AUDIO, d.name)).size }));
  const music = rows.filter((r) => r.name.startsWith("music/") || r.name.startsWith("ambient/"));
  const sfx = rows.filter((r) => !music.includes(r));

  const show = (title, set) => {
    const bytes = set.reduce((s, r) => s + r.bytes, 0);
    const seconds = set.reduce((s, r) => s + r.seconds, 0);
    console.log(`\n${title}: ${set.length} files, ${(bytes / 1024 / 1024).toFixed(2)} MB, ${seconds.toFixed(0)}s, ${((bytes * 8) / seconds / 1000).toFixed(0)} kbps effective`);
    for (const r of [...set].sort((a, b) => b.bytes - a.bytes).slice(0, 6)) {
      console.log(
        `   ${r.name.padEnd(38)}${(r.bytes / 1024 / 1024).toFixed(2).padStart(6)} MB  ${r.seconds.toFixed(0).padStart(4)}s  ` +
          `${((r.bytes * 8) / Math.max(r.seconds, 0.001) / 1000).toFixed(0).padStart(4)} kbps  ${r.channels}ch @${r.rate}`
      );
    }
  };

  show("music + ambient", music);
  show("sfx", sfx);

  const musicBytes = music.reduce((s, r) => s + r.bytes, 0);
  const musicSeconds = music.reduce((s, r) => s + r.seconds, 0);
  console.log("\nwhat a re-encode would cost, at the same durations:");
  for (const kbps of [128, 96, 80, 64]) {
    const size = (kbps * 1000 * musicSeconds) / 8;
    console.log(`   ${String(kbps).padStart(3)} kbps → ${(size / 1024 / 1024).toFixed(1).padStart(5)} MB  (from ${(musicBytes / 1024 / 1024).toFixed(1)} MB, saving ${((musicBytes - size) / 1024 / 1024).toFixed(1)} MB)`);
  }
} finally {
  await browser.close();
  server.close();
}
