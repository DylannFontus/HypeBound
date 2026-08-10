/// <reference types="vitest/config" />
/**
 * How the build is shaped, and the one thing it deliberately takes away from Vite.
 *
 * Vite copies `public/` into `dist/` verbatim. That is the right default almost
 * everywhere and it is wrong here, because `public/` is the owner's *masters* —
 * 296 card paintings as 512x680 PNG, twelve 4K board backdrops, forty 512px
 * icons — and shipping the masters is what made the deployed site 295 MB. The
 * owner reported it as art that "didn't wire properly". It is wired; it was too
 * heavy to arrive.
 *
 * So `build.copyPublicDir` is off and `lightAssets()` does the copy instead,
 * substituting a WebP encode for each master and leaving the master out. Note
 * which knob that is: **`copyPublicDir`, not `publicDir`**. Setting `publicDir:
 * false` would also stop Vite *resolving* against the folder, and `index.html`
 * refers to `./favicon-32.png`, `./apple-touch-icon.png` and the wordmark by
 * relative path — every one of those would start warning and be left to luck.
 * Turning off the copy alone changes nothing about dev, nothing about
 * resolution, and only what lands on disk at the end.
 */
import { defineConfig, type Plugin } from "vite";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createReadStream, statSync } from "node:fs";
import { buildAssetPlan, encodeOnDemand } from "./scripts/encode-assets.mjs";

const MIME: Record<string, string> = {
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

/**
 * Ship the light copy, and serve the same light copy in dev.
 *
 * The dev half exists because of this project's history rather than for
 * performance. Thirteen instruments in `docs/VISUAL-OVERHAUL-STATE.md` produced
 * confident wrong answers, and several of them were right about what they
 * measured and wrong about *which build* they measured. If dev served PNG and
 * production served WebP, then `verify:art` — which runs against the dev server
 * on purpose, so it fetches files as they are served — would be permanently
 * unable to see the format the player actually gets. One extension order
 * everywhere, and dev encodes the first time a WebP is asked for.
 */
function lightAssets(): Plugin {
  let outDir = "dist";
  /**
   * **`closeBundle` fires in dev.** Vite's dev plugin container calls it when
   * the server shuts down, which includes the automatic restart that happens
   * every time this file is saved — so the first version of this plugin
   * re-encoded all 338 masters and wrote a full `dist/` every time anyone
   * touched the config, on a machine with four other builders working against
   * the same dev server. It threw no error and produced correct output, which
   * is why it was found by a cache counter reading "0 encoded" for work nobody
   * had asked for rather than by anything failing.
   *
   * `apply: "build"` cannot express this: the plugin needs `configureServer`
   * too. So the hook checks the command instead.
   */
  let isBuild = false;
  return {
    name: "hypebound:light-assets",

    configResolved(config) {
      outDir = config.build.outDir;
      /**
       * `write: false` is how a tool asks for the bundle in memory without a
       * directory — `scripts/_enc_chunks.mjs` does exactly that to read Rollup's
       * per-module sizes. Without this clause the probe still triggered the
       * copy and put 80 MB of card art somewhere it would only be deleted
       * again, which is slow enough to look like the probe being expensive.
       */
      isBuild = config.command === "build" && config.build.write !== false;
    },

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0];
        if (!url || !url.startsWith("/assets/")) return next();
        const ext = path.extname(url).toLowerCase();
        if (!MIME[ext]) return next();

        void encodeOnDemand(decodeURIComponent(url.slice(1)))
          .then((file) => {
            if (!file) return next();
            res.setHeader("Content-Type", MIME[ext]);
            // No caching in dev: the encode is derived from a file the owner is
            // actively replacing, and a stale 304 on a card they just repainted
            // is the exact confusion this whole change exists to end.
            res.setHeader("Cache-Control", "no-store");
            createReadStream(file).pipe(res);
          })
          .catch(next);
      });
    },

    /**
     * `closeBundle`, not `writeBundle`. Both run after the chunks are on disk,
     * but `closeBundle` is the last hook of the whole build, so the weight
     * report printed here is a report of the finished `dist` and not of a
     * `dist` that is still being written to.
     */
    async closeBundle() {
      if (!isBuild) return;
      const started = Date.now();
      const { plan, stats } = await buildAssetPlan({ log: (m: string) => this.info(m) });

      const entries = [...plan];
      // Bounded, because 430 concurrent copies exhausts the file-handle table
      // on Windows and fails with EMFILE rather than with anything readable.
      let cursor = 0;
      await Promise.all(
        Array.from({ length: Math.min(24, entries.length) }, async () => {
          for (let i = cursor++; i < entries.length; i = cursor++) {
            const [rel, from] = entries[i]!;
            const to = path.join(outDir, rel);
            await mkdir(path.dirname(to), { recursive: true });
            await copyFile(from, to);
          }
        })
      );

      let bytes = 0;
      for (const from of plan.values()) bytes += statSync(from).size;
      this.info(
        `public assets → ${outDir}: ${plan.size} files, ${(bytes / 1024 / 1024).toFixed(2)} MB ` +
          `(${stats.encoded} encoded, ${stats.cached} cached, ${stats.verbatim} verbatim) in ${((Date.now() - started) / 1000).toFixed(1)}s`
      );
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [lightAssets()],
  server: {
    host: true // allow LAN access for mobile-device testing
  },
  build: {
    target: "es2022",
    copyPublicDir: false,
    /**
     * Left where it was. The entry chunk is still over it and still warns, and
     * that warning is the last honest thing pointing at the one part of this
     * problem a build config cannot reach — see the note on `manualChunks`.
     * Raising the limit until the warning stops would be tidying away the
     * finding.
     */
    chunkSizeWarningLimit: 1500,
    /**
     * The 3,040 kB entry chunk, split — and what that is and is not worth.
     *
     * `scripts/_enc_chunks.mjs` reports Rollup's own per-module `renderedLength`
     * and walks the static import graph. Unsplit, the entry is 3,386 kB before
     * minification, and the largest thing in it is **`src/ui/screens` at
     * 1,036 kB** — all 49 screens, every one imported statically by `main.ts`.
     * Next is three.js at 927 kB (514 kB minified), reached by the shortest
     * static chain `main.ts → ui/intro/index.ts → ui/art/texture.ts → three`:
     * module B of the foundation contract opens with `import * as THREE from
     * "three"` and nearly every screen imports it.
     *
     * That is why the honest result of this option is a **caching** win and not
     * a first-load one. Measured: before, one 3,040 kB chunk at 883 kB gzipped;
     * after, 2,476 + 514 + 55 kB at 741 + 131 + 13 kB gzipped. First load moves
     * by about two kilobytes. What changes is that a deploy of game code — which
     * happens on every push — no longer invalidates the 131 kB of three.js and
     * 13 kB of zod already in a returning player's cache, so a repeat visit
     * re-downloads 741 kB instead of 883 kB.
     *
     * The first-load fix is real and is not available from here: lazy-import the
     * screens behind the router in `main.ts`, and put three.js behind a dynamic
     * boundary in `texture.ts`. `postprocessing` (602 kB) already has exactly
     * that treatment and the probe confirms it — no static chain reaches it, so
     * it is not on a first load at all.
     */
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three"],
          zod: ["zod"]
        }
      }
    }
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node"
  }
});
