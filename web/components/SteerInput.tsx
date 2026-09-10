"use client";

import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
} from "react";
import {
  Bot,
  FileText,
  ImagePlus,
  X,
} from "lucide-react";
import type { ChatAttachment, ModelInfo } from "../../shared/events";
import { uploadRoomFile } from "../lib/api";
import { PromptInput, type PromptAction } from "./agents/prompt-input";

interface SteerInputProps {
  onSend: (text: string, attachmentIds?: string[]) => void;
  roomId?: string;
  /** Selected agent is in read-only plan mode. */
  planMode?: boolean;
  /** Agent is mid-run — drafting allowed, send becomes stop */
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
  /** Tight layout for split panes. */
  compact?: boolean;
  /** Stop the in-flight run (Prompt Input stop state). */
  onStop?: () => void;
}

const TYPING_THROTTLE_MS = 1500;
const TYPING_IDLE_STOP_MS = 2000;

const FILE_ACCEPT =
  "image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/markdown,text/csv,application/json";

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
  agentName,
  agentId,
  onTyping,
  onTypingStop,
  typingIndicator,
  compact = false,
  onStop,
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

  const statusHint = !connected
    ? "Reconnecting…"
    : !canSteer
      ? steerLockReason || "You do not have permission to steer"
      : agentBusy
        ? "Agent is working — stop or draft a follow-up"
        : null;

  const submit = (prompt: string) => {
    if (!connected || !canSteer || agentBusy || uploading) return;
    const trimmed = prompt.replace(/^\s+|\s+$/g, "");
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
    if (!roomId || !canSteer) return;
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
        : [{ id: "auto", displayName: "Auto" }];

  const modelLocked = modelDisabled || agentBusy;
  const livePlaceholder = !connected
    ? "Reconnecting…"
    : agentBusy
      ? "Draft a follow-up…"
      : planMode
        ? "Ask for a plan…"
        : placeholder;

  const actions: PromptAction[] = [
    {
      value: "image",
      label: "Attach image",
      description: "Add a screenshot or visual reference.",
      icon: <ImagePlus className="size-4" strokeWidth={1.75} />,
      disabled: !roomId || !canSteer || uploading,
    },
    {
      value: "file",
      label: "Add context",
      description: "Attach a file with supporting details.",
      icon: <FileText className="size-4" strokeWidth={1.75} />,
      disabled: !roomId || !canSteer || uploading,
    },
  ];

  return (
    <div className={compact ? "px-2 pb-2 pt-2" : "px-3 sm:px-5 pb-3 sm:pb-4 pt-3"}>
      <input
        ref={fileInputRef}
        type="file"
        accept={FILE_ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => void handleFiles(e.target.files)}
      />
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
      >
        <PromptInput
          value={text}
          onValueChange={handleChange}
          onSubmit={submit}
          loading={agentBusy}
          onStop={onStop}
          models={modelOptions.map((m) => ({
            value: m.id,
            label: m.displayName,
            icon: <Bot className="size-3.5" strokeWidth={1.75} />,
            disabled: modelLocked,
          }))}
          model={modelId || modelOptions[0]?.id}
          onModelChange={onModelChange}
          modelDisabled={modelLocked}
          actions={actions}
          onAction={() => fileInputRef.current?.click()}
          minRows={compact ? 1 : 2}
          maxRows={compact ? 4 : 8}
          placeholder={livePlaceholder}
          aria-label="Message the agent"
          onBlur={() => stopTyping()}
          allowEmptySubmit={attachments.length > 0}
          submitDisabled={!connected || !canSteer || uploading}
          className={
            !connected
              ? "border-[#5a3a3a]"
              : dragActive
                ? "border-[#4d9fff]/70"
                : undefined
          }
          leadingAction={
            <span className="hidden sm:inline-flex items-center gap-1.5 px-1.5 text-[11px] text-muted-foreground">
              <span className="truncate max-w-[7rem]">{agentName || "Agent"}</span>
              {planMode ? (
                <span className="rounded-md border border-[#4d9fff]/50 bg-[#1a2430] px-1.5 py-0.5 text-[10px] font-medium text-[#8ec5ff]">
                  Plan
                </span>
              ) : null}
            </span>
          }
          header={
            attachments.length > 0 ? (
              <div className="flex flex-wrap gap-2 px-1 pb-2">
                {attachments.map((att) => (
                  <div
                    key={att.id}
                    className="relative flex items-center gap-1.5 rounded-lg border border-border bg-muted pl-1.5 pr-6 py-1 max-w-[180px]"
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
            ) : null
          }
        />
      </div>

      {(typingIndicator ||
        statusHint ||
        attachError ||
        uploading ||
        (planMode && !compact) ||
        !compact) && (
        <div
          className={`${compact ? "mt-1" : "mt-2"} px-1 flex items-center justify-between gap-2 min-h-[1rem]`}
        >
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
      )}
    </div>
  );
}
