"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
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
      className="px-2 sm:px-3 pb-2 sm:pb-3 pt-2"
    >
      <div className="flex items-center gap-2 mb-1.5 sm:mb-2 min-h-7">
        <label className="text-[11px] text-[#6e6e6e] shrink-0">Model</label>
        <select
          value={modelId}
          onChange={(e) => onModelChange?.(e.target.value)}
          disabled={modelLocked}
          title={modelLocked ? modelReason : undefined}
          className="min-w-0 flex-1 sm:flex-none sm:max-w-[min(100%,280px)] h-8 sm:h-7 px-2 rounded-md bg-[#252525] border border-[#2b2b2b] text-[12px] text-[#e4e4e4] outline-none focus:border-[#4d9fff] disabled:opacity-40"
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
        {modelLocked && modelReason && (
          <span className="hidden sm:inline text-[11px] text-[#6e6e6e] truncate">
            {modelReason}
          </span>
        )}
      </div>

      <div
        className={`flex items-center gap-2 rounded-lg border bg-[#1e1e1e] transition-colors px-2.5 sm:px-3 h-12 sm:h-11 ${
          !connected
            ? "border-[#5a3a3a]"
            : "border-[#2b2b2b] focus-within:border-[#3c3c3c]"
        }`}
      >
        {/* Fixed height — long text / paste scrolls inside, never grows the footer */}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={livePlaceholder}
          rows={1}
          // Keep editable while busy/disconnected so users can draft
          className="flex-1 h-full min-h-0 resize-none overflow-y-auto bg-transparent text-[16px] sm:text-[13px] text-[#e4e4e4] placeholder:text-[#6e6e6e] outline-none leading-5 py-3 sm:py-2.5"
          aria-label="Message the agent"
        />
        <button
          type="submit"
          disabled={!canSend}
          className="shrink-0 h-10 sm:h-8 min-w-[4.25rem] sm:min-w-0 px-4 sm:px-3 rounded-md bg-[#e4e4e4] text-[#141414] text-[14px] sm:text-[12px] font-medium hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Send
        </button>
      </div>

      <div className="mt-1.5 px-0.5 flex items-center justify-between gap-2 min-h-[1rem]">
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
