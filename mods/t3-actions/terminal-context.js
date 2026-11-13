// Only this run's last focused terminal per tab. Mods share one JS context, as focus.js already relies on.
import { focused, panes, spaces } from "herdr";

const recent = () => /** @type {any} */ (globalThis).t3TerminalContext ??= new Map();
export function rememberTerminal() {
  const f = focused(), all = panes();
  for (const [key, was] of recent()) if (!all.some(p => p.terminal === was.terminal && p.tab === was.tab)) recent().delete(key);
  if (f?.terminal) recent().set(`${f.space}:${f.tab}`, { ...f });
}
export function terminalFor(space = spaces().find(s => s.active)?.id, tab = spaces().find(s => s.id === space)?.tabs.find(t => t.active)?.id) {
  rememberTerminal();
  const was = recent().get(`${space}:${tab}`);
  return was && panes().some(p => p.terminal === was.terminal && p.tab === tab) ? was : null;
}
