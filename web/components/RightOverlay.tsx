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
const DEFAULT_WIDTH = 380;
const MIN_WIDTH = 300;

function maxWidth(): number {
  if (typeof window === "undefined") return 920;
  return Math.max(MIN_WIDTH, Math.round(window.innerWidth * 0.92));
}

function readStoredWidth(): number {
  if (typeof window === "undefined") return DEFAULT_WIDTH;
  const stored = Number(window.localStorage.getItem(WIDTH_KEY));
  if (!Number.isFinite(stored)) return DEFAULT_WIDTH;
  return Math.min(maxWidth(), Math.max(MIN_WIDTH, stored));
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
  const widthRef = useRef(DEFAULT_WIDTH);
  const dragging = useRef(false);

  useEffect(() => {
    const next = readStoredWidth();
    widthRef.current = next;
    setWidth(next);
  }, []);

  const persist = (next: number) => {
    widthRef.current = next;
    setWidth(next);
    window.localStorage.setItem(WIDTH_KEY, String(next));
  };

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragging.current = true;
    const startX = event.clientX;
    const startW = widthRef.current;
    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "ew-resize";

    const onMove = (move: PointerEvent) => {
      if (!dragging.current) return;
      const next = Math.min(
        maxWidth(),
        Math.max(MIN_WIDTH, startW + (startX - move.clientX)),
      );
      widthRef.current = next;
      setWidth(next);
    };
    const onUp = () => {
      dragging.current = false;
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      persist(widthRef.current);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

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
          aria-label="Resize panel"
          onPointerDown={onPointerDown}
          className="group absolute inset-y-0 -left-1 z-20 w-2 cursor-ew-resize touch-none"
        >
          <span className="absolute inset-y-0 left-[3px] w-px bg-[#2a2a2a] transition-colors group-hover:bg-[#4d9fff]" />
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
