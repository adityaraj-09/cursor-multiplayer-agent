"use client";

import { ArrowUp, LoaderCircle, Plus, Square } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  type TextareaHTMLAttributes,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
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
  stopping?: boolean;
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
  modelLockReason?: string;
}

const MENU_WIDTH = 224;
const MENU_MAX_HEIGHT = 256;

function menuPosition(
  anchor: DOMRect,
  width = MENU_WIDTH,
  maxHeight = MENU_MAX_HEIGHT,
): CSSProperties {
  const gap = 8;
  const spaceAbove = anchor.top - gap;
  const spaceBelow = window.innerHeight - anchor.bottom - gap;
  const openUp = spaceAbove >= Math.min(maxHeight, 140) || spaceAbove >= spaceBelow;
  const left = Math.min(
    Math.max(8, anchor.left),
    window.innerWidth - width - 8,
  );
  const height = Math.min(maxHeight, Math.max(96, openUp ? spaceAbove : spaceBelow));
  if (openUp) {
    return {
      position: "fixed",
      left,
      width,
      bottom: window.innerHeight - anchor.top + gap,
      maxHeight: height,
      zIndex: 80,
    };
  }
  return {
    position: "fixed",
    left,
    width,
    top: anchor.bottom + gap,
    maxHeight: height,
    zIndex: 80,
  };
}

function PromptMenu({
  open,
  anchorRef,
  onClose,
  children,
  labelledBy,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
  labelledBy?: string;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({});

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    setStyle(menuPosition(anchor.getBoundingClientRect()));
  }, [anchorRef]);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || anchorRef.current?.contains(target)) {
        return;
      }
      onClose();
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [anchorRef, onClose, open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-labelledby={labelledBy}
      style={style}
      className="overflow-y-auto rounded-xl border border-[#2b2b2b] bg-[#1a1a1a] p-1.5 shadow-[0_18px_50px_rgba(0,0,0,0.55)]"
    >
      {children}
    </div>,
    document.body,
  );
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
  stopping = false,
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
  modelLockReason,
  ...textareaProps
}: PromptInputProps) {
  const reduce = useReducedMotion() ?? false;
  const attachTriggerId = `${useId()}-attach`;
  const modelTriggerId = `${useId()}-model`;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const measurementRef = useRef<HTMLDivElement>(null);
  const actionsTriggerRef = useRef<HTMLButtonElement>(null);
  const modelsTriggerRef = useRef<HTMLButtonElement>(null);
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
  const closeActions = useCallback(() => setActionsOpen(false), []);
  const closeModels = useCallback(() => setModelsOpen(false), []);

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

  const sendState = stopping ? "stopping" : loading ? "stop" : "send";

  return (
    <form
      onSubmit={submit}
      className={cn(
        "relative w-full rounded-2xl border border-[#2b2b2b] bg-[#1a1a1a] p-2 transition-colors focus-within:border-[#3c3c3c]",
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
          className="scrollbar-hide block w-full resize-none overflow-y-auto bg-transparent px-2 pt-1.5 text-sm leading-6 text-[#e4e4e4] outline-none placeholder:text-[#6e6e6e]"
        />
      </div>

      <div className="mt-1.5 flex items-center gap-1">
        {actions.length ? (
          <div className="relative">
            <button
              ref={actionsTriggerRef}
              type="button"
              disabled={disabled}
              id={attachTriggerId}
              aria-label="Add to prompt"
              aria-expanded={actionsOpen}
              aria-haspopup="menu"
              onClick={() => {
                setModelsOpen(false);
                setActionsOpen((open) => !open);
              }}
              className="grid size-8 place-items-center rounded-full text-[#a0a0a0] outline-none transition-colors hover:bg-[#252525] hover:text-[#e4e4e4] disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[#4d9fff]"
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
            <PromptMenu
              open={actionsOpen}
              anchorRef={actionsTriggerRef}
              onClose={closeActions}
              labelledBy={attachTriggerId}
            >
              {actions.map((action) => (
                <button
                  key={action.value}
                  type="button"
                  role="menuitem"
                  disabled={action.disabled}
                  onClick={() => {
                    onAction?.(action.value);
                    setActionsOpen(false);
                  }}
                  className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none transition-colors hover:bg-[#252525] focus-visible:bg-[#252525] disabled:pointer-events-none disabled:opacity-50"
                >
                  {action.icon ? (
                    <span className="mt-0.5 grid size-4 shrink-0 place-items-center text-[#a0a0a0]">
                      {action.icon}
                    </span>
                  ) : null}
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-[#e4e4e4]">
                      {action.label}
                    </span>
                    {action.description ? (
                      <span className="mt-0.5 block text-[11px] leading-snug text-[#6e6e6e]">
                        {action.description}
                      </span>
                    ) : null}
                  </span>
                </button>
              ))}
            </PromptMenu>
          </div>
        ) : null}
        {leadingAction}
        {models.length ? (
          <div className="relative min-w-0">
            <button
              ref={modelsTriggerRef}
              type="button"
              disabled={disabled || modelDisabled}
              id={modelTriggerId}
              aria-label="Choose model"
              aria-expanded={modelsOpen}
              aria-haspopup="menu"
              title={modelDisabled ? modelLockReason : undefined}
              onClick={() => {
                setActionsOpen(false);
                setModelsOpen((open) => !open);
              }}
              className="inline-flex h-8 max-w-[min(100%,220px)] items-center gap-1.5 rounded-full px-2.5 text-xs text-[#a0a0a0] outline-none transition-colors hover:bg-[#252525] hover:text-[#e4e4e4] disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[#4d9fff]"
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
            <PromptMenu
              open={modelsOpen}
              anchorRef={modelsTriggerRef}
              onClose={closeModels}
              labelledBy={modelTriggerId}
            >
              {models.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="menuitem"
                  disabled={option.disabled}
                  onClick={() => setModel(option.value)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs outline-none transition-colors hover:bg-[#252525] disabled:opacity-50",
                    option.value === currentModelValue &&
                      "bg-[#252525] text-[#e4e4e4]",
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
            </PromptMenu>
          </div>
        ) : null}

        <button
          type={loading ? "button" : "submit"}
          disabled={loading ? !onStop || stopping : !canSubmit}
          aria-label={
            stopping ? "Stopping" : loading ? "Stop generating" : "Send prompt"
          }
          onClick={loading ? onStop : undefined}
          className="ml-auto grid size-8 place-items-center rounded-full bg-[#e4e4e4] text-[#141414] outline-none transition-opacity disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-[#4d9fff]"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={sendState}
              initial={reduce ? { opacity: 1 } : { opacity: 0, y: 3, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -3, scale: 0.8 }}
              transition={reduce ? { duration: 0 } : SPRING_SWAP}
              className="grid place-items-center"
            >
              {stopping ? (
                <LoaderCircle className="size-3.5 animate-spin" strokeWidth={2} />
              ) : loading ? (
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
