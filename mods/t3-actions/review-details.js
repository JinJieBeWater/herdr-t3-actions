import { div, svg } from "gpui-kit";
import { v_flex, InputState } from "gpui-base";
import { props, settings, spaces, panes, shared, setShared, exec, closeOverlay, theme } from "herdr";
import { stop, focusRoot, within, pressed, justClosed } from "./focus.js";
import { glow, tip } from "./tip.js";
import { nameText, measuredTooltip } from "./measured-text.js";
import { DISABLED } from "./button.js";
import { panelState, showPage } from "./panel.js";
import { sourceOkay, detailsRow, detailsLayerOpen, openDetailsLayer, CHEVRON } from "./workspace-details.js";
import { scopeOf, openScope, openBase, scopeMenu, scopeSub, baseMenu, scopeList, baseList, pickListed, pickBase, scopeKey, releaseScope } from "./review-scope.js";

function reviewReason(source) {
  return source.machine ? "Review is unavailable on remote spaces." : !source.folder ? "No working directory."
    : !panelState().pages.includes("review") ? "Install the Review extra to choose a review range." : "";
}

export function reviewDetailsView(view, t, visible) {
  if (visible.review === false) return null;
  const source = props().source, reason = reviewReason(source), on = detailsLayerOpen("review-scope");
  const lit = !reason && (on || view.hot === "details-review" || within(view, ["details-review"]));
  // What Review shows in this space, as its scope button names it; nothing before a first review.
  const shown = shared("review.shown")?.[source.space], scope = !reason && shown?.page ? { ...scopeOf({ page: shown.page }), ...(shown.label ? { label: shown.label } : {}) } : null;
  const row = detailsRow(t, "details-review", { locked: Boolean(reason), on }).pr(0).role("button").accessibility_label("Quick Review")
    .when(Boolean(reason), el => el.opacity(DISABLED).on_hover(glow(view, "details-review")))
    .when(!reason, el => el.cursor_pointer().on_hover(glow(view, "details-review")).on_mouse_down("left", e => { view.reviewPress = e.bounds; pressed(view); }).on_click(() => {
      if (justClosed(view, "t3-actions.menuClosed") || !sourceOkay(source)) return;
      const z = Number(settings().zoom) || 1, viewport = globalThis.window?.viewport_size?.(), width = Math.min(736, (viewport?.width ?? 810) / z - 16), height = Math.min(500, (viewport?.height ?? 660) / z - 32), b = view.reviewPress;
      openDetailsLayer("review-scope", { width, height, frame: "none", ...(b ? { at: { x: b.x + b.width - width * z, y: b.y + b.height + 4 * z } } : {}), props: { scopeWidth: width, scopeHeight: height, scopeMenuWidth: b ? b.width / z : 264 } });
    }))
    .child(svg("mods/t3-actions/icons/pulls-review.svg").size(16).flex_none())
    .child(div().flex_1().min_w(0).child("Quick Review"))
    // The range, its whole name in a tooltip only when it's cut, as the computer name's (measured-text.js).
    .when(Boolean(scope && scope.kind !== "other"), el => el.child(div().id("details-review-scope-slot").flex_none().max_w(120).min_w(0).font_normal()
      .child(measuredTooltip(view, t, "details-review-scope-label", scope?.label ?? "", nameText(view, "details-review-scope-label", scope?.label ?? "", { size: 12 }).text_color(t.dim).whitespace_nowrap().on_hover(glow(view, "details-review-scope-label")), { below: true }).min_w(0))))
    // The split rows' 32px chevron slot, so every chevron in the card lines up.
    .child(div().id("details-review-more").w(32).h_full().flex_none().flex().items_center().justify_center()
      .when(lit, el => el.child(svg(CHEVRON).size(16).text_color(on ? t.foreground : t.dim))));
  return v_flex().id("details-review-section").p(8)
    .when(visible.environment || visible.openIn || visible.scripts, el => el.border_t(1).border_color(t.border))
    .child(reason ? tip(view, t, "details-review", reason, row, { below: true }) : stop(view, t, "details-review", row, 8));
}

const reviewSourceOkay = view => !view.evicted && sourceOkay(props().source)
  && (!props().source.terminal || panes().some(p => p.terminal === props().source.terminal && (!p.cwd || p.cwd === props().source.folder)));

