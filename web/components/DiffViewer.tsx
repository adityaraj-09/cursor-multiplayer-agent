"use client";

import { useEffect, useMemo, useState } from "react";
import type { AppSocket } from "../lib/socket";

interface DiffViewerProps {
  socket: AppSocket | null;
  initialPatch?: string;
  hideHeader?: boolean;
  /** When set, only apply diff-update events for this agent. */
  agentId?: string | null;
}

interface FileDiff {
  path: string;
  patch: string;
}

function splitPatch(patch: string): FileDiff[] {
  if (!patch.trim()) return [];
  const parts = patch.split(/(?=^diff --git )/m).filter((p) => p.trim());
  return parts.map((part) => {
    const path =
      part.match(/^diff --git a\/(.+?) b\//m)?.[1] ||
      part.match(/^\+\+\+ b\/(.+)$/m)?.[1] ||
      "file";
    return { path, patch: part };
  });
}

export default function DiffViewer({
  socket,
  initialPatch = "",
  hideHeader = false,
  agentId = null,
}: DiffViewerProps) {
  const [patch, setPatch] = useState(initialPatch);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setPatch(initialPatch);
  }, [initialPatch]);

  useEffect(() => {
    if (!socket) return;
    const handler = (p: string, eventAgentId?: string) => {
      if (agentId && eventAgentId && eventAgentId !== agentId) return;
      if (agentId && !eventAgentId) return;
      setPatch(p);
    };
    socket.on("diff-update", handler);
    return () => {
      socket.off("diff-update", handler);
    };
  }, [socket, agentId]);

  const files = useMemo(() => splitPatch(patch), [patch]);

  const toggle = (path: string, index: number) => {
    const key = `${index}:${path}`;
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const isOpen = (path: string, index: number) => {
    const key = `${index}:${path}`;
    // Default collapsed
    return Boolean(expanded[key]);
  };

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-[#141414]">
      {!hideHeader && (
        <div className="flex items-center justify-between px-3 h-9 border-b border-[#2b2b2b] shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-[#a0a0a0]">Changes</span>
            {files.length > 0 && (
              <span className="text-[11px] text-[#6e6e6e] tabular-nums">
                {files.length} file{files.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        {files.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-1 px-6 py-10">
            <div className="text-[#6e6e6e] text-[13px]">No file changes yet</div>
            <div className="text-[#4a4a4a] text-[12px] text-center">
              When the agent edits files, diffs show up here
            </div>
          </div>
        ) : (
          <div className="divide-y divide-[#2b2b2b]">
            {files.map((file, index) => (
              <CollapsibleFileDiff
                key={`${index}:${file.path}`}
                path={file.path}
                patch={file.patch}
                open={isOpen(file.path, index)}
                onToggle={() => toggle(file.path, index)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CollapsibleFileDiff({
  path,
  patch,
  open,
  onToggle,
}: {
  path: string;
  patch: string;
  open: boolean;
  onToggle: () => void;
}) {
  const [html, setHtml] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const { html: render } = await import("diff2html");
      if (cancelled) return;
      setHtml(
        render(patch, {
          drawFileList: false,
          matching: "lines",
          outputFormat: "line-by-line",
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [open, patch]);

  const adds = (patch.match(/^\+[^+]/gm) || []).length;
  const dels = (patch.match(/^-[^-]/gm) || []).length;

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-[#1a1a1a] transition-colors"
      >
        <span
          className={`text-[#6e6e6e] text-[10px] transition-transform ${
            open ? "rotate-90" : ""
          }`}
        >
          ▸
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-mono text-[#a0a0a0]">
          {path}
        </span>
        <span className="text-[10px] text-[#3ecf8e] tabular-nums shrink-0">
          +{adds}
        </span>
        <span className="text-[10px] text-[#f07070] tabular-nums shrink-0">
          −{dels}
        </span>
      </button>
      {open && (
        <div
          className="border-t border-[#2b2b2b] max-h-[50vh] overflow-auto font-mono text-[11px] sm:text-[12px] diff-container [&_.d2h-file-header]:hidden [&_.d2h-file-wrapper]:m-0 [&_.d2h-file-wrapper]:rounded-none [&_.d2h-file-wrapper]:border-0"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}
