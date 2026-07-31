"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import {
  Bot,
  ChevronDown,
  Lock,
  SendHorizontal,
  Sparkles,
} from "lucide-react";
import type { ModelInfo } from "../../shared/events";

interface SteerInputProps {
  onSend: (text: string) => void;
  /** Agent is mid-run — drafting allowed, send blocked */
  agentBusy?: boolean;
  /** Socket disconnected — drafting allowed, send blocked */
  connected?: boolean;
  placeholder?: string;
  models?: ModelInfo[];
  modelId?: string;
  onModelChange?: (modelId: string) => void;
  /** Host-only / saving — separate from busy lock messaging */
  modelDisabled?: boolean;
  modelLockReason?: string;
  /** Shown in the model row when steering a named agent. */
  agentName?: string;
}

export default function SteerInput({
  onSend,
  agentBusy = false,
  connected = true,
  placeholder = "Message the agent…",
  models = [],
  modelId = "",
  onModelChange,
  modelDisabled = false,
  modelLockReason,
  agentName,
}: SteerInputProps) {
  const [text, setText] = useState("");

  const canSend =
    connected && !agentBusy && text.trim().length > 0;

  const statusHint = !connected
    ? "Reconnecting…"
    : agentBusy
      ? "Agent is working — send unlocks when idle"
      : null;

  const submit = () => {
    if (!connected || agentBusy) return;
    // Trim leading/trailing whitespace and newlines so Shift+Enter drafts
    // don't leave sticky empty lines after send.
    const trimmed = text.replace(/^\s+|\s+$/g, "");
    if (!trimmed) return;
    onSend(trimmed);
    setText("");
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter = send · Shift+Enter = newline (default textarea behavior)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const modelOptions =
    models.length > 0
      ? models
      : modelId
        ? [{ id: modelId, displayName: modelId }]
        : [];

  const modelLocked = modelDisabled || agentBusy;
  const modelReason = agentBusy
    ? "Applies to next run"
    : modelLockReason;

  const livePlaceholder = !connected
    ? "Reconnecting…"
    : agentBusy
      ? "Draft a follow-up… (send when idle)"
      : placeholder;

  return (
    <form
      onSubmit={handleSubmit}
      className="px-3 sm:px-5 pb-3 sm:pb-4 pt-3"
    >
      <div
        className={`rounded-2xl border bg-[#181818] transition-all shadow-[0_18px_55px_rgba(0,0,0,0.28)] overflow-hidden ${
          !connected
            ? "border-[#5a3a3a]"
            : "border-[#2b2b2b] focus-within:border-[#4d9fff]/60 focus-within:shadow-[0_18px_70px_rgba(77,159,255,0.08)]"
        }`}
      >
        <div className="flex items-center gap-2 border-b border-[#2b2b2b]/80 px-3 h-9">
          <span className="flex items-center gap-1.5 text-[11px] text-[#8a8a8a] shrink-0">
            <Bot className="h-3.5 w-3.5" strokeWidth={1.75} />
            {agentName || "Agent"}
          </span>
          <div className="relative min-w-0 flex-1 sm:flex-none sm:w-[min(100%,320px)]">
            <select
              value={modelId}
              onChange={(e) => onModelChange?.(e.target.value)}
              disabled={modelLocked}
              title={modelLocked ? modelReason : undefined}
              className="w-full h-7 appearance-none rounded-lg bg-[#202020] border border-[#2b2b2b] pl-2.5 pr-7 text-[12px] text-[#e4e4e4] outline-none focus:border-[#4d9fff] disabled:opacity-45"
            >
              {modelOptions.length === 0 ? (
                <option value="auto">Auto</option>
              ) : (
                modelOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))
              )}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#6e6e6e]" strokeWidth={1.75} />
          </div>
          {modelLocked && modelReason && (
            <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-[#6e6e6e] truncate">
              <Lock className="h-3 w-3" strokeWidth={1.75} />
              {modelReason}
            </span>
          )}
        </div>

        <div className="flex items-end gap-2 px-3 py-2.5">
          <Sparkles className="mt-1 h-4 w-4 shrink-0 text-[#6e6e6e]" strokeWidth={1.75} />
          {/* Fixed height — long text / paste scrolls inside, never grows the footer */}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={livePlaceholder}
            rows={1}
            // Keep editable while busy/disconnected so users can draft
            className="flex-1 h-11 min-h-0 resize-none overflow-y-auto bg-transparent text-[16px] sm:text-[13px] text-[#e4e4e4] placeholder:text-[#6e6e6e] outline-none leading-5 py-2.5"
            aria-label="Message the agent"
          />
          <button
            type="submit"
            disabled={!canSend}
            className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#e4e4e4] text-[#141414] hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Send message"
          >
            <SendHorizontal className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </div>

      <div className="mt-2 px-1 flex items-center justify-between gap-2 min-h-[1rem]">
        <p className="text-[11px] text-[#6e6e6e]">
          {statusHint ? (
            <span className={!connected ? "text-[#f07070]" : "text-[#4d9fff]"}>
              {statusHint}
            </span>
          ) : (
            <span className="hidden sm:inline">
              Enter to send · Shift+Enter for newline · anyone can message
            </span>
          )}
        </p>
      </div>
    </form>
  );
}
