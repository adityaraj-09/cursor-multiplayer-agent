"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Archive, ChevronDown, Circle } from "lucide-react";
import type { RoomInfo } from "../../shared/events";

export type SessionListStatus = "active" | "stopped";

export type SessionListItem = {
  id: string;
  href: string;
  name: string;
  status: SessionListStatus;
  runtimeLabel: string;
  authLabel: string;
  modelId: string;
  target: string;
  orgName?: string;
  participantCount: number;
  date?: string;
  canArchive?: boolean;
};

const GROUP_ORDER: SessionListStatus[] = ["active", "stopped"];

function sessionStatusLabel(status: SessionListStatus): string {
  return status === "active" ? "Live" : "Stopped";
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function authLabel(authMode: RoomInfo["authMode"]): string {
  if (authMode === "cli") return "Local login";
  if (authMode === "byok") return "BYOK";
  return "Server key";
}

function targetLabel(room: RoomInfo): string {
  if (room.runtime === "cloud") {
    return (room.repoUrl || "").replace("https://github.com/", "") || "—";
  }
  return room.repoPath.replace(/^.*\/Projects\//, "~/Projects/") || "—";
}

export function roomInfoToRow(room: RoomInfo): SessionListItem {
  return {
    id: room.id,
    href: `/room/${room.id}`,
    name: room.name,
    status: room.status === "active" ? "active" : "stopped",
    runtimeLabel: room.runtime === "cloud" ? "Cloud" : "Local",
    authLabel: authLabel(room.authMode),
    modelId: room.modelId,
    target: targetLabel(room),
    orgName: room.orgName || undefined,
    participantCount: room.participantCount,
    date: formatDate(room.createdAt),
    canArchive: Boolean(room.myCanManage),
  };
}

export default function SessionsGroupedList({
  items,
  selectedIds,
  onToggleSelect,
  onArchive,
  initiallyCollapsed = ["stopped"],
}: {
  items: SessionListItem[];
  selectedIds?: string[];
  onToggleSelect?: (id: string) => void;
  onArchive?: (id: string) => Promise<void> | void;
  initiallyCollapsed?: SessionListStatus[];
}) {
  const grouped = useMemo(() => {
    const map = new Map<SessionListStatus, SessionListItem[]>();
    for (const status of GROUP_ORDER) map.set(status, []);
    for (const item of items) {
      const bucket = map.get(item.status);
      if (bucket) bucket.push(item);
      else map.set(item.status, [item]);
    }
    return GROUP_ORDER.filter((status) => (map.get(status) || []).length > 0).map(
      (status) => ({ status, items: map.get(status) || [] }),
    );
  }, [items]);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(initiallyCollapsed.map((status) => [status, true])),
  );

  if (items.length === 0) return null;

  return (
    <div className="min-w-0">
      {grouped.map((group) => {
        const open = !collapsed[group.status];
        return (
          <section key={group.status} className="border-b border-[#1f1f1f] last:border-b-0">
            <button
              type="button"
              onClick={() =>
                setCollapsed((prev) => ({
                  ...prev,
                  [group.status]: !prev[group.status],
                }))
              }
              className="flex h-9 w-full items-center gap-2 px-3 text-left text-[13px] text-[#c8c8c8] hover:bg-[#1a1a1a]"
            >
              <ChevronDown
                className={`h-3.5 w-3.5 text-[#6e6e6e] transition-transform ${
                  open ? "" : "rotate-[-90deg]"
                }`}
                strokeWidth={1.75}
              />
              <StatusGlyph status={group.status} />
              <span className="font-medium">{sessionStatusLabel(group.status)}</span>
              <span className="text-[#6e6e6e]">{group.items.length}</span>
            </button>
            {open && (
              <ul>
                {group.items.map((item) => (
                  <SessionRow
                    key={item.id}
                    item={item}
                    selected={selectedIds?.includes(item.id)}
                    onToggleSelect={onToggleSelect}
                    onArchive={onArchive}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function SessionRow({
  item,
  selected,
  onToggleSelect,
  onArchive,
}: {
  item: SessionListItem;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  onArchive?: (id: string) => Promise<void> | void;
}) {
  const [archiving, setArchiving] = useState(false);
  const className = `group flex w-full items-center gap-2.5 px-3 h-9 text-left text-[13px] transition-colors ${
    selected ? "bg-[#1e1e1e]" : "hover:bg-[#181818]"
  }`;

  const handleArchive = async () => {
    if (!onArchive || archiving || !item.canArchive) return;
    const ok = window.confirm(
      `Archive “${item.name}”?\n\nIt will be stopped if still live and removed from your sessions list.`,
    );
    if (!ok) return;
    setArchiving(true);
    try {
      await onArchive(item.id);
    } finally {
      setArchiving(false);
    }
  };

  return (
    <li className={className}>
      {onToggleSelect && (
        <input
          type="checkbox"
          checked={Boolean(selected)}
          onChange={() => onToggleSelect(item.id)}
          className="h-3.5 w-3.5 accent-[#4d9fff] shrink-0"
          aria-label={`Select ${item.name} for the board`}
        />
      )}
      <StatusGlyph status={item.status} />
      <Link
        href={item.href}
        className="min-w-0 flex-1 truncate text-[#e4e4e4] hover:text-white"
      >
        {item.name}
      </Link>
      <span className="hidden items-center gap-2 shrink-0 text-[12px] text-[#6e6e6e] sm:flex">
        <LabelChip>{item.runtimeLabel}</LabelChip>
        <LabelChip>{item.authLabel}</LabelChip>
        <LabelChip>{item.modelId}</LabelChip>
        {item.orgName && <LabelChip>{item.orgName}</LabelChip>}
        <span className="max-w-[160px] truncate font-mono text-[11px]">
          {item.target}
        </span>
        <span className="w-14 text-right">
          {item.participantCount > 0
            ? `${item.participantCount} online`
            : "Empty"}
        </span>
        {item.date && <span className="w-12 text-right">{item.date}</span>}
      </span>
      {item.canArchive && onArchive && (
        <button
          type="button"
          onClick={() => void handleArchive()}
          disabled={archiving}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-[#6e6e6e] hover:text-[#e4e4e4] hover:border-[#2b2b2b] hover:bg-[#141414] disabled:opacity-50 shrink-0"
          title="Archive session"
          aria-label={`Archive ${item.name}`}
        >
          <Archive className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      )}
    </li>
  );
}

function LabelChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-5 items-center rounded-full border border-[#2b2b2b] px-1.5 text-[11px] text-[#a0a0a0]">
      {children}
    </span>
  );
}

function StatusGlyph({ status }: { status: SessionListStatus }) {
  if (status === "active") {
    return (
      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center" aria-hidden>
        <span className="h-2 w-2 rounded-full bg-[#3ecf8e]" />
      </span>
    );
  }
  return <Circle className="h-3.5 w-3.5 shrink-0 text-[#5a5a5a]" strokeWidth={1.75} />;
}
