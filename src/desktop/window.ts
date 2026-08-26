/**
 * Fullscreen for the Windows shell, and the four traps that are not obvious.
 *
 * The desktop build is the web build in a WebView2 window (`src-tauri/`). That
 * property is worth keeping, so nothing here is a desktop-only *build* — it is
 * one module the whole game imports, which resolves to nothing at all in a
 * browser. `isDesktopShell()` is the only branch, it is asked at runtime, and it
 * asks the runtime rather than the user agent: Tauri defines `window.isTauri` on
 * every page it hosts (`tauri/src/manager/webview.rs`), and a user-agent string
 * is a claim anybody can make.
 *
 * ## Trap one: the window remembers the wrong rectangle
 *
 * `tauri-plugin-window-state` persists size, position **and** fullscreen, so the
 * choice survives a restart for free and survives it *natively* — restored
 * before the first frame is painted rather than after the page boots, which is
 * the difference between opening fullscreen and opening windowed and jumping.
 *
 * But its `Resized`/`Moved` handlers exclude a maximised window and a minimised
 * one and **do not exclude a fullscreen one** (v2.4.1, `lib.rs::update_state`).
 * Go fullscreen and the geometry it saves is the monitor's. Quit there,
 * relaunch, leave fullscreen — and the window you come back to is monitor-sized
 * with its bottom edge behind the taskbar, not the 1600x900 you had. So the
 * rectangle to come back to is kept here, written the instant before fullscreen
 * is entered, and re-applied by hand on the way out. When there is none stored
 * we set nothing and let tao's own saved placement do it, which is right within
 * a session and only ever wrong across one.
 *
 * ## Trap two: this cannot live in `Settings`
 *
 * A window rectangle looks like a setting and is not one. `settingsStore` is one
 * of the five sections `cloudSaves.ts` uploads and merges across devices, so a
 * rectangle put there would be pushed from the 4K desktop onto the 1366x768
 * laptop — the exact "restore onto a monitor that is not there" failure the
 * window-state plugin exists to prevent, reintroduced through the save system.
 * Hence a store of its own, which nothing syncs. It still lives under
 * `hypebound:`, so the privacy screen's export and delete both see it; losing it
 * costs a default window size once and nothing else.
 *
 * ## Trap three: Escape belongs to the game
 *
 * Escape cancels a target, cancels a placement, drops a card mid-drag, closes
 * the lobby drawer, closes the collection sheet and opens the battle menu. F11
 * is unclaimed anywhere in the source; Escape is claimed six times. So Escape
 * leaves fullscreen **only when nothing else wanted it**, and answering that
 * needs two readings at two different moments, which is the part that is easy to
 * get wrong:
 *
 *   - *was anything open?* — read **first**, from a `window` capture listener,
 *     because the drawer that owns this Escape closes itself during the
 *     dispatch. Asked late, the answer is always "no".
 *   - *did anybody take the key?* — read **last**, in a `setTimeout(0)`, because
 *     `battleView.ts` listens on `window` and `defaultPrevented` is not final
 *     until every handler has run.
 *
 * Both halves were needed; the first draft had only the second and one press
 * shut the lobby drawer *and* left fullscreen.
 *
 * ## Trap four: two F11s in a row
 *
 * Every call into the window is asynchronous IPC, so a second press can arrive
 * while the first is still in flight. `intent` is updated synchronously at the
 * keystroke and the operations are queued behind one promise chain, so N presses
 * always leave the window in the state the Nth press asked for. Reading the live
 * state instead would make the second press a no-op.
 */

import { createStore } from "../save/storage";

/** Outer position and inner size — the pair `tauri-plugin-window-state` stores. */
export interface WindowedBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DesktopWindowState {
  /** what the player last asked for, mirrored so the switch can paint without waiting on IPC */
  fullscreen: boolean;
  /** where to put the window back, see trap one */
  windowed: WindowedBounds | null;
}

/**
 * Its own store, for the reason in trap two.
 *
 * `windowed` defaults to `null` rather than to a rectangle: `fillDefaults` never
 * replaces a saved value with a default, and "we have never seen this window
 * windowed" has to be distinguishable from "it was 1600x900", because the first
 * means *leave tao's placement alone* and the second means *override it*.
 */
export const desktopWindowStore = createStore<DesktopWindowState>({
  key: "desktop-window",
  version: 1,
  defaults: (): DesktopWindowState => ({ fullscreen: false, windowed: null }),
});

