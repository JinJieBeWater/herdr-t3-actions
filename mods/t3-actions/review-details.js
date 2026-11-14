// Details' Quick Review: a split row. Its main half shows Review (the range it's on, or its default); its chevron opens the
// range menu, a popup under the row, whose Commits opens beside it in another (submenu.js), as t3-menu's Snooze. The rows,
// reads and picks are Review's own (review-scope.js); a pick shows Review and asks it for that range (panel.js reviewRequest).
import { div, svg } from "gpui-kit";
import { v_flex, InputState } from "gpui-base";
import { props, closeOverlay, theme } from "herdr";
import { stop, focusRoot } from "./focus.js";
import { opener } from "./trigger.js";
import { glow, tip } from "./tip.js";
import { nameText, measuredTooltip } from "./measured-text.js";
import { split } from "./button.js";
import { panelState, showPage, reviewRepo, reviewRequest, reviewShown } from "./panel.js";
import { MENU_ROW } from "./menu-row.js";
import { propsLit } from "./list.js";
import { hoverRow, subLeft } from "./submenu.js";
import { openBeside, closeSub, subGone, closeChain, hasOpen } from "./popup-menu.js";
import { scopeOf, openScope, scopeRows, scopeRow, scopeItems, scopeList, pickListed, menuKey, commitsKey, commitsBody, releaseScope } from "./review-scope.js";
import { sourceOkay, openLayer, underRow, splitHot, CHEVRON, MENU_CLOSED } from "./details-popup.js";

const ICON_DIR = "mods/t3-actions/icons";
// The range menu at its tallest: four ranges, the rule, Commits, its padding. The app fits a popup to what it draws.
const RANGE_H = 8 + 4 * MENU_ROW + 9 + MENU_ROW;
// The Commits submenu: T3's w-80; its list 320 tall at most, under its search (43) and padding.
const COMMITS_W = 320, COMMITS_LIST = 320;


function reviewReason(source) {
  return source.machine ? "Review is unavailable on remote spaces." : !source.folder ? "No working directory."
    : !panelState().pages.includes("review") ? "Install the Review extra to use Quick Review." : "";
}

/** Quick Review's section, under Workspace's rule when that shows (`rule`). */
export function reviewDetailsView(view, t, visible, rule) {
  if (visible.review === false) return null;
  const source = props().source, reason = reviewReason(source), on = hasOpen(props().overlay, "review-scope");
  // The range as Review's scope button names it; nothing while no Review tab shows one.
  const shown = !reason && reviewShown(source.space), label = shown?.page ? shown.label ?? scopeOf({ page: shown.page }).label : "";
  const row = split(t, { id: "details-review-row", mainId: "details-review", moreId: "details-review-more", chevron: CHEVRON, size: "row",
    hot: splitHot(view, "details-review", "details-review-more"), on, disabled: Boolean(reason), label: label ? `Quick Review: ${label}` : "Quick Review", moreLabel: "Choose review range" },
    // The range's whole name in a tooltip only when it's cut, as the machine's (measured-text.js): on the half, whose hover it is.
    main => measuredTooltip(view, t, "details-review", label, stop(view, t, "details-review", main.on_hover(glow(view, "details-review"))
      .when(!reason, el => el.on_click(() => { if (sourceOkay(source)) showPage("review"); }))
      .child(svg(`${ICON_DIR}/pulls-review.svg`).size(16).flex_none())
      .child(div().flex_1().min_w(0).truncate().child("Quick Review"))
      .when(Boolean(label), el => el.child(div().id("details-review-scope-slot").flex_none().max_w(120).min_w(0).font_normal()
        .child(nameText(view, "details-review", label, { size: 12 }).text_color(t.dim).whitespace_nowrap()))), 8), { below: true }),
    more => stop(view, t, "details-review-more", reason ? more : opener(view, { closed: MENU_CLOSED, onOpen: (b) => {
      if (!sourceOkay(source)) return false;
      const place = underRow(b, RANGE_H);
      openLayer("review-scope", place, { at: place.at ?? null }, !b);
    } })(more.on_hover(glow(view, "details-review-more"))), 8));
  return v_flex().id("details-review-section").p(8).when(rule, el => el.border_t(1).border_color(t.border))
    .child(reason ? tip(view, t, "details-review-row", reason, row, { below: true }) : row);
}

// A pick from either menu: Review shown first, so its request names the tab (born); then Details goes.
function pickInDetails(view, source) {
  return (page, { analyze = false, base = undefined }) => {
    if (!sourceOkay(source)) return;
    showPage("review", true);
    reviewRequest(source.space, view.root, page, { base, analyze });
    closeChain();
  };
}

