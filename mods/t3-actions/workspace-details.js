// A native popup, never a layout column: opening it cannot resize a terminal (ADR 0017).
import { div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { spaces, panes, focused, props, settings, openOverlay, closeOverlay, exec, notify, run, theme, window, shared, setShared } from "herdr";
import { stop, focusRoot } from "./focus.js";
import { button, DISABLED } from "./button.js";
import { terminalFor } from "./terminal-context.js";
import { KEY } from "./store.js";
import { panelState } from "./panel.js";

let detailsOverlay = null; // Only this run's popup id; outside close clears it.
export const openedDetails = () => detailsOverlay;
export function dismissDetails() { if (detailsOverlay) closeOverlay(detailsOverlay); detailsOverlay = null; }

export function sourceOkay(source) {
  const sp = spaces().find(s => s.active);
  return !source || (sp?.id === source.space && sp.tabs.some(t => t.active && t.id === source.tab)
    && (!source.terminal || panes().some(p => p.terminal === source.terminal && p.tab === source.tab)));
}

export function toggleDetails(bounds) {
  if (detailsOverlay) return dismissDetails();
  const sp = spaces().find(s => s.active), current = focused();
  if (!sp) return;
  const tab = sp.tabs.find(t => t.active)?.id;
  const sameTab = panes().filter(p => p.tab === tab), focusedHere = current?.terminal && current.space === sp.id && current.tab === tab;
  const f = focusedHere ? current : terminalFor(sp.id, tab) ?? sameTab.find(p => p.terminal && p.cwd);
  const source = { space: sp.id, tab, pane: f?.pane, terminal: f?.terminal, machine: sp.machine,
    folder: f?.cwd || sameTab.find(p => p.cwd)?.cwd || sp.folder };
  // Shortcut invoked while maximized: restore work without hiding the panel or changing its surfaces.
  const z = Number(settings().zoom) || 1;
  // Keyboard opens have no press bounds: measured header widths keep the popup under the same button.
  const measured = /** @type {any} */ (globalThis).t3Titlebar, viewport = globalThis.window?.viewport_size?.();
  if (!bounds && viewport) {
    const right = viewport.width - (measured?.end ?? 36 * z) - 4 * z - (panelState().open ? (measured?.panel ?? 480 * z) + 16 * z : 0);
    bounds = { x: right - 28 * z, y: 6 * z, width: 28 * z, height: 28 * z };
  }
  detailsOverlay = openOverlay({ mod: "t3-actions", kind: "popup", frame: "none", width: 280, height: 420,
    ...(bounds ? { at: { x: bounds.x + bounds.width - 280 * z, y: bounds.y + bounds.height + 4 * z } } : {}),
    props: { actions: "details", source } });
}

export function detailsClosed(id) {
  if (detailsOverlay === id) { detailsOverlay = null; run("t3-actions.dismiss-details", {}); }
  setShared("t3-actions.detailsClosed", Date.now());
}

export function initDetails(view, cx) {
  view.detailsKeys = cx.focus_handle(); view.detailsKeys.focus();
  view.machineName = props().source.machine || "This Mac";
  view.targets = ["Finder"];
  view.target = "Finder";
  if (!props().source.machine && window()?.platform === "macos") cx.spawn(async (cx) => {
    view.targets = await installedTargets();
    view.target = view.targets.includes(shared(KEY.openTarget)) ? shared(KEY.openTarget) : "Finder";
    if (shared(KEY.openTarget) && view.target === "Finder") setShared(KEY.openTarget, "Finder");
    cx.notify();
  });
  if (!props().source.machine) cx.spawn(async (cx) => {
    const r = await exec("scutil", ["--get", "ComputerName"]).catch(() => null);
    if (r?.code === 0) view.machineName = r.stdout.trim();
    cx.notify();
  });
  cx.timer.every(100, () => {
    if (sourceOkay(props().source)) return;
    closeOverlay(props().overlay);
    notify({ title: "Open details again", body: "The source space, tab or terminal changed.", level: "warning" });
  });
}

let targets = null; // This run's parallel LaunchServices probe, not a process on every draw.
function installedTargets() {
  return targets ??= Promise.all(["Visual Studio Code", "Cursor", "Zed", "Sublime Text"].map(async name => {
    const r = await exec("open", ["-Ra", name]).catch(() => null);
    return r?.code === 0 ? name : null;
  })).then(found => ["Finder", ...found.filter(Boolean)]);
}

async function openTarget(name, source) {
  if (!sourceOkay(source) || source.machine || !source.folder) return;
  if (name !== "Finder") {
    const present = await exec("open", ["-Ra", name]).catch(() => null);
    if (present?.code !== 0) { name = "Finder"; targets = null; }
  }
  if (!sourceOkay(source)) return;
  setShared(KEY.openTarget, name);
  const r = await exec("open", name === "Finder" ? [source.folder] : ["-a", name, source.folder]);
  if (r.code !== 0) throw new Error(r.stderr);
}

export function openInMenu(view) {
  const p = props(), t = theme(), done = () => closeOverlay(p.overlay), names = p.targets;
  const choose = name => { if (!sourceOkay(p.source)) return done(); done(); closeForAction(); openTarget(name, p.source).catch(e => notify({ title: "Couldn't open directory", body: String(e), level: "error" })); };
  return focusRoot(view, v_flex().id("open-in-menu").size_full().p(4).bg(t.popover).track_focus(view.keys)
    .on_key_down((e, cx) => {
      if (e.key === "escape") done();
      else if (e.key === "enter" && view.at >= 0) choose(names[view.at]);
      else if (["up", "down"].includes(e.key)) view.at = (view.at + (e.key === "down" ? 1 : names.length - 1) + names.length) % names.length;
      else return;
      cx.stop_propagation(); cx.notify();
    }).children(names.map((name, i) => h_flex().id(`open-in-${i}`).h(28).px(8).items_center().rounded(4).text_size(14).text_color(t.foreground)
      .when(view.at === i, el => el.bg(t.selected)).gap(8).on_hover((on, cx) => { view.at = on ? i : -1; cx.notify(); }).on_click(() => choose(name)).child(targetIcon(name, t)).child(name))));
}

const targetFiles = { Finder: "finder", "Visual Studio Code": "vscode", Cursor: "cursor", Zed: "zed" };
function targetIcon(name, t) {
  const icon = targetFiles[name] ?? "app-window";
  return ["finder", "vscode"].includes(icon) ? image(`mods/t3-actions/icons/${icon}.svg`).size(16).flex_none()
    : svg(`mods/t3-actions/icons/${icon}.svg`).size(16).flex_none().text_color(t.dim);
}

export function detailsRow(t, id) {
  // docs/internals/t3-tokens.md: 详情 popup geometry, card hover (7%); rows/split groups do not use button().
  return h_flex().id(id).h(32).min_w(0).gap(10).px(10).items_center().rounded(8).text_size(13).font_medium().text_color(t.foreground)
    .hover(el => el.bg(t.foreground + "12"));
}

export function directoryMenu(view) {
  const t = theme(), p = props();
  const copy = cx => { cx.write_to_clipboard(p.source.folder ?? ""); closeOverlay(p.overlay); };
  return v_flex().id("details-directory-menu").p(4).bg(t.popover).track_focus(view.keys)
    .on_key_down((e, cx) => { if (e.key === "enter") copy(cx); else if (e.key === "escape") closeOverlay(p.overlay); else return; cx.stop_propagation(); })
    .child(h_flex().id("details-copy-directory").h(28).px(8).rounded(4).items_center().text_size(14).text_color(t.foreground).hover(el => el.bg(t.selected)).on_click((_e, cx) => copy(cx)).child("Copy directory"));
}

export function closeForAction() {
  const p = props();
  if (p?.details) closeOverlay(p.details);
  if (p?.actions === "details") closeOverlay(p.overlay);
}

export function detailsView(view, control) {
  const t = theme(), p = props(), s = p.source, remote = Boolean(s.machine), available = !remote && window()?.platform === "macos" && Boolean(s.folder);
  const done = () => closeOverlay(p.overlay);
  const reason = remote ? "Local applications cannot open a remote directory" : !s.folder ? "No working directory" : "Open in is only available on macOS";
  const openSpace = () => { done(); openOverlay({ mod: "t3-menu", kind: "popup", width: 220, height: 260, props: { tab: "space", target: { id: s.space } } }); };
  const content = v_flex().id("details-content").w_full().flex_none().p(8)
    .on_size_change((size, cx) => {
      const height = Math.ceil(size.height / (Number(settings().zoom) || 1));
      if (height > 0 && height !== view.detailsHeight) { view.detailsHeight = height; cx.notify(); }
    })
    .child(stop(view, t, "details-space-menu", detailsRow(t, "details-space-menu").role("button").accessibility_label("Space menu").on_click(openSpace)
      .child(svg("mods/t3-actions/icons/laptop.svg").size(16).flex_none().text_color(t.dim))
      .child(div().id("details-machine-name").flex_1().min_w(0).truncate().whitespace_nowrap().child(view.machineName))
      .child(stop(view, t, "details-path", button(t, "details-path", { label: "Working directory", surface: "card" })
        .child(svg("mods/t3-actions/icons/folder.svg").size(16).text_color(t.dim)).tooltip(s.folder || "No working directory")
        .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(s.folder ?? ""); })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "t3-actions", kind: "popup", width: 220, height: 36, props: { actions: "directory-menu", source: s } }); }), 8))
      .child(svg("mods/t3-actions/icons/chevron-down.svg").size(16).flex_none().text_color(t.dim)), 8))
    .child(h_flex().id("details-open-row").h(32).min_w(0).items_center().rounded(8).on_hover((on, cx) => { view.openHot = on; cx.notify(); })
      .child(stop(view, t, "details-finder", detailsRow(t, "details-finder").flex_1().rounded_r(0).role("button").accessibility_label(`Open in ${view.target}`)
        .when(!available, el => el.opacity(DISABLED)).tooltip(available ? s.folder : reason).when(available, el => el.on_click(() => {
          if (!sourceOkay(s)) return;
          done(); openTarget(view.target, s).catch(e => notify({ title: "Couldn't open directory", body: String(e), level: "error" }));
        })).child(targetIcon(view.target, t)).child(div().flex_1().min_w(0).truncate().child(`Open in ${view.target}`)), 8))
      .when(available && view.targets.length > 1, el => el.child(div().w(1).h(16).bg(view.openHot ? t.border : t.popover)).child(stop(view, t, "details-open-more", detailsRow(t, "details-open-more").w(32).px(0).justify_center().rounded_l(0).role("button").accessibility_label("Choose application")
        .on_mouse_down("left", (e) => { view.openPress = e.bounds; })
        .on_click(() => { const b = view.openPress, z = Number(settings().zoom) || 1; openOverlay({ mod: "t3-actions", kind: "popup", width: 220, height: 8 + view.targets.length * 28,
          ...(b ? { at: { x: b.x + b.width - 220 * z, y: b.y + b.height + 4 * z } } : {}), props: { actions: "open-in", source: s, details: p.overlay, targets: view.targets } }); })
        .child(svg("mods/t3-actions/icons/chevron-down.svg").size(16).text_color(t.dim)), 8))))
    .child(control(view, t, (_e, cx) => cx.stop_propagation()));
  // A root scroller with only max-height measures to zero in a native popup (layout-implementation.md).
  return focusRoot(view, v_flex().id("workspace-details").w_full().h(Math.min(420, Math.max(50, (view.detailsHeight ?? 112) + 2))).max_h(420).min_h(50).overflow_y_scrollbar().rounded(16).border(1).border_color(t.border).bg(t.popover).shadow_lg()
    .track_focus(view.detailsKeys).on_key_down((e, cx) => { if (e.key === "escape") { done(); cx.stop_propagation(); } })
    .child(content));
}