/**
 * The slice of Tauri's global API this module touches, and nothing else.
 *
 * Declared rather than imported. `@tauri-apps/api` is not a dependency of this
 * project and adding it would put a package in `package.json` that only one of
 * the two builds can use, which `tests/fairness.test.ts` would then require a
 * legal entry for. `withGlobalTauri` in `tauri.conf.json5` injects the same
 * bundle into the webview at runtime instead — no npm package, nothing fetched,
 * and the web bundle is byte-identical. The cost is that these types are ours to
 * keep honest; the shapes below were read off
 * `tauri-2.11.5/scripts/bundle.global.js`, not remembered.
 */
interface TauriWindowHandle {
  isFullscreen(): Promise<boolean>;
  setFullscreen(value: boolean): Promise<void>;
  /** the client area, which is what `setSize` sets */
  innerSize(): Promise<{ width: number; height: number }>;
  /** the frame's top-left, which is what `setPosition` sets */
  outerPosition(): Promise<{ x: number; y: number }>;
  setSize(size: object): Promise<void>;
  setPosition(position: object): Promise<void>;
}

interface TauriGlobal {
  window: { getCurrentWindow(): TauriWindowHandle };
  dpi: {
    PhysicalSize: new (width: number, height: number) => object;
    PhysicalPosition: new (x: number, y: number) => object;
  };
}

interface TauriHost {
  isTauri?: boolean;
  __TAURI__?: TauriGlobal;
}

let api: TauriGlobal | null | undefined;

function tauri(): TauriGlobal | null {
  if (api !== undefined) return api;
  api = null;
  if (typeof window === "undefined") return api;
  const host = window as unknown as TauriHost;
  /*
   * `isTauri` is defined by the runtime on every page it hosts. The second half
   * is not paranoia: `withGlobalTauri` is a config flag, and if it is ever
   * turned off this module must degrade to "no desktop controls" rather than
   * throw on the first keystroke.
   */
  if (host.isTauri !== true) return api;
  const global = host.__TAURI__;
  if (typeof global?.window?.getCurrentWindow !== "function") return api;
  if (typeof global.dpi?.PhysicalSize !== "function") return api;
  api = global;
  return api;
}

let handleCache: TauriWindowHandle | null | undefined;

function handle(): TauriWindowHandle | null {
  if (handleCache !== undefined) return handleCache;
  const global = tauri();
  handleCache = global ? global.window.getCurrentWindow() : null;
  return handleCache;
}

/** True only inside the packaged Windows shell, on the evidence of the runtime. */
export function isDesktopShell(): boolean {
  return handle() !== null;
}

// --- state -------------------------------------------------------------------

/** What the player last asked for. Synchronous, and what the UI shows. */
let intent = false;
const listeners = new Set<(fullscreen: boolean) => void>();
let chain: Promise<unknown> = Promise.resolve();
let installed = false;

/** The state to paint a switch with, without waiting for a round trip. */
export function desktopFullscreen(): boolean {
  return intent;
}

