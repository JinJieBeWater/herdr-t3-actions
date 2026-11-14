// node mods/t3-actions/check.cjs: main.js runs on inert elements, every view reached without a window.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function element(kind = "div", source) {
  const node = { kind, source, items: [], handlers: {}, style: {}, hoverStyle: {} };
  const proxy = new Proxy(node, { get(target, key) {
    if (key in target) return target[key];
    return (...args) => {
      if (key === "when") { if (args[0]) args[1](proxy); }
      else if (key === "child" || key === "trigger") node.items.push(args[0]);
      else if (key === "children") node.items.push(...args[0]);
      else if (key === "on_mouse_down") node.handlers[`${key}:${args[0]}`] = args[1];
      else if (key.startsWith("on_")) node.handlers[key] = args[0];
      else if (key === "id") node.key = args[0];
      else if (key === "hover") { const hovered = element(); args[0](hovered); node.hoverStyle = hovered.style; }
      else node.style[key] = args.length === 1 ? args[0] : args;
      return proxy;
    };
  } });
  return proxy;
}
const find = (node, id) => !node || typeof node !== "object" ? null : node.key === id ? node : node.items.map(c => find(c, id)).find(Boolean) ?? null;
const strings = (node) => typeof node === "string" ? [node] : node && typeof node === "object" && node.style.h !== 0 ? node.items.flatMap(strings) : [];
function fire(node, event, ...args) {
  assert.ok(node, `missing event target: ${event}`);
  assert.equal(typeof node.handlers[event], "function", event);
  // No event given: Herdr's own, an empty one and the frame's cx.
  return node.handlers[event](...(args.length ? args : [{}, cx]));
}
const plain = (value) => JSON.parse(JSON.stringify(value));

const state = {}, calls = [], overlays = [], commands = [], jobs = [], zoom = 1.1;
const theme = new Proxy({ foreground: "#f4f4f6", dim: "#77777f", border: "#2a2a30", hover: "#202024" }, { get: (t, k) => t[k] ?? "#a9a9b4" });
// Text fields, in the order the editor makes them.
const fields = [];
const env = {
  View: class {}, div: () => element(), h_flex: () => element("h"), v_flex: () => element("v"),
  svg: (source) => element("svg", source), image: source => element("image", source), Input: { new: () => element("input") }, Popup: { new: (id, trigger) => element("popup").id(id).child(trigger) },
  InputState: { new: ({ value = "" }) => { const f = { text: value, on() {}, value: () => f.text, set_value: value => { f.text = value; }, focus() {} }; fields.push(f); return f; } },
  theme: () => theme, settings: () => ({ zoom }), home: () => "/home/me", keys: () => [], window: () => ({ platform: "macos" }),
  shared: (key) => state[key], setShared: (key, value) => { state[key] = value; },
  run: (name, args) => calls.push([name, plain(args)]),
  openOverlay: (spec) => overlays.push(spec), closeOverlay() {},
  focused: () => ({ tab: "b", cwd: "/repo" }), panes: () => [], spaces: () => [{ active: true, folder: "/space" }], layout: () => ({}),
  nextCommand: () => commands.length ? Promise.resolve(commands.shift()) : new Promise(() => {}),
};
const source = ["button.js", "store.js", "tip.js", "measured-text.js", "focus.js", "trigger.js", "list.js", "menu-row.js", "open-in.js", "terminal-context.js", "surfaces.js", "panel.js", "submenu.js", "popup-menu.js", "titlebar.js", "review-git.js", "review-menu.js", "review-scope.js", "details-popup.js", "actions.js", "workspace-details.js", "review-details.js", "main.js"].map(file => fs.readFileSync(path.join(__dirname, file), "utf8")).join("\n").replace("const DISABLED = 0.64;", "const DISABLED = 0.64;\nconst drawButton = button;")
  .replace(/^import .*;\r?\n/gm, "").replace("export default class", "globalThis.Mod = class").replace(/^export (?=(?:async\s+)?function\b|const\b|class\b)/gm, "");
