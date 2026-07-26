"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import type { ModelInfo } from "../../shared/events";

interface SteerInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
  models?: ModelInfo[];
  modelId?: string;
  onModelChange?: (modelId: string) => void;
  modelDisabled?: boolean;
}

export default function SteerInput({
  onSend,
  disabled = false,
  placeholder = "Message the agent…",
  models = [],
  modelId = "",
  onModelChange,
  modelDisabled = false,
}: SteerInputProps) {
  const [text, setText] = useState("");

  const submit = () => {
    if (disabled) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText("");
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
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

  return (
    <form onSubmit={handleSubmit} className="px-3 pb-3 pt-2">
      <div className="flex items-center gap-2 mb-2">
        <label className="text-[11px] text-[#6e6e6e] shrink-0">Model</label>
        <select
          value={modelId}
          onChange={(e) => onModelChange?.(e.target.value)}
          disabled={modelDisabled || modelOptions.length === 0}
          className="min-w-0 max-w-[min(100%,280px)] h-7 px-2 rounded-md bg-[#252525] border border-[#2b2b2b] text-[12px] text-[#e4e4e4] outline-none focus:border-[#4d9fff] disabled:opacity-40"
        >
          {modelOptions.length === 0 ? (
            <option value="">Loading models…</option>
          ) : (
            modelOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))
          )}
        </select>
      </div>
      <div className="flex items-end gap-2 rounded-lg border border-[#2b2b2b] bg-[#1e1e1e] focus-within:border-[#3c3c3c] transition-colors px-3 py-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          maxLength={2000}
          rows={1}
          disabled={disabled}
          className="flex-1 resize-none bg-transparent text-[13px] text-[#e4e4e4] placeholder:text-[#6e6e6e] outline-none leading-5 max-h-24 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabled || !text.trim()}
          className="shrink-0 h-7 px-2.5 rounded-md bg-[#e4e4e4] text-[#141414] text-[12px] font-medium hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Send
        </button>
      </div>
      <p className="text-[11px] text-[#6e6e6e] mt-1.5 px-0.5">
        Enter to send · anyone can message · model applies to the next run
      </p>
    </form>
  );
}
