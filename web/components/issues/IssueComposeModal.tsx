"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ChevronDown,
  Circle,
  FileText,
  Flag,
  GitBranch,
  Paperclip,
  X,
} from "lucide-react";
import {
  createIssue,
  fetchIssueSettings,
  fetchWorkspaceGithub,
  fetchWorkspaceGithubRepos,
  type WorkspaceGithubInfo,
  type WorkspaceGithubRepo,
} from "../../lib/api";
import { workspaceCode } from "../../lib/useWorkspaceScope";
import { DEFAULT_PICKUP_DELAY_MS } from "../../../shared/issues";

type PickupMode = "queue" | "draft" | "now";

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export default function IssueComposeModal({
  orgId,
  workspaceName,
  onClose,
  onCreated,
}: {
  orgId?: string;
  workspaceName: string;
  onClose: () => void;
  onCreated: (issueId: string, createMore: boolean) => void;
}) {
  const titleRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [pickup, setPickup] = useState<PickupMode>("queue");
  const [createMore, setCreateMore] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [startingRef, setStartingRef] = useState("main");
  const [repos, setRepos] = useState<WorkspaceGithubRepo[]>([]);
  const [github, setGithub] = useState<WorkspaceGithubInfo | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<Record<string, string>>({});
  const [openMenu, setOpenMenu] = useState<"pickup" | "priority" | "repo" | null>(
    null,
  );
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [delayMs, setDelayMs] = useState(DEFAULT_PICKUP_DELAY_MS);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  useEffect(() => {
    const next: Record<string, string> = {};
    const urls: string[] = [];
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      const url = URL.createObjectURL(file);
      urls.push(url);
      next[key] = url;
    }
    setFilePreviews(next);
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [files]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    fetchIssueSettings({ orgId: orgId || "personal" })
      .then((settings) => {
        if (cancelled) return;
        setDelayMs(settings.defaultPickupDelayMs);
        setPickup(settings.autoStart ? "queue" : "draft");
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  useEffect(() => {
    let cancelled = false;
    fetchWorkspaceGithub({ orgId })
      .then((info) => {
        if (!cancelled) setGithub(info);
      })
      .catch(() => {
        if (!cancelled) setGithub(null);
      });
    fetchWorkspaceGithubRepos({ orgId })
      .then((list) => {
        if (cancelled) return;
        setRepos(list);
        if (list[0] && !repoUrl) {
          setRepoUrl(list[0].url);
          setStartingRef(list[0].defaultBranch || "main");
        }
      })
      .catch(() => {
        if (!cancelled) setRepos([]);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const selectedRepo = repos.find((repo) => repo.url === repoUrl) || null;
  const settingsHref = orgId
    ? `/settings?org=${encodeURIComponent(orgId)}`
    : "/settings";

  const pickupLabel =
    pickup === "now" ? "Run now" : pickup === "draft" ? "Draft" : "Todo";
  const priorityLabel =
    priority === "urgent"
      ? "Urgent"
      : priority === "high"
        ? "High"
        : priority === "low"
          ? "Low"
          : "Priority";

  const pickupDelayMs = useMemo(() => {
    if (pickup === "now") return 0;
    return delayMs;
  }, [pickup, delayMs]);

  const fileKey = (file: File) =>
    `${file.name}:${file.size}:${file.lastModified}`;

  const addFiles = (incoming: FileList | File[]) => {
    const list = Array.from(incoming);
    if (list.length === 0) return;
    setFiles((prev) => {
      const seen = new Set(prev.map(fileKey));
      const merged = [...prev];
      for (const file of list) {
        const key = fileKey(file);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(file);
        if (merged.length >= 8) break;
      }
      return merged.slice(0, 8);
    });
    if (fileRef.current) fileRef.current.value = "";
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    if (fileRef.current) fileRef.current.value = "";
  };

  const submit = async () => {
    setError("");
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    if (!repoUrl) {
      setError("Connect GitHub and choose a repository");
      return;
    }
    setCreating(true);
    try {
      const attachments = await Promise.all(
        files.slice(0, 8).map(async (file) => ({
          name: file.name,
          mime: file.type || undefined,
          data: await fileToBase64(file),
        })),
      );
      const issue = await createIssue({
        title: title.trim(),
        description,
        repoUrl,
        startingRef,
        priority,
        pickupDelayMs,
        autoStart: pickup !== "draft",
        orgId,
        attachments,
      });
      if (createMore) {
        setTitle("");
        setDescription("");
        setFiles([]);
        titleRef.current?.focus();
        onCreated(issue.id, true);
      } else {
        onCreated(issue.id, false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create issue");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-3 pt-[8vh] sm:pt-[12vh]">
      <button
        type="button"
        className="absolute inset-0 bg-black/65"
        aria-label="Close new issue"
        onClick={onClose}
      />
      <div className="relative w-full max-w-[720px] rounded-xl border border-[#2b2b2b] bg-[#1c1c1c] shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
        <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2">
          <div className="flex items-center gap-2 min-w-0 text-[13px]">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#3d2a2a] text-[10px] font-medium text-[#f07070]">
              {workspaceCode(workspaceName).slice(0, 1)}
            </span>
            <span className="text-[#a0a0a0] truncate">
              {workspaceCode(workspaceName)}
            </span>
            <span className="text-[#6e6e6e]">›</span>
            <span className="text-[#e4e4e4]">New issue</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#6e6e6e] hover:text-[#e4e4e4]"
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        <input
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Issue title"
          className="w-full bg-transparent px-4 pt-1 pb-2 text-[20px] font-medium text-[#e4e4e4] placeholder:text-[#6e6e6e] outline-none"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Add description..."
          rows={5}
          className="w-full resize-none bg-transparent px-4 pb-3 text-[14px] leading-6 text-[#e4e4e4] placeholder:text-[#6e6e6e] outline-none min-h-[120px]"
        />

        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3">
          <Chip
            open={openMenu === "pickup"}
            onToggle={() => setOpenMenu(openMenu === "pickup" ? null : "pickup")}
            icon={<Circle className="h-3 w-3" strokeWidth={1.75} />}
            label={pickupLabel}
          >
            <MenuButton
              active={pickup === "queue"}
              onClick={() => {
                setPickup("queue");
                setOpenMenu(null);
              }}
            >
              Todo · queue after delay
            </MenuButton>
            <MenuButton
              active={pickup === "draft"}
              onClick={() => {
                setPickup("draft");
                setOpenMenu(null);
              }}
            >
              Draft · do not queue
            </MenuButton>
            <MenuButton
              active={pickup === "now"}
              onClick={() => {
                setPickup("now");
                setOpenMenu(null);
              }}
            >
              Run now
            </MenuButton>
          </Chip>
          <Chip
            open={openMenu === "priority"}
            onToggle={() =>
              setOpenMenu(openMenu === "priority" ? null : "priority")
            }
            icon={<Flag className="h-3 w-3" strokeWidth={1.75} />}
            label={priorityLabel}
          >
            {(["low", "medium", "high", "urgent"] as const).map((value) => (
              <MenuButton
                key={value}
                active={priority === value}
                onClick={() => {
                  setPriority(value);
                  setOpenMenu(null);
                }}
              >
                {value[0].toUpperCase() + value.slice(1)}
              </MenuButton>
            ))}
          </Chip>
          <Chip
            open={openMenu === "repo"}
            onToggle={() => setOpenMenu(openMenu === "repo" ? null : "repo")}
            icon={<GitBranch className="h-3 w-3" strokeWidth={1.75} />}
            label={selectedRepo?.fullName || "Repository"}
          >
            {github && !github.connected ? (
              <div className="px-3 py-2 text-[12px] text-[#a0a0a0] max-w-[240px]">
                Connect GitHub in workspace settings to list repos.
                <Link
                  href={settingsHref}
                  className="mt-2 block text-[#4d9fff] hover:underline"
                >
                  Open settings
                </Link>
              </div>
            ) : repos.length === 0 ? (
              <p className="px-3 py-2 text-[12px] text-[#6e6e6e]">
                No repositories found
              </p>
            ) : (
              <div className="max-h-56 overflow-y-auto py-1">
                {repos.map((repo) => (
                  <MenuButton
                    key={repo.url}
                    active={repo.url === repoUrl}
                    onClick={() => {
                      setRepoUrl(repo.url);
                      setStartingRef(repo.defaultBranch || "main");
                      setOpenMenu(null);
                    }}
                  >
                    {repo.fullName}
                    {repo.private ? " · private" : ""}
                  </MenuButton>
                ))}
              </div>
            )}
          </Chip>
        </div>

        {error && (
          <p className="px-4 pb-2 text-[12px] text-[#f07070]">{error}</p>
        )}

        <div className="border-t border-[#2b2b2b] px-4 py-3">
          {files.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {files.map((file, index) => {
                const key = fileKey(file);
                const preview = filePreviews[key];
                return (
                  <div
                    key={key}
                    className="relative flex items-center gap-1.5 rounded-lg border border-[#2b2b2b] bg-[#151515] pl-1.5 pr-6 py-1 max-w-[200px]"
                  >
                    {preview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={preview}
                        alt=""
                        className="h-8 w-8 rounded object-cover"
                      />
                    ) : (
                      <FileText
                        className="h-4 w-4 shrink-0 text-[#a0a0a0]"
                        strokeWidth={1.75}
                      />
                    )}
                    <span className="min-w-0 truncate text-[11px] text-[#c8c8c8]">
                      {file.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFile(index)}
                      className="absolute right-1 top-1 h-4 w-4 rounded text-[#6e6e6e] hover:text-[#e4e4e4]"
                      aria-label={`Remove ${file.name}`}
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <input
                ref={fileRef}
                type="file"
                multiple
                accept="image/*,.pdf,.txt,.md,.json"
                className="hidden"
                onChange={(e) => addFiles(e.target.files || [])}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#6e6e6e] hover:text-[#e4e4e4]"
                aria-label="Attach files"
              >
                <Paperclip className="h-4 w-4" strokeWidth={1.75} />
              </button>
              {files.length > 0 && (
                <span className="text-[11px] text-[#6e6e6e] truncate">
                  {files.length}/8 attached
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-[12px] text-[#a0a0a0]">
                <span>Create more</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={createMore}
                  onClick={() => setCreateMore((v) => !v)}
                  className={`relative h-5 w-9 rounded-full transition-colors ${
                    createMore ? "bg-[#5e6ad2]" : "bg-[#3a3a3a]"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                      createMore ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </label>
              <button
                type="button"
                disabled={creating}
                onClick={() => void submit()}
                className="h-8 px-3 rounded-md bg-[#5e6ad2] text-white text-[13px] font-medium hover:bg-[#6b76db] disabled:opacity-50"
              >
                {creating ? "Creating…" : "Create issue"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Chip({
  open,
  onToggle,
  icon,
  label,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[#2b2b2b] bg-[#171717] px-2.5 text-[12px] text-[#a0a0a0] hover:text-[#e4e4e4]"
      >
        {icon}
        <span className="max-w-[160px] truncate">{label}</span>
        <ChevronDown className="h-3 w-3" strokeWidth={1.75} />
      </button>
      {open && (
        <div className="absolute left-0 top-8 z-10 min-w-[200px] rounded-lg border border-[#2b2b2b] bg-[#1a1a1a] py-1 shadow-xl">
          {children}
        </div>
      )}
    </div>
  );
}

function MenuButton({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full px-3 py-1.5 text-left text-[12px] ${
        active ? "bg-[#252525] text-[#e4e4e4]" : "text-[#a0a0a0] hover:bg-[#222]"
      }`}
    >
      {children}
    </button>
  );
}
