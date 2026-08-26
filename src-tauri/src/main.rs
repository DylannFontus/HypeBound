/*!
Twenty lines that turn a website into a Windows game, and the two traps in them.

Everything HYPEBOUND does happens in the webview. This file opens the webview,
hands it the bundled `dist/`, and gets out of the way. There are deliberately no
`#[tauri::command]` handlers: the moment the page can call into Rust, the desktop
build stops being the same program as the web build, and every screen has to be
reasoned about twice. It is not, and they do not.

## Trap one: the console window

`windows_subsystem = "windows"` is the difference between a game and a game with
a black terminal sitting behind it. It is applied only in release, because in a
debug run the terminal is where `console.log` and every Rust panic go — losing it
would mean debugging a desktop app with no output at all.

## Trap two: the white screen

The failure mode of every webview shell is a window that opens onto nothing, and
it is nearly always asset paths. This project was already immune before any of
this was written: `vite.config.ts` sets `base: "./"`, so the built `index.html`
asks for `./assets/index-*.js` rather than `/assets/index-*.js`. Tauri serves the
bundle from `http://tauri.localhost/` on Windows, which is not a filesystem root
and would 404 every absolute path. The relative base was there for GitHub Pages
subpaths; it is the single reason this port was tractable, and it is worth
knowing that it is load-bearing for two things now, not one. Checked, not
assumed: the first release build opened straight onto the starter-deck picker
with every card painting loaded.

`backgroundColor` in `tauri.conf.json5` covers the remaining flash: without it
the window paints white for the frame or two before the boot plate arrives, on a
game whose entire palette is near-black.
*/

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        /*
         * Window geometry survives a restart.
         *
         * A card game is a thing people leave open on a second monitor, and a
         * shell that re-centres a 1600x900 window on the primary display every
         * launch is a small insult repeated daily. The plugin stores size and
         * position per label and validates them against the monitors currently
         * attached, so a window last closed on a monitor that has since been
         * unplugged comes back on one that exists rather than off-screen.
         *
         * It writes to the OS app-data directory, not to localStorage — so it is
         * outside both the `hypebound:` export and the privacy screen's delete
         * sweep. That is correct: a window rectangle is not something the game
         * knows about you, and it is not something "delete my data" should have
         * an opinion on.
         */
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("the HYPEBOUND window could not be created");
}
