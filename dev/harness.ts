// Dev-only: stands in for the VS Code webview API, forwarding to dev/server.mts.
const params = new URLSearchParams(location.search);
document.body.classList.add(params.get('theme') === 'light' ? 'vscode-light' : 'vscode-dark');
const file = params.get('file') ?? 'platform.d2';

const sent: unknown[] = [];
const w = window as unknown as Record<string, unknown>;
w.__sent = sent;

async function call(route: string, body: Record<string, unknown> = {}): Promise<void> {
  const res = await fetch(`/api/${route}`, { method: 'POST', body: JSON.stringify({ file, ...body }) });
  window.postMessage(await res.json(), '*');
}

w.acquireVsCodeApi = () => ({
  postMessage(msg: { type: string; edit?: unknown }) {
    sent.push(msg);
    if (msg.type === 'ready') void call('model');
    else if (msg.type === 'edit') void call('edit', { edit: msg.edit });
    else if (msg.type === 'undo' || msg.type === 'redo') void call(msg.type);
  },
  getState: () => undefined,
  setState: () => undefined,
});

// Helpers for driving the harness from the console.
w.__setText = (text: string) => call('text', { text });
w.__text = async () => (await (await fetch('/api/text', { method: 'POST', body: JSON.stringify({ file }) })).json()).text;
