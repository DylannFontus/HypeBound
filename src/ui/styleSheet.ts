/**
 * A `<style>` element the page's Content-Security-Policy will actually honour.
 *
 * ## The failure this exists to prevent
 *
 * The desktop build ships a strict CSP, and Tauri rewrites it on the way out:
 * it appends a per-response `nonce-…` to `style-src` so the boot styles it puts
 * into `index.html` are allowed. That one addition changes what the whole
 * directive means, because CSP says a directive carrying a nonce **ignores
 * `'unsafe-inline'` entirely**. So the policy written in `tauri.conf.json5` as
 *
 *     style-src 'self' 'unsafe-inline'
 *
 * reaches the webview as `'self' 'unsafe-inline' 'nonce-XXX'` and behaves as
 * `'self' 'nonce-XXX'`. Every stylesheet the app builds at runtime is dropped.
 *
 * Nine modules install a stylesheet that way — the icon sizing, the texture
 * variables, the battle HUD, the collection kit, the gallery, the play screen's
 * tile art, the pack-opening room, the rewards theme and the UI kit. The
 * browser build has no CSP at all, so all nine worked in every test, in every
 * screenshot and on GitHub Pages, and all nine were dead in the .exe.
 *
 * Measured rather than assumed: in the running app `hb-icon-style` and
 * `hb-texture-vars` were both in `<head>` with their full text, and both had a
 * null `.sheet`, while the one style Tauri had noncced itself was live. The
 * visible symptom was the wallet. `.hb-icon` takes its `width: 1em` from
 * `hb-icon-style`, so with that sheet dead every currency icon laid out at 0×0,
 * `iconAssets.ts` measured 0 against a `minPx` of 14, withheld `hb-mark-fits`
 * exactly as designed, and the chip rendered a bare number. Nothing along that
 * chain was broken; it was reading a stylesheet that had never been applied.
 *
 * ## Why the nonce is read out of the document
 *
 * It is generated per response, so the only value that can possibly match the
 * header is the one already in the page. `getAttribute("nonce")` is
 * deliberately blanked by browsers — "nonce hiding", which stops the value
 * leaking through CSS attribute selectors — so the `.nonce` IDL property is the
 * supported way for same-origin script to read it back.
 *
 * Where there is no nonce (the browser build, jsdom, a test document) this
 * changes nothing at all: no attribute is set, and `'unsafe-inline'` — or the
 * absence of any policy — keeps applying exactly as before.
 */

/**
 * Cached per document. The scan walks every `<style>` and `<script>` in the
 * page, and the answer cannot change for the life of that document.
 *
 * Only a **found** nonce is cached. Caching the empty answer would be a bug:
 * the first caller can run before the element carrying the nonce has been
 * parsed, and one early miss would then be remembered forever and take all nine
 * stylesheets down with it.
 */
const NONCE = new WeakMap<Document, string>();

/** The CSP nonce this document was served with, or `""` if it has none. */
function documentNonce(doc: Document): string {
  const cached = NONCE.get(doc);
  if (cached) return cached;

  let found = "";
  for (const element of doc.querySelectorAll<HTMLElement>("style, script")) {
    // `.nonce` first: the content attribute is blanked by nonce hiding, so
    // reading the attribute alone finds an empty string on exactly the
    // browsers this function exists for.
    const value = element.nonce || element.getAttribute("nonce") || "";
    if (value) {
      found = value;
      break;
    }
  }

  if (found) NONCE.set(doc, found);
  return found;
}

/**
 * Create a `<style>` carrying the document's nonce, if it has one.
 *
 * Use this instead of `document.createElement("style")` anywhere the element is
 * going into the live page. `tests/csp-styles.test.ts` holds the codebase to
 * it, because the failure is completely silent — the element is in the DOM with
 * the right text, and only `.sheet` being null says it never applied.
 */
export function createStyleElement(doc: Document = document): HTMLStyleElement {
  const style = doc.createElement("style");
  const nonce = documentNonce(doc);
  if (nonce) style.nonce = nonce;
  return style;
}
