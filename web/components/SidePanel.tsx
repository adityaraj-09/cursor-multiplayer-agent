"use client";

import { useState } from "react";
import DiffViewer from "./DiffViewer";
import type { AppSocket } from "../lib/socket";
import type { AgentRuntime, CloudMeta } from "../../shared/events";

interface SidePanelProps {
  socket: AppSocket | null;
  lastDiff: string;
  runtime: AgentRuntime;
  cloudMeta: CloudMeta | null;
  prUrl?: string;
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
  mobile = false,
  onClose,
  agentId = null,
}: SidePanelProps) {
  const [collapsed, setCollapsed] = useState(false);

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
      className={`relative flex items-center gap-2 px-3 h-10 border-b border-[#2b2b2b] bg-[#1a1a1a] shrink-0 ${
        rail ? "border-b-0 flex-col h-auto py-3 px-2" : ""
      }`}
    >
      {mobile && (
        <div className="w-8 h-1 rounded-full bg-[#3c3c3c] absolute left-1/2 -translate-x-1/2 top-2" />
      )}
      {mobile ? (
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-[12px] text-[#e4e4e4] truncate">{title}</span>
          {countLabel && (
            <span className="text-[11px] text-[#6e6e6e] tabular-nums">
              {countLabel}
            </span>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className={`flex items-center gap-2 min-w-0 flex-1 text-left hover:opacity-90 transition-opacity ${
            rail ? "flex-col flex-none w-full justify-center gap-1.5" : ""
          }`}
          aria-expanded={!collapsed}
          title={collapsed ? `Expand ${title}` : `Collapse ${title}`}
        >
          <span
            className={`text-[#6e6e6e] text-[10px] transition-transform shrink-0 ${
              rail ? "rotate-180" : "rotate-90"
            }`}
            aria-hidden
          >
            ▸
          </span>
          <span
            className={`text-[12px] text-[#e4e4e4] ${
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
          className="h-7 px-2.5 rounded-md text-[12px] text-[#a0a0a0] hover:text-[#e4e4e4] border border-[#2b2b2b] shrink-0"
        >
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
          <MetaRow label="Repository" value={meta.repoUrl} mono />
          <MetaRow label="Starting ref" value={meta.startingRef} mono />
          <MetaRow label="Branch" value={meta.branch} mono />
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
      <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/50">
        <button
          type="button"
          className="flex-1 w-full cursor-default"
          aria-label={`Close ${title.toLowerCase()}`}
          onClick={onClose}
        />
        <div className="relative h-[75vh] max-h-[85dvh] rounded-t-xl border-t border-[#2b2b2b] bg-[#141414] flex flex-col overflow-hidden shadow-2xl pb-[env(safe-area-inset-bottom)]">
          {body}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`hidden lg:flex border-l border-[#2b2b2b] flex-col min-h-0 h-full overflow-hidden bg-[#141414] transition-[width] duration-200 ${
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
