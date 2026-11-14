// Actions, as T3 Code's run button: commands you start with one click, kept in shared state.
// In a bar it draws "▶ Dev | ▾", sized to fit its block; the menu and the editor are this mod opened as overlays.
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { theme, run, openOverlay, closeOverlay, props, shared, setShared, home, focused, panes, spaces, settings, nextCommand } from "herdr";
import { tip, glow } from "./tip.js";
import { nameText, measuredTooltip } from "./measured-text.js";
import { stopsInit, stopsEnd, stop, focusRoot, onStop } from "./focus.js";
import { menuJump, scrollList } from "./list.js";
import { menuRow, menuRule } from "./menu-row.js";
import { KEY, migrate } from "./store.js";
import { button, radiusOf, split, cardRow } from "./button.js";
import { trigger, opener, popupOpen } from "./trigger.js";
import { toggleDetails, dismissDetails, layerClosed, initDetails, detailsView, sourceOkay, closeForAction, openedDetails, openInMenu, directoryMenu, CHEVRON, splitHot, detailsLayerOpen, openLayer, underRow, detailsItemsMenu, MENU_CLOSED, DETAILS_CLOSED } from "./workspace-details.js";
import { reviewDetailsView, initRangeMenu, rangeMenu, closeRangeMenu, initCommits, commitsMenu } from "./review-details.js";

const MOD = "t3-actions";
const ICONS = ["play", "test", "lint", "configure", "build", "debug"];
const PLACES = [["tab", "Tab"], ["right", "Right"], ["down", "Down"]];
const icon = (name) => svg(`mods/${MOD}/icons/action-${ICONS.includes(name) ? name : "play"}.svg`);

const lit = (view, id, color = theme().dim) => (view.hot === id ? theme().foreground : color);

// { list: [{ id, name, command, icon, place, cwd }], last: id }
const state = () => shared(KEY.actions) ?? { list: [] };
const primary = ({ list, last }) => list.find(a => a.id === last) ?? list[0];
// The menu: a popup's height is only a maximum, so its list sets its own. REST: its padding, rule and Add action.
// The menu as wide as the layout's other menus (t3-menu's, T3's); a longer name is cut short.
const MENU_MAX = 420, MENU_REST = 45, MENU_W = 220;
const editor = (id) => { const p = props() ?? {}; return openOverlay({ mod: MOD, kind: "dialog", frame: "none", width: 512, props: { actions: "edit", id, source: p.source, details: p.actions === "details" ? p.overlay : p.details } }); };

// A menu hangs 4px under the bar's 24px control, centered in its 40 (T3's MenuPopup sideOffset), under the click, not on the pointer; the app keeps it in the window.
// With no press to read (assistive tech clicks without one), the app's default: the pointer.
// Hung 4 under the control, right edges together (its outline 1 past ▾), as T3's (align end) and the layout's other menus
// from a right-side button: `b` is ▾'s bounds from the press.
const underBar = (b) => { const z = Number(settings()?.zoom) || 1; return b && { x: b.x + b.width + z - MENU_W * z, y: b.y + b.height + 5 * z }; };

function runAction(a) {
  const source = props()?.source;
  if (!sourceOkay(source)) { closeForAction(); return; }
  if (source?.terminal) run("pane.focus", { terminal: source.terminal });
  else if (source?.pane) run("pane.focus", { pane: source.pane });
  setShared(KEY.actions, { ...state(), last: a.id });
  // A mod pane (a review beside its agent) has no folder: use a terminal's in the same tab, else the space's.
  const f = focused();
  const folder = a.cwd?.startsWith("~") ? home() + a.cwd.slice(1)
    : a.cwd || source?.folder || f?.cwd || panes().find(p => p.tab === f?.tab && p.cwd)?.cwd || spaces().find(s => s.active)?.folder;
  // shortcut: sh -c skips your shell's aliases and functions and needs sh (not on plain Windows); run them through `zsh -ic` in the command if needed.
  run("terminal.open", { argv: ["sh", "-c", a.command], name: a.name, place: a.place ?? "tab", ...(folder ? { folder } : {}) });
}

// The answer from Delete's confirm dialog.
function deleteAction(id) {
  const s = state();
  setShared(KEY.actions, { ...s, list: s.list.filter(x => x.id !== id) });
}

