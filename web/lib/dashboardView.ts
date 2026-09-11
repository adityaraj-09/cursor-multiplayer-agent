export type DashboardSessionsView = "list" | "grid";

const KEY = "steer:dashboardSessionsView";

export function readDashboardSessionsView(): DashboardSessionsView {
  if (typeof window === "undefined") return "list";
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === "grid" || raw === "list") return raw;
  } catch {
    /* ignore */
  }
  return "list";
}

export function writeDashboardSessionsView(view: DashboardSessionsView): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, view);
  } catch {
    /* ignore quota / private mode */
  }
}
