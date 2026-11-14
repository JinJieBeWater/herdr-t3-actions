// Details (cmd-shift-b): a native popup, never a layout column, so opening it can't resize a terminal (docs/adr/0019).
// Its menus are popups of their own, each under its row (underRow); this run's ones are kept in one place (layers) so
// closing Details closes them, and a menu its own submenu. Only Details watches its source: a menu acts on it after a
// last check, and goes with Details when it goes.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { spaces, panes, props, settings, openOverlay, closeOverlay, exec, notify, theme, window, shared, setShared } from "herdr";
import { stop, focusRoot, within } from "./focus.js";
import { opener } from "./trigger.js";
import { split, cardRow } from "./button.js";
import { terminalFor, workFolder } from "./terminal-context.js";
import { KEY } from "./store.js";
import { panelState } from "./panel.js";
import { menuKeys } from "./list.js";
import { menuRow, menuRule, MENU_ROW } from "./menu-row.js";
import { installedTargets, knownTargets, openTarget, targetIcon, targetsMenu, openInHeight } from "./open-in.js";
import { glow, tip, tipMark } from "./tip.js";
import { nameText, measuredTooltip } from "./measured-text.js";

export const MENU_CLOSED = "t3-actions.menuClosed", DETAILS_CLOSED = "t3-actions.detailsClosed";
export const CHEVRON = "mods/t3-actions/icons/chevron-down.svg";
// T3 threadDetailsPanelStyles: the card 280 wide, its rows inside its 1px border and 8 padding.
const CARD_W = 280, ROW_W = CARD_W - 2 - 16, CARD_MAX = 420;

const DETAILS_ITEMS = [["environment", "Machine and folder"], ["openIn", "Open in"], ["scripts", "Actions"], ["review", "Quick Review"]];
export function detailsVisibility() {
  const saved = shared(KEY.detailsItems);
  return Object.fromEntries(DETAILS_ITEMS.map(([id]) => [id, saved?.[id] !== false]));
}

// Only this run: Details' popup id and each popup it opened, by id, with the one that opened it ({ parent, kind }). Mods share
// one JS context (terminal-context.js), so the bar's copy and the popups' read the same.
const reg = () => /** @type {any} */ (globalThis).t3Details ??= { id: null, layers: new Map() };
export const openedDetails = () => reg().id;
/** Whether this popup has a `kind` menu open. */
export const detailsLayerOpen = kind => [...reg().layers.values()].some(layer => layer.parent === props().overlay && layer.kind === kind);
export const layerOpen = id => reg().layers.has(id);

/** Where a row's menu goes: as wide as the row, 4 under it, right edges together; `b`, the pressed half's bounds. Without a
 *  press (keys, assistive tech) the app's default place. */
export function underRow(b, height) {
  const z = Number(settings().zoom) || 1;
  return { width: ROW_W, height, ...(b ? { at: { x: b.x + b.width - ROW_W * z, y: b.y + b.height + 4 * z } } : {}) };
}

/** Opens a menu of this popup's, `kind` its props.actions; it shares Details' source and closes with this popup. */
export function openLayer(kind, place, extra = {}) {
  const p = props(), root = p.actions === "details" ? p.overlay : p.details;
  const id = openOverlay({ mod: "t3-actions", kind: "popup", ...place, props: { ...extra, actions: kind, source: p.source, details: root } });
  if (root) reg().layers.set(id, { parent: p.overlay, kind });
  return id;
}

/** A popup of this mod's closed: its own menus go with it; Details gone, its button shows it. */
export function layerClosed(id) {
  for (const [child, layer] of reg().layers) if (layer.parent === id) { reg().layers.delete(child); closeOverlay(child); }
  reg().layers.delete(id);
  if (reg().id === id) { reg().id = null; setShared(DETAILS_CLOSED, Date.now()); }
}

export function dismissDetails() { if (reg().id) closeOverlay(reg().id); reg().id = null; }

