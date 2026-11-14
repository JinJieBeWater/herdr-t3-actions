// A native popup, never a layout column: opening it cannot resize a terminal (ADR 0017).
import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { spaces, panes, focused, props, settings, openOverlay, closeOverlay, exec, notify, run, theme, window, shared, setShared } from "herdr";
import { stop, focusRoot, pressed, justClosed, within } from "./focus.js";
import { DISABLED, split } from "./button.js";
import { terminalFor } from "./terminal-context.js";
import { KEY } from "./store.js";
import { panelState } from "./panel.js";
import { menuJump, scrollList } from "./list.js";
import { installedTargets, knownTargets, openTarget, targetIcon } from "./open-in.js";
import { glow, tip, tipMark } from "./tip.js";
import { nameText, measuredTooltip } from "./measured-text.js";

const DETAILS_ITEMS = [["environment", "Environment and worktree"], ["openIn", "Open in editor"], ["scripts", "Actions"], ["review", "Quick Review"]];
export function detailsVisibility() {
  const saved = shared(KEY.detailsItems);
  return Object.fromEntries(DETAILS_ITEMS.map(([id]) => [id, saved?.[id] !== false]));
}

// As the actions menu's rows: a leave reported after the next row's enter doesn't unlight that one.
const litRow = (view, at) => (on, cx) => { const to = on ? at : view.at === at ? -1 : view.at; if (to !== view.at) { view.at = to; cx.notify(); } };

// From its row: under it, its width, as the other rows' menus; from a right-click on the card, where the pointer is.
function chooseDetailsItems(view, bounds) { return openDetailsLayer("details-items", bounds ? { ...underDetails(view, bounds), height: 185 } : { width: 220, height: 185 }); }

export function detailsItemsMenu(view) {
  const t = theme(), visible = detailsVisibility(), dirty = Object.values(visible).some(on => !on), done = () => closeOverlay(props().overlay);
  const choose = (at, cx) => {
    if (at === DETAILS_ITEMS.length) { if (!dirty) return; setShared(KEY.detailsItems, {}); done(); }
    else if (DETAILS_ITEMS[at]) {
      const next = { ...visible, [DETAILS_ITEMS[at][0]]: !visible[DETAILS_ITEMS[at][0]] };
      setShared(KEY.detailsItems, Object.fromEntries(Object.entries(next).filter(([, on]) => !on)));
    }
    cx.notify();
  };
  const row = (id, at, label, disabled = false) => h_flex().id(id).h(28).px(8).gap(8).items_center().rounded(4).text_size(14).text_color(t.foreground)
    .when(disabled, el => el.disabled(true).opacity(DISABLED)).when(view.at === at && !disabled, el => el.bg(t.selected))
    .when(!disabled, el => el.on_hover(litRow(view, at)).on_click((_e, cx) => choose(at, cx)))
    .role("button").accessibility_label(label);
  return focusRoot(view, v_flex().id("details-items-menu").p(4).bg(t.popover).track_focus(view.keys)
    .on_key_down((e, cx) => {
      if (e.key === "escape") done();
      else if (e.key === "enter" || e.key === "space") choose(view.at, cx);
      else {
        const to = menuJump(view, e, [...DETAILS_ITEMS.map(([, label]) => label), ...(dirty ? ["Reset to default"] : [])], view.at);
        if (to < 0) return;
        view.at = to;
      }
      cx.stop_propagation(); cx.notify();
    })
    .child(h_flex().h(28).px(8).items_center().text_size(12).font_medium().text_color(t.dim).child("Show in thread details"))
    .children(DETAILS_ITEMS.map(([id, label], at) => row(`details-item-${id}`, at, label).role("check_box").checked(visible[id])
      .child(div().size(16).flex_none().when(visible[id], el => el.child(svg("mods/t3-actions/icons/check.svg").size(16))))
      .child(label)))
    .child(div().h(1).mx(8).my(4).bg(t.border))
    .child(row("details-items-reset", DETAILS_ITEMS.length, "Reset to default", !dirty).child("Reset to default")));
}

let detailsOverlay = null; // Only this run's popup id; outside close clears it.
// Only this run's child overlays: no persistent menu state or retained view/context.
const detailLayers = () => /** @type {any} */ (globalThis).t3DetailsLayers ??= new Map();
export const detailsLayerOpen = kind => [...detailLayers().values()].some(layer => layer.parent === props().overlay && layer.kind === kind);
export function detailsLayerClosed(id) { return detailLayers().delete(id); }
export function openDetailsLayer(kind, spec) {
  const p = props(), parent = p.actions === "details" ? p.overlay : p.details;
  const id = openOverlay({ mod: "t3-actions", kind: "popup", ...spec, props: { ...spec.props, actions: kind, source: p.source, details: parent } });
  if (parent) detailLayers().set(id, { parent, kind });
  return id;
}

