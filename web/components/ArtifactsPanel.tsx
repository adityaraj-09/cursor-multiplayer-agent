"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Download,
  FileText,
  Image as ImageIcon,
  LoaderCircle,
  Package,
  RefreshCw,
  Video,
  X,
} from "lucide-react";
import type { AgentArtifactInfo } from "../../shared/agentArtifacts";
import {
  fetchRoomAgentArtifactBlob,
  fetchRoomAgentArtifacts,
} from "../lib/api";

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function kindFor(name: string): "image" | "video" | "file" {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(ext)) return "image";
  if (["mp4", "webm", "mov"].includes(ext)) return "video";
  return "file";
}

function KindIcon({ name }: { name: string }) {
  const kind = kindFor(name);
  if (kind === "image") {
    return <ImageIcon className="h-4 w-4 text-[#8ec5ff]" strokeWidth={1.75} />;
  }
  if (kind === "video") {
    return <Video className="h-4 w-4 text-[#8ec5ff]" strokeWidth={1.75} />;
  }
  return <FileText className="h-4 w-4 text-[#a0a0a0]" strokeWidth={1.75} />;
}

export default function ArtifactsPanel({
  roomId,
  agentId,
  agentLabel,
  onClose,
}: {
  roomId: string;
  agentId?: string | null;
  agentLabel?: string;
  onClose: () => void;
}) {
  const [items, setItems] = useState<AgentArtifactInfo[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    item: AgentArtifactInfo;
    url: string;
    kind: "image" | "video";
  } | null>(null);

  const load = useCallback(async () => {
    if (!agentId) {
      setItems([]);
      setError("Select an agent to view its artifacts.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      setItems(await fetchRoomAgentArtifacts(roomId, agentId));
    } catch (err) {
      setItems([]);
      setError(err instanceof Error ? err.message : "Failed to list artifacts");
    } finally {
      setLoading(false);
    }
  }, [roomId, agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => {
      if (preview?.url) URL.revokeObjectURL(preview.url);
    };
  }, [preview?.url]);

  const download = async (item: AgentArtifactInfo) => {
    if (!agentId) return;
    setDownloading(item.path);
    setError("");
    try {
      const blob = await fetchRoomAgentArtifactBlob(roomId, agentId, item.path);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = item.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to download");
    } finally {
      setDownloading(null);
    }
  };

  const openPreview = async (item: AgentArtifactInfo) => {
    const kind = kindFor(item.name);
    if (kind === "file" || !agentId) {
      await download(item);
      return;
    }
    setDownloading(item.path);
    setError("");
    try {
      const blob = await fetchRoomAgentArtifactBlob(roomId, agentId, item.path);
      if (preview?.url) URL.revokeObjectURL(preview.url);
      setPreview({ item, url: URL.createObjectURL(blob), kind });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open artifact");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/60 backdrop-blur-sm">
      <button
        type="button"
        className="flex-1 w-full cursor-default"
        aria-label="Close artifacts"
        onClick={onClose}
      />
      <div className="relative h-[75vh] max-h-[85dvh] rounded-t-2xl border-t border-[#2b2b2b] bg-[#141414] flex flex-col overflow-hidden shadow-2xl pb-[env(safe-area-inset-bottom)]">
        <div className="relative flex items-center gap-2 px-3 h-11 border-b border-[#2b2b2b] bg-[#171717] shrink-0">
          <div className="w-8 h-1 rounded-full bg-[#3c3c3c] absolute left-1/2 -translate-x-1/2 top-2" />
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#252525] text-[#a0a0a0]">
              <Package className="h-3.5 w-3.5" strokeWidth={1.75} />
            </span>
            <span className="text-[12px] font-medium text-[#e4e4e4] truncate">
              Artifacts
            </span>
            {agentLabel && (
              <span className="text-[11px] text-[#6e6e6e] truncate">
                {agentLabel}
              </span>
            )}
            {items.length > 0 && (
              <span className="text-[11px] text-[#6e6e6e] tabular-nums">
                {items.length}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[#a0a0a0] hover:text-[#e4e4e4] border border-[#2b2b2b] disabled:opacity-50"
            title="Refresh artifacts"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
              strokeWidth={1.75}
            />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 items-center gap-1.5 px-2.5 rounded-lg text-[12px] text-[#a0a0a0] hover:text-[#e4e4e4] border border-[#2b2b2b] shrink-0"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.75} />
            Close
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
          {error && (
            <p className="text-[12px] text-[#f07070] px-1">{error}</p>
          )}
          {loading && items.length === 0 && (
            <div className="flex items-center justify-center py-16 text-[#6e6e6e]">
              <LoaderCircle className="h-5 w-5 animate-spin" strokeWidth={1.75} />
            </div>
          )}
          {!loading && items.length === 0 && !error && (
            <div className="rounded-xl border border-[#2b2b2b] bg-[#181818] p-4">
              <p className="text-[13px] text-[#e4e4e4]">No artifacts yet</p>
              <p className="mt-1 text-[12px] leading-relaxed text-[#6e6e6e]">
                Cloud agents can drop APKs, screenshots, and other produced
                files here. This is not the repo file tree.
              </p>
            </div>
          )}
          {items.map((item) => (
            <div
              key={item.path}
              className="flex items-center gap-2 rounded-xl border border-[#2b2b2b] bg-[#181818] hover:bg-[#1c1c1c]"
            >
              <button
                type="button"
                onClick={() => void openPreview(item)}
                className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left"
              >
                <KindIcon name={item.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-[#e4e4e4]">
                    {item.name}
                  </p>
                  <p className="text-[11px] text-[#6e6e6e] font-mono truncate">
                    {formatBytes(item.sizeBytes)}
                  </p>
                </div>
              </button>
              <button
                type="button"
                disabled={downloading === item.path}
                onClick={() => void download(item)}
                className="mr-2 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[#6e6e6e] hover:bg-[#222] hover:text-[#e4e4e4] disabled:opacity-50"
                title={`Download ${item.name}`}
                aria-label={`Download ${item.name}`}
              >
                {downloading === item.path ? (
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
                ) : (
                  <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                )}
              </button>
            </div>
          ))}
        </div>
      </div>

      {preview && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              URL.revokeObjectURL(preview.url);
              setPreview(null);
            }
          }}
        >
          <div className="w-full max-w-3xl overflow-hidden rounded-xl border border-[#2b2b2b] bg-[#141414] shadow-2xl">
            <div className="flex items-center gap-2 border-b border-[#2b2b2b] px-3 py-2">
              <p className="min-w-0 flex-1 truncate text-[13px] text-[#e4e4e4]">
                {preview.item.name}
              </p>
              <button
                type="button"
                onClick={() => void download(preview.item)}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[#2b2b2b] px-2.5 text-[11px] text-[#a0a0a0] hover:text-[#e4e4e4]"
              >
                <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                Download
              </button>
              <button
                type="button"
                onClick={() => {
                  URL.revokeObjectURL(preview.url);
                  setPreview(null);
                }}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#a0a0a0] hover:text-[#e4e4e4]"
                aria-label="Close preview"
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
            </div>
            <div className="flex max-h-[70vh] items-center justify-center bg-black p-3">
              {preview.kind === "video" ? (
                <video
                  src={preview.url}
                  controls
                  playsInline
                  className="max-h-[66vh] max-w-full"
                />
              ) : (
                <img
                  src={preview.url}
                  alt={preview.item.name}
                  className="max-h-[66vh] max-w-full object-contain"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
