// Clean up (docs/internals/specs/dialogs.md#clean-up), drawn as Inbox is: an Idle shelf folded to its count, then a Left behind
// shelf whose programs, running where no agent is at work any more, are cards. Quiet until hovered (t3-tokens P7), the act for a title and the reason last (P5, P9).
// t3-tabs.cleanup opens it: props { idle: [row], cards: [row + process], command: { name } | null }, a row { pane, name, space,
// spaceId, machine, program }. What's gone since leaves, and the counts and the spaces that close follow.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, closeOverlay, props, panes, spaces } from "herdr";
import { stopsInit, stop, focusRoot, onStop, within } from "./focus.js";
import { button, radiusOf, tint } from "./button.js";
import { glow } from "./tip.js";
import { programIcon } from "./program.js";
import { alpha } from "./color.js";
import { projectMark } from "./project.js";
import { dialog, dialogTitle, dialogButton } from "./dialog.js";

const cleanUpAnd = (list) => list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;

export function initCleanUp(view, cx) {
  view.ask = cx.focus_handle();
  view.ask.focus();
  view.openIdle = false;
  stopsInit(view, cx, "modal");
}

const hovers = (view, id) => (over, cx) => {
  const to = over ? id : view.hot === id ? null : view.hot;
  if (to !== view.hot) { view.hot = to; cx.notify(); }
};

// The space's own mark, as Inbox's cards wear it; a space already gone keeps a plain one.
function mark(t, r, size) {
  const s = spaces().find((x) => x.id === r.spaceId) ?? { id: r.spaceId, name: r.space, machine: r.machine };
  return projectMark("mods/t3-actions", s, size, t, panes(), true);
}

// As Inbox's shelf header: a dim label, its count, a chevron when it folds; what it implies at the right.
/** @param {any} view @param {any} t @param {string} id @param {string} label @param {number} count
 *  @param {{ open?: boolean, side?: string | null, toggle?: (e: any, cx: any) => void }} o */