// Not shared/button.js: one outline round two halves is T3's ButtonGroup (docs/internals/t3-tokens.md).
// The bar's control: "▶ Dev | ▾", or "Add action" before there is one. Outlined, not filled: a fill would read as an active tab.
function control(view, t, stopPress = (_e, cx) => cx.stop_propagation()) {
  if (props()?.actions === "details") return panelControl(view, t);
  // A narrow bar's layout sets it (Herdr T3's bar-measure): the icon alone, the name left to the hover label. Unset, the full control.
  const s = state(), main = primary(s), compact = shared(KEY.compact), menuOn = popupOpen(view, "action-more", MENU_CLOSED);
  // T3's xs outline button: its svg hangs 2px into each side, its label sits 4 on, and with the icon alone it's 24 square.
  const ends = (el, wide) => wide ? el.pl(5).pr(7).gap(4) : el.justify_center();
  const box = (id) => h_flex().id(id).h(24).flex_none().items_center().rounded(8).border(1).border_color(t.border).text_size(12).on_mouse_down("left", stopPress);
  if (!main) return measuredTooltip(view, t, "action-add", "Add action", stop(view, t, "action-add", ends(box("action-add"), !compact).when(Boolean(compact), el => el.w(24)).text_color(lit(view, "action-add")).hover(st => st.bg(t.hover)).on_hover(glow(view, "action-add"))
    // The dialog covers it, before the pointer can report leaving it.
    .role("button").accessibility_label("Add action").on_click((_e, cx) => { view.hot = null; editor(null); cx.notify(); })
    .child(svg("mods/t3-actions/icons/plus.svg").size(14)).when(!compact, el => el.child("Add action")), 8), { shown: !compact, below: true });
  return box("actions").text_color(t.dim)
    // 22, the outline's inside: a hover card's wrapper has no height for h_full to fill.
    .child(measuredTooltip(view, t, "action-run", `Run ${main.name}`, stop(view, t, "action-run", ends(h_flex().id("action-run").h(22).items_center().rounded_l(8), !compact).when(Boolean(compact), el => el.w(23)).text_color(lit(view, "action-run")).hover(st => st.bg(t.hover)).on_hover(glow(view, "action-run"))
      .role("button").accessibility_label(`Run ${main.name}`).on_click(() => runAction(main))
      .child(icon(main.icon).size(14)).when(!compact, el => el.child(nameText(view, "action-run", main.name).max_w(140))), 8), { shown: !compact, below: true }))
    .child(div().w(1).h(22).flex_none().bg(t.border))
    .child(stop(view, t, "action-more", opener(view, { id: "action-more", closed: MENU_CLOSED, onOpen: (b) => openOverlay({ mod: MOD, kind: "popup", at: underBar(b), width: MENU_W, height: Math.min(MENU_MAX, MENU_REST + s.list.length * 28), props: { actions: "menu", source: props()?.source, details: null } }) })(
      div().id("action-more").h(22).w(23).flex().items_center().justify_center().rounded_r(8).text_color(menuOn ? t.foreground : lit(view, "action-more"))
        .when(menuOn, el => el.bg(t.selected)).when(!menuOn, el => el.hover(st => st.bg(t.hover))).on_hover(glow(view, "action-more"))
        .role("button").accessibility_label("Actions"))
      .child(svg("mods/t3-actions/icons/chevron-down.svg").size(16)), 8));
}

function panelControl(view, t) {
  const s = state(), main = primary(s), menuOn = detailsLayerOpen("menu");
  if (!main) return stop(view, t, "action-add", cardRow(t, "action-add").w_full().role("button").accessibility_label("Add action").cursor_pointer()
    .on_click(() => editor(null)).child(svg("mods/t3-actions/icons/plus.svg").size(16).flex_none().text_color(t.dim)).child("Add action"), 8);
  return split(t, { id: "details-actions-row", mainId: "action-run", moreId: "action-more", chevron: CHEVRON, size: "row",
    hot: splitHot(view, "action-run", "action-more"), on: menuOn, label: `Run ${main.name}`, moreLabel: "Actions" },
    // Its whole name in a tooltip only when it's cut (measured-text.js), on the half, whose hover it is.
    run => measuredTooltip(view, t, "action-run", main.name, stop(view, t, "action-run", run.on_hover(glow(view, "action-run")).on_click(() => runAction(main))
      .child(icon(main.icon).size(16).flex_none().text_color(t.dim)).child(nameText(view, "action-run", main.name, { size: 13, weight: "medium" }).flex_1().whitespace_nowrap()), 8), { below: true }),
    more => stop(view, t, "action-more", opener(view, { closed: MENU_CLOSED, onOpen: (b) => openLayer("menu", underRow(b, Math.min(MENU_MAX, 36 + s.list.length * 28))) })(more.on_hover(glow(view, "action-more"))), 8));
}