/** The range menu: Review's rows (none lit, the range Review shows checked), read once on opening. */
export function initRangeMenu(view, cx) {
  const p = props(), source = p.source;
  // menuKey's Escape (review-scope.js) is this popup's close.
  view.scopePage = null; view.scopeAt = -1; view.s = {}; view.sub = null; view.rowsAt = [];
  view.closePopup = () => closeOverlay(p.overlay);
  view.space = source.space; view.root = null; view.page = null;
  view.keys = cx.focus_handle(); view.keys.focus();
  // Where it opened, for placing Commits when keys open it before the pointer has found its row.
  view.origin = p.at ?? globalThis.window?.mouse_position?.() ?? null;
  view.pick = pickInDetails(view, source);
  view.openCommits = (cx, lit) => openCommits(view, lit, cx);
  view.scopeSearch = InputState.new({ placeholder: "Search" });
  cx.spawn(async (cx) => {
    const { root, problem } = await reviewRepo(source.space);
    if (view.closed) return;
    if (!root) view.scopeError = problem;
    else {
      view.root = root;
      const shown = reviewShown(source.space);
      if (shown?.root === root) { view.page = shown.page; view.base = shown.base || shown.page; }
      openScope(view, cx, propsLit());
    }
    cx.notify();
  });
  /** @type {any} */ (globalThis).t3DetailsRange = view;
}

export function closeRangeMenu(view) {
  view.closed = true; releaseScope(view);
  if (/** @type {any} */ (globalThis).t3DetailsRange === view) /** @type {any} */ (globalThis).t3DetailsRange = null;
}

// Commits beside its row, as t3-menu's Snooze: the row where the pointer last found it, else from where the menu opened.
function openCommits(view, lit, cx) {
  const p = props(), i = scopeRows(view).findIndex(r => r.sub);
  const count = scopeList(view).length, h = 8 + 43 + (count ? Math.min(count * MENU_ROW, COMMITS_LIST) : 36);
  openBeside(view, i, "commits", { top: 4 + i * MENU_ROW + 9, width: underRow(null, 0).width - 8 },
    { mod: "t3-actions", width: COMMITS_W, height: h, props: { actions: "review-commits", source: p.source, details: p.details } }, "review-commits", lit >= 0);
  cx.notify();
}

export function rangeMenu(view) {
  const t = theme();
  // Its Commits closed itself (← or Esc in it, a click beside it): the keyboard comes back here.
  subGone(view, MENU_CLOSED);
  const rows = scopeRows(view), loading = !view.scopeError && view.scopeGit === undefined;
  const row = (r, i) => scopeRow(view, t, r, i, { icons: ICON_DIR, open: Boolean(r.sub) && Boolean(view.sub),
    also: (el) => el.on_mouse_move((e, cx) => {
      view.rowsAt[i] = e.bounds;
      hoverRow(view.s, r.sub && r.count ? r.sub : null, e, cx, (key, _b, cx) => key ? openCommits(view, -1, cx) : closeSub(view));
    }) });
  return focusRoot(view, v_flex().id("details-range-menu").w_full().p(4).bg(t.popover).text_size(14).track_focus(view.keys)
    .on_hover((on) => { if (!on) subLeft(view.s); })
    .on_key_down((e, cx) => { if (!loading && !view.scopeError) menuKey(view, e, cx); else if (e.key === "escape") view.closePopup(); })
    .when(Boolean(view.scopeError || loading), el => el.child(div().id("details-range-note").min_h(28).px(8).flex().items_center().text_color(t.dim).child(view.scopeError || "Reading review ranges…")))
    .when(!view.scopeError && !loading, el => el.children(scopeItems(t, rows, row))));
}

/** Commits beside the range menu: what the menu read, its search, its rows. */
export function initCommits(view, cx) {
  const range = /** @type {any} */ (globalThis).t3DetailsRange;
  if (!range) return closeOverlay(props().overlay);
  for (const k of ["space", "root", "page", "base", "scopeGit", "picks", "refs", "scopeRoot", "scopeBase", "pick"]) view[k] = range[k];
  view.scopeListAt = propsLit();
  view.scopeSearch = InputState.new({ placeholder: "Search commits" });
  view.scopeSearch.on("change", (_e, cx) => { view.scopeListAt = 0; view.scrollTop = { ...view.scrollTop, "scope-list": 0 }; cx.notify(); });
  view.scopeSearch.on("submit", (_e, cx) => pickListed(view, scopeList(view)[view.scopeListAt], cx));
  view.scopeSearch.focus();
}

export function commitsMenu(view) {
  const t = theme();
  return focusRoot(view, v_flex().id("details-commits").w_full().p(4).bg(t.popover).text_size(14)
    .on_key_down((e, cx) => commitsKey(view, e, cx, () => closeOverlay(props().overlay)))
    .children(commitsBody(view, t, { height: COMMITS_LIST, icons: ICON_DIR })));
}
