"use client";

import { useEffect, useRef } from "react";
import type { AppSocket } from "../lib/socket";
import {
  isTerminalAutoReply,
  sanitizeTerminalOutput,
} from "../../shared/terminalFilter";

interface TerminalProps {
  socket: AppSocket | null;
  amDriver: boolean;
  scrollback: string;
  onInput: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  onScrollHistory: (direction: "up" | "down", lines?: number) => void;
}

export default function Terminal({
  socket,
  amDriver,
  scrollback,
  onInput,
  onResize,
  onScrollHistory,
}: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<{
    write: (d: string) => void;
    dispose: () => void;
    cols: number;
    rows: number;
    clear: () => void;
    onData: (cb: (d: string) => void) => { dispose: () => void };
  } | null>(null);
  const amDriverRef = useRef(amDriver);
  const onInputRef = useRef(onInput);
  const onResizeRef = useRef(onResize);
  const onScrollHistoryRef = useRef(onScrollHistory);
  const scrollbackRef = useRef(scrollback);
  const appliedScrollbackRef = useRef(false);

  amDriverRef.current = amDriver;
  onInputRef.current = onInput;
  onResizeRef.current = onResize;
  onScrollHistoryRef.current = onScrollHistory;
  scrollbackRef.current = scrollback;

  useEffect(() => {
    if (!containerRef.current || !socket) return;

    let disposed = false;
    let dataUnsub: { dispose: () => void } | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let onPtyOutput: ((data: string) => void) | null = null;
    const container = containerRef.current;
    const abort = new AbortController();

    (async () => {
      const { Terminal: XTerminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      await import("@xterm/xterm/css/xterm.css");

      if (disposed || !containerRef.current) return;

      const term = new XTerminal({
        fontFamily:
          '"JetBrains Mono", "SF Mono", "Cascadia Code", Menlo, monospace',
        fontSize: 13,
        lineHeight: 1.35,
        convertEol: false,
        scrollback: 5000,
        windowOptions: {
          getWinSizeChars: false,
          setWinSizeChars: false,
        },
        theme: {
          background: "#141414",
          foreground: "#cccccc",
          cursor: "#aeafad",
          cursorAccent: "#141414",
          selectionBackground: "#264f78",
          black: "#1e1e1e",
          red: "#f07070",
          green: "#3ecf8e",
          yellow: "#e8a23a",
          blue: "#4d9fff",
          magenta: "#c084fc",
          cyan: "#38bdf8",
          white: "#e4e4e4",
          brightBlack: "#6e6e6e",
          brightRed: "#f07070",
          brightGreen: "#3ecf8e",
          brightYellow: "#e8a23a",
          brightBlue: "#4d9fff",
          brightMagenta: "#c084fc",
          brightCyan: "#38bdf8",
          brightWhite: "#ffffff",
        },
        cursorBlink: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);
      fitAddon.fit();
      termRef.current = term;
      appliedScrollbackRef.current = false;

      if (scrollbackRef.current) {
        term.write(sanitizeTerminalOutput(scrollbackRef.current));
        appliedScrollbackRef.current = true;
      }

      // Only the driver types into the agent. Never forward DA/CPR auto-replies.
      dataUnsub = term.onData((data: string) => {
        if (!amDriverRef.current) return;
        if (isTerminalAutoReply(data)) return;
        onInputRef.current(data);
      });

      // Wheel → tmux history scroll (works for every viewer).
      // Cursor Agent ignores mouse-wheel escapes (pastes them as junk).
      container.addEventListener(
        "wheel",
        (e: WheelEvent) => {
          e.preventDefault();
          e.stopPropagation();
          const lines = Math.min(
            12,
            Math.max(1, Math.round(Math.abs(e.deltaY) / 24)),
          );
          onScrollHistoryRef.current(e.deltaY < 0 ? "up" : "down", lines);
        },
        { passive: false, capture: true, signal: abort.signal },
      );

      onPtyOutput = (data: string) => {
        if (disposed) return;
        const cleaned = sanitizeTerminalOutput(data);
        if (cleaned) term.write(cleaned);
      };
      socket.on("pty-output", onPtyOutput);

      resizeObserver = new ResizeObserver(() => {
        if (disposed) return;
        fitAddon.fit();
        if (amDriverRef.current) {
          onResizeRef.current(term.cols, term.rows);
        }
      });
      resizeObserver.observe(container);
      if (amDriverRef.current) {
        onResizeRef.current(term.cols, term.rows);
      }
    })();

    return () => {
      disposed = true;
      abort.abort();
      if (onPtyOutput) socket.off("pty-output", onPtyOutput);
      dataUnsub?.dispose();
      resizeObserver?.disconnect();
      termRef.current?.dispose();
      termRef.current = null;
      appliedScrollbackRef.current = false;
    };
  }, [socket]);

  useEffect(() => {
    if (!scrollback || !termRef.current || appliedScrollbackRef.current) return;
    termRef.current.write(sanitizeTerminalOutput(scrollback));
    appliedScrollbackRef.current = true;
  }, [scrollback]);

  return (
    <div
      ref={containerRef}
      className="terminal-host flex-1 bg-[#141414] p-2 min-h-0 min-w-0 overflow-hidden"
    />
  );
}
