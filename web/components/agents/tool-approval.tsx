"use client";

import {
  Check,
  ChevronDown,
  CircleAlert,
  Clock,
  LoaderCircle,
  ShieldCheck,
  X,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { AgentCode, type AgentCodeLanguage } from "./agent-code";
import { AgentDisclosure } from "./agent-disclosure";
import { EASE_OUT, SPRING_PRESS, SPRING_SWAP } from "../../lib/ease";
import { cn } from "../../lib/utils";

export type ToolApprovalStatus =
  | "pending"
  | "approving"
  | "approved"
  | "denied"
  | "running"
  | "complete"
  | "error"
  | "expired";

export interface ToolApprovalParameter {
  id: string;
  label: ReactNode;
  value: ReactNode;
}

export interface ToolApprovalCodeProps {
  code: string;
  language?: AgentCodeLanguage;
  className?: string;
}

export interface ToolApprovalProps {
  tool: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  agent?: ReactNode;
  note?: ReactNode;
  parameters?: ToolApprovalParameter[];
  status?: ToolApprovalStatus;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onApprove?: () => void;
  onAlwaysAllow?: () => void;
  onDeny?: () => void;
  className?: string;
}

function getStatusCopy(status: ToolApprovalStatus) {
  if (status === "approving") return "Approving";
  if (status === "approved") return "Approved";
  if (status === "denied") return "Denied";
  if (status === "running") return "Running";
  if (status === "complete") return "Completed";
  if (status === "expired") return "Expired";
  if (status === "error") return "Failed";
  return "Approval required";
}

function getStatusBadgeClass(status: ToolApprovalStatus) {
  if (status === "pending") {
    return "border-[#3a2a1c] bg-[#14110e] text-[#e8a23a]";
  }
  if (status === "approving" || status === "running") {
    return "border-[#26405d] bg-[#17202a] text-[#4d9fff]";
  }
  if (status === "approved" || status === "complete") {
    return "border-[#234337] bg-[#17251f] text-[#3ecf8e]";
  }
  if (status === "expired") {
    return "border-[#2b2b2b] bg-[#1a1a1a] text-[#8a8a8a]";
  }
  return "border-[#3c2b2b] bg-[#1f1818] text-[#f07070]";
}

function StatusIcon({ status }: { status: ToolApprovalStatus }) {
  if (status === "approving" || status === "running") {
    return <LoaderCircle className="size-4 animate-spin" strokeWidth={1.8} />;
  }
  if (status === "expired") {
    return <Clock className="size-4" strokeWidth={1.8} />;
  }
  if (status === "error") {
    return <CircleAlert className="size-4" strokeWidth={1.8} />;
  }
  if (status === "denied") {
    return <X className="size-4" strokeWidth={1.8} />;
  }
  if (status === "approved" || status === "complete") {
    return <Check className="size-4" strokeWidth={1.8} />;
  }
  return <ShieldCheck className="size-4" strokeWidth={1.8} />;
}

export function ToolApprovalCode({
  code,
  language = "bash",
  className,
}: ToolApprovalCodeProps) {
  return (
    <AgentCode
      code={code}
      language={language}
      className={cn(
        "whitespace-pre-wrap break-words rounded-lg border border-[#2b2b2b] bg-[#121212] px-2.5 py-2",
        className,
      )}
    />
  );
}

export function ToolApproval({
  tool,
  title = "Allow this tool to run?",
  description,
  agent,
  note,
  parameters = [],
  status = "pending",
  open,
  defaultOpen = false,
  onOpenChange,
  onApprove,
  onAlwaysAllow,
  onDeny,
  className,
}: ToolApprovalProps) {
  const reduce = useReducedMotion() ?? false;
  const baseId = useId();
  const detailsId = `${baseId}-details`;
  const previousStatus = useRef(status);
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const currentOpen = open ?? internalOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (open === undefined) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange, open],
  );
  const busy = status === "approving" || status === "running";
  const pending = status === "pending";
  const error = status === "error";

  useEffect(() => {
    // Only collapse when this card itself leaves pending — not when a
    // historical card mounts already decided, and not when an unrelated
    // agent-running flag flips the badge.
    if (previousStatus.current === "pending" && status !== "pending") {
      setOpen(false);
    }
    previousStatus.current = status;
  }, [setOpen, status]);

  return (
    <div
      data-state={status}
      aria-busy={busy}
      className={cn(
        "w-full overflow-hidden rounded-2xl border border-[#2b2b2b] bg-[#191919] text-sm",
        className,
      )}
    >
      <div className="flex items-start gap-3 px-4 pt-4 pb-3">
        <span
          aria-hidden="true"
          className={cn(
            "mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl border border-[#2b2b2b] bg-[#1f1f1f] text-[#a0a0a0]",
            error && "text-[#f07070]",
          )}
        >
          <StatusIcon status={status} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-[#e4e4e4]">{title}</p>
            <span className="truncate font-mono text-xs text-[#6e6e6e]">
              {tool}
            </span>
            {agent ? (
              <span className="truncate rounded-md bg-[#252525] px-1.5 py-0.5 text-[10px] text-[#a0a0a0]">
                {agent}
              </span>
            ) : null}
            <span
              className={cn(
                "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
                getStatusBadgeClass(status),
              )}
            >
              {getStatusCopy(status)}
            </span>
          </div>
          {description ? (
            <p className="mt-1 text-xs leading-relaxed text-[#8a8a8a]">
              {description}
            </p>
          ) : null}

          {parameters.length ? (
            <button
              type="button"
              aria-expanded={currentOpen}
              aria-controls={detailsId}
              onClick={() => setOpen(!currentOpen)}
              className="mt-2 inline-flex items-center gap-1 rounded-md text-xs font-medium text-[#6e6e6e] outline-none transition-colors hover:text-[#e4e4e4] focus-visible:ring-2 focus-visible:ring-[#4d9fff]"
            >
              View details
              <motion.span
                aria-hidden="true"
                animate={{ rotate: currentOpen ? 180 : 0 }}
                transition={reduce ? { duration: 0 } : SPRING_SWAP}
              >
                <ChevronDown className="size-3.5" strokeWidth={1.8} />
              </motion.span>
            </button>
          ) : null}
        </div>
      </div>

      <AgentDisclosure id={detailsId} open={currentOpen}>
        <div className="space-y-2.5 border-t border-[#2b2b2b] px-4 py-3">
          {parameters.map((parameter) => (
            <div
              key={parameter.id}
              className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] items-start gap-3 text-xs"
            >
              <span className="pt-1 text-[#6e6e6e]">{parameter.label}</span>
              <div className="min-w-0 text-[#e4e4e4]">{parameter.value}</div>
            </div>
          ))}
        </div>
      </AgentDisclosure>

      {note ? (
        <p className="border-t border-[#2b2b2b] px-4 py-2.5 text-[11px] leading-relaxed text-[#8a8a8a]">
          {note}
        </p>
      ) : null}

      <AnimatePresence>
        {pending && (onApprove || onDeny) ? (
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0.12 : 0.22, ease: EASE_OUT }}
            className="flex flex-wrap items-center gap-2 border-t border-[#2b2b2b] px-4 py-3"
          >
            <motion.button
              type="button"
              onClick={onApprove}
              whileTap={reduce ? undefined : { scale: 0.97 }}
              transition={SPRING_PRESS}
              className="rounded-xl bg-[#e4e4e4] px-3 py-1.5 text-xs font-medium text-[#141414] outline-none focus-visible:ring-2 focus-visible:ring-[#4d9fff] focus-visible:ring-offset-2 focus-visible:ring-offset-[#191919]"
            >
              Allow once
            </motion.button>
            {onAlwaysAllow ? (
              <motion.button
                type="button"
                onClick={onAlwaysAllow}
                whileTap={reduce ? undefined : { scale: 0.97 }}
                transition={SPRING_PRESS}
                title="Remember this tool for the rest of this session"
                className="rounded-xl border border-[#2b2b2b] bg-[#1f1f1f] px-3 py-1.5 text-xs font-medium text-[#e4e4e4] outline-none transition-colors hover:bg-[#252525] focus-visible:ring-2 focus-visible:ring-[#4d9fff]"
              >
                Always allow this session
              </motion.button>
            ) : null}
            <button
              type="button"
              onClick={onDeny}
              className="rounded-xl px-3 py-1.5 text-xs font-medium text-[#a0a0a0] outline-none transition-colors hover:bg-[#252525] hover:text-[#e4e4e4] focus-visible:ring-2 focus-visible:ring-[#4d9fff]"
            >
              Deny
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
