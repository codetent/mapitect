// Thin wrapper around the official D2 compiler (@d2lang/d2, the WASM build of
// D2). Compiles run in the library's worker thread; results are turned into
// the preview model plus the source index used for navigation and edits.

import type { CompileResponse, D2 } from '@d2lang/d2';
import type { ParseIssue } from '../model.ts';
import { lineCol } from './ast.ts';
import { buildModel, type Built } from './convert.ts';

export type CompileResult = { ok: true; built: Built } | { ok: false; issues: ParseIssue[] };

export class D2Compiler {
  private d2: D2 | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly create: () => D2;

  constructor(create: () => D2) {
    this.create = create;
  }

  // `files` lets `...@import` resolve against sibling .d2 files.
  compile(text: string, inputPath = 'index', files: Record<string, string> = {}): Promise<CompileResult> {
    const run = async (): Promise<CompileResult> => {
      this.d2 ??= this.create();
      let res: CompileResponse;
      try {
        res = await this.d2.compile({ fs: { ...files, [inputPath]: text }, inputPath, options: { layout: 'dagre' } });
      } catch (err) {
        return { ok: false, issues: compileIssues((err as Error).message ?? String(err)) };
      }
      return { ok: true, built: buildModel(res, text) };
    };
    // Serialize: the worker handles one request at a time anyway.
    const result = this.queue.then(run, run);
    this.queue = result;
    return result;
  }

  async dispose(): Promise<void> {
    const d2 = this.d2;
    this.d2 = undefined;
    await d2?.dispose();
  }
}

// Compile errors arrive as a JSON array of {range, errmsg}.
export function compileIssues(message: string): ParseIssue[] {
  try {
    const list = JSON.parse(message) as { range: string; errmsg: string }[];
    if (Array.isArray(list) && list.length) {
      return list.map((e) => ({
        severity: 'error',
        message: e.errmsg.replace(/^[^\s:]+:\d+:\d+:\s*/, ''),
        range: lineCol(e.range),
      }));
    }
  } catch {
    // not JSON: fall through
  }
  return [{ severity: 'error', message, range: { line: 0, col: 0, endLine: 0, endCol: 1 } }];
}