export function underDetails(view, bounds) {
  const z = Number(settings().zoom) || 1, width = (view.detailsWidth ?? 264 * z) / z;
  return { width, ...(bounds ? { at: { x: bounds.x + bounds.width - width * z, y: bounds.y + bounds.height + 4 * z } } : {}) };
}
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
  for (const [child, layer] of detailLayers()) if (layer.parent === id) { detailLayers().delete(child); closeOverlay(child); }
  if (detailsOverlay === id) { detailsOverlay = null; run("t3-actions.dismiss-details", {}); }
  setShared("t3-actions.detailsClosed", Date.now());
}

export function initDetails(view, cx) {
  view.detailsKeys = cx.focus_handle(); view.detailsKeys.focus();
  view.machineName = props().source.machine || "This Mac";
  view.targets = knownTargets() ?? ["Finder"];
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

async function openDirectory(name, source) {
  if (!sourceOkay(source) || source.machine || !source.folder) return;
  const opened = await openTarget(name, source.folder, () => sourceOkay(source));
  if (opened) setShared(KEY.openTarget, opened);
}

const OPEN_IN_MAX = 420;

export function openInMenu(view) {
  const p = props(), t = theme(), done = () => closeOverlay(p.overlay), names = p.targets ?? [];
  const choose = name => { if (!sourceOkay(p.source)) return done(); setShared(KEY.openTarget, name); done(); };
  return focusRoot(view, v_flex().id("open-in-menu").size_full().p(4).bg(t.popover).track_focus(view.keys)
    .on_key_down((e, cx) => {
      if (e.key === "escape") done();
      else if ((e.key === "enter" || e.key === "space") && view.at >= 0) choose(names[view.at]);
      else {
        if (!names.length) return;
        const to = menuJump(view, e, names, view.at);
        if (to < 0) return;
        view.at = to;
      }
      cx.stop_propagation(); cx.notify();
    }).when(!names.length, el => el.child(h_flex().id("open-in-unavailable").min_h(28).px(8).items_center().text_size(14).text_color(t.dim).child(p.reason ?? "No installed editors found")))
    // list.js's scrollList, OPEN_IN_MAX at most, so twenty editors scroll and the keys' row stays in view.
    .when(names.length > 0, el => el.child(scrollList(view, "open-in-list", { count: names.length, row: 28, at: view.at, height: Math.min(names.length * 28, OPEN_IN_MAX - 8),
      wheeled: (keep) => { if (keep >= 0) view.at = keep; },
      draw: (i) => h_flex().id(`open-in-${i}`).h(28).px(8).items_center().rounded(4).text_size(14).text_color(t.foreground).cursor_pointer()
        .role("button").accessibility_label(`Open in ${names[i]}`)
        .when(view.at === i, el => el.bg(t.selected)).gap(8).on_hover(litRow(view, i)).on_click(() => choose(names[i])).child(targetIcon("mods/t3-actions", names[i], t)).child(div().flex_1().min_w(0).truncate().child(names[i])) }))));
}


export const CHEVRON = "mods/t3-actions/icons/chevron-down.svg";
// The half of a split under the pointer or the keyboard (T3's group-focus-within), for split()'s `hot`.
export const splitHot = (view, main, more) => view.hot === main || within(view, [main]) ? "main" : view.hot === more || within(view, [more]) ? "more" : null;

export function detailsRow(t, id, { locked = false, on = false } = {}) {
  // docs/internals/t3-tokens.md: 详情 popup geometry, card hover (7%); rows/split groups do not use button().
  return h_flex().id(id).h(32).min_w(0).gap(10).px(10).items_center().rounded(8).text_size(13).font_medium().text_color(t.foreground)
    .when(on, el => el.bg(t.foreground + "1f"))
    .when(!locked && !on, el => el.hover(st => st.bg(t.foreground + "12")));
}

export function directoryMenu(view) {
  const t = theme(), p = props();
  const copy = cx => { cx.write_to_clipboard(p.source.folder ?? ""); closeOverlay(p.overlay); notify({ title: "Path copied", body: p.source.folder ?? "", level: "success" }); };
  return v_flex().id("details-directory-menu").p(4).bg(t.popover).track_focus(view.keys)
    .on_key_down((e, cx) => { if (e.key === "enter") copy(cx); else if (e.key === "escape") closeOverlay(p.overlay); else return; cx.stop_propagation(); })
    .child(h_flex().id("details-copy-directory").h(28).px(8).rounded(4).items_center().text_size(14).text_color(t.foreground).cursor_pointer().hover(el => el.bg(t.selected)).on_click((_e, cx) => copy(cx)).child("Copy full path"));
}

export function closeForAction() {
  const p = props();
  if (p?.details) closeOverlay(p.details);
  if (p?.actions === "details") closeOverlay(p.overlay);
}

export function detailsView(view, control, reviewView) {
  const t = theme(), p = props(), s = p.source, remote = Boolean(s.machine), available = !remote && window()?.platform === "macos" && Boolean(s.folder);
  const targets = knownTargets() ?? view.targets, target = targets.includes(shared(KEY.openTarget)) ? shared(KEY.openTarget) : view.target;
  const openOn = detailsLayerOpen("open-in");
  const visible = detailsVisibility(), review = reviewView?.(view, t, visible), hasWorkspace = visible.environment || visible.openIn || visible.scripts;
  const done = () => closeOverlay(p.overlay);
  const reason = remote ? "Local applications cannot open a remote directory" : !s.folder ? "No working directory" : "Open in is only available on macOS";
  const workspace = v_flex().id("details-workspace").p(8)
    .when(visible.environment, el => el.child(detailsRow(t, "details-context", { locked: true }).pr(0).accessibility_label(`Run context: ${view.machineName}`)
      .when(Boolean(s.folder), el => el.on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openDetailsLayer("directory-menu", { width: 220, height: 36 }); cx.notify(); }))
      .child(div().id("details-machine-icon").size(16).flex_none().child(svg("mods/t3-actions/icons/laptop.svg").size(16).text_color(t.dim)))
      .child(div().id("details-machine-slot").flex_1().min_w(0).child(measuredTooltip(view, t, "details-machine-name", view.machineName, nameText(view, "details-machine-name", view.machineName, { size: 13, weight: "medium" }).id("details-machine-name").w_full().whitespace_nowrap().on_hover(glow(view, "details-machine-name")), { below: true }).w_full().min_w(0)))
      .child(div().id("details-path-slot").w(32).h_full().flex_none().flex().justify_center().items_center().child(tipMark(view, t, "details-path", s.folder || "No working directory", svg("mods/t3-actions/icons/folder.svg").size(16).text_color(t.dim), { below: true })))))
    .when(visible.openIn, el => el.child(split(t, { id: "details-open-row", mainId: "details-finder", moreId: "details-open-more", chevron: CHEVRON, size: "row", quiet: true,
      hot: splitHot(view, "details-finder", "details-open-more"), on: openOn, locked: !available, label: `Open in ${target}`, moreLabel: "Choose application" },
      main => tip(view, t, "details-finder", available ? s.folder : reason, stop(view, t, "details-finder", main.on_hover(glow(view, "details-finder")).when(available, el => el.on_click(() => {
        if (!sourceOkay(s)) return;
        openDirectory(target, s).catch(e => notify({ title: "Couldn't open directory", body: String(e), level: "error" }));
      })).child(targetIcon("mods/t3-actions", target, t)).child(div().flex_1().min_w(0).truncate().child(`Open in ${target}`)), 8), { below: true }),
      more => stop(view, t, "details-open-more", more.on_hover(glow(view, "details-open-more"))
        .on_mouse_down("left", (e) => { view.openPress = e.bounds; pressed(view); })
        .on_click((_e, cx) => { view.hot = null; if (!justClosed(view, "t3-actions.menuClosed")) openDetailsLayer("open-in", { ...underDetails(view, view.openPress), height: Math.min(OPEN_IN_MAX, 8 + Math.max(1, targets.length) * 28), props: { targets: available ? targets : [], reason: available ? null : reason } }); cx.notify(); }), 8))
      .on_size_change((size) => { view.detailsWidth = size.width; })))
    .when(visible.scripts, el => el.child(control(view, t, (_e, cx) => cx.stop_propagation())));
  const content = v_flex().id("details-content").w_full().flex_none()
    .on_size_change((size, cx) => {
      const height = Math.ceil(size.height / (Number(settings().zoom) || 1));
      if (height > 0 && height !== view.detailsHeight) { view.detailsHeight = height; cx.notify(); }
    })
    .when(hasWorkspace, el => el.child(workspace)).when(Boolean(review), el => el.child(review))
    .when(!hasWorkspace && !review, el => el.child(div().p(8).child(stop(view, t, "details-choose-items", detailsRow(t, "details-choose-items").role("button").accessibility_label("Choose what to show").cursor_pointer()
      .on_mouse_down("left", (e) => { view.itemsPress = e.bounds; pressed(view); })
      .on_click((_e, cx) => { const b = view.itemsPress; view.itemsPress = null; if (!justClosed(view, "t3-actions.menuClosed")) chooseDetailsItems(view, b); cx.notify(); }).child(svg("mods/t3-actions/icons/sliders-horizontal.svg").size(16).text_color(t.dim)).child("Choose what to show"), 8))));
  // No shadow: the native popup is the card's own size and would clip one into square corners.
  // A root scroller with only max-height measures to zero in a native popup (layout-implementation.md).
  return focusRoot(view, v_flex().id("workspace-details").w_full().h(Math.min(420, Math.max(50, (view.detailsHeight ?? 112) + 2))).max_h(420).min_h(50).overflow_y_scrollbar().rounded(16).border(1).border_color(t.border).bg(t.popover)
    .track_focus(view.detailsKeys).on_key_down((e, cx) => { if (e.key === "escape") { done(); cx.stop_propagation(); } })
    .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); chooseDetailsItems(view); cx.notify(); })
    .child(content));
}
