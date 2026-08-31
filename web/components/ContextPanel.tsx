"use client";

import { useMemo, useState } from "react";
import {
  Archive,
  BookOpen,
  Check,
  GitBranch,
  Pin,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import type {
  AgentContextReceiptInfo,
  MemoryEntryInfo,
  MemoryKind,
  RepoMapInfo,
  RoomContextSnapshot,
} from "../../shared/roomContext";
import {
  acceptRoomMemory,
  archiveRoomMemory,
  captureHandoffDraft,
  createRoomMemory,
  refreshRoomRepoMap,
  updateRoomMemory,
} from "../lib/api";

const KINDS: { id: MemoryKind; label: string }[] = [
  { id: "goal", label: "Goal" },
  { id: "decision", label: "Decision" },
  { id: "constraint", label: "Constraint" },
  { id: "discovery", label: "Discovery" },
  { id: "handoff", label: "Handoff" },
  { id: "feedback", label: "Feedback" },
];

interface ContextPanelProps {
  roomId: string;
  snapshot: RoomContextSnapshot | null;
  canEdit: boolean;
  selectedAgentId: string | null;
  selectedAgentLabel?: string;
  agentIdle?: boolean;
  stale?: { agentId: string; usedVersion: number; currentVersion: number } | null;
  mobile?: boolean;
  onClose?: () => void;
}

export default function ContextPanel({
  roomId,
  snapshot,
  canEdit,
  selectedAgentId,
  selectedAgentLabel,
  agentIdle = false,
  stale,
  mobile = false,
  onClose,
}: ContextPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [kind, setKind] = useState<MemoryKind>("goal");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");

  const entries = snapshot?.entries ?? [];
  const proposed = entries.filter((e) => e.status === "proposed");
  const active = entries.filter((e) => e.status === "active");
  const receipt: AgentContextReceiptInfo | null = selectedAgentId
    ? snapshot?.lastReceiptByAgent[selectedAgentId] ?? null
    : null;
  const map: RepoMapInfo | null = snapshot?.map ?? null;

  const grouped = useMemo(() => {
    const byKind: Record<MemoryKind, MemoryEntryInfo[]> = {
      goal: [],
      decision: [],
      constraint: [],
      discovery: [],
      handoff: [],
      feedback: [],
    };
    for (const e of active) byKind[e.kind]?.push(e);
    return byKind;
  }, [active]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy("");
    }
  };

  const handleCreate = () =>
    run("create", async () => {
      await createRoomMemory(roomId, { kind, title, content });
      setTitle("");
      setContent("");
    });

  const rail = collapsed && !mobile;
  const showContent = mobile || !collapsed;

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
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#252525] text-[#a0a0a0]">
            <BookOpen className="h-3.5 w-3.5" strokeWidth={1.75} />
          </span>
          <span className="text-[12px] font-medium text-[#e4e4e4] truncate">
            Memory
          </span>
          <span className="text-[11px] text-[#6e6e6e] tabular-nums">
            v{snapshot?.memoryVersion ?? 0}
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className={`flex items-center gap-2 min-w-0 flex-1 text-left hover:opacity-90 transition-opacity ${
            rail ? "flex-col flex-none w-full justify-center gap-1.5" : ""
          }`}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand Memory" : "Collapse Memory"}
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#252525] text-[#a0a0a0] shrink-0">
            <BookOpen className="h-3.5 w-3.5" strokeWidth={1.75} />
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
            Memory
          </span>
          {!rail && (
            <span className="text-[11px] text-[#6e6e6e] tabular-nums">
              v{snapshot?.memoryVersion ?? 0}
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

  const contentEl = showContent && (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
      {error && <p className="text-[12px] text-[#f07070]">{error}</p>}

      <div className="rounded-xl border border-[#2b2b2b] bg-[#181818] p-3 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-[#e4e4e4]">
            <GitBranch className="h-3.5 w-3.5 text-[#a0a0a0]" strokeWidth={1.75} />
            Repo map
          </div>
          {canEdit && (
            <button
              type="button"
              disabled={busy === "scan"}
              onClick={() => run("scan", async () => { await refreshRoomRepoMap(roomId); })}
              className="inline-flex items-center gap-1 text-[11px] text-[#a0a0a0] hover:text-[#e4e4e4] disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${busy === "scan" ? "animate-spin" : ""}`} />
              Refresh
            </button>
          )}
        </div>
        {map?.status === "ready" ? (
          <p className="text-[11px] text-[#8a8a8a]">
            {map.fileCount} files · {map.symbolCount} symbols ·{" "}
            {map.gitSha ? map.gitSha.slice(0, 8) : "no sha"}
          </p>
        ) : (
          <p className="text-[11px] text-[#6e6e6e]">
            {map?.status === "error"
              ? map.error || "Scan failed"
              : "Not scanned yet — refresh or send a first message"}
          </p>
        )}
        {receipt && (
          <p className="text-[11px] text-[#6e6e6e]">
            Last briefing: v{receipt.memoryVersion}
            {receipt.isBaseline ? " · baseline" : ""} · {receipt.entryIds.length}{" "}
            memories · {receipt.fileIds.length} files
          </p>
        )}
        {stale && selectedAgentId && stale.agentId === selectedAgentId && (
          <p className="text-[11px] text-[#e8a23a]">
            This agent finished on memory v{stale.usedVersion}; room is now v
            {stale.currentVersion}.
          </p>
        )}
      </div>

      {canEdit && selectedAgentId && agentIdle && (
        <button
          type="button"
          disabled={busy === "handoff"}
          onClick={() =>
            run("handoff", async () => {
              await captureHandoffDraft(roomId, selectedAgentId);
            })
          }
          className="w-full h-8 rounded-md border border-[#2b2b2b] bg-[#1f1f1f] text-[12px] text-[#e4e4e4] hover:border-[#3c3c3c] disabled:opacity-50"
        >
          Capture handoff{selectedAgentLabel ? ` from ${selectedAgentLabel}` : ""}
        </button>
      )}

      {proposed.length > 0 && (
        <section>
          <h3 className="text-[11px] uppercase tracking-wide text-[#6e6e6e] mb-1.5">
            Proposed
          </h3>
          <div className="space-y-2">
            {proposed.map((e) => (
              <article
                key={e.id}
                className="rounded-lg border border-[#3c3220] bg-[#1a1610] p-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[12px] text-[#e4e4e4] font-medium">
                      {e.title}
                    </p>
                    <p className="text-[10px] text-[#8a8a8a] mt-0.5">
                      {e.kind} · r{e.revision}
                      {e.createdByAgentId ? " · from agent" : ""}
                    </p>
                  </div>
                  {canEdit && (
                    <div className="flex gap-1 shrink-0">
                      <button
                        type="button"
                        title="Accept"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          run(`accept-${e.id}`, async () => {
                            await acceptRoomMemory(roomId, e.id, e.revision);
                          })
                        }
                        className="h-6 w-6 inline-flex items-center justify-center rounded text-[#3ecf8e] hover:bg-[#17251f]"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Archive"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          run(`archive-${e.id}`, async () => {
                            await archiveRoomMemory(roomId, e.id, e.revision);
                          })
                        }
                        className="h-6 w-6 inline-flex items-center justify-center rounded text-[#a0a0a0] hover:bg-[#252525]"
                      >
                        <Archive className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
                <p className="mt-1.5 text-[12px] text-[#c8c8c8] whitespace-pre-wrap">
                  {e.content}
                </p>
              </article>
            ))}
          </div>
        </section>
      )}

      {KINDS.map(({ id, label }) => {
        const list = grouped[id];
        if (!list.length) return null;
        return (
          <section key={id}>
            <h3 className="text-[11px] uppercase tracking-wide text-[#6e6e6e] mb-1.5">
              {label}s
            </h3>
            <div className="space-y-2">
              {list.map((e) => (
                <article
                  key={e.id}
                  className="rounded-lg border border-[#2b2b2b] bg-[#181818] p-2.5"
                >
                  {editingId === e.id ? (
                    <>
                      <input
                        value={editTitle}
                        onChange={(ev) => setEditTitle(ev.target.value)}
                        className="w-full h-7 mb-1.5 px-2 rounded bg-[#252525] border border-[#2b2b2b] text-[12px] text-[#e4e4e4] outline-none"
                      />
                      <textarea
                        value={editContent}
                        onChange={(ev) => setEditContent(ev.target.value)}
                        rows={3}
                        className="w-full mb-1.5 px-2 py-1 rounded bg-[#252525] border border-[#2b2b2b] text-[12px] text-[#e4e4e4] outline-none resize-y"
                      />
                      <div className="flex gap-1 justify-end">
                        <button
                          type="button"
                          className="h-6 px-2 text-[11px] text-[#a0a0a0]"
                          onClick={() => setEditingId(null)}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={busy === `edit-${e.id}`}
                          onClick={() =>
                            run(`edit-${e.id}`, async () => {
                              await updateRoomMemory(roomId, e.id, {
                                expectedRevision: e.revision,
                                title: editTitle,
                                content: editContent,
                              });
                              setEditingId(null);
                            })
                          }
                          className="h-6 px-2 rounded bg-[#e4e4e4] text-[#141414] text-[11px] font-medium"
                        >
                          Save
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[12px] text-[#e4e4e4] font-medium">
                          {e.pinned ? "Pinned · " : ""}
                          {e.title}
                          {e.source === "auto" && (
                            <span className="ml-1.5 inline-flex items-center rounded px-1 py-px text-[9px] uppercase tracking-wide bg-[#252525] text-[#8ec5ff] border border-[#2a3a4a] align-middle">
                              Auto
                            </span>
                          )}
                        </p>
                        {canEdit && (
                          <div className="flex gap-1 shrink-0">
                            <button
                              type="button"
                              title={e.pinned ? "Unpin" : "Pin"}
                              onClick={() =>
                                run(`pin-${e.id}`, async () => {
                                  await updateRoomMemory(roomId, e.id, {
                                    expectedRevision: e.revision,
                                    pinned: !e.pinned,
                                  });
                                })
                              }
                              className="h-6 w-6 inline-flex items-center justify-center rounded text-[#a0a0a0] hover:bg-[#252525]"
                            >
                              <Pin className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              className="h-6 px-1.5 text-[10px] text-[#a0a0a0] hover:text-[#e4e4e4]"
                              onClick={() => {
                                setEditingId(e.id);
                                setEditTitle(e.title);
                                setEditContent(e.content);
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              title="Archive"
                              onClick={() =>
                                run(`archive-${e.id}`, async () => {
                                  await archiveRoomMemory(roomId, e.id, e.revision);
                                })
                              }
                              className="h-6 w-6 inline-flex items-center justify-center rounded text-[#a0a0a0] hover:bg-[#252525]"
                            >
                              <Archive className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                      <p className="text-[10px] text-[#6e6e6e] mt-0.5">
                        r{e.revision}
                        {e.source === "auto" ? " · archive to undo" : ""}
                      </p>
                      <p className="mt-1.5 text-[12px] text-[#c8c8c8] whitespace-pre-wrap">
                        {e.content}
                      </p>
                    </>
                  )}
                </article>
              ))}
            </div>
          </section>
        );
      })}

      {canEdit && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleCreate();
          }}
          className="rounded-xl border border-[#2b2b2b] bg-[#181818] p-3 space-y-2"
        >
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-[#e4e4e4]">
            <Plus className="h-3.5 w-3.5" />
            Add memory
          </div>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as MemoryKind)}
            className="w-full h-8 px-2 rounded-md bg-[#252525] border border-[#2b2b2b] text-[12px] text-[#e4e4e4]"
          >
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className="w-full h-8 px-2 rounded-md bg-[#252525] border border-[#2b2b2b] text-[12px] text-[#e4e4e4] outline-none focus:border-[#4d9fff]"
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="What should the next agent know?"
            rows={3}
            className="w-full px-2 py-1.5 rounded-md bg-[#252525] border border-[#2b2b2b] text-[12px] text-[#e4e4e4] outline-none focus:border-[#4d9fff] resize-y"
          />
          <button
            type="submit"
            disabled={busy === "create" || !title.trim() || !content.trim()}
            className="h-8 px-3 rounded-md bg-[#e4e4e4] text-[#141414] text-[12px] font-medium disabled:opacity-50"
          >
            Save
          </button>
        </form>
      )}

      {!canEdit && !active.length && !proposed.length && (
        <p className="text-[12px] text-[#6e6e6e]">
          No shared memory yet. Editors can record goals, decisions, and
          handoffs here.
        </p>
      )}
    </div>
  );

  const body = (
    <>
      {header}
      {contentEl}
    </>
  );

  if (mobile) {
    return (
      <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/60">
        <div className="h-[80vh] rounded-t-2xl border-t border-[#2b2b2b] bg-[#141414] flex flex-col overflow-hidden">
          {body}
        </div>
      </div>
    );
  }

  return (
    <aside
      className={`hidden lg:flex flex-col border-l border-[#2b2b2b] bg-[#141414] shrink-0 ${
        rail ? "w-12" : "w-[300px] xl:w-[340px]"
      }`}
    >
      {body}
    </aside>
  );
}