const cx = { notify() {}, stop_propagation() {}, spawn: (fn) => jobs.push(fn), focus_handle: () => ({ focus() {} }), timer: { every: () => ({ cancel() {} }), after: (_ms, f) => (f(cx), { cancel() {} }) } };
const load = (props = {}) => {
  const context = vm.createContext({ ...env, props: () => props });
  vm.runInContext(source, context, { filename: "main.js" });
  const mod = new context.Mod();
  mod.init?.(props, cx);
  mod.testScope = context;
  return mod;
};

// Every icon it names is on disk.
for (const name of JSON.parse(/const ICONS = (\[[^\]]+\])/.exec(source)[1])) assert.ok(fs.existsSync(path.join(__dirname, "icons", `action-${name}.svg`)), `icon on disk: ${name}`);

// Home has no project to run them in; the same bar elsewhere shows them.
state["t3-tabs.home"] = "home";
env.spaces = () => [{ id: "home", active: true }];
assert.equal(find(load({ block: "actions" }).render(), "actions-fit"), null);
env.spaces = () => [{ id: "home" }, { id: "s", active: true, folder: "/space" }];
assert.ok(find(load({ block: "actions" }).render(), "actions-fit"));
env.spaces = () => [{ active: true, folder: "/space" }];
delete state["t3-tabs.home"];

// None yet: "Add action", outlined, brightening with its icon on hover; it opens the editor.
const bar = load({ block: "actions" });
assert.ok(find(bar.render(), "action-add").style.border, "outlined, as a control on its own in any bar");
assert.equal(find(bar.render(), "tip-action-add"), null, "visible Add action text needs no repeated tooltip");
assert.equal(find(bar.render(), "action-add").style.text_color, theme.dim);
fire(find(bar.render(), "action-add"), "on_hover", true, cx);
assert.equal(find(bar.render(), "action-add").style.text_color, theme.foreground, "its icon brightens with its text");
fire(find(bar.render(), "action-add"), "on_click", {}, cx);
assert.deepEqual(plain(overlays.at(-1)), { mod: "t3-actions", kind: "dialog", frame: "none", width: 512, props: { actions: "edit", id: null } }, "as T3's dialog, as tall as its fields");

// Some: "▶ Dev | ▾" in one outline, a rule between.
state["t3-actions.actions"] = { list: [{ id: "a", name: "Dev", command: "bun dev" }, { id: "b", name: "Test", command: "bun test", place: "right", cwd: "~/x" }] };
const control = find(bar.render(), "actions");
assert.ok(control.style.border);
assert.deepEqual(control.items.map(n => typeof n.key === "string" ? n.key : n.kind), ["action-run", "div", "action-more"]);
assert.equal(find(control, "tip-action-more"), null, "a split arrow keeps its accessible label, not a tooltip");
fire(find(control, "text-name-action-run"), "on_size_change", { width: 140 * zoom }, cx);
fire(find(control, "text-measure-action-run"), "on_size_change", { width: 120 * zoom }, cx);
assert.equal(find(bar.render(), "tip-action-run"), null, "the actually fitting name is not repeated");
fire(find(control, "text-measure-action-run"), "on_size_change", { width: 200 * zoom }, cx);
assert.ok(find(bar.render(), "tip-action-run"), "the actually clipped name has its full Run label");
assert.equal(find(bar.render(), "tip-action-run").style.anchor, "top_center");
assert.deepEqual(strings(find(control, "text-name-action-run")), ["Dev"]);
fire(find(control, "action-run"), "on_click");
assert.deepEqual(calls.at(-1), ["terminal.open", { argv: ["sh", "-c", "bun dev"], name: "Dev", place: "tab", folder: "/repo" }]);
// The menu hangs 4 under the control, right edges together (its outline 1 past ▾), as T3's (align end) and the layout's
// other menus from a right-side button; with no press (assistive tech), at the pointer.
fire(find(bar.render(), "action-more"), "on_click", {}, cx);
assert.equal(overlays.at(-1).at, undefined);
fire(find(bar.render(), "action-more"), "on_mouse_down:left", { position: { x: 1000, y: 20 }, bounds: { x: 990 * zoom, y: 9 * zoom, width: 23 * zoom, height: 22 * zoom } }, cx);
fire(find(bar.render(), "action-more"), "on_click", {}, cx);
const hung = plain(overlays.at(-1).at);
assert.deepEqual([hung.x / zoom, hung.y / zoom].map(v => Math.round(v * 1000) / 1000), [990 + 23 + 1 - 220, 9 + 22 + 1 + 4], "right edges together, 4 under the outline");
assert.equal(overlays.at(-1).mod, "t3-actions");
assert.equal(overlays.at(-1).width, 220, "as wide as the layout's other menus (t3-menu's, T3's)");
// The button toggles: the press closed the open menu on its way in, so its click doesn't open another.
{
  const open = load({ actions: "menu" }), count = overlays.length;
  fire(find(bar.render(), "action-more"), "on_mouse_down:left", { position: { x: 1000, y: 20 } }, cx);
  open.close();
  fire(find(bar.render(), "action-more"), "on_click", {}, cx);
  assert.equal(overlays.length, count, "closed by its own button");
  fire(find(bar.render(), "action-more"), "on_click", {}, cx);
  assert.equal(overlays.length, count + 1, "the keyboard's click has no press: it opens");
  delete state["t3-actions.menuClosed"];
  load({ actions: "edit" }).close();
  assert.equal(state["t3-actions.menuClosed"], undefined, "the editor isn't the menu");
}

