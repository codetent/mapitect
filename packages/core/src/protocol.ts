// The messages between the diagram UI and its host. Plain JSON, so they can
// cross a webview's postMessage, an HTTP connection, or stay in-process.

import type { AdrIndex, DiagramModel, EditOp, Problem, SourceRange } from './model.ts';

export interface PreviewConfig {
  defaultDepth?: number; // detail level a preview opens at; 0 expands everything
  wheel?: string; // 'auto' | 'zoom' | 'pan'
}

// What went wrong while the UI drew the diagram.
export type RenderProblem =
  | { kind: 'layout'; message: string } // the layout failed; the previous picture stays
  | { kind: 'icon'; id: string }; // the element's icon could not be loaded

// UI -> host
export type UiMessage =
  | { type: 'ready' }
  | { type: 'navigate'; range: SourceRange }
  | { type: 'highlight'; range: SourceRange | null }
  | { type: 'openLink'; url: string }
  | { type: 'export'; format: 'svg' | 'png'; data: string } // png data is base64
  | { type: 'edit'; edit: EditOp }
  | { type: 'openFile'; path: string; range?: SourceRange } // a range opens it for editing there
  | { type: 'newDecision'; id: string | null } // null: a system-wide decision
  | { type: 'renderProblems'; problems: RenderProblem[] } // replaces the ones sent before
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
      problems?: Problem[]; // in the decisions and from drawing; the compiler's are in model.issues
    }
  | { type: 'problems'; problems: Problem[] } // the problems changed, the diagram didn't
  | { type: 'toast'; message: string }
  | { type: 'cursor'; id: string | null }
  | { type: 'command'; command: 'fit' | 'export-svg' | 'export-png' };
