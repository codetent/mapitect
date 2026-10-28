// Dev-only: stands in for the VS Code host so the webview can be run in a browser.
import { parseD2 } from '../src/parser/d2.ts';

const params = new URLSearchParams(location.search);
document.body.classList.add(params.get('theme') === 'light' ? 'vscode-light' : 'vscode-dark');
const file = params.get('file') ?? 'platform.d2';

const sent: unknown[] = [];
(window as unknown as Record<string, unknown>).__sent = sent;
(window as unknown as Record<string, unknown>).acquireVsCodeApi = () => ({
  postMessage(msg: { type: string }) {
    sent.push(msg);
    if (msg.type === 'ready') void load();
  },
  getState: () => undefined,
  setState: () => undefined,
});

async function load(source?: string): Promise<void> {
  const text = source ?? (await (await fetch(`../examples/${file}`)).text());
  const model = parseD2(text);
  window.postMessage({ type: 'update', uri: `file:///${file}`, fileName: file, model, config: {} }, '*');
}
(window as unknown as Record<string, unknown>).__load = load;