/** Fires on every settled change, including one made with F11 from another screen. */
export function onDesktopFullscreenChange(listener: (fullscreen: boolean) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function settle(fullscreen: boolean): void {
  intent = fullscreen;
  if (desktopWindowStore.get().fullscreen !== fullscreen) {
    desktopWindowStore.set({ fullscreen });
  }
  for (const listener of listeners) listener(fullscreen);
}

/**
 * Every window operation, one after another.
 *
 * A rejection here is a permission the capability file does not grant, or a
 * window that has gone away. Neither is worth a crash in a card game, so it is
 * logged and the mirror is put back in step with whatever the window actually
 * says — an out-of-date switch is a smaller defect than a switch that lies.
 */
function queue(step: (target: TauriWindowHandle, global: TauriGlobal) => Promise<void>): void {
  const target = handle();
  const global = tauri();
  if (!target || !global) return;
  chain = chain
    .then(() => step(target, global))
    .catch(async (error: unknown) => {
      console.warn("[desktop] window operation failed", error);
      try {
        settle(await target.isFullscreen());
      } catch {
        /* the window is gone; there is nothing left to correct */
      }
    });
}

/** Ask for a state. Safe to call before `installDesktopWindow`, and on the web. */
export function setDesktopFullscreen(fullscreen: boolean): void {
  if (!isDesktopShell()) return;
  intent = fullscreen;
  queue(async (target, global) => {
    if ((await target.isFullscreen()) === fullscreen) {
      settle(fullscreen);
      return;
    }

    if (fullscreen) {
      /*
       * Captured before the transition, never after: once the window is
       * fullscreen its inner size is the monitor's and there is nothing left to
       * remember. Zero-sized readings are dropped for the same reason the
       * window-state plugin drops them — a minimised window reports 0x0, and
       * saving that would restore an invisible window.
       */
      const [size, at] = await Promise.all([target.innerSize(), target.outerPosition()]);
      if (size.width > 0 && size.height > 0) {
        desktopWindowStore.set({ windowed: { x: at.x, y: at.y, width: size.width, height: size.height } });
      }
      await target.setFullscreen(true);
      settle(true);
      return;
    }

    await target.setFullscreen(false);
    const back = desktopWindowStore.get().windowed;
    if (back) {
      /*
       * Size first, then position: `setSize` keeps the top-left where it is, so
       * doing it the other way round would move the window and then resize it
       * away from where it had just been put.
       */
      await target.setSize(new global.dpi.PhysicalSize(back.width, back.height));
      await target.setPosition(new global.dpi.PhysicalPosition(back.x, back.y));
    }
    settle(false);
  });
}

/**
 * Module-private on purpose: F11 is the only thing that toggles rather than
 * sets, and an exported second way to change this state is a second thing to
 * keep in step with the switch on the settings screen.
 */
function toggleDesktopFullscreen(): void {
  setDesktopFullscreen(!intent);
}

// --- keys --------------------------------------------------------------------

const isTextField = (node: Element | null): boolean =>
  node instanceof HTMLInputElement ||
  node instanceof HTMLTextAreaElement ||
  (node instanceof HTMLElement && node.isContentEditable);

/** Anything Escape should be dismissing before it starts moving the window. */
const somethingIsOpen = (): boolean =>
  document.querySelector('[data-open="true"], [aria-modal="true"], dialog[open]') !== null;

function onKeyDown(event: KeyboardEvent): void {
  /*
   * Nothing can have cancelled the default yet — this runs in the capture phase
   * on `window`, which is the first listener in the dispatch. It is checked
   * anyway because "first" is only true while nothing else registers a window
   * capture listener ahead of this one, and that is a property of load order
   * rather than a guarantee.
   */
  if (event.defaultPrevented) return;
  if (event.ctrlKey || event.altKey || event.metaKey) return;

  if (event.key === "F11") {
    /*
     * `repeat` matters: holding the key down would otherwise flip the window
     * dozens of times a second.
     */
    if (event.repeat) return;
    event.preventDefault();
    toggleDesktopFullscreen();
    return;
  }

  if (event.key !== "Escape" || !intent) return;

  /*
   * Two questions about the same keystroke, asked at two different times. The
   * first draft asked both of them late, and `_wfs_escape.mjs` caught it: one
   * press closed the lobby drawer *and* left fullscreen.
   *
   * "Was something open?" has to be asked **now**, before the dispatch finishes.
   * Deferring it reads the world *after* the handler that owned this Escape has
   * already closed the drawer — so the drawer shut and the window left
   * fullscreen on one press, which is precisely the double action the guard
   * exists to prevent.
   *
   * "Did anybody take the key?" can only be asked **later**, because
   * `battleView.ts` listens on `window` and registers after this module does, so
   * `defaultPrevented` is not final until the whole dispatch has run. A
   * `setTimeout(0)` is a fresh task and therefore after all of it; a microtask
   * would run between listeners and would be no better than reading it inline.
   *
   * `preventDefault` is never called on this path either way: deciding not to
   * take the key is the whole point, and cancelling the default would take it
   * from whoever runs after us.
   */
  if (somethingIsOpen() || isTextField(document.activeElement)) return;
  setTimeout(() => {
    if (event.defaultPrevented || !intent) return;
    setDesktopFullscreen(false);
  }, 0);
}

/**
 * Bind the keys and find out what the window is actually doing. Idempotent.
 *
 * **The window wins the boot, not the store.** The plugin has already restored
 * fullscreen natively by the time any of this runs, so pushing the stored
 * preference back at it would at best be a no-op and at worst fight it. The
 * mirror is corrected from the window instead, which is also what keeps the
 * settings switch honest after a crash, or after a hand edit of the state file.
 */
export function installDesktopWindow(): void {
  if (installed) return;
  installed = true;
  if (!isDesktopShell()) return;

  intent = desktopWindowStore.get().fullscreen;
  /*
   * **Capture, not bubble**, and this was a bug before it was a decision.
   *
   * The lobby's drawer listens on `document`, and in the bubble phase `document`
   * runs before `window` — so by the time a bubble-phase listener here asked
   * "was anything open?", the drawer had already closed itself and the answer
   * was no. Escape then shut the drawer *and* left fullscreen on one press.
   * Capture on `window` is the first listener in the whole dispatch, so the
   * snapshot it takes is genuinely the state the player pressed the key in.
   *
   * It does not undermine the deferred half: `defaultPrevented` is still read a
   * task later, when every other handler has had its turn.
   */
  window.addEventListener("keydown", onKeyDown, { capture: true });
  queue(async (target) => {
    settle(await target.isFullscreen());
  });
}
