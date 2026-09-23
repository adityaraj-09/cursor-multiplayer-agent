"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Bot,
  BrainCircuit,
  CircleStop,
  Layers3,
  Plus,
  Radio,
  X,
} from "lucide-react";
import type {
  AgentInfo,
  AgentRunStatus,
  ModelInfo,
  Participant,
} from "../../shared/events";
import { isIntegratorAgent } from "../../shared/events";

interface AgentTabsProps {
  agents: AgentInfo[];
  selectedAgentId: string | null;
  /** null = show all agents' messages in chat */
  chatFilterAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
  onSelectAll: () => void;
  statusByAgent: Record<string, AgentRunStatus>;
  participants: Participant[];
  models: ModelInfo[];
  amHost: boolean;
  onAddAgent: () => void;
  onStopAgent: (agentId: string) => void;
  /** Mobile bottom-sheet mode */
  mobile?: boolean;
  onClose?: () => void;
}

const WIDTH_KEY = "steer-agent-sidebar-width";
const COLLAPSED_KEY = "steer-agent-sidebar-collapsed";
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 200;
const MAX_WIDTH = 420;
const RAIL_WIDTH = 40;

function statusDot(status: AgentRunStatus | string | undefined): string {
  if (status === "running") return "bg-[#3ecf8e] animate-pulse";
  if (status === "error") return "bg-[#f07070]";
  if (status === "stopped") return "bg-[#3c3c3c]";
  return "bg-[#6e6e6e]";
}

function modelLabel(modelId: string, models: ModelInfo[]): string {
  const match = models.find((m) => m.id === modelId);
  if (match) return match.displayName;
  if (modelId === "auto") return "Auto";
  const tail = modelId.split("-").pop() || modelId;
  return tail.length > 14 ? `${tail.slice(0, 12)}…` : tail;
}

function readStoredWidth(): number {
  if (typeof window === "undefined") return DEFAULT_WIDTH;
  const raw = window.localStorage.getItem(WIDTH_KEY);
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_WIDTH;
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(n)));
}

function readStoredCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(COLLAPSED_KEY) === "1";
}

