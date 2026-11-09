import type { Mode } from "../lib/types";

export function ModeIcon({ mode, done = false }: { mode: Mode; done?: boolean }) {
  if (mode === "task") {
    return (
      <svg className="mode-icon" viewBox="0 0 16 16" aria-label={done ? "Task done" : "Task"}>
        <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" fill={done ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" />
        {done && <path d="M5 8.2l2 2 4-4.4" fill="none" stroke="var(--surface)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />}
      </svg>
    );
  }
  if (mode === "fixed") {
    return (
      <svg className="mode-icon" viewBox="0 0 16 16" aria-label="Fixed">
        <rect x="3.5" y="7" width="9" height="7" rx="1.5" fill="currentColor" />
        <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    );
  }
  if (mode === "flexible") {
    return (
      <svg className="mode-icon" viewBox="0 0 16 16" aria-label="Flexible">
        <path d="M3 6.5a5 5 0 0 1 9-1.5M13 9.5a5 5 0 0 1-9 1.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M12.5 2v3.3H9.2M3.5 14v-3.3h3.3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg className="mode-icon" viewBox="0 0 16 16" aria-label="Target-fill">
      <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.5 2" />
      <circle cx="8" cy="8" r="2" fill="currentColor" />
    </svg>
  );
}

export const MODE_LABEL: Record<Mode, string> = {
  fixed: "Fixed (never moved)",
  flexible: "Flexible (may be moved)",
  "target-fill": "Target-fill (auto-placed)",
  task: "Task (auto-placed chore)",
};
