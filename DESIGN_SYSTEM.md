# EarsMixer server design system

## Interfaces

- Keep the browser mixer focused on the selected AUX, identifiable channels and quick level changes. Preserve list and grid layouts and keep connection, loading and PIN states legible. Use [mixer.css](web/mixer.css) for the existing browser styles.
- Use the admin dashboard's existing controls in [ui.jsx](admin/src/ui.jsx) and styles in [styles.css](admin/src/styles.css). Keep settings, live mixes, templates and connected clients easy to distinguish. Label desk-affecting and destructive actions explicitly.
- Use the native controls and materials in the Windows tray and macOS menu bar interfaces. Keep connection status understandable without colour.

## Labels and interaction

Write plain British English in sentence case. Use the desk terms musicians and engineers know, such as **AUX**, **channel**, **level**, **pan** and **desk**. Describe what happened and the next action in connection errors.

Keep touch targets reachable on phones and tablets. Give keyboard controls visible focus and accessible names. Preserve the selected AUX and channel context during loading, reconnect and layout changes.