// The menu takes the keyboard, as the shipped menu does. As T3's, nothing is lit until a key or the pointer gets there.
function initMenu(view, cx) {
  view.at = -1;
  view.keys = cx.focus_handle();
  view.keys.focus();
  stopsInit(view, cx, "modal");
}

function menu(view) {
  const t = theme(), { list } = state(), done = () => closeOverlay(props().overlay), panel = Boolean(props().details), rest = panel ? 36 : MENU_REST;
  const picks = [...list.map(a => () => runAction(a)), () => editor(null)];
  const labels = [...list.map(a => a.name), "Add action"];
  const row = (id, at, icon, label, trail = null) => menuRow(view, t, id, { at: [view, "at", at], label, icon, trail, pick: () => { done(); picks[at](); } });
  return focusRoot(view, v_flex().id("actions-menu").size_full().min_h(0).p(4).bg(t.popover).text_size(14)
    .track_focus(view.keys).on_key_down((e, cx) => {
      // On a row's Edit, Enter is Edit's.
      if (e.key === "enter") { if (onStop(view)) return; if (view.at >= 0) { done(); picks[view.at](); } }
      else if (e.key === "escape") done();
      else {
        const to = menuJump(view, e, labels, view.at);
        if (to < 0) return;
        view.at = to;
      }
      cx.stop_propagation();
      cx.notify();
    })
    // Add action stays outside the list, always in view: with it lit, nothing here is.
    .child(scrollList(view, "actions-list", { count: list.length, row: 28, height: Math.min(list.length * 28, MENU_MAX - rest), at: view.at < list.length ? view.at : -1, wheeled: (keep) => { if (keep >= 0) view.at = keep; }, draw: (at) => { const a = list[at]; return row(`action-${a.id}`, at, icon(a.icon).size(16).text_color(t.muted), a.name,
        div().size(24).flex_none().when(!panel || view.at === at || onStop(view) === `edit-${a.id}`, el => el.child(tip(view, t, `edit-${a.id}`, `Edit ${a.name}`, stop(view, t, `edit-${a.id}`, button(t, `edit-${a.id}`, { icon: "mods/t3-actions/icons/settings.svg", label: `Edit ${a.name}`, surface: "card", hot: view.hot === `edit-${a.id}` })
          .on_hover(glow(view, `edit-${a.id}`)).on_click((_e, cx) => { cx.stop_propagation(); done(); editor(a.id); }), radiusOf()), { below: true })))); } }))
    .when(!panel, el => el.child(menuRule(t)))
    .child(row("action-new", list.length, "mods/t3-actions/icons/plus.svg", "Add action")));
}

// The editor dialog: this copy's own inputs, made once in init.
function initEditor(view, cx) {
  stopsInit(view, cx, "modal");
  const a = state().list.find(x => x.id === props().id);
  view.action = a;
  view.icon = a?.icon ?? "play";
  view.place = a?.place ?? "tab";
  view.inputs = [["name", "Dev"], ["command", "bun run dev"], ["cwd", "Focused terminal's folder"]].map(([k, placeholder]) => {
    const input = InputState.new({ placeholder, value: a?.[k] ?? "" });
    input.on("change", (_e, cx) => cx.notify());
    input.on("submit", () => saveEditor(view));
    return [k, input];
  });
  view.inputs[0][1].focus();
}

function saveEditor(view) {
  const v = Object.fromEntries(view.inputs.map(([k, input]) => [k, input.value().trim()]));
  if (!v.name || !v.command) return;
  const s = state(), id = view.action?.id ?? Date.now().toString(36);
  const next = { id, name: v.name, command: v.command, icon: view.icon, place: view.place, ...(v.cwd ? { cwd: v.cwd } : {}) };
  setShared(KEY.actions, { ...s, list: view.action ? s.list.map(x => x.id === id ? next : x) : [...s.list, next] });
  closeOverlay(props().overlay);
}

