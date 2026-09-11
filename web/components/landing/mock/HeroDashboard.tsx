"use client";

import { useMemo, useState } from "react";
import { Archive, LayoutGrid, LayoutList } from "lucide-react";
import ProductChrome, { MockPageHeader } from "./ProductChrome";
import IssuesGroupedList from "../../issues/IssuesGroupedList";
import SessionsGroupedList, {
  type SessionListItem,
} from "../../SessionsGroupedList";
import Markdown from "../../Markdown";
import BoardShowcase from "./BoardShowcase";
import SessionRoomView from "./SessionRoomView";
import {
  DEMO_ISSUES,
  DEMO_SESSIONS,
  issueStatusLabel,
  issueStatusTone,
  type DemoView,
} from "./demo-data";

export function IssuesShowcase() {
  return (
    <div className="flex h-[min(640px,75vh)] min-h-0 overflow-hidden rounded-[18px] border border-[#2b2b2b] bg-[#141414] text-[#e4e4e4] shadow-[0_40px_120px_rgba(0,0,0,0.55)]">
      <IssuesPane />
    </div>
  );
}

export default function HeroDashboard({
  initialView = "issues",
}: {
  initialView?: DemoView;
}) {
  const [view, setView] = useState<DemoView>(initialView);
  const [selected, setSelected] = useState<string[]>([]);

  return (
    <ProductChrome view={view} onView={setView}>
      {view === "sessions" && (
        <SessionsPane selected={selected} onToggle={setSelected} />
      )}
      {view === "issues" && <IssuesPane />}
      {view === "board" && <BoardShowcase />}
    </ProductChrome>
  );
}

function demoSessionRows(): SessionListItem[] {
  return DEMO_SESSIONS.map((room) => ({
    id: room.id,
    href: `#${room.id}`,
    name: room.name,
    status: room.status === "active" ? "active" : "stopped",
    runtimeLabel: room.runtime === "cloud" ? "Cloud" : "Local",
    authLabel: room.auth,
    modelId: room.model,
    target: room.target,
    participantCount: room.people,
    date: room.ago.replace(" ago", ""),
    canArchive: true,
  }));
}

