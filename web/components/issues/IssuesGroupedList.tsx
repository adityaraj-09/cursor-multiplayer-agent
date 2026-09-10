"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronDown, Circle, GitPullRequest, XCircle } from "lucide-react";
import {
  issueStatusLabel,
  type IssueInfo,
  type IssuePriority,
  type IssueStatus,
} from "../../../shared/issues";

export type IssueListItem = {
  id: string;
  href?: string;
  identifier: string;
  title: string;
  status: IssueStatus;
  priority: IssuePriority;
  repo?: string;
  prLabel?: string;
  labels?: string[];
  assignee?: string;
  date?: string;
};

const GROUP_ORDER: IssueStatus[] = [
  "in_review",
  "running",
  "needs_input",
  "queued",
  "draft",
  "failed",
  "cancelled",
  "done",
];

function repoLabel(url: string): string {
  return url.replace(/^https:\/\/github\.com\//i, "");
}

function prLabel(url?: string | null): string | undefined {
  const match = url?.match(/\/pull\/(\d+)/);
  return match ? `#${match[1]}` : undefined;
}

function shortId(id: string): string {
  const tail = id.replace(/[^a-zA-Z0-9]/g, "").slice(-4).toUpperCase();
  return tail ? `STE-${tail}` : "STE-0000";
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function issueInfoToRow(issue: IssueInfo): IssueListItem {
  return {
    id: issue.id,
    href: `/issues/${issue.id}`,
    identifier: shortId(issue.id),
    title: issue.title,
    status: issue.status,
    priority: issue.priority,
    repo: repoLabel(issue.repoUrl),
    prLabel: prLabel(issue.prUrl),
    labels: issue.status === "running" ? ["Working…"] : undefined,
    assignee: issue.creatorName || undefined,
    date: formatDate(issue.updatedAt || issue.createdAt),
  };
}

export default function IssuesGroupedList({
  items,
  selectedId,
  onSelect,
  hideTags = false,
  initiallyCollapsed = ["done", "cancelled"],
}: {
  items: IssueListItem[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  hideTags?: boolean;
  initiallyCollapsed?: IssueStatus[];
}) {
  const grouped = useMemo(() => {
    const map = new Map<IssueStatus, IssueListItem[]>();
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
              <span className="font-medium">{issueStatusLabel(group.status)}</span>
              <span className="text-[#6e6e6e]">{group.items.length}</span>
            </button>
            {open && (
              <ul>
                {group.items.map((item) => (
                  <IssueRow
                    key={item.id}
                    item={item}
                    selected={item.id === selectedId}
                    onSelect={onSelect}
                    hideTags={hideTags}
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

function IssueRow({
  item,
  selected,
  onSelect,
  hideTags,
}: {
  item: IssueListItem;
  selected?: boolean;
  onSelect?: (id: string) => void;
  hideTags?: boolean;
}) {
  const className = `group flex w-full items-center gap-2.5 px-3 h-9 text-left text-[13px] transition-colors ${
    selected ? "bg-[#1e1e1e]" : "hover:bg-[#181818]"
  }`;

  const body = (
    <>
      <PriorityBars priority={item.priority} />
      <StatusGlyph status={item.status} />
      <span className="min-w-0 flex-1 truncate text-[#e4e4e4]">{item.title}</span>
      <span className="hidden items-center gap-2 shrink-0 text-[12px] text-[#6e6e6e] sm:flex">
        {item.prLabel && (
          <span className="inline-flex items-center gap-1">
            <GitPullRequest className="h-3 w-3 text-[#5a5a5a]" strokeWidth={1.75} />
            {item.prLabel}
          </span>
        )}
        {!hideTags && item.repo && (
          <LabelChip>{item.repo.split("/")[1] || item.repo}</LabelChip>
        )}
        {!hideTags &&
          (item.labels || []).map((label) => (
            <LabelChip key={label}>{label}</LabelChip>
          ))}
        {item.date && <span className="w-12 text-right">{item.date}</span>}
        {item.assignee && (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#252525] text-[9px] text-[#e4e4e4]">
            {item.assignee.slice(0, 1).toUpperCase()}
          </span>
        )}
      </span>
    </>
  );

  if (item.href && !onSelect) {
    return (
      <li>
        <Link href={item.href} className={className}>
          {body}
        </Link>
      </li>
    );
  }

  return (
    <li>
      <button type="button" onClick={() => onSelect?.(item.id)} className={className}>
        {body}
      </button>
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

function PriorityBars({ priority }: { priority: IssuePriority }) {
  const filled =
    priority === "urgent" ? 3 : priority === "high" ? 3 : priority === "medium" ? 2 : 1;
  const color =
    priority === "urgent"
      ? "bg-[#f07070]"
      : priority === "high"
        ? "bg-[#e6c07b]"
        : "bg-[#6e6e6e]";
  return (
    <span className="flex h-3.5 w-3 shrink-0 items-end justify-between" aria-label={priority}>
      {[1, 2, 3].map((n) => (
        <span
          key={n}
          className={`w-[2px] rounded-sm ${n <= filled ? color : "bg-[#2b2b2b]"}`}
          style={{ height: `${6 + n * 3}px` }}
        />
      ))}
    </span>
  );
}

function StatusGlyph({ status }: { status: IssueStatus }) {
  if (status === "in_review" || status === "done") {
    return (
      <CheckCircle2
        className={`h-3.5 w-3.5 shrink-0 ${
          status === "done" ? "text-[#6e6e6e]" : "text-[#3ecf8e]"
        }`}
        strokeWidth={1.75}
      />
    );
  }
  if (status === "failed" || status === "cancelled") {
    return <XCircle className="h-3.5 w-3.5 shrink-0 text-[#f07070]" strokeWidth={1.75} />;
  }
  if (status === "running" || status === "needs_input") {
    return (
      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        <span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-[#e6c07b] border-r-transparent" />
      </span>
    );
  }
  return <Circle className="h-3.5 w-3.5 shrink-0 text-[#5a5a5a]" strokeWidth={1.75} />;
}
