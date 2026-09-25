"use client";

import { useEffect, useRef } from "react";
import { GitBranch } from "lucide-react";
import DiffViewer from "./DiffViewer";
import RightOverlay from "./RightOverlay";
import type { AppSocket } from "../lib/socket";
import type { AgentRuntime, CloudMeta } from "../../shared/events";

interface SidePanelProps {
  socket: AppSocket | null;
  lastDiff: string;
  runtime: AgentRuntime;
  cloudMeta: CloudMeta | null;
  prUrl?: string;
  integrationBranch?: string;
  integrationPrUrl?: string;
  mobile?: boolean;
  onClose?: () => void;
  agentId?: string | null;
  onRequestDiff?: (agentId?: string) => void;
}

export default function SidePanel({
  socket,
  lastDiff,
  runtime,
  cloudMeta,
  prUrl,
  integrationBranch,
  integrationPrUrl,
  onClose,
  agentId = null,
  onRequestDiff,
}: SidePanelProps) {
  const requestedKey = useRef("");

  const fileCount = lastDiff
    ? (lastDiff.match(/^diff --git /gm) || []).length
    : 0;

  const meta = cloudMeta || {};
  const effectivePr = meta.prUrl || prUrl;
  const title = runtime === "cloud" ? "Cloud" : "Changes";
  const countLabel =
    runtime === "local" && fileCount > 0 ? `${fileCount} files` : undefined;

  useEffect(() => {
    if (!onRequestDiff) return;
    const key = `${agentId ?? ""}`;
    if (requestedKey.current === key) return;
    requestedKey.current = key;
    onRequestDiff(agentId || undefined);
  }, [onRequestDiff, agentId]);

  return (
    <RightOverlay title={title} subtitle={countLabel} onClose={onClose || (() => {})}>
      {runtime === "cloud" ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-3">
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
            <div className="mb-1 text-[11px] text-[#6e6e6e]">Integration PR</div>
            {integrationPrUrl ? (
              <a
                href={integrationPrUrl}
                target="_blank"
                rel="noreferrer"
                className="break-all text-[13px] text-[#4d9fff] hover:underline"
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
            <div className="mb-1 text-[11px] text-[#6e6e6e]">Pull request</div>
            {effectivePr ? (
              <a
                href={effectivePr}
                target="_blank"
                rel="noreferrer"
                className="break-all text-[13px] text-[#4d9fff] hover:underline"
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
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <DiffViewer
            socket={socket}
            initialPatch={lastDiff}
            hideHeader
            agentId={agentId}
          />
        </div>
      )}
    </RightOverlay>
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
      <div className="mb-1 text-[11px] text-[#6e6e6e]">{label}</div>
      <div
        className={`break-all text-[13px] text-[#e4e4e4] ${
          mono ? "font-mono text-[12px]" : ""
        }`}
      >
        {value || "—"}
      </div>
    </div>
  );
}
