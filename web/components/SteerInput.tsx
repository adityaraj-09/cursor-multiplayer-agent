"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import {
  Bot,
  ChevronDown,
  FileText,
  ImagePlus,
  Lock,
  Paperclip,
  SendHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import type { ChatAttachment, ModelInfo } from "../../shared/events";
import { uploadRoomFile } from "../lib/api";

interface SteerInputProps {
  onSend: (text: string, attachmentIds?: string[]) => void;
  roomId?: string;
  /** Selected agent is in read-only plan mode. */
  planMode?: boolean;
  /** Agent is mid-run — drafting allowed, send blocked */
  agentBusy?: boolean;
  /** Socket disconnected — drafting allowed, send blocked */
  connected?: boolean;
  /** Collaboration permission — drafting allowed, send blocked when false */
  canSteer?: boolean;
  /** Explains why send is blocked for permissions */
  steerLockReason?: string;
  placeholder?: string;
  models?: ModelInfo[];
  modelId?: string;
  onModelChange?: (modelId: string) => void;
  /** Host-only / saving — separate from busy lock messaging */
  modelDisabled?: boolean;
  modelLockReason?: string;
  /** Shown in the model row when steering a named agent. */
  agentName?: string;
  /** Current agent id — used to scope typing start/stop. */
  agentId?: string;
  /** Throttled by this component while the user drafts. */
  onTyping?: (agentId: string) => void;
  onTypingStop?: (agentId?: string) => void;
  /** e.g. "Jae is typing to Agent A…" */
  typingIndicator?: string;
  /** Compact status for shared room memory used on the next send. */
  contextHint?: string;
  onOpenContext?: () => void;
}

const TYPING_THROTTLE_MS = 1500;
const TYPING_IDLE_STOP_MS = 2000;

