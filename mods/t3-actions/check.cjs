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
  return node.handlers[event](...args);
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
const source = ["button.js", "store.js", "tip.js", "measured-text.js", "focus.js", "list.js", "open-in.js", "panel.js", "terminal-context.js", "submenu.js", "review-git.js", "review-menu.js", "review-scope.js", "workspace-details.js", "review-details.js", "main.js"].map(file => fs.readFileSync(path.join(__dirname, file), "utf8")).join("\n").replace("const DISABLED = 0.64;", "const DISABLED = 0.64;\nconst drawButton = button;")
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
  const source = { space: "s", tab: "b", terminal: "t9", folder: "/captured", machine: "remote-computer-name-that-is-deliberately-long" };
  env.panes = () => [{ terminal: "t9", tab: "b", cwd: "/captured" }];
  env.spaces = () => [{ id: "s", active: true, tabs: [{ id: "b", active: true }] }];
  const entry = load({ details: true });
  fire(find(entry.render(), "details-toggle"), "on_mouse_down:left", { bounds: { x: 1000, y: 6, width: 28 * zoom, height: 28 * zoom } }, cx);
  fire(find(entry.render(), "details-toggle"), "on_click", {}, cx);
  assert.equal(overlays.at(-1).props.actions, "details", "the real entry button click handler opens Details");
  assert.equal(overlays.at(-1).height, 420, "the host allows the measured popup content to grow");
  state["t3-actions.actions"] = { list: [] };
  const details = load({ actions: "details", source, overlay: "details" });
  const root = details.render();
  assert.equal(find(root, "workspace-details").style.rounded, 16);
  assert.equal(find(root, "workspace-details").style.shadow_lg, undefined, "no card shadow: the native popup clips it into square corners");
  assert.ok(find(root, "workspace-details").style.h >= 50, "an open Details scroll viewport has room for a control, never zero height");
  fire(find(root, "details-content"), "on_size_change", { width: 280 * zoom, height: 240 * zoom }, cx);
  assert.equal(find(details.render(), "workspace-details").style.h, 242, "Details sizes its viewport from laid-out content plus the border");
  fire(find(root, "details-content"), "on_size_change", { width: 280 * zoom, height: 2000 * zoom }, cx);
  assert.equal(find(details.render(), "workspace-details").style.h, 420, "long content is scrollable within the popup's height limit");
  fire(find(root, "details-content"), "on_size_change", { width: 280 * zoom, height: 112 * zoom }, cx);
  assert.ok(find(root, "details-machine-name").items.some(child => child.style?.truncate), "visible name truncates without constraining its natural-width sibling");
  assert.ok(find(root, "details-machine-name").style.whitespace_nowrap !== undefined);
  assert.equal(find(root, "details-space-menu")?.handlers.on_click, undefined, "a started context is locked, not a space-management button");
  assert.equal(find(root, "details-path").handlers.on_click, undefined, "folder is a path tooltip, not a separate copy button");
  assert.equal(find(root, "details-path").kind, "div", "the host only wires tooltips on owned wrappers, not SVGs");
  assert.equal(find(root, "details-machine-icon").style.tooltip, undefined, "the adjacent visible computer name is not repeated on its glyph");
  fire(find(root, "details-machine-name"), "on_size_change", { width: 160 * zoom }, cx);
  fire(find(root, "text-measure-details-machine-name"), "on_size_change", { width: 220 * zoom }, cx);
  assert.ok(find(details.render(), "tip-details-machine-name"), "a clipped computer name uses the shared measured-text tooltip");
  assert.ok(find(details.render(), "details-machine-slot").style.flex_1, "adding a tooltip cannot steal the folder icon's space");
  assert.equal(find(root, "details-context").hoverStyle.bg, undefined, "a locked context cannot light up on initial pointer hover");
  assert.equal(find(root, "details-path-slot").style.w, 32, "the folder sits in the same 32px end slot as the rows' chevrons");
  assert.ok(find(root, "action-add"));
  const detailsClose = [];
  details.testScope.closeOverlay = id => detailsClose.push(id);
  fire(find(root, "action-add"), "on_click", {}, cx);
  assert.deepEqual(detailsClose, [], "opening the action editor keeps details behind it");
  assert.equal(overlays.at(-1).props.details, "details");
  assert.equal(find(root, "details-finder").style.opacity, 0.64, "remote open uses the existing disabled token");
  assert.equal(find(root, "details-finder").handlers.on_click, undefined);
  state["t3-actions.actions"] = { list: [{ id: "a", name: "Run captured", command: "pwd", place: "down" }] };
  calls.length = 0;
  fire(find(details.render(), "action-run"), "on_click");
  assert.deepEqual(detailsClose, [], "running an action does not proactively dismiss its details");
  assert.equal(calls.at(-1)[1].folder, "/captured", "popup focus cannot replace the source cwd");
  assert.equal(calls.at(-1)[1].place, "down");
  details.testScope.spaces = () => [{ id: "other", active: true, tabs: [] }]; calls.length = 0;
  fire(find(details.render(), "action-run"), "on_click"); assert.equal(calls.length, 0, "stale source cannot execute");
  details.testScope.spaces = () => [{ id: "s", active: true, tabs: [{ id: "b", active: true }] }];
  const picker = load({ actions: "open-in", source: { ...source, machine: null }, targets: ["Finder", "Zed"], details: "parent-details", overlay: "editor-picker" });
  const pickedExec = [], pickedClose = [];
  picker.testScope.exec = async (...args) => { pickedExec.push(args); return { code: 0 }; };
  picker.testScope.closeOverlay = id => pickedClose.push(id);
  fire(find(picker.render(), "open-in-menu"), "on_key_down", { key: "up" }, cx);
  assert.equal(find(picker.render(), "open-in-1").style.bg, theme.selected, "Up from no selection chooses the final editor");
  fire(find(picker.render(), "open-in-1"), "on_click");
  await Promise.resolve();
  assert.equal(pickedExec.length, 0, "choosing an editor changes preference, never opens a directory");
  assert.equal(state["t3.openTarget"], "Zed");
  assert.deepEqual(pickedClose, ["editor-picker"], "choosing closes only the picker, not its parent details");
  const many = load({ actions: "open-in", source: { ...source, machine: null }, targets: Array.from({ length: 20 }, (_, i) => `Editor ${i}`), details: "parent-details", overlay: "many-editors" });
  assert.equal(find(many.render(), "open-in-list").style.h, 412, "twenty editors scroll in a list capped with the menu at 420");
  for (let i = 0; i < 19; i++) fire(find(many.render(), "open-in-menu"), "on_key_down", { key: "down" }, cx);
  assert.ok(find(many.render(), "open-in-18"), "the keys' row is drawn, scrolled into view");
  const localDetails = load({ actions: "details", source: { ...source, machine: null }, overlay: "local-details" });
  localDetails.testScope.layout = () => ({ id: "root", children: [{ id: "panel", children: [{ id: "panel-body", children: [{ id: "files" }, { id: "review" }, { id: "panel-empty" }] }] }] });
  assert.ok(find(localDetails.render(), "details-review"), "Details has Quick Review instead of a Git operations section");
  assert.equal(find(localDetails.render(), "git-section"), null);
  fire(find(localDetails.render(), "details-review"), "on_mouse_down:left", { bounds: { x: 900, y: 180, width: 264 * zoom, height: 32 * zoom } }, cx);
  fire(find(localDetails.render(), "details-review"), "on_click", {}, cx);
  assert.equal(overlays.at(-1).props.actions, "review-scope", "the row opens the shared Review range selector, not a Git action");
  const reviewMenu = overlays.at(-1), anchored = load({ ...reviewMenu.props, overlay: "anchored-review" });
  assert.equal(reviewMenu.at.y + anchored.scopeOrigin.y * zoom, 219.6, "the scope menu starts 4px below Quick Review, without a detached header gap");
  assert.ok(Math.abs(reviewMenu.at.x + anchored.scopeOrigin.x * zoom - 900) < 0.001, "the scope menu's left edge is anchored to the pressed row");
  assert.ok(Math.abs(reviewMenu.at.x + (anchored.scopeOrigin.x + anchored.scopeMenuWidth) * zoom - 1190.4) < 0.001, "the scope menu's right edge is anchored to the pressed row");
  // Pressing the row again while its menu is open: the press outside closes the menu (its close() stamps), the click mustn't reopen it.
  const before = overlays.length;
  fire(find(localDetails.render(), "details-review"), "on_mouse_down:left", { bounds: { x: 900, y: 180, width: 264 * zoom, height: 32 * zoom } }, cx);
  anchored.close();
  fire(find(localDetails.render(), "details-review"), "on_click", {}, cx);
  assert.equal(overlays.length, before, "a second click on Quick Review closes its menu, as the sidebar's filter does");
  delete state["t3-actions.menuClosed"]; // later presses here are new ones, not this close's
  assert.equal(find(localDetails.render(), "details-review-more").style.w, 32, "Quick Review's chevron lines up with the split chevrons above");
  assert.equal(find(localDetails.render(), "details-review-scope-slot"), null, "no range shown yet: nothing claimed");
  state["review.shown"] = { s: { root: "/captured", page: "/worktree" } };
  assert.deepEqual(strings(find(localDetails.render(), "details-review-scope-slot")), ["Uncommitted"], "the range Review shows, in dim words");
  state["review.shown"] = { s: { root: "/captured", page: "/commit/1a2b3c4d5e", label: "fix: keep the label" } };
  assert.deepEqual(strings(find(localDetails.render(), "details-review-scope-slot")), ["fix: keep the label"], "a commit reads as Review's own scope button does, not its sha");
  delete state["review.shown"];
  localDetails.targets = ["Finder"];
  assert.ok(find(localDetails.render(), "details-open-more"), "the editor menu remains available with one target");
  assert.deepEqual([find(localDetails.render(), "details-open-row").style.bg, find(localDetails.render(), "details-open-row-rule").style.bg, find(localDetails.render(), "details-open-more").items.length], [undefined, undefined, 0],
    "at rest a row is plain: no fill, no seam, no chevron (a column of chevrons read as an accordion)");
  fire(find(localDetails.render(), "details-finder"), "on_hover", true, cx);
  assert.deepEqual([find(localDetails.render(), "details-open-row").style.bg, find(localDetails.render(), "details-open-row-rule").style.bg, find(localDetails.render(), "details-open-more").items.length], [theme.foreground + "12", theme.border, 1],
    "hovered: one fill under the whole split, its seam and chevron shown");
  fire(find(localDetails.render(), "details-finder"), "on_hover", false, cx);
  fire(find(localDetails.render(), "details-open-row"), "on_size_change", { width: 264 * zoom, height: 32 * zoom }, cx);
  fire(find(localDetails.render(), "details-open-more"), "on_mouse_down:left", { bounds: { x: 900, y: 100, width: 32 * zoom, height: 32 * zoom } }, cx);
  fire(find(localDetails.render(), "details-open-more"), "on_click", {}, cx);
  const selectedMenu = overlays.at(-1);
  assert.equal(selectedMenu.width, 264, "editor menu uses the full split row width");
  assert.equal(selectedMenu.at.x, 900 + 32 * zoom - 264 * zoom);
  assert.equal(find(localDetails.render(), "details-open-row").style.bg, theme.foreground + "1f", "menu open keeps the parent split in its card on-state");
  assert.equal(find(localDetails.render(), "details-open-row-rule").style.bg, theme.border);
  localDetails.testScope.detailsLayerClosed(overlays.length);
  assert.equal(find(localDetails.render(), "details-open-row").style.bg, undefined, "closing the menu releases its parent's on-state");
  fire(find(localDetails.render(), "action-more"), "on_mouse_down:left", { bounds: { x: 900, y: 140, width: 32 * zoom, height: 32 * zoom } }, cx);
  fire(find(localDetails.render(), "action-more"), "on_click", {}, cx);
  assert.equal(overlays.at(-1).width, 264, "the Actions picker also anchors to its full split row");
  assert.equal(find(localDetails.render(), "details-actions-row").style.bg, theme.foreground + "1f");
  assert.equal(find(localDetails.render(), "details-actions-row-rule").style.bg, theme.border);
  const panelMenu = load({ actions: "menu", details: "local-details" });
  assert.equal(find(panelMenu.render(), "edit-a"), null, "panel script Edit stays hidden until hover or keyboard selection");
  assert.equal(find(panelMenu.render(), "actions-menu-divider"), null, "T3 does not add a separator before Add action");
  fire(find(panelMenu.render(), "action-a"), "on_hover", true, cx);
  assert.ok(find(panelMenu.render(), "edit-a"));
  state["t3-actions.detailsItems"] = { environment: false, openIn: false, scripts: false, review: false };
  assert.equal(find(localDetails.render(), "details-context"), null, "hidden sections do not reserve rows");
  assert.ok(find(localDetails.render(), "details-choose-items"), "an empty card can always restore its items");
  const visibility = load({ actions: "details-items", source, details: "local-details" });
  fire(find(visibility.render(), "details-item-openIn"), "on_click", {}, cx);
  assert.equal(state["t3-actions.detailsItems"].openIn, undefined, "default-visible choices need no stored true value");
  fire(find(visibility.render(), "details-items-reset"), "on_click", {}, cx);
  assert.deepEqual(plain(state["t3-actions.detailsItems"]), {}, "Reset restores all default items without changing Actions");
  assert.ok(find(localDetails.render(), "details-context"));
  const opened = [];
  localDetails.targets = ["Finder", "Zed"]; state["t3.openTarget"] = "Zed";
  localDetails.testScope.exec = async (_cmd, args) => { opened.push([...args]); return { code: args.includes("-Ra") ? 1 : 0 }; };
  fire(find(localDetails.render(), "details-finder"), "on_click", {}, cx);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(opened, [["-Ra", "Zed"], ["--", "/captured"]]);
  assert.equal(state["t3.openTarget"], "Finder", "uninstalled target falls back globally");
}
{
  const source = { space: "s", tab: "b", terminal: "t9", folder: "/captured" };
  const scope = load({ actions: "review-scope", source, details: "parent", overlay: "quick" });
  assert.equal(find(scope.render(), "details-review-scope").style.h, 500, "the native scope popup's absolute menus have an explicit nonzero layout area");
  scope.testScope.layout = () => ({ id: "root", children: [{ id: "work" }, { id: "panel", children: [{ id: "panel-body", children: [{ id: "files" }, { id: "review" }, { id: "panel-empty" }] }] }] });
  const closed = []; scope.testScope.closeOverlay = id => closed.push(id);
  scope.scopeLoading = false;
  scope.scopeGit = { root: "/captured", branch: "feature", base: "main", baseRef: "main", unmerged: 2, changed: 1 };
  scope.picks = { commits: [{ sha: "abc123", subject: "fix: focused review", time: 1 }], unpushed: [] };
  assert.equal(find(scope.render(), "review-scope"), null, "Quick Review itself is the trigger; the child menu has no second scope button");
  scope.page = scope.base = "/branch/feature";
  assert.ok(find(find(scope.render(), "review-scope-menu"), "review-base"), "the existing base control stays inside the one child-menu frame");
  assert.equal(find(scope.render(), "review-scope"), null, "Changes does not bring back a second trigger either");
  scope.page = scope.base = "/worktree";
  fire(find(scope.render(), "scope-uncommitted"), "on_click", {}, cx);
  assert.equal(state.review.page, "/worktree", "quick pick asks Review for exactly the shared menu's range");
  assert.equal(state.review.space, "s"); assert.equal(state.review.root, "/captured");
  assert.equal(state["t3.panels"].s.active, "review", "a range pick opens or activates Review's unique tab");
  assert.deepEqual(closed, ["quick", "parent"]);
  closed.length = 0; calls.length = 0;
  scope.selectReview("/compare/main...feature", { stays: true }, cx);
  assert.deepEqual(closed, [], "a base remote switch preserves the picker, as on Review");
  assert.ok(!calls.some(([name]) => name === "t3-actions.dismiss-details"));
  const before = state.review;
  scope.testScope.spaces = () => [{ id: "other", active: true, tabs: [] }];
  scope.selectReview("/commit/abc123", {}, cx);
  assert.equal(state.review, before, "a stale Details source cannot change Review's range");
  scope.close();
}
console.log("ok: Actions controls/editor; T3 three-row details, single-line name, source cwd, invalidation and editor fallback");
})().catch((e) => { console.error(e); process.exit(1); });
