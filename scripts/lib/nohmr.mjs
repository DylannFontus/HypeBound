/**
 * Stop Vite's HMR client reloading the page in the middle of a measurement.
 *
 * Fifteen builders share one dev server. Any of them saving a file that is not
 * hot-acceptable makes the client call `location.reload()`, and a screencast
 * that runs across that reload reports the boot plate as a two-and-a-half
 * second dead window and blames the game for it — which is exactly what
 * happened twice before this file existed.
 *
 * The client module is fetched as normal and the one call is neutered, so every
 * other thing it does (CSS swapping, error overlays) still works.
 */
export async function suppressHmrReload(page) {
  await page.route("**/@vite/client", async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replaceAll(
      "location.reload()",
      "console.warn('[measure] hmr reload suppressed')"
    );
    await route.fulfill({ response, body, headers: { ...response.headers(), "content-type": "application/javascript" } });
  });
}
