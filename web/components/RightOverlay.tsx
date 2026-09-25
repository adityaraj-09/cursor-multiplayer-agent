"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { X } from "lucide-react";

const WIDTH_KEY = "steer-right-overlay-width";
const DEFAULT_WIDTH = 480;
const MIN_WIDTH = 320;
const COMPACT_WIDTH = 380;

function maxWidth(): number {
  if (typeof window === "undefined") return 1100;
  return Math.max(MIN_WIDTH, Math.round(window.innerWidth * 0.92));
}

function largeWidth(): number {
  if (typeof window === "undefined") return 860;
  return Math.min(maxWidth(), Math.max(640, Math.round(window.innerWidth * 0.72)));
}

function clampWidth(value: number): number {
  return Math.min(maxWidth(), Math.max(MIN_WIDTH, Math.round(value)));
}

function readStoredWidth(): number {
  if (typeof window === "undefined") return DEFAULT_WIDTH;
  const stored = Number(window.localStorage.getItem(WIDTH_KEY));
  if (!Number.isFinite(stored)) return DEFAULT_WIDTH;
  return clampWidth(stored);
}

export default function RightOverlay({
  title,
  subtitle,
  hideHeader = false,
  headerRight,
  onClose,
  children,
}: {
  title?: string;
  subtitle?: string;
  hideHeader?: boolean;
  headerRight?: ReactNode;
  onClose: () => void;
  children: ReactNode | ((width: number) => ReactNode);
}) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [resizing, setResizing] = useState(false);
  const widthRef = useRef(DEFAULT_WIDTH);

  useEffect(() => {
    const next = readStoredWidth();
    widthRef.current = next;
    setWidth(next);
  }, []);

  const persist = (next: number) => {
    const clamped = clampWidth(next);
    widthRef.current = clamped;
    setWidth(clamped);
    window.localStorage.setItem(WIDTH_KEY, String(clamped));
  };

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startW = widthRef.current;
    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "ew-resize";
    setResizing(true);

    const onMove = (move: PointerEvent) => {
      const next = clampWidth(startW + (startX - move.clientX));
      widthRef.current = next;
      setWidth(next);
    };
    const onUp = () => {
      try {
        handle.releasePointerCapture(event.pointerId);
      } catch {
        /* already released */
      }
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setResizing(false);
      persist(widthRef.current);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  const toggleLarge = () => {
    persist(widthRef.current < largeWidth() - 40 ? largeWidth() : COMPACT_WIDTH);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40">
      <button
        type="button"
        className="h-full min-w-0 flex-1 cursor-default"
        aria-label="Close panel"
        onClick={onClose}
      />
      <div
        className="relative z-10 flex h-full min-h-0 flex-col border-l border-[#1c1c1c] bg-[#0a0a0a] text-[#e8e8e8] shadow-[-16px_0_40px_rgba(0,0,0,0.35)]"
        style={{ width }}
      >
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Drag to resize panel"
          title="Drag to resize · double-click to expand"
          onPointerDown={onPointerDown}
          onDoubleClick={toggleLarge}
          className="absolute inset-y-0 -left-1.5 z-20 flex w-3 cursor-ew-resize touch-none items-center justify-center"
        >
          <span
            className={`h-12 w-1 rounded-full transition-colors ${
              resizing ? "bg-[#4d9fff]" : "bg-[#4a4a4a] hover:bg-[#4d9fff]"
            }`}
          />
        </div>
        {!hideHeader && (
          <header className="flex h-11 shrink-0 items-center gap-2 border-b border-[#1c1c1c] px-3">
            <div className="min-w-0 flex-1">
              {title && (
                <p className="truncate text-[13px] font-medium text-[#f2f2f2]">
                  {title}
                </p>
              )}
              {subtitle && (
                <p className="truncate text-[11px] text-[#6a6a6a]">{subtitle}</p>
              )}
            </div>
            {headerRight}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#8a8a8a] hover:bg-[#1a1a1a] hover:text-[#e8e8e8]"
              aria-label="Close panel"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </header>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {typeof children === "function" ? children(width) : children}
        </div>
      </div>
    </div>
  );
}