// T3's dialog: 512 wide (max-w-lg) and as tall as its content. Its 16px corners are more than the app's frame has, so it opens frame: "none" and draws them.
const dialog = (id, t) => v_flex().id(id).size_full().relative().rounded(16).border(1).border_color(t.border).bg(t.popover).shadow_2xl().text_size(14).line_height("20px");
const dialogTitle = (t, text) => div().text_size(20).line_height("27.5px").font_semibold().text_color(t.foreground).child(text);
const dialogButton = (view, t, id, text, variant, act, disabled = false) => stop(view, t, id,
  button(t, id, { text, variant, size: "default", surface: "card", disabled }).when(!disabled, el => el.cursor_pointer().on_click(act)), radiusOf("default"));

function editorView(view) {
  const t = theme(), done = () => closeOverlay(props().overlay);
  const [name, command] = view.inputs.map(([, input]) => input.value().trim());
  const ok = Boolean(name && command);
  const label = (text) => div().line_height("16px").font_medium().text_color(t.foreground).child(text);
  const field = ([k, input]) => v_flex().gap(6).child(label({ name: "Name", command: "Command", cwd: "Folder (optional)" }[k]))
    .child(h_flex().h(32).px(11).rounded(8).border(1).border_color(t.border).bg(t.input).items_center()
      .child(Input.new(input).flex_1().h_full().text_size(14).text_color(t.foreground)));
  // T3's sm toggle: 28 at least, with 6 either side of its words.
  const choice = (id, on, pick, name, child) => stop(view, t, id, h_flex().id(id).h(28).min_w(28).px(6).rounded(8).items_center().justify_center().font_medium()
    .bg(on ? t.selected : t.input).text_color(lit(view, id, on ? t.foreground : t.dim)).on_hover(glow(view, id))
    .role("button").accessibility_label(name)
    .on_click((_e, cx) => { pick(); cx.notify(); }).child(child), 8);
  return focusRoot(view, dialog("action-editor", t)
    .child(div().p(24).pb(12).child(dialogTitle(t, view.action ? "Edit action" : "Add action")))
    // T3's close: 32 square, 8 in from the corner.
    .child(stop(view, t, "action-close", button(t, "action-close", { icon: "mods/t3-actions/icons/x.svg", label: "Close", size: "default", surface: "card", hot: view.hot === "action-close" })
      .absolute().top(8).right(8).on_hover(glow(view, "action-close")).on_click(done), radiusOf("default")))
    .child(v_flex().px(24).py(4).gap(16)
      .children(view.inputs.map(field))
      .child(h_flex().gap(16)
        .child(v_flex().gap(6).child(label("Icon")).child(h_flex().gap(2).children(ICONS.map(i =>
          choice(`icon-${i}`, view.icon === i, () => { view.icon = i; }, `Icon: ${i}`, icon(i).size(16)).px(0)))))
        .child(v_flex().gap(6).child(label("Run in")).child(h_flex().gap(2).children(PLACES.map(([p, text]) =>
          choice(`place-${p}`, view.place === p, () => { view.place = p; }, `Run in: ${text}`, text)))))))
    // As T3's editor: its footer is the bare kind, with no rule.
    .child(h_flex().mt_auto().px(24).py(16).gap(8).items_center()
      .when(Boolean(view.action), el => el.child(dialogButton(view, t, "action-delete", "Delete", "danger", () => {
          done();
          openOverlay({ mod: MOD, kind: "dialog", frame: "none", width: 512, props: {
            actions: "confirm",
            title: `Delete ${view.action.name}?`,
            detail: "This removes the action and can't be undone.",
            yes: "Delete",
            command: { name: `${MOD}.delete-action:${view.action.id}` },
          } });
        })))
      .child(div().flex_1())
      .child(dialogButton(view, t, "action-cancel", "Cancel", "outline", done))
      .child(dialogButton(view, t, "action-save", "Save", "primary", () => saveEditor(view), !ok))));
}

// T3's alert dialog, for what the shipped confirm mod would ask: props { title, detail, yes, command: { name, args } }. Enter confirms, Esc cancels.
// Drawn as this layout's editor is: a bare footer, and the going-ahead button the editor's Delete, its word saying what it does (`yes`).
function initConfirm(view, cx) {
  view.ask = cx.focus_handle();
  view.ask.focus();
  stopsInit(view, cx, "modal");
}