export default function SteerInput({
  onSend,
  roomId,
  planMode = false,
  agentBusy = false,
  connected = true,
  canSteer = true,
  steerLockReason,
  placeholder = "Message the agent…",
  models = [],
  modelId = "",
  onModelChange,
  modelDisabled = false,
  modelLockReason,
  agentName,
  agentId,
  onTyping,
  onTypingStop,
  typingIndicator,
  contextHint,
  onOpenContext,
}: SteerInputProps) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [attachError, setAttachError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastTypingEmitRef = useRef(0);
  const idleStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingActiveRef = useRef(false);
  const agentIdRef = useRef(agentId);
  agentIdRef.current = agentId;

  const clearIdleTimer = () => {
    if (idleStopTimerRef.current) {
      clearTimeout(idleStopTimerRef.current);
      idleStopTimerRef.current = null;
    }
  };

  const stopTyping = () => {
    clearIdleTimer();
    if (!typingActiveRef.current) return;
    typingActiveRef.current = false;
    lastTypingEmitRef.current = 0;
    const id = agentIdRef.current;
    if (id) onTypingStop?.(id);
    else onTypingStop?.();
  };

  const bumpTyping = () => {
    const id = agentIdRef.current;
    if (!id || !onTyping || !connected) return;
    const now = Date.now();
    if (
      !typingActiveRef.current ||
      now - lastTypingEmitRef.current >= TYPING_THROTTLE_MS
    ) {
      typingActiveRef.current = true;
      lastTypingEmitRef.current = now;
      onTyping(id);
    }
    clearIdleTimer();
    idleStopTimerRef.current = setTimeout(() => {
      stopTyping();
    }, TYPING_IDLE_STOP_MS);
  };

  // Switching agents or unmounting should clear the previous indicator.
  useEffect(() => {
    return () => {
      stopTyping();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when agent changes
  }, [agentId]);

  useEffect(() => {
    if (!connected) stopTyping();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  const canSend =
    connected &&
    canSteer &&
    !agentBusy &&
    !uploading &&
    (text.trim().length > 0 || attachments.length > 0);

  const statusHint = !connected
    ? "Reconnecting…"
    : !canSteer
      ? steerLockReason || "You do not have permission to steer"
      : agentBusy
        ? "Agent is working — send unlocks when idle"
        : null;

  const submit = () => {
    if (!connected || !canSteer || agentBusy || uploading) return;
    // Trim leading/trailing whitespace and newlines so Shift+Enter drafts
    // don't leave sticky empty lines after send.
    const trimmed = text.replace(/^\s+|\s+$/g, "");
    if (!trimmed && attachments.length === 0) return;
    stopTyping();
    onSend(
      trimmed || (attachments.length ? "(attached files)" : ""),
      attachments.map((a) => a.id),
    );
    setText("");
    setAttachments([]);
    setPreviews({});
    setAttachError("");
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length || !roomId) return;
    setUploading(true);
    setAttachError("");
    try {
      for (const file of Array.from(files).slice(0, 6)) {
        const att = await uploadRoomFile(roomId, file);
        setAttachments((prev) => {
          if (prev.some((p) => p.id === att.id) || prev.length >= 6) return prev;
          return [...prev, att];
        });
        if (file.type.startsWith("image/")) {
          const url = URL.createObjectURL(file);
          setPreviews((prev) => ({ ...prev, [att.id]: url }));
        }
      }
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (!roomId) return;
    await handleFiles(e.dataTransfer.files);
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
    setPreviews((prev) => {
      const url = prev[id];
      if (url) URL.revokeObjectURL(url);
      const next = { ...prev };
      delete next[id];
      return next;
    });
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

  const handleChange = (value: string) => {
    setText(value);
    if (value.trim()) bumpTyping();
    else stopTyping();
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
      : planMode
        ? "Ask for a plan… (approve it in chat when ready)"
        : placeholder;

  return (
    <form
      onSubmit={handleSubmit}
      className="px-3 sm:px-5 pb-3 sm:pb-4 pt-3"
    >
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          if (!canSteer) return;
          setDragActive(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!canSteer) return;
          setDragActive(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragActive(false);
        }}
        onDrop={(e) => void handleDrop(e)}
        className={`rounded-2xl border bg-[#181818] transition-all shadow-[0_18px_55px_rgba(0,0,0,0.28)] overflow-hidden ${
          !connected
            ? "border-[#5a3a3a]"
            : dragActive
              ? "border-[#4d9fff]/70 shadow-[0_18px_70px_rgba(77,159,255,0.12)]"
              : "border-[#2b2b2b] focus-within:border-[#4d9fff]/60 focus-within:shadow-[0_18px_70px_rgba(77,159,255,0.08)]"
        }`}
      >
        <div className="flex items-center gap-2 border-b border-[#2b2b2b]/80 px-3 h-9">
          <span className="flex items-center gap-1.5 text-[11px] text-[#8a8a8a] shrink-0">
            <Bot className="h-3.5 w-3.5" strokeWidth={1.75} />
            {agentName || "Agent"}
          </span>
          {planMode && (
            <span className="inline-flex items-center h-5 px-1.5 rounded-md border border-[#4d9fff]/50 bg-[#1a2430] text-[10px] font-medium text-[#8ec5ff] shrink-0">
              Plan mode
            </span>
          )}
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
          {contextHint && (
            <button
              type="button"
              onClick={onOpenContext}
              className="hidden sm:inline-flex ml-auto items-center gap-1 text-[11px] text-[#8ec5ff] hover:text-[#b8dcff] truncate"
            >
              {contextHint}
            </button>
          )}
        </div>

        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-2.5">
            {attachments.map((att) => (
              <div
                key={att.id}
                className="relative flex items-center gap-1.5 rounded-lg border border-[#2b2b2b] bg-[#141414] pl-1.5 pr-6 py-1 max-w-[180px]"
              >
                {previews[att.id] ? (
                  <img
                    src={previews[att.id]}
                    alt=""
                    className="h-8 w-8 rounded object-cover"
                  />
                ) : att.mime.startsWith("image/") ? (
                  <ImagePlus className="h-4 w-4 text-[#8ec5ff]" strokeWidth={1.75} />
                ) : (
                  <FileText className="h-4 w-4 text-[#a0a0a0]" strokeWidth={1.75} />
                )}
                <span className="text-[11px] text-[#c8c8c8] truncate">
                  {att.name}
                </span>
                <button
                  type="button"
                  onClick={() => removeAttachment(att.id)}
                  className="absolute right-1 top-1 h-4 w-4 rounded text-[#6e6e6e] hover:text-[#e4e4e4]"
                  aria-label={`Remove ${att.name}`}
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2 px-3 py-2.5">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/markdown,text/csv,application/json"
            multiple
            className="hidden"
            onChange={(e) => void handleFiles(e.target.files)}
          />
          <button
            type="button"
            disabled={!roomId || !canSteer || uploading}
            onClick={() => fileInputRef.current?.click()}
            className="mb-1 inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#8a8a8a] hover:text-[#e4e4e4] hover:bg-[#222] disabled:opacity-30"
            aria-label="Attach files"
            title="Attach images or files"
          >
            <Paperclip className="h-4 w-4" strokeWidth={1.75} />
          </button>
          <Sparkles className="mt-1 h-4 w-4 shrink-0 text-[#6e6e6e]" strokeWidth={1.75} />
          {/* Fixed height — long text / paste scrolls inside, never grows the footer */}
          <textarea
            value={text}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => stopTyping()}
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
        <p className="text-[11px] text-[#6e6e6e] truncate">
          {typingIndicator ? (
            <span className="text-[#4d9fff]">{typingIndicator}</span>
          ) : statusHint ? (
            <span className={!connected ? "text-[#f07070]" : "text-[#4d9fff]"}>
              {statusHint}
            </span>
          ) : attachError ? (
            <span className="text-[#f07070]">{attachError}</span>
          ) : uploading ? (
            <span className="text-[#4d9fff]">Uploading…</span>
          ) : planMode ? (
            <span>Plan mode — the agent explores and proposes, then you approve</span>
          ) : (
            <span className="hidden sm:inline">
              Enter to send · Shift+Enter for newline · attach images or files
            </span>
          )}
        </p>
      </div>
    </form>
  );
}
