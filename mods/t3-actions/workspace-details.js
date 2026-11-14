// Details (cmd-shift-b): a native popup, never a layout column, so opening it can't resize a terminal (docs/adr/0019).
// This draws its card and its own menus; details-popup.js opens it and hangs the menus off it. Only Details watches its
// source: a menu acts on it after a last check, and goes with Details when it goes.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { props, settings, closeOverlay, exec, notify, theme, window, shared, setShared } from "herdr";
import { stop, focusRoot } from "./focus.js";
import { opener } from "./trigger.js";
import { hasOpen } from "./popup-menu.js";
import { split, cardRow } from "./button.js";
import { KEY } from "./store.js";
import { MENU_CLOSED, CHEVRON, CARD_MAX, sourceOkay, openLayer, underRow, splitHot } from "./details-popup.js";
import { detailsControl } from "./actions.js";
import { reviewDetailsView } from "./review-details.js";
import { menuKeys } from "./list.js";
import { menuRow, menuRule, MENU_ROW } from "./menu-row.js";
import { installedTargets, knownTargets, openTarget, targetIcon, targetsMenu, openInHeight } from "./open-in.js";
import { glow, tip, tipMark } from "./tip.js";
import { nameText, measuredTooltip } from "./measured-text.js";

const DETAILS_ITEMS = [["environment", "Machine and folder"], ["openIn", "Open in"], ["scripts", "Actions"], ["review", "Quick Review"]];
export function detailsVisibility() {
  const saved = shared(KEY.detailsItems);
  return Object.fromEntries(DETAILS_ITEMS.map(([id]) => [id, saved?.[id] !== false]));
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
    hot: splitHot(view, "details-finder", "details-open-more"), on: hasOpen(props().overlay, "open-in"), locked: !available, label: `Open in ${target}`, moreLabel: "Choose application" },
    main => tip(view, t, "details-finder", available ? s.folder : reason, stop(view, t, "details-finder", main.on_hover(glow(view, "details-finder")).when(available, el => el.on_click(() => {
      openDirectory(target, s).catch(e => notify({ title: "Couldn't open directory", body: String(e), level: "error" }));
    })).child(targetIcon("mods/t3-actions", target, t)).child(div().flex_1().min_w(0).truncate().child(`Open in ${target}`)), 8), { below: true }),
    more => stop(view, t, "details-open-more", opener(view, { closed: MENU_CLOSED, onOpen: (b) => openLayer("open-in", underRow(b, openInHeight(available ? targets : [])),
      { targets: available ? targets : [], reason: available ? null : reason }) })(more.on_hover(glow(view, "details-open-more"))), 8));
}

/** The card: Workspace (machine, Open in, Actions) then Quick Review, as T3's thread details. */
export function detailsView(view) {
  const t = theme(), p = props(), s = p.source, visible = detailsVisibility();
  const shown = ["environment", "openIn", "scripts"].filter(id => visible[id]).length, review = reviewDetailsView(view, t, visible, shown > 0);
  const workspace = v_flex().id("details-workspace").p(8)
    .when(visible.environment, el => el.child(machineRow(view, t, s)))
    .when(visible.openIn, el => el.child(openInRow(view, t, s)))
    .when(visible.scripts, el => el.child(detailsControl(view, t)));
  // Before the first measure, what the rows will make: 8 round each section, 32 a row, a rule between.
  const guess = !shown && !review ? 48 : (shown ? 16 + 32 * shown : 0) + (review ? 48 + (shown ? 1 : 0) : 0);
  const content = v_flex().id("details-content").w_full().flex_none()
    .on_size_change((size, cx) => {
      const height = Math.ceil(size.height / (Number(settings().zoom) || 1));
      if (height > 0 && height !== view.detailsHeight) { view.detailsHeight = height; cx.notify(); }
    })
    .when(shown > 0, el => el.child(workspace)).when(Boolean(review), el => el.child(review))
    .when(!shown && !review, el => el.child(div().p(8).child(stop(view, t, "details-choose-items", opener(view, { closed: MENU_CLOSED, onOpen: (b) => chooseDetailsItems(b) })(cardRow(t, "details-choose-items", { on: hasOpen(props().overlay, "details-items") }).role("button").accessibility_label("Choose what to show").cursor_pointer())
      .child(svg("mods/t3-actions/icons/sliders-horizontal.svg").size(16).text_color(t.dim)).child("Choose what to show"), 8))));
  // No shadow: the native popup is the card's own size and would clip one into square corners.
  // A root scroller with only max-height measures to zero in a native popup (layout-implementation.md): its height is set.
  return focusRoot(view, v_flex().id("workspace-details").w_full().h(Math.min(CARD_MAX, Math.max(50, (view.detailsHeight ?? guess) + 2))).min_h(50).overflow_y_scrollbar().rounded(16).border(1).border_color(t.border).bg(t.popover)
    .track_focus(view.detailsKeys).on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); } })
    .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); chooseDetailsItems(); cx.notify(); })
    .child(content));
}