export default function AgentTabs({
  agents,
  selectedAgentId,
  chatFilterAgentId,
  onSelectAgent,
  onSelectAll,
  statusByAgent,
  participants,
  models,
  amHost,
  onAddAgent,
  onStopAgent,
  mobile = false,
  onClose,
}: AgentTabsProps) {
  const multi = agents.length > 1;
  const showAllTab = multi;
  const allSelected = multi && chatFilterAgentId === null;

  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef<{
    startX: number;
    startWidth: number;
    latestWidth: number;
  } | null>(null);

  // Restore prefs after mount (client-only).
  useEffect(() => {
    const storedWidth = readStoredWidth();
    const storedCollapsed = readStoredCollapsed();
    queueMicrotask(() => {
      setWidth(storedWidth);
      setCollapsed(storedCollapsed);
    });
  }, []);

  const persistWidth = useCallback((next: number) => {
    window.localStorage.setItem(WIDTH_KEY, String(next));
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  const onResizePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (collapsed || mobile) return;
      e.preventDefault();
      dragRef.current = {
        startX: e.clientX,
        startWidth: width,
        latestWidth: width,
      };
      setResizing(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [collapsed, mobile, width],
  );

  const onResizePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      const next = Math.min(
        MAX_WIDTH,
        Math.max(
          MIN_WIDTH,
          Math.round(
            dragRef.current.startWidth + (e.clientX - dragRef.current.startX),
          ),
        ),
      );
      dragRef.current.latestWidth = next;
      setWidth(next);
    },
    [],
  );

  const endResize = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      const finalWidth = dragRef.current.latestWidth;
      dragRef.current = null;
      setResizing(false);
      persistWidth(finalWidth);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    },
    [persistWidth],
  );

  useEffect(() => {
    if (!resizing) return;
    const prev = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = prev;
      document.body.style.userSelect = prevSelect;
    };
  }, [resizing]);

  if (!agents.length && !amHost) return null;

  const rail = collapsed && !mobile;

  const list = (
    <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-1">
      {showAllTab && (
        <button
          type="button"
          onClick={onSelectAll}
          className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[12px] text-left transition-colors border ${
            allSelected
              ? "bg-[#252525] text-[#e4e4e4] border-[#3c3c3c] shadow-sm"
              : "text-[#a0a0a0] hover:text-[#e4e4e4] hover:bg-[#1e1e1e] border-transparent"
          }`}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#1a1a1a] text-[#a0a0a0] shrink-0">
            <Layers3 className="h-3.5 w-3.5" strokeWidth={1.75} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium truncate">All agents</span>
            <span className="block text-[10px] text-[#6e6e6e] mt-0.5">
              Combined chat
            </span>
          </span>
        </button>
      )}

      {agents.map((agent) => {
        const isActive = multi
          ? chatFilterAgentId === agent.id
          : selectedAgentId === agent.id;
        const isTarget = selectedAgentId === agent.id;
        const status = statusByAgent[agent.id] || agent.status;
        const driver = participants.find((p) =>
          p.drivingAgentIds?.includes(agent.id),
        );

        return (
          <div
            key={agent.id}
            className={`group relative flex items-stretch gap-1 rounded-xl border transition-colors ${
              isActive
                ? "bg-[#252525] border-[#3c3c3c] shadow-sm"
                : "border-transparent hover:bg-[#1e1e1e]"
            } ${agent.status === "stopped" ? "opacity-50" : ""}`}
          >
            <button
              type="button"
              onClick={() => onSelectAgent(agent.id)}
              className="flex-1 flex items-start gap-2.5 px-2.5 py-2 min-w-0 text-left"
              title={
                isTarget
                  ? `Messaging ${agent.label}`
                  : `View ${agent.label} — click to focus`
              }
            >
              <span className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-[#1a1a1a] text-[#a0a0a0] shrink-0 mt-0.5">
                {agent.backend === "claude-code" ? (
                  <BrainCircuit className="h-3.5 w-3.5" strokeWidth={1.75} />
                ) : (
                  <Bot className="h-3.5 w-3.5" strokeWidth={1.75} />
                )}
                <span
                  className={`absolute -right-0.5 -top-0.5 w-1.5 h-1.5 rounded-full ring-1 ring-[#1a1a1a] ${statusDot(status)}`}
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span
                    className={`truncate text-[12px] font-medium ${
                      isActive ? "text-[#e4e4e4]" : "text-[#c8c8c8]"
                    }`}
                  >
                    {agent.label}
                  </span>
                  {isTarget && multi && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-[#17251f] text-[#3ecf8e] inline-flex items-center gap-1 shrink-0">
                      <Radio className="h-2.5 w-2.5" strokeWidth={2} />
                      active
                    </span>
                  )}
                  {isIntegratorAgent(agent) && (
                    <span
                      className="text-[9px] px-1.5 py-0.5 rounded-md bg-[#1d2418] text-[#a3e635] shrink-0"
                      title="Merges agent branches into the shared integration PR"
                    >
                      integrator
                    </span>
                  )}
                  {agent.planMode && (
                    <span
                      className="text-[9px] px-1.5 py-0.5 rounded-md bg-[#17202a] text-[#4d9fff] shrink-0"
                      title="Plan mode — explore & propose only"
                    >
                      plan
                    </span>
                  )}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 min-w-0 text-[10px] text-[#6e6e6e]">
                  <span className="uppercase tracking-wide shrink-0">
                    {agent.backend === "claude-code" ? "Claude" : "Cursor"}
                  </span>
                  <span className="text-[#3c3c3c]">·</span>
                  <span className="truncate" title={agent.modelId}>
                    {modelLabel(agent.modelId, models)}
                  </span>
                </span>
                {agent.scopePath && (
                  <span
                    className="mt-1 block truncate font-mono text-[10px] text-[#5a5a5a]"
                    title={agent.scopePath}
                  >
                    {agent.scopePath}
                  </span>
                )}
              </span>
              {driver && (
                <span
                  className="w-5 h-5 rounded-full text-[9px] flex items-center justify-center text-white shrink-0 mt-1"
                  style={{ backgroundColor: driver.color }}
                  title={`Driven by ${driver.name}`}
                >
                  {driver.name.slice(0, 1).toUpperCase()}
                </span>
              )}
            </button>
            {amHost &&
              agent.status !== "stopped" &&
              multi &&
              !isIntegratorAgent(agent) && (
              <button
                type="button"
                title="Stop agent"
                onClick={() => onStopAgent(agent.id)}
                className="opacity-0 group-hover:opacity-100 self-center mr-1.5 p-1.5 rounded-md text-[#6e6e6e] hover:text-[#f07070] hover:bg-[#1a1a1a]"
              >
                <CircleStop className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );

  const footer = amHost ? (
    <div className="shrink-0 border-t border-[#2b2b2b] p-2">
      <button
        type="button"
        onClick={onAddAgent}
        className="w-full inline-flex h-9 items-center justify-center gap-1.5 px-3 rounded-xl border border-dashed border-[#3c3c3c] text-[12px] text-[#8a8a8a] hover:text-[#e4e4e4] hover:bg-[#1e1e1e] transition-colors"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
        Add agent
      </button>
    </div>
  ) : null;

  const header = (
    <div
      className={`relative flex items-center gap-2 px-3 h-11 border-b border-[#2b2b2b] bg-[#171717] shrink-0 ${
        rail ? "border-b-0 flex-col h-auto py-3 px-2" : ""
      }`}
    >
      {mobile && (
        <div className="w-8 h-1 rounded-full bg-[#3c3c3c] absolute left-1/2 -translate-x-1/2 top-2" />
      )}
      {mobile ? (
        <div className="flex items-center gap-2 min-w-0 flex-1 pt-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#252525] text-[#a0a0a0]">
            <Bot className="h-3.5 w-3.5" strokeWidth={1.75} />
          </span>
          <span className="text-[12px] font-medium text-[#e4e4e4] truncate">
            Agents
          </span>
          <span className="text-[11px] text-[#6e6e6e] tabular-nums">
            {agents.length}
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={toggleCollapsed}
          className={`flex items-center gap-2 min-w-0 flex-1 text-left hover:opacity-90 transition-opacity ${
            rail ? "flex-col flex-none w-full justify-center gap-1.5" : ""
          }`}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand Agents" : "Collapse Agents"}
        >
          <span
            className="flex h-6 w-6 items-center justify-center rounded-md bg-[#252525] text-[#a0a0a0] shrink-0"
            aria-hidden
          >
            <Bot className="h-3.5 w-3.5" strokeWidth={1.75} />
          </span>
          <span
            className={`text-[12px] font-medium text-[#e4e4e4] ${
              rail ? "text-center leading-tight" : "truncate"
            }`}
            style={
              rail
                ? { writingMode: "vertical-rl", transform: "rotate(180deg)" }
                : undefined
            }
          >
            Agents
          </span>
          {!rail && (
            <span className="text-[11px] text-[#6e6e6e] tabular-nums">
              {agents.length}
            </span>
          )}
          {rail && agents.length > 0 && (
            <span className="text-[10px] text-[#6e6e6e] tabular-nums">
              {agents.length}
            </span>
          )}
        </button>
      )}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-7 items-center gap-1.5 px-2.5 rounded-lg text-[12px] text-[#a0a0a0] hover:text-[#e4e4e4] border border-[#2b2b2b] shrink-0"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.75} />
          Close
        </button>
      )}
    </div>
  );

  const body = (
    <>
      {header}
      {(mobile || !collapsed) && (
        <>
          {list}
          {footer}
        </>
      )}
      {rail && (
        <div className="flex-1 flex flex-col items-center gap-2 px-1 py-2 overflow-y-auto">
          {agents.map((agent) => {
            const isTarget = selectedAgentId === agent.id;
            const status = statusByAgent[agent.id] || agent.status;
            return (
              <button
                key={agent.id}
                type="button"
                onClick={() => {
                  onSelectAgent(agent.id);
                  if (collapsed) {
                    setCollapsed(false);
                    window.localStorage.setItem(COLLAPSED_KEY, "0");
                  }
                }}
                className={`relative flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
                  isTarget
                    ? "bg-[#252525] border-[#3c3c3c] text-[#e4e4e4]"
                    : "bg-[#1a1a1a] border-transparent text-[#a0a0a0] hover:text-[#e4e4e4]"
                }`}
                title={agent.label}
              >
                {agent.backend === "claude-code" ? (
                  <BrainCircuit className="h-3.5 w-3.5" strokeWidth={1.75} />
                ) : (
                  <Bot className="h-3.5 w-3.5" strokeWidth={1.75} />
                )}
                <span
                  className={`absolute right-0.5 top-0.5 w-1.5 h-1.5 rounded-full ${statusDot(status)}`}
                />
              </button>
            );
          })}
          {amHost && (
            <button
              type="button"
              onClick={onAddAgent}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-dashed border-[#3c3c3c] text-[#8a8a8a] hover:text-[#e4e4e4]"
              title="Add agent"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          )}
        </div>
      )}
    </>
  );

  if (mobile) {
    return (
      <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/60 backdrop-blur-sm">
        <button
          type="button"
          className="flex-1 w-full cursor-default"
          aria-label="Close agents"
          onClick={onClose}
        />
        <div className="relative h-[75vh] max-h-[85dvh] rounded-t-2xl border-t border-[#2b2b2b] bg-[#141414] flex flex-col overflow-hidden shadow-2xl pb-[env(safe-area-inset-bottom)]">
          {body}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`hidden lg:flex relative border-r border-[#2b2b2b] flex-col min-h-0 h-full overflow-hidden bg-[#131313] ${
        resizing ? "" : "transition-[width] duration-200"
      }`}
      style={{
        width: collapsed ? RAIL_WIDTH : width,
        minWidth: collapsed ? RAIL_WIDTH : MIN_WIDTH,
        maxWidth: collapsed ? RAIL_WIDTH : MAX_WIDTH,
      }}
    >
      {body}
      {!collapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize agents panel"
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          className={`absolute top-0 right-0 z-20 h-full w-1.5 cursor-col-resize touch-none group ${
            resizing ? "bg-[#4d9fff]/35" : "hover:bg-[#4d9fff]/25"
          }`}
        >
          <div className="absolute inset-y-0 -right-1 w-3" />
        </div>
      )}
    </div>
  );
}