// The menu: a row runs its action and makes it the one ▶ runs; a gear edits it.
const menu = load({ actions: "menu" });
fire(find(menu.render(), "action-b"), "on_click");
assert.deepEqual(calls.at(-1), ["terminal.open", { argv: ["sh", "-c", "bun test"], name: "Test", place: "right", folder: "/home/me/x" }]);
assert.deepEqual(strings(find(bar.render(), "action-run")), ["Test"]);
fire(find(menu.render(), "edit-a"), "on_click", {}, cx);
assert.deepEqual(plain(overlays.at(-1).props), { actions: "edit", id: "a" });

// Past the rows that show, ↑/↓ keep the highlight in view; Add action stays outside the list.
{
  const saved = state["t3-actions.actions"];
  state["t3-actions.actions"] = { ...saved, list: Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, name: `N${i}`, command: "x", icon: "play" })) };
  const long = load({ actions: "menu" }), press = (k) => fire(find(long.render(), "actions-menu"), "on_key_down", { key: k }, cx);
  assert.equal(find(long.render(), "actions-list").style.h, 420 - 45, "the list sets its own height: a popup's is only a maximum, and a flexed list would have none");
  assert.ok(!find(long.render(), "action-n20"), "only the rows in view are drawn");
  for (let i = 0; i < 26; i++) press("down");
  assert.ok(find(long.render(), "action-n25"), "the highlight's row is");
  for (let i = 0; i < 5; i++) press("down");
  assert.ok(find(long.render(), "action-new") && find(long.render(), "action-n29"), "Add action lit, the list stays where it was");
  state["t3-actions.actions"] = saved;
}

// The editor saves an edit in place, and a new one at the end.
fields.length = 0;
const edit = load({ actions: "edit", id: "a" });
assert.equal(edit.render().style.opacity, undefined, "its contents are there from the first frame");
assert.equal(find(edit.render(), "action-save").hoverStyle.opacity, 0.9);
assert.equal(find(edit.render(), "action-delete").style.bg, theme.raised);
assert.equal(find(edit.render(), "action-close").hoverStyle.bg, theme.foreground + "12", "a dialog's ghost uses a card tint");
fields[1].text = "bun run dev";
fire(find(edit.render(), "action-save"), "on_click");
assert.equal(state["t3-actions.actions"].list[0].command, "bun run dev");
fields.length = 0;
const add = load({ actions: "edit", id: null });
const disabledSave = find(add.render(), "action-save");
assert.equal(disabledSave.handlers.on_click, undefined, "disabled Save has no click");
assert.equal(disabledSave.style.opacity, 0.64);
assert.equal(disabledSave.style.bg, theme.solid, "disabled primary keeps its fill");
assert.deepEqual(disabledSave.hoverStyle, {}, "disabled Save has no hover");
assert.equal(state["t3-actions.actions"].list.length, 2, "no name or command, nothing saved");
fields[0].text = "Lint"; fields[1].text = "bun lint";
fire(find(add.render(), "action-save"), "on_click");
assert.deepEqual(plain(state["t3-actions.actions"].list.map(a => a.name)), ["Dev", "Test", "Lint"]);

