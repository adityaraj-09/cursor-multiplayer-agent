"use client";

import { useEffect, useRef, useState } from "react";

interface InlineDiffProps {
  patch: string;
  defaultOpen?: boolean;
}

export default function InlineDiff({
  patch,
  defaultOpen = true,
}: InlineDiffProps) {
  const [open, setOpen] = useState(defaultOpen);
  const containerRef = useRef<HTMLDivElement>(null);

  const fileCount = (patch.match(/^diff --git /gm) || []).length;
  const fileLabel =
    patch.match(/^diff --git a\/(.+?) b\//m)?.[1] ||
    patch.match(/^\+\+\+ b\/(.+)$/m)?.[1] ||
    "file";

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
    <div className="mt-2 rounded-md border border-[#2b2b2b] overflow-hidden bg-[#121212]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-2.5 h-8 text-left hover:bg-[#1a1a1a] transition-colors"
      >
        <span className="min-w-0 truncate text-[11px] font-mono text-[#a0a0a0]">
          {fileLabel}
          {fileCount > 1 ? ` · ${fileCount} files` : ""}
        </span>
        <span className="text-[10px] text-[#6e6e6e] shrink-0">
          {open ? "Hide diff" : "Show diff"}
        </span>
      </button>
      {open && (
        <div
          ref={containerRef}
          className="max-h-72 overflow-auto border-t border-[#2b2b2b] font-mono text-[11px] diff-container inline-diff"
        />
      )}
    </div>
  );
}
