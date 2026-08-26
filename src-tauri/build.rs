// Tauri's build script. It compiles `tauri.conf.json` into the crate, and on
// Windows it is also what puts `icons/icon.ico` into the executable's resource
// table — which is why the .exe, the taskbar button and the Alt-Tab card all
// show the HB mark without anything else asking for it.
fn main() {
    tauri_build::build()
}