// It sizes its block to the control, in logical pixels, once per change; without a block it leaves the layout alone.
calls.length = 0;
const fit = find(bar.render(), "actions-fit");
assert.equal(fit.style.pr, 8, "its own gap to what follows it");
fire(fit, "on_size_change", { width: 110 });
fire(fit, "on_size_change", { width: 110 });
assert.deepEqual(calls, [["layout.resize", { id: "actions", px: 100 }]]);
fire(find(load().render(), "actions-fit"), "on_size_change", { width: 220 });
assert.equal(calls.length, 1);
assert.ok([bar.render(), find(bar.render(), "actions"), find(bar.render(), "action-run")].every(n => !n.style.bg), "no fill at rest: the bar's own background shows");

// In a narrow bar the icon stands alone; the hover label and the accessibility label keep the name.
state["t3-tabs.compact"] = true;
assert.deepEqual(strings(find(bar.render(), "action-run")), []);
assert.equal(find(bar.render(), "action-run").style.accessibility_label, "Run Test");
assert.ok(find(bar.render(), "action-more"), "the menu stays");
const added = state["t3-actions.actions"];
state["t3-actions.actions"] = { list: [] };
assert.deepEqual(strings(find(bar.render(), "action-add")), []);
assert.equal(find(bar.render(), "action-add").style.accessibility_label, "Add action");
state["t3-actions.actions"] = added;
delete state["t3-tabs.compact"];

