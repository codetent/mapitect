// Timers exist in every runtime the core targets, but aren't part of the ES library.
declare function setTimeout(callback: () => void, ms?: number): unknown;
declare function clearTimeout(id: unknown): void;
