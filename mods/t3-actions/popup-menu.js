// Popup menus that hang off one another, as T3's MenuSub: t3-menu's Snooze, Files' folders as deep as they go, Details' menus
// and Quick Review's Commits. Which popup hangs off which is kept for this run only, in one registry: mods share one JS context
// (terminal-context.js), so every copy reads the same. A submenu is a popup of its own beside its row (submenu.js places it).
// scripts/sync.sh copies this to the mods that use it.
import { openOverlay, closeOverlay, props, settings, shared } from "herdr";
import { subPlace, subOpened } from "./submenu.js";
import { MENU_ROW } from "./menu-row.js";

// id → { mod, parent, kind }: the popup it hangs off (null: a top one) and what it is, for a row's on state (hasOpen).
const popups = () => /** @type {Map<string, { mod: string, parent: string | null, kind: string | null }>} */ (/** @type {any} */ (globalThis).t3Popups ??= new Map());

/** Opens openOverlay's `spec` as a popup hanging off `parent` (a popup's id, or null), recorded as `kind`: its id. */
export function openPopup(spec, parent = null, kind = null) {
  const id = openOverlay({ kind: "popup", ...spec });
  popups().set(id, { mod: spec.mod, parent, kind });
  return id;
}

/** Whether popup `id` is still open. */
export const isOpen = (id) => popups().has(id);
/** Whether popup `parent` has a `kind` popup open off it. */
export const hasOpen = (parent, kind) => [...popups().values()].some((m) => m.parent === parent && m.kind === kind);

/** In a popup's close(): it leaves the registry, and what hangs off it closes with it. */
export function menuClosed(id) {
  popups().delete(id);
  for (const [child, m] of popups()) if (m.parent === id) { popups().delete(child); closeOverlay(child); }
}

/** Closes every top popup of `mod` (cmd-w), what hangs off them with them: whether there was one. */
export function closeTops(mod) {
  const tops = [...popups()].filter(([, m]) => m.mod === mod && m.parent == null).map(([id]) => id);
  for (const id of tops) closeOverlay(id);
  return tops.length > 0;
}

/** A pick: this popup closes, and every one it hangs off (props().parents). */
export function closeChain() {
  const p = props() ?? {};
  // Not a popup (a bar's control): nothing to close. closeOverlay with no id would close the top one, whoever's it is.
  if (!p.overlay) return;
  closeOverlay(p.overlay);
  for (const id of [...(p.parents ?? [])].reverse()) closeOverlay(id);
}

/** Opens row `i`'s submenu beside it, closing the one open: `key` names it for submenu.js's hoverRow, `spec` is openOverlay's
 *  with the submenu's `width` and `height`. The row is where the pointer last found it (`view.rowsAt[i]`), else `row`: its top
 *  and width inside the menu, in the menu's px. Its props get `parents`, this popup and the ones it hangs off. */
export function openBeside(view, i, key, row, spec, kind = null) {
  closeSub(view);
  const p = props() ?? {}, z = Number(settings()?.zoom) || 1;
  // shortcut: with no row seen yet (keys only), the row is placed from the pointer where the menu opened, as Herdr opens it
  // there; a menu Herdr pushed back into the window puts its submenu off by as much. Upgrade if Herdr reports where an element is.
  const o = view.origin ?? { x: 0, y: 0 };
  const b = view.rowsAt[i] ?? { x: o.x + 4 * z, y: o.y + row.top * z, width: row.width * z, height: MENU_ROW * z };
  // Herdr keeps a popup in the window, but doesn't flip it: subPlace does, in the menu's own px.
  const at = subPlace({ x: b.x / z, y: b.y / z, width: b.width / z, height: b.height / z }, spec.width, 0, (/** @type {any} */ (globalThis).window?.viewport_size?.().width ?? 1e6) / z);
  const id = openPopup({ ...spec, at: { x: at.x * z, y: at.y * z }, props: { ...spec.props, parents: [...(p.parents ?? []), p.overlay] } }, p.overlay, kind);
  view.sub = { id, row: i };
  subOpened(view.s, key, { x: at.x * z, y: at.y * z, width: spec.width * z, height: spec.height * z }, at.side);
  return id;
}

/** Closes the open submenu; the keyboard comes back to the menu (`view.keys`). */
export function closeSub(view) {
  if (!view.sub) return;
  closeOverlay(view.sub.id);
  view.sub = null;
  subOpened(view.s, null);
  view.keys.focus();
}

/** In render: the submenu closed itself (← or Esc in it, a click beside it), so the keyboard comes back here. `stamp` is the key
 *  its close() writes: reading it redraws this menu then. */
export function subGone(view, stamp) {
  shared(stamp);
  if (view.sub && !popups().has(view.sub.id)) { view.sub = null; subOpened(view.s, null); view.keys.focus(); }
}
