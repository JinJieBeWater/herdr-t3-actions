// This run's LaunchServices probe is shared across Files and Details; never launch after the captured source changes.
import { image, svg } from "gpui-kit";
import { exec } from "herdr";

// T3 contracts/editor.ts; LaunchServices also finds bundles absent from this GUI process's PATH.
const EDITORS = ["Cursor", "Trae", "Kiro", "Visual Studio Code", "Visual Studio Code - Insiders", "VSCodium", "Zed", "Antigravity",
  "IntelliJ IDEA", "Aqua", "CLion", "DataGrip", "DataSpell", "GoLand", "PhpStorm", "PyCharm", "Rider", "RubyMine", "RustRover", "WebStorm"];

export function installedTargets() {
  const cache = globalThis.t3OpenInTargets;
  if (cache?.version === 3) return cache.promise;
  const entry = { version: 3, names: null, promise: null };
  entry.promise = Promise.all(EDITORS.map(async name => {
    const r = await exec("open", ["-Ra", name]).catch(() => null);
    return r?.code === 0 ? name : null;
  })).then(names => entry.names = ["Finder", ...names.filter(Boolean)]);
  globalThis.t3OpenInTargets = entry;
  return entry.promise;
}

// A hot-reloaded view may have lost its init await; rendering reads only completed metadata.
export const knownTargets = () => globalThis.t3OpenInTargets?.version === 3 ? globalThis.t3OpenInTargets.names : null;

/** @param {string} name @param {string} path @param {() => boolean} [isCurrent] */
export async function openTarget(name, path, isCurrent = () => true) {
  if (!path || !isCurrent()) return null;
  if (!EDITORS.includes(name)) name = "Finder";
  if (name !== "Finder") {
    const present = await exec("open", ["-Ra", name]).catch(() => null);
    if (present?.code !== 0) { name = "Finder"; globalThis.t3OpenInTargets = null; }
  }
  if (!isCurrent()) return null;
  const r = await exec("open", name === "Finder" ? ["--", path] : ["-a", name, "--", path]);
  if (r.code !== 0) throw new Error(r.stderr || "The application couldn't be opened.");
  return name;
}

// T3's OpenInPicker: brand art in its own colours, a one-colour brand mark in the text's, any other app the dim generic window.
const APP_ART = { Finder: "finder", "Visual Studio Code": "vscode", VSCodium: "vscodium" }, APP_MARKS = { Cursor: "cursor", Zed: "zed" };
/** `mod` the folder whose icons/ holds them (scripts/sync.sh copies them into Files). @param {string} mod @param {string} name @param {any} t */
export function targetIcon(mod, name, t, size = 16) {
  if (APP_ART[name]) return image(`${mod}/icons/${APP_ART[name]}.svg`).size(size).flex_none();
  return svg(`${mod}/icons/${APP_MARKS[name] ?? "app-window"}.svg`).size(size).flex_none().text_color(APP_MARKS[name] ? t.foreground : t.dim);
}
