"use client";

import { useMemo } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  GitCompare,
  LoaderCircle,
  X,
} from "lucide-react";
import type { ChatMessage } from "../../shared/events";
import InlineDiff, { countDiffLines } from "./InlineDiff";
import {
  normalizeToolName,
  resolveToolPath,
  toolCategoryFor,
} from "../lib/toolMessages";

interface ToolDetailPanelProps {
  message: ChatMessage | null;
  mobile?: boolean;
  onClose: () => void;
}

export default function ToolDetailPanel({
  message,
  mobile = false,
  onClose,
}: ToolDetailPanelProps) {
  const path = message ? resolveToolPath(message) : null;
  const category = message ? toolCategoryFor(message) : "other";
  const isEdit = category === "edit" || Boolean(message?.diffPatch);

  const stats = useMemo(
    () => (message?.diffPatch ? countDiffLines(message.diffPatch) : null),
    [message?.diffPatch],
  );

  if (!message) return null;

  const toolName = normalizeToolName(message.toolName);

  const body = (
    <>
      {mobile && (
        <div className="w-8 h-1 rounded-full bg-[#3c3c3c] mx-auto mt-2 shrink-0" />
      )}

      {isEdit ? (
        /* ── Edit / diff view ── */
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
          {/* Compact header: path + stats + close */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[#2b2b2b] shrink-0">
            <GitCompare className="h-4 w-4 text-[#4d9fff] shrink-0" strokeWidth={1.75} />
            <span className="text-[13px] font-mono text-[#d0d0d0] truncate min-w-0 flex-1">
              {path || toolName}
            </span>
            {stats && (stats.added > 0 || stats.removed > 0) && (
              <span className="inline-flex items-center gap-1.5 text-[12px] font-medium shrink-0">
                {stats.added > 0 && (
                  <span className="text-[#3ecf8e]">+{stats.added}</span>
                )}
                {stats.removed > 0 && (
                  <span className="text-[#f07070]">−{stats.removed}</span>
                )}
              </span>
            )}
            <StatusBadge status={message.status} />
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[#6e6e6e] hover:text-[#e4e4e4] border border-[#2b2b2b] shrink-0 transition-colors"
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </div>

          {/* Diff fills remaining space */}
          {message.diffPatch ? (
            <div className="flex-1 min-h-0 overflow-hidden">
              <InlineDiff patch={message.diffPatch} alwaysOpen hideHeader />
            </div>
          ) : (
            <div className="flex items-center justify-center flex-1 text-[12px] text-[#555]">
              Diff not yet available
            </div>
          )}
        </div>
      ) : (
        /* ── Non-edit view (search / read / terminal / other) ── */
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
          <div className="rounded-xl border border-[#2b2b2b] bg-[#181818] p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[15px] font-semibold text-[#e4e4e4] truncate">
                    {toolName}
                  </span>
                  <StatusBadge status={message.status} />
                </div>
                {path && (
                  <p className="mt-2 text-[12px] leading-relaxed text-[#c8c8c8] font-mono break-all">
                    {path}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] text-[#555] font-mono">
                  {formatTime(message.ts)}
                </span>
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-7 items-center gap-1.5 px-2.5 rounded-lg text-[12px] text-[#a0a0a0] hover:text-[#e4e4e4] border border-[#2b2b2b] transition-colors"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Close
                </button>
              </div>
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

          {!message.content && (
            <div className="rounded-xl border border-[#2b2b2b] bg-[#181818] p-3 text-[12px] text-[#7d7d7d]">
              No additional details for this tool call.
            </div>
          )}
        </div>
      )}
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

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
