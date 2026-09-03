"use client";

import { useEffect, useState } from "react";
import { Cloud, GitBranch, GitCompare, X } from "lucide-react";
import DiffViewer from "./DiffViewer";
import type { AppSocket } from "../lib/socket";
import type { AgentRuntime, CloudMeta } from "../../shared/events";

const COLLAPSED_KEY = "steer-side-panel-collapsed";

function readStoredCollapsed(): boolean {
  if (typeof window === "undefined") return true;
  const v = window.localStorage.getItem(COLLAPSED_KEY);
  if (v === null) return true;
  return v === "1";
}

interface SidePanelProps {
  socket: AppSocket | null;
  lastDiff: string;
  runtime: AgentRuntime;
  cloudMeta: CloudMeta | null;
  prUrl?: string;
  integrationBranch?: string;
  integrationPrUrl?: string;
  /** Mobile bottom-sheet mode */
  mobile?: boolean;
  onClose?: () => void;
  agentId?: string | null;
}

export default function SidePanel({
  socket,
  lastDiff,
  runtime,
  cloudMeta,
  prUrl,
  integrationBranch,
  integrationPrUrl,
  mobile = false,
  onClose,
  agentId = null,
}: SidePanelProps) {
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    const stored = readStoredCollapsed();
    queueMicrotask(() => setCollapsed(stored));
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  };

  const fileCount = lastDiff
    ? (lastDiff.match(/^diff --git /gm) || []).length
    : 0;

  const meta = cloudMeta || {};
  const effectivePr = meta.prUrl || prUrl;
  const title = runtime === "cloud" ? "Cloud" : "Changes";
  const countLabel =
    runtime === "local" && fileCount > 0 ? String(fileCount) : null;

  const rail = collapsed && !mobile;

  const header = (
    <div
      className={`relative flex items-center gap-2 px-3 h-11 border-b border-[#2b2b2b] bg-[#171717] shrink-0 ${
        rail ? "border-b-0 flex-col h-auto py-3 px-2" : ""
      }`}
    >
      {mobile && (
        <div className="w-8 h-1 rounded-full bg-[#3c3c3c] absolute left-1/2 -translate-x-1/2 top-2" />
      )}
      {mobile ? (
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#252525] text-[#a0a0a0]">
            {runtime === "cloud" ? (
              <Cloud className="h-3.5 w-3.5" strokeWidth={1.75} />
            ) : (
              <GitCompare className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
          </span>
          <span className="text-[12px] font-medium text-[#e4e4e4] truncate">{title}</span>
          {countLabel && (
            <span className="text-[11px] text-[#6e6e6e] tabular-nums">
              {countLabel}
            </span>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={toggleCollapsed}
          className={`flex items-center gap-2 min-w-0 flex-1 text-left hover:opacity-90 transition-opacity ${
            rail ? "flex-col flex-none w-full justify-center gap-1.5" : ""
          }`}
          aria-expanded={!collapsed}
          title={collapsed ? `Expand ${title}` : `Collapse ${title}`}
        >
          <span
            className="flex h-6 w-6 items-center justify-center rounded-md bg-[#252525] text-[#a0a0a0] shrink-0"
            aria-hidden
          >
            {runtime === "cloud" ? (
              <Cloud className="h-3.5 w-3.5" strokeWidth={1.75} />
            ) : (
              <GitCompare className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
          </span>
          <span
            className={`text-[12px] font-medium text-[#e4e4e4] ${
              rail ? "text-center leading-tight" : "truncate"
            }`}
            style={
              rail
                ? { writingMode: "vertical-rl", transform: "rotate(180deg)" }
                : undefined
            }
          >
            {title}
          </span>
          {countLabel && !rail && (
            <span className="text-[11px] text-[#6e6e6e] tabular-nums">
              {countLabel}
            </span>
          )}
          {countLabel && rail && (
            <span className="text-[10px] text-[#6e6e6e] tabular-nums">
              {countLabel}
            </span>
          )}
        </button>
      )}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-7 items-center gap-1.5 px-2.5 rounded-lg text-[12px] text-[#a0a0a0] hover:text-[#e4e4e4] border border-[#2b2b2b] shrink-0"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.75} />
          Close
        </button>
      )}
    </div>
  );

  const showContent = mobile || !collapsed;

  const content = showContent && (
    <div className="flex-1 min-h-0 overflow-hidden relative">
      {runtime === "cloud" ? (
        <div className="absolute inset-0 overflow-y-auto p-4 space-y-3">
          <div className="rounded-xl border border-[#2b2b2b] bg-[#181818] p-3">
            <div className="flex items-center gap-2 text-[12px] font-medium text-[#e4e4e4]">
              <GitBranch className="h-4 w-4 text-[#a0a0a0]" strokeWidth={1.75} />
              Cloud run metadata
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-[#6e6e6e]">
              Branch and PR details appear here as the agent works.
            </p>
          </div>
          <MetaRow label="Repository" value={meta.repoUrl} mono />
          <MetaRow label="Starting ref" value={meta.startingRef} mono />
          <MetaRow label="Branch" value={meta.branch} mono />
          <MetaRow label="Integration branch" value={integrationBranch} mono />
          <div>
            <div className="text-[11px] text-[#6e6e6e] mb-1">Integration PR</div>
            {integrationPrUrl ? (
              <a
                href={integrationPrUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[13px] text-[#4d9fff] hover:underline break-all"
              >
                {integrationPrUrl}
              </a>
            ) : (
              <p className="text-[13px] text-[#6e6e6e]">
                Click Integrate on an agent to merge into the shared PR
              </p>
            )}
          </div>
          <div>
            <div className="text-[11px] text-[#6e6e6e] mb-1">Pull request</div>
            {effectivePr ? (
              <a
                href={effectivePr}
                target="_blank"
                rel="noreferrer"
                className="text-[13px] text-[#4d9fff] hover:underline break-all"
              >
                {effectivePr}
              </a>
            ) : (
              <p className="text-[13px] text-[#6e6e6e]">
                {meta.autoCreatePR
                  ? "PR will appear when the agent opens one"
                  : "Auto-create PR is off for this room"}
              </p>
            )}
          </div>
        </div>
      ) : (
        <DiffViewer
          socket={socket}
          initialPatch={lastDiff}
          hideHeader
          agentId={agentId}
        />
      )}
    </div>
  );

  const body = (
    <>
      {header}
      {content}
    </>
  );

  if (mobile) {
    return (
      <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/60 backdrop-blur-sm">
        <button
          type="button"
          className="flex-1 w-full cursor-default"
          aria-label={`Close ${title.toLowerCase()}`}
          onClick={onClose}
        />
        <div className="relative h-[75vh] max-h-[85dvh] rounded-t-2xl border-t border-[#2b2b2b] bg-[#141414] flex flex-col overflow-hidden shadow-2xl pb-[env(safe-area-inset-bottom)]">
          {body}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`hidden lg:flex border-l border-[#2b2b2b] flex-col min-h-0 h-full overflow-hidden bg-[#131313] transition-[width] duration-200 ${
        collapsed
          ? "w-10 min-w-10 max-w-10"
          : "w-[38%] min-w-[300px] max-w-[540px]"
      }`}
    >
      {body}
    </div>
  );
}

function MetaRow({
  label,
  value,
  mono,
}: {
  label: string;
  value?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[11px] text-[#6e6e6e] mb-1">{label}</div>
      <div
        className={`text-[13px] text-[#e4e4e4] break-all ${
          mono ? "font-mono text-[12px]" : ""
        }`}
      >
        {value || "—"}
      </div>
    </div>
  );
}
