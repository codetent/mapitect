// Dev-only browser entry: the mapitect UI, wired to dev/server.mts over HTTP.
// Host messages arrive as server-sent events; UI messages go out as POSTs, in order.
import '@mapitect/ui/styles.css';
import type { HostMessage, UiMessage } from '@mapitect/core';
import { mount, type HostBridge } from '@mapitect/ui';

const params = new URLSearchParams(location.search);
if (params.get('theme') === 'light') document.body.classList.add('theme-light');
const file = params.get('file') ?? 'platform.d2';

const events = new EventSource(`/api/events?file=${encodeURIComponent(file)}`);
let queue = new Promise<unknown>((resolve) => events.addEventListener('open', resolve, { once: true }));

const sent: UiMessage[] = [];
const post = (route: string, body: Record<string, unknown>) =>
  fetch(`/api/${route}`, { method: 'POST', body: JSON.stringify({ file, ...body }) });

const bridge: HostBridge = {
  send(msg) {
    sent.push(msg);
    queue = queue.then(() => post('message', { msg }));
  },
  onMessage: (listener) => events.addEventListener('message', (ev) => listener(JSON.parse(ev.data) as HostMessage)),
  loadState: () => undefined,
  saveState: () => undefined,
};

mount(document.getElementById('app')!, bridge);

// Helpers for driving the harness from the console.
const w = window as unknown as Record<string, unknown>;
w.__sent = sent;
w.__setText = (text: string) => post('text', { text });
w.__text = async () => (await (await post('text', {})).json()).text;