function confirmView(view) {
  const t = theme(), p = props() ?? {}, done = () => closeOverlay(p.overlay);
  const yes = () => { done(); run(p.command.name, p.command.args ?? {}); };
  return focusRoot(view, dialog("action-confirm", t).track_focus(view.ask)
    .on_key_down((e, cx) => {
      // On a button, Enter is the button's.
      if (e.key === "enter") { if (onStop(view)) return; yes(); }
      else if (e.key === "escape") done();
      else return;
      cx.stop_propagation();
    })
    .child(v_flex().p(24).gap(8).min_h(0)
      .child(dialogTitle(t, p.title ?? "Are you sure?"))
      .child(div().id("confirm-detail").max_h(384).overflow_y_scrollbar().text_color(t.muted).child(p.detail ?? "")))
    .child(h_flex().id("confirm-footer").mt_auto().px(24).pb(24).gap(8).items_center().justify_end()
      .child(dialogButton(view, t, "confirm-no", "Cancel", "outline", done))
      .child(dialogButton(view, t, "confirm-yes", p.yes ?? "Confirm", "danger", yes))));
}

export default class Actions extends View {

  init(_props, cx) {
    this.hot = null;
    // Installed alone, this may be the only mod of the layout's here: keys under old names move first (docs/internals/storage.md).
    migrate();
    const overlay = props()?.actions;
    if (overlay === "edit") initEditor(this, cx);
    if (overlay === "menu") initMenu(this, cx);
    if (overlay === "open-in") initMenu(this, cx);
    if (overlay === "directory-menu") initMenu(this, cx);
    if (overlay === "details-items") initMenu(this, cx);
    if (overlay === "confirm") initConfirm(this, cx);
    if (overlay === "details") { stopsInit(this, cx, "modal"); initDetails(this, cx); }
    if (overlay === "review-scope") { stopsInit(this, cx, "modal"); initRangeMenu(this, cx); }
    if (overlay === "review-commits") { stopsInit(this, cx, "modal"); initCommits(this, cx); }
    if (!overlay) stopsInit(this, cx);
    // The bar's copy answers Delete's dialog: `t3-actions.delete-action:<id>`.
    if (!overlay) cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command.startsWith("delete-action:")) deleteAction(command.slice("delete-action:".length));
        else if (command === "details") { toggleDetails(); cx.notify(); }
        else if (command === "dismiss-details") { dismissDetails(); cx.notify(); }
      }
    });
  }

  close() {
    stopsEnd(this);
    if (props()?.actions === "review-scope") closeRangeMenu(this);
    // Every menu, and every layer Details opens (Quick Review's too): a press on its button that closed it mustn't reopen it.
    if (/** @type {any} */ (this).keys || props()?.details) setShared(MENU_CLOSED, Date.now());
    // Its own menus go with it; Details, its button shows it gone.
    if (props()?.overlay) layerClosed(props().overlay);
  }

  render() {
    const overlay = props()?.actions;
    if (overlay === "menu") return menu(this);
    if (overlay === "open-in") return openInMenu(this);
    if (overlay === "directory-menu") return directoryMenu(this);
    if (overlay === "details-items") return detailsItemsMenu(this);
    if (overlay === "edit") return editorView(this);
    if (overlay === "confirm") return confirmView(this);
    if (overlay === "details") return detailsView(this, control, reviewDetailsView);
    if (overlay === "review-scope") return rangeMenu(this);
    if (overlay === "review-commits") return commitsMenu(this);
    const stopPress = (_e, cx) => cx.stop_propagation(), home = shared(KEY.home);
    return focusRoot(this, h_flex().size_full().items_center().justify_end()
      // Home has no project to run them in.
      .when(!home || !spaces().some(s => s.active && s.id === home), el => el.child(h_flex().id("actions-fit").flex_none().pr(props()?.details ? 0 : 8).items_center().on_size_change((size) => this.fit(size))
        .when(!props()?.details, el => el.child(control(this, theme(), stopPress)))
        .when(Boolean(props()?.details), el => el.child(trigger(this, theme(), "details-toggle", { icon: "mods/t3-actions/icons/square-menu.svg", label: "Details",
          action: "t3-tabs.details", below: true, open: Boolean(openedDetails()), closed: DETAILS_CLOSED, onOpen: (b) => toggleDetails(b) }))))));
  }

  // With the block's id in props.block, it sizes that block to the control: layout.resize, which Herdr keeps with the
  // layout's clicks. on_size_change reports zoomed pixels; a layout's are logical.
  fit(size) {
    // The window snaps a zoomed width to whole pixels: up to half a px over its logical width isn't more room needed.
    const id = props()?.block, px = Math.ceil(size.width / (Number(settings()?.zoom) || 1) - 0.5);
    if (!id || px === this.fitted) return;
    this.fitted = px;
    run("layout.resize", { id, px });
  }
}