/** The space, tab and terminal Details opened on are still the ones shown. */
export function sourceOkay(source) {
  const sp = spaces().find(s => s.active);
  return !source || (sp?.id === source.space && sp.tabs.some(t => t.active && t.id === source.tab)
    && (!source.terminal || panes().some(p => p.terminal === source.terminal && p.tab === source.tab)));
}

export function toggleDetails(bounds) {
  if (reg().id) return dismissDetails();
  const sp = spaces().find(s => s.active);
  if (!sp) return;
  // Taken before the popup takes the keyboard: the tab's last terminal, and the folder it works in (terminal-context.js).
  const tab = sp.tabs.find(t => t.active)?.id, f = terminalFor(sp.id, tab) ?? panes().find(p => p.tab === tab && p.terminal);
  const source = { space: sp.id, tab, pane: f?.pane, terminal: f?.terminal, machine: sp.machine, folder: workFolder(sp.id, tab) };
  const z = Number(settings().zoom) || 1;
  // Keys have no press to hang it under: the button's place, from the header's measured blocks (t3-tabs' end, t3-chrome's panel).
  const measured = /** @type {any} */ (globalThis).t3Titlebar, viewport = globalThis.window?.viewport_size?.();
  if (!bounds && viewport) {
    // Its right edge: the work column's end (the panel and its 8 each side, while open), less the layout's 12 and t3-tabs' end.
    const right = viewport.width - (measured?.end ?? 28 * z) - 12 * z - (panelState().open ? (measured?.panel ?? 480 * z) + 16 * z : 0);
    bounds = { x: right - 28 * z, y: 6 * z, width: 28 * z, height: 28 * z };
  }
  reg().id = openOverlay({ mod: "t3-actions", kind: "popup", frame: "none", width: CARD_W, height: CARD_MAX,
    ...(bounds ? { at: { x: bounds.x + bounds.width - CARD_W * z, y: bounds.y + bounds.height + 4 * z } } : {}),
    props: { actions: "details", source } });
}

export function initDetails(view, cx) {
  view.detailsKeys = cx.focus_handle(); view.detailsKeys.focus();
  const source = props().source;
  view.machineName = source.machine || "This Mac";
  view.targets = knownTargets() ?? ["Finder"];
  view.target = "Finder";
  if (!source.machine && window()?.platform === "macos") cx.spawn(async (cx) => {
    view.targets = await installedTargets();
    view.target = view.targets.includes(shared(KEY.openTarget)) ? shared(KEY.openTarget) : "Finder";
    if (shared(KEY.openTarget) && view.target === "Finder") setShared(KEY.openTarget, "Finder");
    cx.notify();
  });
  if (!source.machine) cx.spawn(async (cx) => {
    const r = await exec("scutil", ["--get", "ComputerName"]).catch(() => null);
    if (r?.code === 0) view.machineName = r.stdout.trim();
    cx.notify();
  });
  // The one watch on the source: Details goes, and its menus with it (layerClosed).
  cx.timer.every(100, () => {
    if (sourceOkay(source)) return;
    closeOverlay(props().overlay);
    notify({ title: "Open Details again", body: "The space, tab or terminal it was opened on changed.", level: "warning" });
  });
}

/** Closes Details and the menu acting for it. */
export function closeForAction() {
  const p = props();
  if (p?.details) closeOverlay(p.details);
  if (p?.actions === "details") closeOverlay(p.overlay);
}

// From its row: under it, as the other rows' menus; from a right-click on the card, where the pointer is.
const ITEMS_H = 8 + 28 + DETAILS_ITEMS.length * MENU_ROW + 9 + MENU_ROW;
function chooseDetailsItems(b) { return openLayer("details-items", b ? underRow(b, ITEMS_H) : { width: 220, height: ITEMS_H }); }

