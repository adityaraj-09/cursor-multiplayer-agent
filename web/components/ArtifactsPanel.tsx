"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CirclePlay,
  Download,
  FileText,
  LoaderCircle,
  Menu,
  Package,
  RefreshCw,
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

function KindIcon({ name, active }: { name: string; active?: boolean }) {
  const kind = kindFor(name);
  const tone = active ? "text-[#e8e8e8]" : "text-[#8a8a8a]";
  if (kind === "video") {
    return <CirclePlay className={`h-3.5 w-3.5 shrink-0 ${tone}`} strokeWidth={1.8} />;
  }
  return <FileText className={`h-3.5 w-3.5 shrink-0 ${tone}`} strokeWidth={1.8} />;
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
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    path: string;
    url: string;
    kind: "image" | "video";
  } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const previewUrlRef = useRef<string | null>(null);

  const selected =
    items.find((item) => item.path === selectedPath) || items[0] || null;

  const revokePreview = () => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  };

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
      const next = await fetchRoomAgentArtifacts(roomId, agentId);
      setItems(next);
      setSelectedPath((prev) =>
        prev && next.some((item) => item.path === prev)
          ? prev
          : next[0]?.path || null,
      );
    } catch (err) {
      setItems([]);
      setSelectedPath(null);
      setError(err instanceof Error ? err.message : "Failed to list artifacts");
    } finally {
      setLoading(false);
    }
  }, [roomId, agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => revokePreview();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!agentId || !selected) {
      revokePreview();
      setPreview(null);
      setPreviewing(false);
      return;
    }
    const kind = kindFor(selected.name);
    if (kind === "file") {
      revokePreview();
      setPreview(null);
      setPreviewing(false);
      return;
    }

    let cancelled = false;
    setPreviewing(true);
    void fetchRoomAgentArtifactBlob(roomId, agentId, selected.path)
      .then((blob) => {
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        revokePreview();
        previewUrlRef.current = url;
        setPreview({ path: selected.path, url, kind });
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to open artifact");
      })
      .finally(() => {
        if (!cancelled) setPreviewing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentId, roomId, selected?.path, selected?.name]);

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

  return (
    <div className="fixed inset-0 z-40 flex bg-[#0a0a0a] text-[#e8e8e8]">
      <aside className="flex w-[188px] shrink-0 flex-col border-r border-[#1c1c1c] bg-[#0a0a0a] sm:w-[228px]">
        <div className="flex h-12 items-center gap-4 px-4">
          <span className="text-[13px] font-medium text-[#f2f2f2]">
            Artifacts
          </span>
          {agentLabel && (
            <span className="min-w-0 truncate text-[12px] text-[#6a6a6a]">
              {agentLabel}
            </span>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {error && (
            <p className="px-2 pb-2 text-[11px] leading-relaxed text-[#f07070]">
              {error}
            </p>
          )}
          {loading && items.length === 0 && (
            <div className="flex items-center justify-center py-10 text-[#6a6a6a]">
              <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={1.75} />
            </div>
          )}
          {!loading && items.length === 0 && !error && (
            <p className="px-2 py-3 text-[12px] leading-relaxed text-[#6a6a6a]">
              No artifacts yet. Cloud agents drop APKs, screenshots, and videos
              here.
            </p>
          )}
          <div className="flex flex-col gap-0.5">
            {items.map((item) => {
              const active = item.path === selected?.path;
              return (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => setSelectedPath(item.path)}
                  className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left ${
                    active
                      ? "rounded-full bg-[#1f1f1f] text-[#f2f2f2]"
                      : "rounded-full text-[#c8c8c8] hover:bg-[#141414]"
                  }`}
                >
                  <KindIcon name={item.name} active={active} />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] leading-5">
                    {item.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col bg-[#0a0a0a]">
        <header className="flex h-12 shrink-0 items-center gap-2 px-3">
          <Menu className="h-4 w-4 shrink-0 text-[#8a8a8a]" strokeWidth={1.8} />
          <span className="min-w-0 flex-1 truncate text-[13px] text-[#f2f2f2]">
            {selected?.name || "Artifacts"}
          </span>
          {selected && (
            <span className="hidden text-[11px] text-[#6a6a6a] sm:inline">
              {formatBytes(selected.sizeBytes)}
            </span>
          )}
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#8a8a8a] hover:bg-[#1a1a1a] hover:text-[#e8e8e8] disabled:opacity-50"
            title="Refresh artifacts"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
              strokeWidth={1.75}
            />
          </button>
          {selected && (
            <button
              type="button"
              disabled={downloading === selected.path}
              onClick={() => void download(selected)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#8a8a8a] hover:bg-[#1a1a1a] hover:text-[#e8e8e8] disabled:opacity-50"
              title={`Download ${selected.name}`}
            >
              {downloading === selected.path ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
              ) : (
                <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#8a8a8a] hover:bg-[#1a1a1a] hover:text-[#e8e8e8]"
            aria-label="Close artifacts"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </header>

        <div className="relative min-h-0 flex-1">
          {previewing && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#0a0a0a]">
              <LoaderCircle
                className="h-6 w-6 animate-spin text-[#6a6a6a]"
                strokeWidth={1.75}
              />
            </div>
          )}
          {preview && preview.kind === "video" && (
            <video
              key={preview.url}
              src={preview.url}
              controls
              playsInline
              className="h-full w-full bg-[#0a0a0a] object-contain"
            />
          )}
          {preview && preview.kind === "image" && (
            <img
              src={preview.url}
              alt={selected?.name || "Artifact"}
              className="h-full w-full object-contain"
            />
          )}
          {!previewing && selected && kindFor(selected.name) === "file" && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-[#222] bg-[#141414] text-[#a0a0a0]">
                <Package className="h-5 w-5" strokeWidth={1.75} />
              </span>
              <div>
                <p className="text-[14px] text-[#e8e8e8]">{selected.name}</p>
                <p className="mt-1 text-[12px] text-[#6a6a6a]">
                  {formatBytes(selected.sizeBytes)} · download to open
                </p>
              </div>
              <button
                type="button"
                disabled={downloading === selected.path}
                onClick={() => void download(selected)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#222] bg-[#161616] px-3 text-[12px] text-[#e8e8e8] hover:bg-[#1c1c1c] disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                Download
              </button>
            </div>
          )}
          {!previewing && !selected && !loading && (
            <div className="flex h-full items-center justify-center">
              <p className="text-[13px] text-[#6a6a6a]">
                Select an artifact to preview.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
