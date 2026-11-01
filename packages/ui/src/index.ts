// @mapitect/ui: the interactive diagram, for any browser context.
//
// A host mounts it into an element and passes a HostBridge. Styles come from
// '@mapitect/ui/styles.css'; a host can theme them through these hooks on <body>:
//   classes   theme-light, theme-high-contrast (dark is the default)
//   variables --host-font-mono, --host-background, --host-foreground, --host-contrast-border

export { mount } from './app.ts';
export type { HostBridge } from './bridge.ts';
