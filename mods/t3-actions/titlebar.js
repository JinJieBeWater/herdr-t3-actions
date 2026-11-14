// What the header measured this run, for a popup keys open under a header button (Details, cmd-shift-b): t3-tabs' window
// part (`end`: the closed panel's toggle, the window's buttons) and t3-chrome's panel head (`panel`), in zoomed px. Mods
// share one JS context, so every copy reads the same. scripts/sync.sh copies this to the mods that use it.
const measured = () => /** @type {{ end?: number, panel?: number }} */ (/** @type {any} */ (globalThis).t3Titlebar ??= {});

/** The header's `part` ("end" or "panel") measured `width` wide, zoomed px. */
export function noteTitlebar(part, width) { measured()[part] = width; }

/** Details' button in a `viewport` ({ width }) at zoom `z`, the panel `open` or not: its 28px bounds, zoomed px. Its right
 *  edge is the work column's end (the panel, its 8 each side and the root's 1 divider, while open), less the layout's 12 and
 *  the window part. Before a part's first frame, the layout's sizes: the closed panel's 28 toggle, the panel's 480 least. */
export function detailsAnchor(viewport, z, open) {
  const m = measured();
  // shortcut: unmeasured, the window's own buttons (Windows, Linux) aren't counted; they're measured by the first frame.
  const right = viewport.width - (m.end ?? (open ? 0 : 28 * z)) - 12 * z - (open ? (m.panel ?? 480 * z) + 17 * z : 0);
  return { x: right - 28 * z, y: 6 * z, width: 28 * z, height: 28 * z };
}
