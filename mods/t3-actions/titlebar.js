// What the header measured this run, for a popup keys open under a header button (Details, cmd-shift-b), in zoomed px:
// `end`, what stands right of Details in the tab row (t3-tabs' window part and the row's padding), and `panel`, what the
// open panel takes from the work column (t3-chrome's head, its padding and the root's divider). Mods share one JS context,
// so every copy reads the same. scripts/sync.sh copies this to the mods that use it.
const measured = () => /** @type {{ end?: number, panel?: number }} */ (/** @type {any} */ (globalThis).t3Titlebar ??= {});

/** The header's `part` ("end" or "panel") measured `width` wide, zoomed px. */
export function noteTitlebar(part, width) { measured()[part] = width; }

/** Details' 28px button, centred in the 40px row, in a `viewport` ({ width }) at zoom `z`, the panel `open` or not, zoomed px;
 *  null before what it stands by has drawn, and the popup takes its default place. */
export function detailsAnchor(viewport, z, open) {
  const m = measured();
  if (m.end == null || (open && m.panel == null)) return null;
  const right = viewport.width - m.end - (open ? m.panel : 0);
  return { x: right - 28 * z, y: 6 * z, width: 28 * z, height: 28 * z };
}
