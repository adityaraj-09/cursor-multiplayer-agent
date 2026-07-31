/** localStorage key for the selected workspace scope on the dashboard/create flows. */
export const SELECTED_WORKSPACE_KEY = "steer:selectedWorkspace";

export type WorkspaceScope = "personal" | string;

export function readSelectedWorkspace(): WorkspaceScope {
  if (typeof window === "undefined") return "personal";
  try {
    const raw = window.localStorage.getItem(SELECTED_WORKSPACE_KEY);
    return raw?.trim() || "personal";
  } catch {
    return "personal";
  }
}

export function writeSelectedWorkspace(scope: WorkspaceScope): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SELECTED_WORKSPACE_KEY, scope);
  } catch {
    /* ignore */
  }
}
