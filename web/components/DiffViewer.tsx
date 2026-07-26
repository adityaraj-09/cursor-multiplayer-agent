"use client";

import { useEffect, useState, useRef } from "react";
import type { AppSocket } from "../lib/socket";

interface DiffViewerProps {
  socket: AppSocket | null;
  initialPatch?: string;
  hideHeader?: boolean;
}

export default function DiffViewer({
  socket,
  initialPatch = "",
  hideHeader = false,
}: DiffViewerProps) {
  const [patch, setPatch] = useState(initialPatch);
  const [sideBySide, setSideBySide] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPatch(initialPatch);
  }, [initialPatch]);

  useEffect(() => {
    if (!socket) return;
    const handler = (p: string) => setPatch(p);
    socket.on("diff-update", handler);
    return () => {
      socket.off("diff-update", handler);
    };
  }, [socket]);

  useEffect(() => {
    if (!containerRef.current) return;
    if (!patch.trim()) {
      containerRef.current.innerHTML = `
        <div class="flex flex-col items-center justify-center h-full gap-1 px-6">
          <div class="text-[#6e6e6e] text-[13px]">No file changes yet</div>
          <div class="text-[#4a4a4a] text-[12px] text-center">When the agent edits files, the live git diff shows up here</div>
        </div>`;
      return;
    }

    (async () => {
      const { html } = await import("diff2html");
      const rendered = html(patch, {
        drawFileList: true,
        matching: "lines",
        outputFormat: sideBySide ? "side-by-side" : "line-by-line",
      });
      if (containerRef.current) {
        containerRef.current.innerHTML = rendered;
      }
    })();
  }, [patch, sideBySide]);

  const fileCount = patch
    ? (patch.match(/^diff --git /gm) || []).length
    : 0;

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-[#141414]">
      {!hideHeader && (
        <div className="flex items-center justify-between px-3 h-9 border-b border-[#2b2b2b] shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-[#a0a0a0]">Changes</span>
            {fileCount > 0 && (
              <span className="text-[11px] text-[#6e6e6e] tabular-nums">
                {fileCount} file{fileCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <button
            onClick={() => setSideBySide(!sideBySide)}
            className="h-6 px-2 rounded text-[11px] text-[#6e6e6e] hover:text-[#e4e4e4] hover:bg-[#252525] transition-colors"
          >
            {sideBySide ? "Unified" : "Split"}
          </button>
        </div>
      )}
      {hideHeader && (
        <div className="flex items-center justify-end px-3 h-8 border-b border-[#2b2b2b] shrink-0">
          <button
            onClick={() => setSideBySide(!sideBySide)}
            className="h-6 px-2 rounded text-[11px] text-[#6e6e6e] hover:text-[#e4e4e4] hover:bg-[#252525] transition-colors"
          >
            {sideBySide ? "Unified" : "Split"}
          </button>
        </div>
      )}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-auto overscroll-contain font-mono text-[12px] diff-container"
      />
    </div>
  );
}
