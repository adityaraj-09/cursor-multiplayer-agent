"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";

interface SteerInputProps {
  onSend: (text: string) => void;
}

export default function SteerInput({ onSend }: SteerInputProps) {
  const [text, setText] = useState("");

  const submit = () => {
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

  return (
    <form onSubmit={handleSubmit} className="px-3 pb-3 pt-2">
      <div className="flex items-end gap-2 rounded-lg border border-[#2b2b2b] bg-[#1e1e1e] focus-within:border-[#3c3c3c] transition-colors px-3 py-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Steer the agent…"
          maxLength={2000}
          rows={1}
          className="flex-1 resize-none bg-transparent text-[13px] text-[#e4e4e4] placeholder:text-[#6e6e6e] outline-none leading-5 max-h-24"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          className="shrink-0 h-7 px-2.5 rounded-md bg-[#e4e4e4] text-[#141414] text-[12px] font-medium hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Send
        </button>
      </div>
      <p className="text-[11px] text-[#6e6e6e] mt-1.5 px-0.5">
        Enter to send · anyone can steer
      </p>
    </form>
  );
}