export function detailsItemsMenu(view) {
  const t = theme(), visible = detailsVisibility(), dirty = Object.values(visible).some(on => !on);
  const choose = (at, cx) => {
    if (at === DETAILS_ITEMS.length) { if (!dirty) return; setShared(KEY.detailsItems, {}); closeOverlay(props().overlay); }
    else if (DETAILS_ITEMS[at]) {
      const next = { ...visible, [DETAILS_ITEMS[at][0]]: !visible[DETAILS_ITEMS[at][0]] };
      setShared(KEY.detailsItems, Object.fromEntries(Object.entries(next).filter(([, on]) => !on)));
    }
    cx.notify();
  };
  const row = (id, at, label, o = {}) => menuRow(view, t, id, { at: [view, "at", at], label, pick: (cx) => choose(at, cx), ...o });
  return focusRoot(view, v_flex().id("details-items-menu").p(4).bg(t.popover).track_focus(view.keys)
    .on_key_down(menuKeys(view, [...DETAILS_ITEMS.map(([, label]) => label), ...(dirty ? ["Reset to default"] : [])], choose))
    .child(h_flex().h(28).px(8).items_center().text_size(12).font_medium().text_color(t.dim).child("Show in Details"))
    .children(DETAILS_ITEMS.map(([id, label], at) => row(`details-item-${id}`, at, label,
      { lead: div().size(16).flex_none().when(visible[id], el => el.child(svg("mods/t3-actions/icons/check.svg").size(16))) }).role("check_box").checked(visible[id])))
    .child(menuRule(t))
    .child(row("details-items-reset", DETAILS_ITEMS.length, "Reset to default", { disabled: !dirty })));
}

async function openDirectory(name, source) {
  if (!sourceOkay(source) || source.machine || !source.folder) return;
  const opened = await openTarget(name, source.folder, () => sourceOkay(source));
  if (opened) setShared(KEY.openTarget, opened);
}

/** Open in's menu (open-in.js, shared with Files): it only picks the app; the row's main half opens it. */
export function openInMenu(view) {
  const p = props();
  return targetsMenu(view, "mods/t3-actions", p.targets ?? [], p.reason, (name) => { if (sourceOkay(p.source)) setShared(KEY.openTarget, name); closeOverlay(p.overlay); });
}

/** The machine row's right-click menu: its one item. */
export function directoryMenu(view) {
  const t = theme(), p = props();
  const copy = (_at, cx) => { cx.write_to_clipboard(p.source.folder ?? ""); closeOverlay(p.overlay); notify({ title: "Path copied", body: p.source.folder ?? "", level: "success" }); };
  return v_flex().id("details-directory-menu").p(4).bg(t.popover).track_focus(view.keys)
    .on_key_down(menuKeys(view, ["Copy full path"], copy))
    .child(menuRow(view, t, "details-copy-directory", { at: [view, "at", 0], label: "Copy full path", pick: (cx) => copy(0, cx) }));
}

// The half of a split under the pointer or the keyboard (T3's group-focus-within), for split()'s `hot`.
export const splitHot = (view, main, more) => view.hot === main || within(view, [main]) ? "main" : view.hot === more || within(view, [more]) ? "more" : null;

function machineRow(view, t, s) {
  return cardRow(t, "details-context", { locked: true }).pr(0).accessibility_label(`Machine: ${view.machineName}`)
    .when(Boolean(s.folder), el => el.on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openLayer("directory-menu", { width: 220, height: 8 + MENU_ROW }); cx.notify(); }))
    .child(div().id("details-machine-icon").size(16).flex_none().child(svg("mods/t3-actions/icons/laptop.svg").size(16).text_color(t.dim)))
    .child(div().id("details-machine-slot").flex_1().min_w(0).child(measuredTooltip(view, t, "details-machine-name", view.machineName, nameText(view, "details-machine-name", view.machineName, { size: 13, weight: "medium" }).id("details-machine-name").w_full().whitespace_nowrap().on_hover(glow(view, "details-machine-name")), { below: true }).w_full().min_w(0)))
    .child(div().id("details-path-slot").w(32).h_full().flex_none().flex().justify_center().items_center().child(tipMark(view, t, "details-path", s.folder || "No working directory", svg("mods/t3-actions/icons/folder.svg").size(16).text_color(t.dim), { below: true })));
}

