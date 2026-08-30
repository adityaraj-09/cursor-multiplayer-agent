"use client";

import { useEffect, useMemo, useRef, useState } from "react";

interface InlineDiffProps {
  patch: string;
  defaultOpen?: boolean;
  /** When true, skip the nested "Show/Hide diff" chrome and always show the patch. */
  alwaysOpen?: boolean;
  /** Hide the filename/+N/−M bar — parent already shows that. */
  hideHeader?: boolean;
}

export function countDiffLines(patch: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("@@")) {
      continue;
    }
    if (line.startsWith("+")) added += 1;
    else if (line.startsWith("-")) removed += 1;
  }
  return { added, removed };
}

export default function InlineDiff({
  patch,
  defaultOpen = false,
  alwaysOpen = false,
  hideHeader = false,
}: InlineDiffProps) {
  const [open, setOpen] = useState(alwaysOpen || defaultOpen);
  const showChrome = !alwaysOpen && !hideHeader;
  const showStaticHeader = alwaysOpen && !hideHeader;
  const containerRef = useRef<HTMLDivElement>(null);
  const stats = useMemo(() => countDiffLines(patch), [patch]);

  const fileCount = (patch.match(/^diff --git /gm) || []).length;
  const fileLabel =
    patch.match(/^diff --git a\/(.+?) b\//m)?.[1] ||
    patch.match(/^\+\+\+ b\/(.+)$/m)?.[1] ||
    "file";

  useEffect(() => {
    if (alwaysOpen) setOpen(true);
  }, [alwaysOpen]);

  useEffect(() => {
    if (!open || !containerRef.current || !patch.trim()) return;
    let cancelled = false;
    (async () => {
      const { html } = await import("diff2html");
      if (cancelled || !containerRef.current) return;
      containerRef.current.innerHTML = html(patch, {
        drawFileList: false,
        matching: "lines",
        outputFormat: "line-by-line",
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [patch, open]);

  return (
    <div
      className={
        hideHeader
          ? "overflow-hidden bg-[#121212]"
          : "rounded-md border border-[#2b2b2b] overflow-hidden bg-[#121212]"
      }
    >
      {showChrome && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-2 px-2.5 h-8 text-left hover:bg-[#1a1a1a] transition-colors"
        >
          <span className="min-w-0 truncate text-[11px] font-mono text-[#a0a0a0]">
            {fileLabel}
            {fileCount > 1 ? ` · ${fileCount} files` : ""}
          </span>
          <span className="flex items-center gap-2 shrink-0">
            {stats.added > 0 && (
              <span className="text-[10px] font-medium text-[#3ecf8e]">
                +{stats.added}
              </span>
            )}
            {stats.removed > 0 && (
              <span className="text-[10px] font-medium text-[#f07070]">
                −{stats.removed}
              </span>
            )}
            <span className="text-[10px] text-[#6e6e6e]">
              {open ? "Hide" : "Show"}
            </span>
          </span>
        </button>
      )}
      {showStaticHeader && (
        <div className="flex items-center justify-between gap-2 px-2.5 h-8 border-b border-[#2b2b2b]">
          <span className="min-w-0 truncate text-[11px] font-mono text-[#a0a0a0]">
            {fileLabel}
            {fileCount > 1 ? ` · ${fileCount} files` : ""}
          </span>
          <span className="flex items-center gap-2 shrink-0">
            {stats.added > 0 && (
              <span className="text-[10px] font-medium text-[#3ecf8e]">
                +{stats.added}
              </span>
            )}
            {stats.removed > 0 && (
              <span className="text-[10px] font-medium text-[#f07070]">
                −{stats.removed}
              </span>
            )}
          </span>
        </div>
      )}
      {open && (
        <div
          ref={containerRef}
          className={`max-h-80 overflow-auto font-mono text-[11px] diff-container inline-diff ${
            alwaysOpen ? "" : "border-t border-[#2b2b2b]"
          }`}
        />
      )}
    </div>
  );
}
