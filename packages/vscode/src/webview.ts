// Webview entry: the mapitect UI, wired to the extension host through VS Code's webview API.
import '@mapitect/ui/styles.css';
import './webview.css';
import { mount, type HostBridge } from '@mapitect/ui';

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

const bridge: HostBridge = {
  send: (msg) => vscode.postMessage(msg),
  onMessage: (listener) => window.addEventListener('message', (ev) => listener(ev.data)),
  loadState: () => vscode.getState(),
  saveState: (state) => vscode.setState(state),
};

// VS Code marks the theme kind on <body> and changes it live; mirror it onto the UI's theme classes.
const syncTheme = () => {
  const cls = document.body.classList;
  cls.toggle('theme-light', cls.contains('vscode-light'));
  cls.toggle('theme-high-contrast', cls.contains('vscode-high-contrast'));
};
syncTheme();
new MutationObserver(syncTheme).observe(document.body, { attributes: true, attributeFilter: ['class'] });

mount(document.getElementById('app')!, bridge);
