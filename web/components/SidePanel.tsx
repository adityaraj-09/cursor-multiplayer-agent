"use client";

import DiffViewer from "./DiffViewer";
import type { AppSocket } from "../lib/socket";
import type { AgentRuntime, CloudMeta } from "../../shared/events";

interface SidePanelProps {
  socket: AppSocket | null;
  lastDiff: string;
  runtime: AgentRuntime;
  cloudMeta: CloudMeta | null;
  prUrl?: string;
}

export default function SidePanel({
  socket,
  lastDiff,
  runtime,
  cloudMeta,
  prUrl,
}: SidePanelProps) {
  const fileCount = lastDiff
    ? (lastDiff.match(/^diff --git /gm) || []).length
    : 0;

  const meta = cloudMeta || {};
  const effectivePr = meta.prUrl || prUrl;

  return (
    <div className="w-[38%] min-w-[320px] max-w-[540px] border-l border-[#2b2b2b] flex flex-col min-h-0 h-full overflow-hidden bg-[#141414]">
      <div className="flex items-center justify-between px-3 h-9 border-b border-[#2b2b2b] bg-[#1a1a1a] shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-[#e4e4e4]">
            {runtime === "cloud" ? "Cloud" : "Changes"}
          </span>
          {runtime === "local" && fileCount > 0 && (
            <span className="text-[11px] text-[#6e6e6e] tabular-nums">
              {fileCount}
            </span>
          )}
        </div>
      </div>
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
            <p className="text-[12px] text-[#4a4a4a] pt-2">
              Cloud agents edit a Cursor VM clone. Live working-tree diffs are
              only available for local rooms.
            </p>
          </div>
        ) : (
          <DiffViewer socket={socket} initialPatch={lastDiff} hideHeader />
        )}
      </div>
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