function SessionsPane({
  selected,
  onToggle,
}: {
  selected: string[];
  onToggle: (next: string[]) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const rows = useMemo(() => demoSessionRows(), []);

  if (openId) {
    return <SessionRoomView roomId={openId} onBack={() => setOpenId(null)} />;
  }

  return (
    <>
      <MockPageHeader
        kicker="Kinetic"
        title="Sessions"
        meta={`${DEMO_SESSIONS.length} sessions · ${DEMO_SESSIONS.filter((room) => room.status === "active").length} live`}
        action="New session"
      />
      <div className="flex items-center justify-end gap-2 px-4 pb-2 sm:px-5">
        <div
          className="inline-flex h-8 items-center rounded-md border border-[#2b2b2b] bg-[#1a1a1a] p-0.5"
          role="group"
          aria-label="Session view"
        >
          <button
            type="button"
            onClick={() => setViewMode("list")}
            className={`inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2 text-[11px] transition-colors ${
              viewMode === "list"
                ? "bg-[#252525] text-[#e4e4e4]"
                : "text-[#6e6e6e] hover:text-[#e4e4e4]"
            }`}
            aria-pressed={viewMode === "list"}
          >
            <LayoutList className="h-3.5 w-3.5" strokeWidth={1.75} />
            List
          </button>
          <button
            type="button"
            onClick={() => setViewMode("grid")}
            className={`inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2 text-[11px] transition-colors ${
              viewMode === "grid"
                ? "bg-[#252525] text-[#e4e4e4]"
                : "text-[#6e6e6e] hover:text-[#e4e4e4]"
            }`}
            aria-pressed={viewMode === "grid"}
          >
            <LayoutGrid className="h-3.5 w-3.5" strokeWidth={1.75} />
            Grid
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 pb-4 sm:px-5">
        {viewMode === "list" ? (
          <div className="overflow-hidden rounded-lg border border-[#2b2b2b] bg-[#141414]">
            <SessionsGroupedList
              items={rows}
              selectedIds={selected}
              onToggleSelect={(id) =>
                onToggle(
                  selected.includes(id)
                    ? selected.filter((item) => item !== id)
                    : [...selected, id],
                )
              }
              onSelect={setOpenId}
              initiallyCollapsed={[]}
            />
          </div>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {DEMO_SESSIONS.map((room) => {
              const isOn = selected.includes(room.id);
              return (
                <div
                  key={room.id}
                  className={`rounded-xl border p-3.5 text-left transition-colors ${
                    isOn
                      ? "border-[#26405d] bg-[#17202a] shadow-[0_0_0_1px_rgba(38,64,93,0.55)]"
                      : "border-[#2b2b2b] bg-[#1a1a1a] hover:border-[#3c3c3c]"
                  }`}
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={isOn}
                        onChange={() =>
                          onToggle(
                            isOn
                              ? selected.filter((id) => id !== room.id)
                              : [...selected, room.id],
                          )
                        }
                        onClick={(event) => event.stopPropagation()}
                        className="h-3.5 w-3.5 accent-[#4d9fff]"
                        aria-label={`Select ${room.name} for the board`}
                      />
                      <button
                        type="button"
                        onClick={() => setOpenId(room.id)}
                        className="truncate text-[13px] font-medium text-[#e4e4e4] hover:text-white"
                      >
                        {room.name}
                      </button>
                    </div>
                    <span
                      className={`flex items-center gap-1 text-[11px] ${
                        room.status === "active" ? "text-[#3ecf8e]" : "text-[#6e6e6e]"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          room.status === "active" ? "bg-[#3ecf8e]" : "bg-[#6e6e6e]"
                        }`}
                      />
                      {room.status === "active" ? "Live" : "Idle"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpenId(room.id)}
                    className="w-full text-left"
                  >
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      <span className="rounded border border-[#2b2b2b] bg-[#252525] px-1.5 py-0.5 text-[10px] text-[#a0a0a0]">
                        {room.runtime === "cloud" ? "Cloud" : "Local"}
                      </span>
                      <span className="rounded border border-[#2b2b2b] bg-[#252525] px-1.5 py-0.5 text-[10px] text-[#a0a0a0]">
                        {room.auth}
                      </span>
                      <span className="rounded border border-[#2b2b2b] bg-[#252525] px-1.5 py-0.5 text-[10px] text-[#a0a0a0]">
                        {room.model}
                      </span>
                    </div>
                    <p className="mb-2 truncate font-mono text-[12px] text-[#6e6e6e]">
                      {room.target}
                    </p>
                    <p className="text-[11px] text-[#6e6e6e]">
                      {room.people} online · {room.ago}
                    </p>
                    <span className="mt-2 inline-flex items-center gap-1 text-[10px] text-[#6e6e6e]">
                      <Archive className="h-3 w-3" />
                      Archive
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {selected.length > 0 && (
          <div className="sticky bottom-1 mt-3 flex items-center justify-between gap-3 rounded-lg border border-[#26405d] bg-[#17202a] px-3 py-2">
            <p className="text-[12px] text-[#8ec5ff]">
              {selected.length} selected for the board
            </p>
            <span className="h-7 rounded-md bg-[#e4e4e4] px-2.5 text-[11px] font-medium leading-7 text-[#141414]">
              Open board
            </span>
          </div>
        )}
      </div>
    </>
  );
}

export function IssuesPane() {
  const [issueId, setIssueId] = useState<string | null>(null);

  if (issueId) {
    return <IssueDetail issueId={issueId} onBack={() => setIssueId(null)} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 pt-4 pb-2 sm:px-4">
        <p className="text-[11px] uppercase tracking-wide text-[#6e6e6e]">Kinetic</p>
        <div className="mt-1 flex items-center justify-between">
          <h3 className="text-[16px] font-medium text-[#e4e4e4]">Issues</h3>
          <span className="h-7 rounded-md bg-[#e4e4e4] px-2.5 text-[11px] font-medium leading-7 text-[#141414]">
            New issue
          </span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <IssuesGroupedList items={DEMO_ISSUES} onSelect={setIssueId} hideTags />
      </div>
    </div>
  );
}

export function IssueDetail({
  issueId,
  onBack,
}: {
  issueId: string;
  onBack?: () => void;
}) {
  const issue = DEMO_ISSUES.find((item) => item.id === issueId) ?? DEMO_ISSUES[0];
  return (
    <div className="min-h-0 w-full flex-1 overflow-auto px-4 py-4">
      <button
        type="button"
        onClick={onBack}
        className="text-[11px] text-[#6e6e6e] hover:text-[#e4e4e4]"
      >
        ← Issues
      </button>
      <div className="mt-2 flex items-start justify-between gap-2">
        <h4 className="text-[15px] font-medium leading-5 text-[#e4e4e4]">
          {issue.title}
        </h4>
        <span
          className={`inline-flex h-5 shrink-0 items-center rounded border px-1.5 text-[10px] ${issueStatusTone(issue.status)}`}
        >
          {issueStatusLabel(issue.status)}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-[#6e6e6e]">
        {issue.repo} · {issue.ref} · {issue.priority}
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {issue.status === "queued" && (
          <span className="h-7 rounded-md border border-[#2b2b2b] px-2 text-[11px] leading-7 text-[#e4e4e4]">
            Run now
          </span>
        )}
        {issue.status === "in_review" && (
          <span className="h-7 rounded-md border border-[#2b2b2b] px-2 text-[11px] leading-7 text-[#3ecf8e]">
            Mark done
          </span>
        )}
        {issue.status === "failed" && (
          <span className="h-7 rounded-md border border-[#2b2b2b] px-2 text-[11px] leading-7 text-[#e4e4e4]">
            Retry
          </span>
        )}
      </div>
      {issue.status === "queued" && (
        <p className="mt-2 text-[11px] text-[#e6c07b]">{issue.pickup}</p>
      )}
      {issue.prUrl && (
        <span className="mt-3 inline-flex h-8 items-center rounded-md border border-[#26405d] bg-[#17202a] px-2.5 text-[12px] text-[#8ec5ff]">
          Open pull request
        </span>
      )}
      <div className="mt-4 rounded-xl border border-[#2b2b2b] bg-[#1a1a1a] p-3">
        <p className="mb-1 text-[11px] text-[#6e6e6e]">Description</p>
        <p className="text-[12px] leading-5 text-[#d0d0d0]">{issue.description}</p>
      </div>
      <div className="mt-2 rounded-xl border border-[#2b2b2b] bg-[#1a1a1a] p-3">
        <p className="mb-1 text-[11px] text-[#6e6e6e]">
          Writeup · {issue.agent} · not in git
        </p>
        {issue.writeup ? (
          <div className="text-[12px] leading-5 text-[#d8d8d8]">
            <Markdown content={issue.writeup} />
          </div>
        ) : (
          <p className="text-[12px] leading-5 text-[#6e6e6e]">
            {issue.status === "running" || issue.status === "queued"
              ? "The agent will save a cause / fix / verify note here after the PR — not in the repo."
              : "No writeup yet."}
          </p>
        )}
      </div>
      <div className="mt-3">
        <p className="mb-1.5 text-[11px] text-[#6e6e6e]">Activity</p>
        <ol className="space-y-1.5">
          {issue.events.map((event) => (
            <li key={`${event.time}-${event.kind}`} className="text-[11px] text-[#a0a0a0]">
              <span className="text-[#6e6e6e]">{event.time}</span>
              {" · "}
              {event.kind}
              {" — "}
              {event.message}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

