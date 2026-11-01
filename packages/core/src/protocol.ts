// The messages between the diagram UI and its host. Plain JSON, so they can
// cross a webview's postMessage, an HTTP connection, or stay in-process.

import type { AdrIndex, DiagramModel, EditOp, SourceRange } from './model.ts';

export interface PreviewConfig {
  defaultDepth?: number; // detail level a preview opens at; 0 expands everything
  wheel?: string; // 'auto' | 'zoom' | 'pan'
}

// UI -> host
export type UiMessage =
  | { type: 'ready' }
  | { type: 'navigate'; range: SourceRange }
  | { type: 'highlight'; range: SourceRange | null }
  | { type: 'openLink'; url: string }
  | { type: 'export'; format: 'svg' | 'png'; data: string } // png data is base64
  | { type: 'edit'; edit: EditOp }
  | { type: 'openFile'; path: string }
  | { type: 'newDecision'; id: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reload' };

// host -> UI
export type HostMessage =
  | {
      type: 'update';
      uri: string;
      model: DiagramModel;
      fileName: string;
      config?: PreviewConfig;
      adrs?: AdrIndex; // decisions per element, from the ADR folders
    }
  | { type: 'toast'; message: string }
  | { type: 'cursor'; id: string | null }
  | { type: 'command'; command: 'fit' | 'export-svg' | 'export-png' };
