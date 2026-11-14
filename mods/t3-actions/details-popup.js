// Details' popup (cmd-shift-b): opening and closing it, the source it was opened on, and the menus that hang off it
// (popup-menu.js), each under its row (underRow). What it draws is workspace-details.js's; its Actions row actions.js's,
// its Quick Review review-details.js's.
import { spaces, panes, props, settings, openOverlay, closeOverlay, setShared } from "herdr";
import { within } from "./focus.js";
import { hang } from "./trigger.js";
import { openPopup, menuClosed } from "./popup-menu.js";
import { terminalFor, workFolder } from "./terminal-context.js";
import { closedKey } from "./store.js";
import { panelState } from "./panel.js";
import { detailsAnchor } from "./titlebar.js";

export const MENU_CLOSED = closedKey("t3-actions", "menu"), DETAILS_CLOSED = closedKey("t3-actions", "details");
export const CHEVRON = "mods/t3-actions/icons/chevron-down.svg";
// T3 threadDetailsPanelStyles: the card 280 wide, its rows inside its 1px border and 8 padding.
export const CARD_W = 280, ROW_W = CARD_W - 2 - 16, CARD_MAX = 420;

// Only this run: Details' popup id. Mods share one JS context (terminal-context.js), so the bar's copy and the popups' read the same.
const reg = () => /** @type {any} */ (globalThis).t3Details ??= { id: null };
export const openedDetails = () => reg().id;

/** Where a row's menu goes: as wide as the row, 4 under it, right edges together; `b`, the pressed half's bounds. */
export const underRow = (b, height) => ({ width: ROW_W, height, ...hang(b, ROW_W) });

/** Opens a menu of this popup's, `kind` its props.actions: it shares Details' source and hangs off this popup. `keys`: opened
 *  by keys (a button's opener got no press: `!b`), so its first row lights (list.js propsLit in its init). */
export function openLayer(kind, place, extra = {}, keys = false) {
  const p = props(), root = p.actions === "details" ? p.overlay : p.details;
  return openPopup({ mod: "t3-actions", ...place, props: { ...extra, actions: kind, source: p.source, details: root, parents: [...(p.parents ?? []), p.overlay] } }, p.overlay, kind, keys);
}

/** A popup of this mod's closed: its own menus go with it; Details gone, its button shows it. */
export function layerClosed(id) {
  menuClosed(id);
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
  // Keys have no press to hang it under: the button's place, from what the header measured (titlebar.js).
  const viewport = globalThis.window?.viewport_size?.();
  if (!bounds && viewport) bounds = detailsAnchor(viewport, Number(settings().zoom) || 1, panelState().open);
  reg().id = openOverlay({ mod: "t3-actions", kind: "popup", frame: "none", width: CARD_W, height: CARD_MAX,
    ...hang(bounds, CARD_W),
    props: { actions: "details", source } });
}

// The half of a split under the pointer or the keyboard (T3's group-focus-within), for split()'s `hot`.
export const splitHot = (view, main, more) => view.hot === main || within(view, [main]) ? "main" : view.hot === more || within(view, [more]) ? "more" : null;