function openInRow(view, t, s) {
  const available = !s.machine && window()?.platform === "macos" && Boolean(s.folder);
  const targets = knownTargets() ?? view.targets, target = targets.includes(shared(KEY.openTarget)) ? shared(KEY.openTarget) : view.target;
  const reason = s.machine ? "Local applications cannot open a remote directory" : !s.folder ? "No working directory" : "Open in is only available on macOS";
  return split(t, { id: "details-open-row", mainId: "details-finder", moreId: "details-open-more", chevron: CHEVRON, size: "row",
    hot: splitHot(view, "details-finder", "details-open-more"), on: detailsLayerOpen("open-in"), locked: !available, label: `Open in ${target}`, moreLabel: "Choose application" },
    main => tip(view, t, "details-finder", available ? s.folder : reason, stop(view, t, "details-finder", main.on_hover(glow(view, "details-finder")).when(available, el => el.on_click(() => {
      openDirectory(target, s).catch(e => notify({ title: "Couldn't open directory", body: String(e), level: "error" }));
    })).child(targetIcon("mods/t3-actions", target, t)).child(div().flex_1().min_w(0).truncate().child(`Open in ${target}`)), 8), { below: true }),
    more => stop(view, t, "details-open-more", opener(view, { closed: MENU_CLOSED, onOpen: (b) => openLayer("open-in", underRow(b, openInHeight(available ? targets : [])),
      { targets: available ? targets : [], reason: available ? null : reason }) })(more.on_hover(glow(view, "details-open-more"))), 8));
}

/** The card: Workspace (machine, Open in, Actions) then Quick Review, as T3's thread details; `control` draws the Actions row
 *  (main.js), `reviewView` Quick Review's section (review-details.js). */
export function detailsView(view, control, reviewView) {
  const t = theme(), p = props(), s = p.source, visible = detailsVisibility();
  const shown = ["environment", "openIn", "scripts"].filter(id => visible[id]).length, review = reviewView(view, t, visible, shown > 0);
  const workspace = v_flex().id("details-workspace").p(8)
    .when(visible.environment, el => el.child(machineRow(view, t, s)))
    .when(visible.openIn, el => el.child(openInRow(view, t, s)))
    .when(visible.scripts, el => el.child(control(view, t)));
  // Before the first measure, what the rows will make: 8 round each section, 32 a row, a rule between.
  const guess = !shown && !review ? 48 : (shown ? 16 + 32 * shown : 0) + (review ? 48 + (shown ? 1 : 0) : 0);
  const content = v_flex().id("details-content").w_full().flex_none()
    .on_size_change((size, cx) => {
      const height = Math.ceil(size.height / (Number(settings().zoom) || 1));
      if (height > 0 && height !== view.detailsHeight) { view.detailsHeight = height; cx.notify(); }
    })
    .when(shown > 0, el => el.child(workspace)).when(Boolean(review), el => el.child(review))
    .when(!shown && !review, el => el.child(div().p(8).child(stop(view, t, "details-choose-items", opener(view, { closed: MENU_CLOSED, onOpen: (b) => chooseDetailsItems(b) })(cardRow(t, "details-choose-items", { on: detailsLayerOpen("details-items") }).role("button").accessibility_label("Choose what to show").cursor_pointer())
      .child(svg("mods/t3-actions/icons/sliders-horizontal.svg").size(16).text_color(t.dim)).child("Choose what to show"), 8))));
  // No shadow: the native popup is the card's own size and would clip one into square corners.
  // A root scroller with only max-height measures to zero in a native popup (layout-implementation.md): its height is set.
  return focusRoot(view, v_flex().id("workspace-details").w_full().h(Math.min(CARD_MAX, Math.max(50, (view.detailsHeight ?? guess) + 2))).min_h(50).overflow_y_scrollbar().rounded(16).border(1).border_color(t.border).bg(t.popover)
    .track_focus(view.detailsKeys).on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); } })
    .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); chooseDetailsItems(); cx.notify(); })
    .child(content));
}