(async () => {
  // What opens over its button drops its hover: nothing reports the leaving until the pointer moves.
  state["t3-actions.actions"] = { list: [{ id: "a1", name: "Dev", command: "x" }, { id: "a2", name: "Test", command: "y" }] };
  const view = load();
  fire(find(view.render(), "action-more"), "on_hover", true, cx);
  fire(find(view.render(), "action-more"), "on_click", {}, cx);
  assert.equal(view.hot, null, "the menu's button doesn't stay lit");
  fire(find(view.render(), "action-more"), "on_hover", true, cx);
  assert.equal(find(view.render(), "tip-action-more"), null, "hover does not restore the removed split-arrow tooltip");

  // The menu goes by arrows and Enter.
  const selected = (n) => find(n.render(), "action-a1").style.bg === theme.selected;
  const menu = load({ actions: "menu" }), key = (k) => fire(find(menu.render(), "actions-menu"), "on_key_down", { key: k }, cx);
  assert.ok(!selected(menu) && find(menu.render(), "action-new").style.bg !== theme.selected, "as T3's, nothing lit until a key or the pointer gets there");
  overlays.length = 0; calls.length = 0;
  key("enter");
  assert.equal(overlays.length + calls.length, 0, "so Enter runs nothing");
  // The pointer lights the row it's on, and leaving it puts the light out, as the Snooze menu's.
  fire(find(menu.render(), "action-a1"), "on_hover", true, cx);
  assert.ok(selected(menu));
  fire(find(menu.render(), "action-a1"), "on_hover", false, cx);
  assert.ok(!selected(menu), "leaving the row clears it");
  key("up");
  assert.equal(find(menu.render(), "action-new").style.bg, theme.selected, "up wraps to the last row");
  overlays.length = 0;
  key("enter");
  assert.equal(overlays.pop().props.actions, "edit");

  // Delete asks; only the dialog's answer, split as the app splits it, deletes. Only the bar's copy hears it.
  jobs.length = 0;
  load();
  const heard = jobs.length;
  const edit = load({ actions: "edit", id: "a1" });
  assert.equal(jobs.length, heard, "an overlay's copy doesn't listen");
  fire(find(edit.render(), "action-delete"), "on_click", {}, cx);
  const { mod, props } = overlays.pop();
  assert.deepEqual([mod, props.actions, props.title, props.yes], ["t3-actions", "confirm", "Delete Dev?", "Delete"]);
  assert.equal(state["t3-actions.actions"].list.length, 2, "the click only asks");
  const dot = props.command.name.indexOf(".");
  assert.equal(props.command.name.slice(0, dot), "t3-actions");
  commands.push(props.command.name.slice(dot + 1));
  jobs[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(plain(state["t3-actions.actions"].list.map((a) => a.id)), ["a2"]);

  // T3's alert dialog: its buttons run the command or only close, Enter runs it, Esc only closes.
  {
    const ask = (p) => load({ actions: "confirm", title: "Close?", detail: "It stops.", command: { name: "x.y", args: { a: 1 } }, ...p });
    let ran = calls.length;
    fire(find(ask().render(), "confirm-no"), "on_click", {}, cx);
    assert.equal(calls.length, ran, "Cancel runs nothing");
    // As the editor's Delete: the theme's red on the raised fill, no block of color; it says what it does. A bare footer, as the editor's.
    Object.assign(theme, { ansi1: "#f38ba8", raised: "#313244" });
    const yesButton = find(ask({ yes: "Close" }).render(), "confirm-yes");
    assert.deepEqual([yesButton.style.text_color, yesButton.style.bg, yesButton.items.at(-1)], ["#f38ba8", "#313244", "Close"]);
    assert.equal(find(ask().render(), "confirm-yes").items.at(-1), "Confirm", "with no word given, Confirm");
    assert.equal(find(ask().render(), "confirm-footer").style.border_t, undefined, "no rule over the buttons");
    delete theme.ansi1; delete theme.raised;
    fire(find(ask().render(), "confirm-yes"), "on_click", {}, cx);
    assert.deepEqual(calls.at(-1), ["x.y", { a: 1 }]);
    ran = calls.length;
    fire(find(ask().render(), "action-confirm"), "on_key_down", { key: "escape" }, cx);
    assert.equal(calls.length, ran, "Esc runs nothing");
    fire(find(ask().render(), "action-confirm"), "on_key_down", { key: "enter" }, cx);
    assert.deepEqual(calls.at(-1), ["x.y", { a: 1 }]);
    const copy = ask();
    delete state["t3-actions.menuClosed"];
    copy.close();
    assert.equal(state["t3-actions.menuClosed"], undefined, "the dialog isn't the menu");
  }

  {
  // Home, End, typing; Enter on a row's Edit is Edit's, not the row's; the bar's stops wait for keyboard mode.
  const menu = load({ actions: "menu" }), key = (e) => fire(find(menu.render(), "actions-menu"), "on_key_down", e, cx);
  key({ key: "end" });
  assert.equal(find(menu.render(), "action-new").style.bg, theme.selected);
  key({ key: "home" });
  assert.notEqual(find(menu.render(), "action-new").style.bg, theme.selected);
  key({ key: "a", key_char: "a", modifiers: {} });
  assert.equal(find(menu.render(), "action-new").style.bg, theme.selected, "typing finds Add action");
  assert.equal(find(menu.render(), "action-new").style.tab_index, undefined, "rows go by the arrows");
}
{
  // Details: what it does, not how it's drawn.
  const source = { space: "s", tab: "b", terminal: "t9", folder: "/captured", machine: null };
  const panelLayout = () => ({ id: "root", children: [{ id: "work" }, { id: "panel", children: [{ id: "panel-body", children: [{ id: "files" }, { id: "review" }, { id: "panel-empty" }] }] }] });
  env.panes = () => [{ terminal: "t9", tab: "b", cwd: "/captured" }];
  env.spaces = () => [{ id: "s", active: true, machine: null, folder: "/space", tabs: [{ id: "b", active: true }] }];
  env.focused = () => ({ space: "s", tab: "b", terminal: "t9", cwd: "/captured" });

  // The button opens it on what's in view; a second press, which closed it, doesn't open it again.
  const entry = load({ details: true }), press = () => fire(find(entry.render(), "details-toggle"), "on_mouse_down:left", { bounds: { x: 1000, y: 6, width: 28 * zoom, height: 28 * zoom } }, cx);
  press(); fire(find(entry.render(), "details-toggle"), "on_click", {}, cx);
  const opened = overlays.at(-1);
  assert.deepEqual([opened.props.actions, plain(opened.props.source)], ["details", { space: "s", tab: "b", terminal: "t9", machine: null, folder: "/captured" }], "the tab's terminal and the folder it works in");
  assert.ok(vm.runInContext("openedDetails()", entry.testScope), "its button shows it open");
  const count = overlays.length;
  press(); entry.testScope.layerClosed(vm.runInContext("openedDetails()", entry.testScope));
  fire(find(entry.render(), "details-toggle"), "on_click", {}, cx);
  assert.equal(overlays.length, count, "closed by its own button");
  assert.ok(!vm.runInContext("openedDetails()", entry.testScope));

  // Its height follows what it holds, 420 at most.
  state["t3-actions.actions"] = { list: [] };
  const details = load({ actions: "details", source, overlay: "details" });
  details.testScope.layout = panelLayout;
  fire(find(details.render(), "details-content"), "on_size_change", { width: 280 * zoom, height: 240 * zoom }, cx);
  assert.equal(find(details.render(), "workspace-details").style.h, 242);
  fire(find(details.render(), "details-content"), "on_size_change", { width: 280 * zoom, height: 2000 * zoom }, cx);
  assert.equal(find(details.render(), "workspace-details").style.h, 420);

  // Add action's editor keeps Details behind it; an action runs where Details was opened, and not once that's gone.
  const closed = []; details.testScope.closeOverlay = id => closed.push(id);
  fire(find(details.render(), "action-add"), "on_click", {}, cx);
  assert.deepEqual(closed, []); assert.equal(overlays.at(-1).props.details, "details");
  state["t3-actions.actions"] = { list: [{ id: "a", name: "Run captured", command: "pwd", place: "down" }] };
  calls.length = 0; fire(find(details.render(), "action-run"), "on_click");
  assert.deepEqual([calls.at(-1)[1].folder, calls.at(-1)[1].place, closed.length], ["/captured", "down", 0]);
  details.testScope.spaces = () => [{ id: "other", active: true, tabs: [] }]; calls.length = 0;
  fire(find(details.render(), "action-run"), "on_click"); assert.equal(calls.length, 0, "a stale source runs nothing");
  details.testScope.spaces = env.spaces;
  // A long action name is whole in a tooltip only when it's cut.
  state["t3-actions.actions"] = { list: [{ id: "a", name: "A deliberately long action name", command: "pwd" }] };
  fire(find(details.render(), "text-name-action-run"), "on_size_change", { width: 120 * zoom }, cx);
  fire(find(details.render(), "text-measure-action-run"), "on_size_change", { width: 100 * zoom }, cx);
  assert.equal(find(details.render(), "tip-action-run"), null);
  fire(find(details.render(), "text-measure-action-run"), "on_size_change", { width: 240 * zoom }, cx);
  assert.ok(find(details.render(), "tip-action-run"), "clipped: its whole name");

  // A row's menu is as wide as the row, right edges together, 4 under it.
  fire(find(details.render(), "details-open-more"), "on_mouse_down:left", { bounds: { x: 900, y: 100, width: 32 * zoom, height: 32 * zoom } }, cx);
  fire(find(details.render(), "details-open-more"), "on_click", {}, cx);
  const menu = overlays.at(-1);
  assert.deepEqual([menu.props.actions, menu.width, Math.round(menu.at.x * 100) / 100, Math.round(menu.at.y * 100) / 100], ["open-in", 262, Math.round((900 + 32 * zoom - 262 * zoom) * 100) / 100, Math.round((100 + 36 * zoom) * 100) / 100]);
  assert.equal(find(details.render(), "details-open-row").style.bg, theme.foreground + "1f", "its row stays on while it's open");
  // Details closing takes its menus with it; only Details watches the source.
  closed.length = 0;
  details.close();
  assert.deepEqual(closed, [overlays.length], "its open menu goes with it");
  assert.equal(find(details.render(), "details-open-row").style.bg, undefined);

  // Open in's menu only picks the app, and closes only itself.
  const picker = load({ actions: "open-in", source, targets: ["Finder", "Zed"], details: "parent", overlay: "picker" });
  const pickedExec = [], pickedClose = [];
  picker.testScope.exec = async (...args) => { pickedExec.push(args); return { code: 0 }; };
  picker.testScope.closeOverlay = id => pickedClose.push(id);
  fire(find(picker.render(), "open-in-menu"), "on_key_down", { key: "up" }, cx);
  fire(find(picker.render(), "open-in-menu"), "on_key_down", { key: "enter" }, cx);
  await Promise.resolve();
  assert.deepEqual([pickedExec.length, state["t3.openTarget"], pickedClose], [0, "Zed", ["picker"]]);
  // Open in opens there; an uninstalled app falls back to Finder for everyone.
  const opener = load({ actions: "details", source, overlay: "d2" }), ran = [];
  opener.targets = ["Finder", "Zed"];
  opener.testScope.exec = async (_cmd, args) => { ran.push([...args]); return { code: args.includes("-Ra") ? 1 : 0 }; };
  fire(find(opener.render(), "details-finder"), "on_click", {}, cx);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(ran, [["-Ra", "Zed"], ["--", "/captured"]]);
  assert.equal(state["t3.openTarget"], "Finder");

  // What shows: only what's hidden is kept; Reset shows all; with nothing shown, a way back.
  state["t3-actions.detailsItems"] = { environment: false, openIn: false, scripts: false, review: false };
  assert.ok(find(details.render(), "details-choose-items") && !find(details.render(), "details-context"));
  const items = load({ actions: "details-items", source, details: "details" });
  fire(find(items.render(), "details-item-openIn"), "on_click", {}, cx);
  assert.equal(state["t3-actions.detailsItems"].openIn, undefined);
  fire(find(items.render(), "details-items-reset"), "on_click", {}, cx);
  assert.deepEqual(plain(state["t3-actions.detailsItems"]), {});

  // Quick Review's end names the range a Review tab shows; a closed tab's isn't claimed.
  assert.equal(find(details.render(), "details-review-scope-slot"), null, "no Review shown: nothing named");
  state["t3.panels"] = { s: { tabs: [{ id: "review", born: 5 }], active: "review", open: true } };
  state["review.shown"] = { s: { root: "/captured", page: "/worktree", born: 5 } };
  assert.deepEqual(strings(find(details.render(), "details-review-scope-slot")), ["Uncommitted"]);
  state["review.shown"] = { s: { root: "/captured", page: "/commit/1a2b3c", label: "fix: keep", born: 4 } };
  assert.equal(find(details.render(), "details-review-scope-slot"), null, "a closed Review tab's range");
  // Its main half shows Review, asking for nothing: the tab shows what it shows, or its default.
  const asked = state.review; calls.length = 0;
  fire(find(details.render(), "details-review"), "on_click", {}, cx);
  assert.ok(calls.some(([name, a]) => name === "layout.select" && a.child === "review") && state.review === asked);
  // Its chevron: the range menu, under the row, as wide.
  fire(find(details.render(), "details-review-more"), "on_mouse_down:left", { bounds: { x: 900, y: 180, width: 32 * zoom, height: 32 * zoom } }, cx);
  fire(find(details.render(), "details-review-more"), "on_click", {}, cx);
  assert.deepEqual([overlays.at(-1).props.actions, overlays.at(-1).width], ["review-scope", 262]);
  delete state["t3-actions.menuClosed"];
}
{
  // The range menu: Review's rows, none checked before Review has shown one; a pick shows Review and asks it for that range.
  env.layout = () => ({ id: "root", children: [{ id: "work" }, { id: "panel", children: [{ id: "panel-body", children: [{ id: "files" }, { id: "review" }, { id: "panel-empty" }] }] }] });
  env.exec = async (_cmd, args) => args.includes("--show-toplevel") ? { code: 0, stdout: "/repo\n" } : { code: 0, stdout: "" };
  delete state["review.shown"]; delete state["t3.panels"];
  const source = { space: "s", tab: "b", terminal: "t9", folder: "/repo/sub" };
  const open = async (shown) => {
    state["review.shown"] = shown;
    jobs.length = 0;
    const range = load({ actions: "review-scope", source, details: "parent", parents: ["parent"], overlay: "quick", at: { x: 600, y: 220 } });
    await jobs.shift()(cx);
    Object.assign(range, { scopeGit: { root: "/repo", branch: "feature", base: "main", baseRef: "main", unmerged: 2, changed: 0 },
      picks: { commits: [{ sha: "abc123", subject: "fix: focused review", time: 1 }], unpushed: [] }, refs: [], scopeRoot: "/repo", scopeBase: null });
    return range;
  };
  const label = (range, id) => find(range.render(), id).style.accessibility_label;
  let range = await open(undefined);
  assert.ok(!label(range, "scope-uncommitted").endsWith(", shown") && !label(range, "scope-changes").endsWith(", shown"), "nothing claimed shown");
  assert.notEqual(find(range.render(), "scope-uncommitted").style.bg, theme.selected, "nothing lit on opening");
  state["t3.panels"] = { s: { tabs: [{ id: "review", born: 9 }], active: "review", open: true } };
  range = await open({ s: { root: "/repo", page: "/worktree", born: 9 } });
  assert.ok(label(range, "scope-uncommitted").endsWith(", shown"));
  assert.equal(find(range.render(), "scope-uncommitted").style.opacity, undefined, "the range shown isn't greyed at nothing");
  const closed = []; range.testScope.closeOverlay = id => closed.push(id);
  fire(find(range.render(), "scope-changes"), "on_click", {}, cx);
  const born = state["t3.panels"].s.tabs.find(t => t.id === "review").born;
  assert.deepEqual([state.review.page, state.review.root, state.review.born, state.review.analyze], ["/branch/feature", "/repo", born, true], "for the Review tab shown, its born");
  assert.ok(closed.includes("parent"), "Details goes");
  // A stale source changes nothing.
  const before = state.review;
  range.testScope.spaces = () => [{ id: "other", active: true, tabs: [] }];
  fire(find(range.render(), "scope-changes"), "on_click", {}, cx);
  assert.equal(state.review, before);
  range.testScope.spaces = env.spaces;
  // Commits opens beside it, a popup of its own; a commit picked there asks for it, its branch's Changes as base.
  fire(find(range.render(), "scope-commits"), "on_click", {}, cx);
  const sub = overlays.at(-1);
  assert.equal(sub.props.actions, "review-commits");
  assert.ok(sub.at.x >= 600 + (4 + 254) * zoom - 1, "beside its row, as t3-menu's submenus");
  assert.ok(Math.abs(sub.at.y - (220 + (4 + 2 * 28 + 9 - 5) * zoom)) < 0.01, "its first row level with Commits, under the two ranges and the rule");
  env.t3DetailsRange = range;
  const commits = load({ ...sub.props, overlay: "commits" });
  delete env.t3DetailsRange;
  fire(find(commits.render(), "scope-commit-abc123"), "on_click", {}, cx);
  assert.deepEqual([state.review.page, state.review.base], ["/commit/abc123", "/branch/feature"]);
  range.close();
}
console.log("ok: Actions controls/editor; Details opens on its source, its menus under their rows and gone with it; Quick Review shows Review and picks its range");
})().catch((e) => { console.error(e); process.exit(1); });