export function initReviewScope(view, cx) {
  const p = props(), source = p.source;
  view.width = p.scopeWidth || 736; view.height = p.scopeHeight || 500;
  view.scopeMod = "t3-actions"; view.scopeMenuWidth = p.scopeMenuWidth || 264; view.scopeInMenu = true;
  view.scopeOrigin = { x: Math.max(0, view.width - view.scopeMenuWidth), y: 0 };
  view.space = source.space; view.root = source.folder; view.page = "/worktree"; view.base = view.page;
  view.handled = 0; view.scopeAt = -1; view.scopeListAt = -1; view.baseAt = -1; view.scrollTop = {};
  view.handle = cx.focus_handle(); view.handle.focus();
  view.scopeSearch = InputState.new({ placeholder: "Search" });
  view.refSearch = InputState.new({ placeholder: "Search refs" });
  view.scopeSearch.on("change", (_e, cx) => { view.scopeListAt = 0; view.scrollTop["scope-list"] = 0; cx.notify(); });
  view.scopeSearch.on("submit", (_e, cx) => pickListed(view, scopeList(view)[view.scopeListAt], cx));
  view.refSearch.on("change", (_e, cx) => { view.baseAt = 0; view.scrollTop["base-list"] = 0; cx.notify(); });
  view.refSearch.on("submit", (_e, cx) => { const item = baseList(view)[view.baseAt]; if (item) pickBase(view, item.value, cx); });
  view.closePopup = () => closeOverlay(p.overlay);
  view.togglePopup = (name, cx) => {
    if (view.popup === name) return view.closePopup();
    view.popup = name;
    if (name === "scope") { view.handle.focus(); openScope(view, cx); }
    else if (name === "base") openBase(view, cx);
    cx.notify();
  };
  view.selectReview = (page, options, cx) => {
    if (!reviewSourceOkay(view) || reviewReason(source)) return;
    const n = Math.max(Date.now(), Number(shared("review")?.n || 0) + 1);
    setShared("review", { space: source.space, root: view.root, page, ...(options.base ? { base: options.base } : {}), n, analyze: Boolean(options.analyze) });
    showPage("review", Boolean(options.stays));
    if (options.stays) { view.page = page; view.base = options.base || page; cx.notify(); }
    else { closeOverlay(p.overlay); if (p.details) closeOverlay(p.details); }
  };
  view.popup = "scope"; view.scopeLoading = true;
  cx.spawn(async cx => {
    const top = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "rev-parse", "--show-toplevel"], { cwd: source.folder }).catch(() => null);
    if (!reviewSourceOkay(view)) return;
    view.scopeLoading = false;
    if (top?.code !== 0) view.scopeError = "This directory is not a Git repository.";
    else {
      view.root = top.stdout.endsWith("\n") ? top.stdout.slice(0, -1) : top.stdout;
      const shown = shared("review.shown")?.[source.space];
      if (shown?.root === view.root) { view.page = shown.page; view.base = shown.base || shown.page; }
      openScope(view, cx);
    }
    cx.notify();
  });
  cx.timer.every(100, () => { if (!reviewSourceOkay(view)) { releaseScope(view); closeOverlay(p.overlay); } });
}

export function closeReviewScope(view) { view.evicted = true; releaseScope(view); }

export function reviewScopeView(view) {
  const t = theme(), origin = view.scopeOrigin, loading = view.scopeLoading || view.scopeGit === undefined;
  return focusRoot(view, div().id("details-review-scope").w(view.width).h(view.height).relative().cursor_default().track_focus(view.handle)
    .on_mouse_move(e => { view.paneAt = { x: e.bounds.x, y: e.bounds.y }; })
    .on_key_down((e, cx) => scopeKey(view, e, cx))
    .child(v_flex().absolute().left(origin.x).top(origin.y).w(view.scopeMenuWidth)
      .when(Boolean(loading || view.scopeError), el => el.child(div().p(12).rounded(8).bg(t.popover).text_size(14).text_color(t.dim).child(view.scopeError || "Reading review ranges…")))
      .when(!loading && !view.scopeError && view.popup === "scope", el => el.child(scopeMenu(view, t))))
    .when(!loading && !view.scopeError && view.popup === "scope" && Boolean(view.scopePage), el => el.child(scopeSub(view, t)))
    .when(!loading && !view.scopeError && view.popup === "base", el => el.child(baseMenu(view, t))));
}
