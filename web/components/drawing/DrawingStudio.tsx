"use client";

import {
  Component,
  useCallback,
  useLayoutEffect,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { Pencil, Trash2, X } from "lucide-react";
import "@excalidraw/excalidraw/index.css";

type ScenePayload = {
  elements: readonly unknown[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
};

type ExcalidrawAPI = {
  getSceneElements: () => readonly unknown[];
  getAppState: () => Record<string, unknown>;
  getFiles: () => Record<string, unknown>;
  updateScene?: (opts: { elements: unknown[] }) => void;
};

const Excalidraw = dynamic(
  async () => {
    const mod = await import("@excalidraw/excalidraw");
    return mod.Excalidraw;
  },
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[240px] items-center justify-center text-[13px] text-[#6e6e6e]">
        Loading whiteboard…
      </div>
    ),
  },
);

class WhiteboardErrorBoundary extends Component<
  { children: ReactNode; fallback: (message: string) => ReactNode },
  { message: string | null }
> {
  state = { message: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return {
      message: error instanceof Error ? error.message : "Whiteboard failed to load",
    };
  }

  render() {
    if (this.state.message) return this.props.fallback(this.state.message);
    return this.props.children;
  }
}

function sceneKey(roomId: string): string {
  return `steer-drawing:${roomId}`;
}

function loadScene(roomId: string): ScenePayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(sceneKey(roomId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ScenePayload;
    if (!parsed || !Array.isArray(parsed.elements)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveScene(roomId: string, scene: ScenePayload): void {
  try {
    window.localStorage.setItem(
      sceneKey(roomId),
      JSON.stringify({
        elements: scene.elements,
        files: scene.files || {},
        appState: {
          viewBackgroundColor: "#121212",
          theme: "dark",
        },
      }),
    );
  } catch {
    // quota / private mode
  }
}

export function drawingFileFromBlob(blob: Blob): File {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return new File([blob], `whiteboard-${stamp}.png`, { type: "image/png" });
}

export default function DrawingStudio({
  roomId,
  open,
  canAttach = true,
  onClose,
  onAttach,
}: {
  roomId: string;
  open: boolean;
  canAttach?: boolean;
  onClose: () => void;
  onAttach: (file: File) => Promise<void> | void;
}) {
  const [mounted, setMounted] = useState(false);
  const [api, setApi] = useState<ExcalidrawAPI | null>(null);
  const [initial, setInitial] = useState<ScenePayload | null>(null);
  const [sceneReady, setSceneReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useLayoutEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setSceneReady(false);
      setApi(null);
      return;
    }
    setInitial(loadScene(roomId));
    setError("");
    setBusy(false);
    setSceneReady(true);
  }, [open, roomId]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const persist = useCallback(
    (elements: readonly unknown[], appState: Record<string, unknown>, files: Record<string, unknown>) => {
      saveScene(roomId, { elements, appState, files });
    },
    [roomId],
  );

  const handleClear = () => {
    api?.updateScene?.({ elements: [] });
    saveScene(roomId, { elements: [], files: {}, appState: { viewBackgroundColor: "#121212", theme: "dark" } });
  };

  const handleAttach = async () => {
    if (!api || !canAttach) return;
    setBusy(true);
    setError("");
    try {
      const { exportToBlob } = await import("@excalidraw/excalidraw");
      const elements = api.getSceneElements();
      if (!elements.length) {
        setError("Draw something first, then attach it.");
        return;
      }
      const blob = await exportToBlob({
        elements,
        appState: {
          ...api.getAppState(),
          exportWithDarkMode: true,
        },
        files: api.getFiles(),
        mimeType: "image/png",
      });
      await onAttach(drawingFileFromBlob(blob));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not export drawing");
    } finally {
      setBusy(false);
    }
  };

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="steer-drawing-overlay"
      data-testid="steer-drawing-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="steer-drawing-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        width: "100vw",
        background: "#111111",
      }}
    >
      <div className="flex h-full min-h-0 w-full flex-col px-3 py-3 sm:px-5 sm:py-4">
        <header className="mb-2 flex shrink-0 items-center gap-2 rounded-xl border border-[#2b2b2b] bg-[#171717] px-3 py-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1f1f1f] text-[#8ec5ff]">
            <Pencil className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="steer-drawing-title" className="text-[13px] font-medium text-[#e4e4e4]">
              Whiteboard
            </h2>
            <p className="truncate text-[11px] text-[#6e6e6e]">
              Sketch in the session, then attach the image to your next message.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClear}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#2b2b2b] px-2.5 text-[12px] text-[#a0a0a0] hover:text-[#e4e4e4]"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
            Clear
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#2b2b2b] text-[#a0a0a0] hover:text-[#e4e4e4]"
            aria-label="Close whiteboard"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </header>

        <div className="steer-drawing-canvas" style={{ minHeight: 240 }}>
          <WhiteboardErrorBoundary
            fallback={(message) => (
              <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-2 px-6 text-center">
                <p className="text-[13px] text-[#e4e4e4]">Whiteboard could not load</p>
                <p className="max-w-md text-[12px] text-[#f07070]">{message}</p>
              </div>
            )}
          >
            {sceneReady ? (
              <Excalidraw
                key={`${roomId}-board`}
                excalidrawAPI={(next) => setApi(next as unknown as ExcalidrawAPI)}
                initialData={
                  initial
                    ? {
                        elements: initial.elements as never,
                        appState: {
                          ...(initial.appState || {}),
                          viewBackgroundColor: "#121212",
                          theme: "dark",
                        } as never,
                        files: (initial.files || {}) as never,
                      }
                    : {
                        appState: { viewBackgroundColor: "#121212", theme: "dark" },
                      }
                }
                theme="dark"
                UIOptions={{
                  canvasActions: {
                    loadScene: false,
                    saveToActiveFile: false,
                    toggleTheme: false,
                  },
                }}
                onChange={(elements, appState, files) => {
                  persist(
                    elements,
                    appState as unknown as Record<string, unknown>,
                    files as unknown as Record<string, unknown>,
                  );
                }}
              />
            ) : (
              <div className="flex h-full min-h-[240px] items-center justify-center text-[13px] text-[#6e6e6e]">
                Loading whiteboard…
              </div>
            )}
          </WhiteboardErrorBoundary>
        </div>

        <footer className="mt-2 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-[#2b2b2b] bg-[#171717] px-3 py-2">
          <p className="min-w-0 flex-1 truncate text-[11px] text-[#6e6e6e]">
            {error ||
              (canAttach
                ? "Attach exports a PNG into the composer. The board stays in this session."
                : "View only — you cannot attach from this role.")}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 items-center rounded-lg border border-[#2b2b2b] px-3 text-[12px] text-[#a0a0a0] hover:text-[#e4e4e4]"
            >
              Close
            </button>
            <button
              type="button"
              data-testid="steer-drawing-attach"
              disabled={!canAttach || busy}
              onClick={() => void handleAttach()}
              className="inline-flex h-8 items-center rounded-lg bg-[#e4e4e4] px-3 text-[12px] font-medium text-[#141414] disabled:opacity-40"
            >
              {busy ? "Attaching…" : "Attach to composer"}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
