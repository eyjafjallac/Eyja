/** Autocomplete list and snippet field styles shared by the editors. */
export const promptTheme = {
  ".cm-tooltip.cm-tooltip-autocomplete": {
    padding: "6px",
    backgroundColor: "var(--bg-elevated)",
    color: "var(--text-primary)",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-md)",
    fontFamily: "var(--font-sans)",
    fontSize: "12.5px",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "inherit",
    maxHeight: "320px",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    padding: "5px 8px",
    borderRadius: "6px",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--accent)",
    color: "var(--text-on-accent)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionDetail": {
    color: "inherit",
    opacity: "0.8",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > completion-section": {
    padding: "4px 8px 4px",
    color: "var(--text-muted)",
    fontFamily: "inherit",
    fontSize: "10.5px",
    fontWeight: "600",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    opacity: "1",
    border: "0",
  },
  ".cm-completionLabel": {
    fontFamily: "var(--font-mono)",
    fontWeight: "500",
  },
  ".cm-completionDetail": {
    marginLeft: "16px",
    fontStyle: "normal",
    color: "var(--text-muted)",
  },
  ".cm-snippetField": {
    backgroundColor: "var(--accent-border)",
    borderRadius: "2px",
  },
};
