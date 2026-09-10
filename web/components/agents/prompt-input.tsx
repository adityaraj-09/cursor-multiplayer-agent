"use client";

import { ArrowUp, Plus, Square } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { SPRING_SWAP } from "../../lib/ease";
import { cn } from "../../lib/utils";

export interface PromptModel {
  value: string;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface PromptAction {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface PromptInputProps
  extends Omit<
    TextareaHTMLAttributes<HTMLTextAreaElement>,
    "value" | "defaultValue" | "onChange" | "onSubmit" | "children"
  > {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  models?: PromptModel[];
  model?: string;
  defaultModel?: string;
  onModelChange?: (model: string) => void;
  actions?: PromptAction[];
  onAction?: (action: string) => void;
  onSubmit?: (value: string, model?: string) => void | Promise<void>;
  loading?: boolean;
  onStop?: () => void;
  minRows?: number;
  maxRows?: number;
  leadingAction?: ReactNode;
  className?: string;
  /** Extra slot above the textarea (attachments, banners). */
  header?: ReactNode;
  /** Enable send even when the prompt is empty (e.g. attachments only). */
  allowEmptySubmit?: boolean;
  /** Extra send lock (permissions, reconnect, upload). */
  submitDisabled?: boolean;
  modelDisabled?: boolean;
}

export function PromptInput({
  value,
  defaultValue = "",
  onValueChange,
  models = [],
  model,
  defaultModel,
  onModelChange,
  actions = [],
  onAction,
  onSubmit,
  loading = false,
  onStop,
  minRows = 2,
  maxRows = 8,
  leadingAction,
  className,
  disabled,
  placeholder = "Ask the agent to do something…",
  "aria-label": ariaLabel = "Prompt",
  onKeyDown,
  header,
  allowEmptySubmit = false,
  submitDisabled = false,
  modelDisabled = false,
  ...textareaProps
}: PromptInputProps) {
  const reduce = useReducedMotion() ?? false;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const measurementRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLFormElement>(null);
  const [internalValue, setInternalValue] = useState(defaultValue);
  const [internalModel, setInternalModel] = useState(
    defaultModel ?? models[0]?.value,
  );
  const [actionsOpen, setActionsOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const currentValue = value ?? internalValue;
  const currentModelValue = model ?? internalModel;
  const currentModel = models.find(
    (option) => option.value === currentModelValue,
  );
  const canSubmit =
    (Boolean(currentValue.trim()) || allowEmptySubmit) &&
    !disabled &&
    !loading &&
    !submitDisabled;

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    const measurement = measurementRef.current;
    if (!textarea || !measurement) return;

    const lineHeight = 24;
    const nextHeight = Math.min(
      Math.max(measurement.scrollHeight, minRows * lineHeight),
      maxRows * lineHeight,
    );
    const height = `${nextHeight}px`;
    if (textarea.style.height !== height) textarea.style.height = height;
  }, [minRows, maxRows]);

  useLayoutEffect(() => {
    resizeTextarea();
  }, [resizeTextarea, currentValue]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(resizeTextarea);
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [resizeTextarea]);

  useEffect(() => {
    if (!actionsOpen && !modelsOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setActionsOpen(false);
        setModelsOpen(false);
      }
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setActionsOpen(false);
        setModelsOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [actionsOpen, modelsOpen]);

  const setValue = (next: string) => {
    if (value === undefined) setInternalValue(next);
    onValueChange?.(next);
  };

  const setModel = (next: string) => {
    if (model === undefined) setInternalModel(next);
    onModelChange?.(next);
    setModelsOpen(false);
  };

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const prompt = currentValue.trim();
    if ((!prompt && !allowEmptySubmit) || disabled || loading || submitDisabled) {
      return;
    }
    void onSubmit?.(prompt, currentModelValue);
    if (value === undefined) setInternalValue("");
    textareaRef.current?.focus({ preventScroll: true });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown?.(event);
    if (
      event.defaultPrevented ||
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }
    event.preventDefault();
    submit();
  };

  return (
    <form
      ref={rootRef}
      onSubmit={submit}
      className={cn(
        "relative w-full rounded-2xl border border-border/80 bg-background p-2 transition-colors focus-within:border-foreground/25",
        disabled && "opacity-60",
        className,
      )}
    >
      {header}
      <div className="relative">
        <div
          ref={measurementRef}
          aria-hidden="true"
          className="pointer-events-none invisible absolute inset-x-0 top-0 whitespace-pre-wrap px-2 text-sm leading-6 [overflow-wrap:break-word]"
        >
          {`${currentValue}\u200b`}
        </div>
        <textarea
          ref={textareaRef}
          value={currentValue}
          disabled={disabled}
          placeholder={placeholder}
          aria-label={ariaLabel}
          rows={minRows}
          {...textareaProps}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          className="scrollbar-hide block w-full resize-none overflow-y-auto bg-transparent px-2 pt-1.5 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground/55"
        />
      </div>

      <div className="mt-1.5 flex items-center gap-1">
        {actions.length ? (
          <div className="relative">
            <button
              type="button"
              disabled={disabled || loading}
              aria-label="Add to prompt"
              aria-expanded={actionsOpen}
              onClick={() => {
                setModelsOpen(false);
                setActionsOpen((open) => !open);
              }}
              className="grid size-8 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <motion.span
                aria-hidden="true"
                animate={{ rotate: actionsOpen ? 45 : 0 }}
                transition={reduce ? { duration: 0 } : SPRING_SWAP}
                className="grid place-items-center"
              >
                <Plus className="size-4" strokeWidth={1.8} />
              </motion.span>
            </button>
            {actionsOpen ? (
              <div className="absolute bottom-full left-0 z-30 mb-2 w-56 rounded-xl border border-border/80 bg-background p-1.5 shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
                {actions.map((action) => (
                  <button
                    key={action.value}
                    type="button"
                    disabled={action.disabled}
                    onClick={() => {
                      onAction?.(action.value);
                      setActionsOpen(false);
                    }}
                    className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none transition-colors hover:bg-muted focus-visible:bg-muted disabled:pointer-events-none disabled:opacity-50"
                  >
                    {action.icon ? (
                      <span className="mt-0.5 grid size-4 shrink-0 place-items-center text-muted-foreground">
                        {action.icon}
                      </span>
                    ) : null}
                    <span className="min-w-0">
                      <span className="block text-xs font-medium text-foreground">
                        {action.label}
                      </span>
                      {action.description ? (
                        <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                          {action.description}
                        </span>
                      ) : null}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {leadingAction}
        {models.length ? (
          <div className="relative min-w-0">
            <button
              type="button"
              disabled={disabled || loading || modelDisabled}
              aria-label="Choose model"
              aria-expanded={modelsOpen}
              onClick={() => {
                setActionsOpen(false);
                setModelsOpen((open) => !open);
              }}
              className="inline-flex h-8 max-w-[min(100%,220px)] items-center gap-1.5 rounded-full px-2.5 text-xs text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring"
            >
              {currentModel?.icon ? (
                <span className="grid size-4 shrink-0 place-items-center">
                  {currentModel.icon}
                </span>
              ) : null}
              <span className="truncate">
                {currentModel?.label ?? "Choose model"}
              </span>
            </button>
            {modelsOpen ? (
              <div className="absolute bottom-full left-0 z-30 mb-2 max-h-64 w-56 overflow-y-auto rounded-xl border border-border/80 bg-background p-1.5 shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
                {models.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    disabled={option.disabled}
                    onClick={() => setModel(option.value)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs outline-none transition-colors hover:bg-muted disabled:opacity-50",
                      option.value === currentModelValue && "bg-muted/80 text-foreground",
                    )}
                  >
                    {option.icon ? (
                      <span className="grid size-4 shrink-0 place-items-center">
                        {option.icon}
                      </span>
                    ) : null}
                    <span className="truncate">{option.label}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <button
          type={loading ? "button" : "submit"}
          disabled={loading ? !onStop : !canSubmit}
          aria-label={loading ? "Stop generating" : "Send prompt"}
          onClick={loading ? onStop : undefined}
          className="ml-auto grid size-8 place-items-center rounded-full bg-foreground text-background outline-none transition-opacity disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={loading ? "stop" : "send"}
              initial={reduce ? { opacity: 1 } : { opacity: 0, y: 3, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -3, scale: 0.8 }}
              transition={reduce ? { duration: 0 } : SPRING_SWAP}
              className="grid place-items-center"
            >
              {loading ? (
                <Square className="size-3.5 fill-current" strokeWidth={2} />
              ) : (
                <ArrowUp className="size-4" strokeWidth={2.2} />
              )}
            </motion.span>
          </AnimatePresence>
        </button>
      </div>
    </form>
  );
}
