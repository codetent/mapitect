// @mapitect/core: everything that doesn't depend on where mapitect runs.
// No Node, DOM or VS Code APIs; hosts plug in through the interfaces in ports.ts.

export * from './model.ts';
export * from './protocol.ts';
export * from './ports.ts';
export * as paths from './path.ts';
export { ADR_VAR, adrFolderEntries, adrFoldersOf, indexAdrs, parseMadr, planNewAdr, scanAdrs, type AdrFile, type AdrScan, type NewAdr } from './adr.ts';
export { compileIssues, D2Compiler, type CompileResult } from './d2/compiler.ts';
export { buildModel, type Built } from './d2/convert.ts';
export { applyEdits, EditError, planEdit } from './d2/edits.ts';
export { CompileCache, type DocState } from './compile-cache.ts';
export { DiagramSession } from './session.ts';
