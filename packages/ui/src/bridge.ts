import type { HostMessage, UiMessage } from '@mapitect/core';

// How the UI reaches its host: a webview's postMessage, an HTTP connection,
// or a DiagramSession in the same page.
export interface HostBridge {
  send(msg: UiMessage): void;
  onMessage(listener: (msg: HostMessage) => void): void;
  // View state (focus, camera, panels) kept across reloads of the UI; opaque to the host.
  loadState(): unknown;
  saveState(state: unknown): void;
}