function shelfHead(view, t, id, label, count, { open = false, side = null, toggle = undefined }) {
  const lit = view.hot === id || within(view, [id]);
  const head = h_flex().id(id).h(32).px(8).gap(6).items_center().rounded(6).text_size(12)
    .child(div().flex_none().text_color(lit ? t.muted : t.dim).child(label))
    .child(div().flex_none().text_color(t.muted).child(String(count)))
    .when(Boolean(toggle), (el) => el.child(svg(`mods/t3-actions/icons/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim)))
    .child(div().flex_1())
    .when(Boolean(side), (el) => el.child(div().flex_none().text_color(t.dim).child(side)));
  if (!toggle) return head;
  return stop(view, t, id, head.cursor_pointer().on_hover(hovers(view, id)).on_click(toggle)
    .role("button").accessibility_label(`${open ? "Hide" : "Show"} ${count} ${label.toLowerCase()}`), 6);
}

// What closes: Settled's slim row, 32 here, its mark 40% until lit; a click goes there before you empty it.
function idleRow(view, t, r, done) {
  const id = `clean-up-idle-${r.pane}`, lit = view.hot === id || within(view, [id]);
  return stop(view, t, id, h_flex().id(id).h(32).px(8).gap(10).items_center().rounded(6).cursor_pointer()
    .when(lit, (el) => el.bg(tint(t, "card", false)))
    .on_hover(hovers(view, id)).on_click(() => { done(); run(`t3-tabs.go-pane:${r.pane}`, {}); })
    .role("button").accessibility_label(`Go to ${r.name}`)
    .child(div().flex_none().opacity(lit ? 1 : 0.4).child(mark(t, r, 16)))
    .child(div().flex_1().min_w(0).truncate().text_color(lit ? t.foreground : t.muted).child(r.name))
    .child(div().flex_none().text_size(12).text_color(t.dim).child(r.space)), 6);
}

// A program left behind, as Inbox's card: its space over its name, the process at the right where Stop comes on hover. A click goes
// there; Stop stops it, no second question: a word, as the ×s elsewhere ask first while a program runs.
function card(view, t, c, done) {
  const id = `clean-up-card-${c.pane}`, stopId = `clean-up-stop-${c.pane}`;
  const lit = view.hot === id || view.hot === stopId || within(view, [id, stopId]);
  const corner = lit
    ? stop(view, t, stopId, button(t, stopId, { text: "Stop", size: "micro", surface: "card", label: `Stop ${c.name}`, hot: view.hot === stopId })
      .on_hover(glow(view, stopId)).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); stopCard(c.pane); }), radiusOf("micro"))
    // A process the name already says isn't said twice (t3-tokens P5).
    : c.process && c.process.toLowerCase() !== c.name.toLowerCase() ? div().flex_none().font_family("monospace").child(c.process) : null;
  // A card on the dialog's face: a 4% fill at rest so it reads as one, the card surface's 7% hovered.
  const row = v_flex().id(id).px(8).py(8).rounded(6).cursor_pointer()
    .bg(lit ? tint(t, "card", false) : alpha(t.foreground, "0a"))
    .on_hover(hovers(view, id)).on_click(() => { done(); run(`t3-tabs.go-pane:${c.pane}`, {}); })
    .role("button").accessibility_label(`Go to ${c.name}`)
    .child(h_flex().h(20).gap(6).items_center().text_size(12).text_color(t.dim)
      .child(mark(t, c, 16))
      .child(div().flex_1().min_w(0).truncate().child(c.space))
      .when(Boolean(c.machine), (el) => el.child(svg("mods/t3-actions/icons/server.svg").size(12).flex_none().text_color(t.dim)).child(div().flex_none().child(c.machine)))
      .when(Boolean(corner), (el) => el.child(h_flex().h(20).min_w(20).flex_none().justify_end().items_center().child(corner))))
    .child(h_flex().h(20).mt(4).gap(6).items_center()
      .child(div().flex_1().min_w(0).truncate().text_color(lit ? t.foreground : t.muted).child(c.name))
      .child(div().flex_none().opacity(0.6).child(programIcon(c.program, 14, t.muted) ?? svg("mods/t3-actions/icons/terminal.svg").size(14).flex_none().text_color(t.muted))));
  return stop(view, t, id, row, 6);
}

const stopCard = (pane) => run(`t3-tabs.stop-pane:${pane}`, {});

// The card Ctrl+D stops: the one holding the keyboard, else the one under the pointer.
function litCard(view, cards) {
  const id = onStop(view) ?? view.hot;
  return cards.find((c) => id === `clean-up-card-${c.pane}` || id === `clean-up-stop-${c.pane}`);
}

export function cleanUpView(view) {
  const t = theme(), p = props() ?? {}, done = () => closeOverlay(p.overlay);
  const ps = panes(), live = new Set(ps.map((x) => x.pane));
  // A row goes as its pane does: stopped here, or anywhere else; the counts and the spaces that close follow.
  const idle = (p.idle ?? []).filter((r) => live.has(r.pane)), cards = (p.cards ?? []).filter((c) => live.has(c.pane));
  const n = idle.length, idleSet = new Set(idle.map((r) => r.pane));
  const closing = n ? spaces().filter((s) => {
    const tabs = new Set((s.tabs ?? []).map((c) => c.id)), mine = ps.filter((x) => tabs.has(x.tab));
    return mine.length > 0 && mine.every((x) => idleSet.has(x.pane));
  }).map((s) => s.name) : [];
  const yes = () => { if (!p.command) return; done(); run(p.command.name, p.command.args ?? {}); };
  const toggle = (_e, cx) => { view.openIdle = !view.openIdle; cx.notify(); };
  return focusRoot(view, dialog("action-clean-up", t).track_focus(view.ask)
    .on_key_down((e, cx) => {
      // On a row or a button, Enter is its own.
      if (e.key === "enter") { if (onStop(view)) return; yes(); }
      else if (e.key === "escape") done();
      else if (e.key === "d" && e.modifiers?.control) { const c = litCard(view, cards); if (!c) return; stopCard(c.pane); }
      else return;
      cx.stop_propagation();
    })
    .child(div().px(24).pt(24).pb(12).child(dialogTitle(t, "Clean up")))
    .child(v_flex().id("clean-up-body").px(16).gap(8).max_h(420).overflow_y_scrollbar()
      .when(n > 0, (el) => el.child(v_flex()
        .child(shelfHead(view, t, "clean-up-idle", "Idle", n, { open: view.openIdle, toggle, side: closing.length ? `closes ${cleanUpAnd(closing)}` : null }))
        .when(view.openIdle, (el) => el.child(v_flex().gap(1).children(idle.map((r) => idleRow(view, t, r, done)))))))
      .when(cards.length > 0, (el) => el.child(v_flex()
        .child(shelfHead(view, t, "clean-up-left", "Left behind", cards.length, { side: "no agent at work" }))
        .child(v_flex().gap(5).children(cards.map((c) => card(view, t, c, done)))))))
    // The reason last (P9), on a line of its own level with the title: beside the buttons it wrapped and pulled at them.
    .child(div().id("clean-up-note").px(24).pt(12).text_size(12).line_height("16px").text_color(t.dim)
      .child("Skips the tab you're on, and programs in the space you're in."))
    .child(h_flex().id("clean-up-footer").mt_auto().px(24).pt(20).pb(24).gap(8).items_center().justify_end()
      .child(dialogButton(view, t, "clean-up-no", n ? "Cancel" : "Done", "outline", done))
      .when(n > 0, (el) => el.child(dialogButton(view, t, "clean-up-yes", `Close ${n}`, "danger", yes)))));
}
