"use client";

import { useMemo } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  GitCompare,
  LoaderCircle,
  Search,
  SquareTerminal,
  Wrench,
  X,
} from "lucide-react";
import type { ChatMessage } from "../../shared/events";
import InlineDiff, { countDiffLines } from "./InlineDiff";
import {
  normalizeToolName,
  resolveToolPath,
  toolCallTitle,
  toolCategoryFor,
  toolCategoryMeta,
} from "../lib/toolMessages";

interface ToolDetailPanelProps {
  message: ChatMessage | null;
  agentLabel?: string;
  mobile?: boolean;
  onClose: () => void;
}

export default function ToolDetailPanel({
  message,
  agentLabel,
  mobile = false,
  onClose,
}: ToolDetailPanelProps) {
  const category = message ? toolCategoryFor(message) : "other";
  const meta = toolCategoryMeta(category);
  const path = message ? resolveToolPath(message) : null;
  const stats = useMemo(
    () => (message?.diffPatch ? countDiffLines(message.diffPatch) : null),
    [message?.diffPatch],
  );

  if (!message) return null;

  const title = toolCallTitle(message);
  const body = (
    <>
      <div className="relative flex items-center gap-2 px-3 h-11 border-b border-[#2b2b2b] bg-[#171717] shrink-0">
        {mobile && (
          <div className="w-8 h-1 rounded-full bg-[#3c3c3c] absolute left-1/2 -translate-x-1/2 top-2" />
        )}
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#252525] text-[#a0a0a0] shrink-0">
          <PanelIcon category={category} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-medium text-[#e4e4e4] truncate">
            Tool details
          </div>
          <div className="text-[10px] text-[#6e6e6e] truncate">
            {meta.label} / {normalizeToolName(message.toolName)}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-7 items-center gap-1.5 px-2.5 rounded-lg text-[12px] text-[#a0a0a0] hover:text-[#e4e4e4] border border-[#2b2b2b] shrink-0"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.75} />
          Close
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
        <div className="rounded-xl border border-[#2b2b2b] bg-[#181818] p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[13px] font-medium text-[#e4e4e4] truncate">
                  {title}
                </span>
                <StatusBadge status={message.status} />
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-[#8a8a8a]">
                {meta.description}
              </p>
            </div>
            <span className="text-[10px] text-[#555] font-mono shrink-0">
              {formatTime(message.ts)}
            </span>
          </div>
          <div className="mt-3 grid gap-2">
            <MetaRow label="Tool" value={normalizeToolName(message.toolName)} mono />
            {agentLabel && <MetaRow label="Agent" value={agentLabel} />}
            {path && <MetaRow label="File path" value={path} mono />}
            {stats && (
              <div className="flex items-center gap-2">
                <div className="text-[11px] text-[#6e6e6e] w-20 shrink-0">
                  Diff
                </div>
                <div className="text-[12px]">
                  <span className="text-[#3ecf8e]">+{stats.added}</span>
                  <span className="mx-1.5 text-[#555]">/</span>
                  <span className="text-[#f07070]">-{stats.removed}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {message.content && (
          <section className="rounded-xl border border-[#2b2b2b] bg-[#181818] overflow-hidden">
            <div className="px-3 py-2 border-b border-[#2b2b2b] text-[11px] uppercase tracking-[0.12em] text-[#6e6e6e]">
              Details
            </div>
            <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words p-3 text-[12px] leading-relaxed text-[#cfcfcf] font-mono bg-[#141414]">
              {message.content}
            </pre>
          </section>
        )}

        {message.diffPatch && (
          <section className="rounded-xl border border-[#2b2b2b] bg-[#181818] overflow-hidden">
            <div className="px-3 py-2 border-b border-[#2b2b2b] text-[11px] uppercase tracking-[0.12em] text-[#6e6e6e]">
              File changes
            </div>
            <InlineDiff patch={message.diffPatch} alwaysOpen hideHeader />
          </section>
        )}
      </div>
    </>
  );

  if (mobile) {
    return (
      <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/60 backdrop-blur-sm lg:hidden">
        <button
          type="button"
          className="flex-1 w-full cursor-default"
          aria-label="Close tool details"
          onClick={onClose}
        />
        <div className="relative h-[75vh] max-h-[85dvh] rounded-t-2xl border-t border-[#2b2b2b] bg-[#141414] flex flex-col overflow-hidden shadow-2xl pb-[env(safe-area-inset-bottom)]">
          {body}
        </div>
      </div>
    );
  }

  return (
    <div className="hidden lg:flex border-l border-[#2b2b2b] flex-col min-h-0 h-full overflow-hidden bg-[#131313] w-[38%] min-w-[320px] max-w-[560px]">
      {body}
    </div>
  );
}

function PanelIcon({ category }: { category: string }) {
  switch (category) {
    case "search":
      return <Search className="h-3.5 w-3.5" strokeWidth={1.75} />;
    case "read":
      return <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />;
    case "terminal":
      return <SquareTerminal className="h-3.5 w-3.5" strokeWidth={1.75} />;
    case "edit":
      return <GitCompare className="h-3.5 w-3.5" strokeWidth={1.75} />;
    default:
      return <Wrench className="h-3.5 w-3.5" strokeWidth={1.75} />;
  }
}

function StatusBadge({ status }: { status: ChatMessage["status"] }) {
  if (status === "streaming") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] rounded-full border border-[#26405d] bg-[#17202a] px-2 py-0.5 text-[#4d9fff]">
        <LoaderCircle className="h-3 w-3 animate-spin" strokeWidth={1.8} />
        running
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] rounded-full border border-[#4a2727] bg-[#2a1717] px-2 py-0.5 text-[#f07070]">
        <AlertTriangle className="h-3 w-3" strokeWidth={1.8} />
        error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] rounded-full border border-[#234337] bg-[#17251f] px-2 py-0.5 text-[#3ecf8e]">
      <CheckCircle2 className="h-3 w-3" strokeWidth={1.8} />
      done
    </span>
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
    <div className="flex gap-2">
      <div className="text-[11px] text-[#6e6e6e] w-20 shrink-0">{label}</div>
      <div
        className={`min-w-0 text-[12px] text-[#e4e4e4] break-all ${
          mono ? "font-mono" : ""
        }`}
      >
        {value || "-"}
      </div>
    </div>
  );
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

