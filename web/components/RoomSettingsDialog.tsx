"use client";

import { useEffect, useState } from "react";
import {
  Bell,
  BookOpen,
  Bot,
  Cloud,
  Download,
  Eye,
  GitCompare,
  Link2,
  Radio,
  Settings2,
  Share2,
  StopCircle,
  Users,
} from "lucide-react";
import type {
  AgentInfo,
  AgentRunStatus,
  ApprovalMode,
  ControlMode,
} from "../../shared/events";
import SplitAgentPicker from "./SplitAgentPicker";
import type { AutoMemoryMode } from "../../shared/roomContext";
import {
  approvalModeDescription,
  approvalModeLabel,
} from "../../shared/approvals";
import {
  controlModeDescription,
  controlModeLabel,
  roomRoleLabel,
  type RoomRole,
} from "../../shared/roomPermissions";

export default function RoomSettingsDialog({
  open,
  onClose,
  roomName,
  roomId,
  myRole,
  controlMode,
  approvalMode,
  autoMemory,
  canManage,
  amHost,
  selectedAgent,
  slackConfigured,
  runtime,
  planModeBusy,
  savingControlMode,
  savingApprovalMode,
  savingAutoMemory,
  exporting,
  stopping,
  onControlModeChange,
  onApprovalModeChange,
  onAutoMemoryChange,
  onTogglePlanMode,
  onOpenSlack,
  onOpenInvites,
  onExport,
  onStopSession,
  onLeave,
  onOpenMemory,
  onOpenChanges,
  onOpenMembers,
  onOpenFlag,
  onOpenAgents,
  splitAvailable,
  broadcastEnabled,
  onBroadcastEnabledChange,
  splitAgents,
  visibleAgentIds,
  statusByAgent,
  onShowSplitAgent,
  onHideSplitAgent,
  onFocusSplitAgent,
}: {
  open: boolean;
  onClose: () => void;
  roomName: string;
  roomId: string;
  myRole: RoomRole;
  controlMode: ControlMode;
  approvalMode: ApprovalMode;
  autoMemory: AutoMemoryMode;
  canManage: boolean;
  amHost: boolean;
  selectedAgent: AgentInfo | null;
  slackConfigured: boolean;
  runtime: "local" | "cloud";
  planModeBusy: boolean;
  savingControlMode: boolean;
  savingApprovalMode: boolean;
  savingAutoMemory: boolean;
  exporting: boolean;
  stopping: boolean;
  onControlModeChange: (mode: ControlMode) => void;
  onApprovalModeChange: (mode: ApprovalMode) => void;
  onAutoMemoryChange: (mode: AutoMemoryMode) => void;
  onTogglePlanMode: () => void;
  onOpenSlack: () => void;
  onOpenInvites: () => void;
  onExport: () => void;
  onStopSession: () => void;
  onLeave: () => void;
  onOpenMemory?: () => void;
  onOpenChanges?: () => void;
  onOpenMembers?: () => void;
  onOpenFlag?: () => void;
  onOpenAgents?: () => void;
  splitAvailable?: boolean;
  broadcastEnabled?: boolean;
  onBroadcastEnabledChange?: (enabled: boolean) => void;
  splitAgents?: AgentInfo[];
  visibleAgentIds?: string[];
  statusByAgent?: Record<string, AgentRunStatus>;
  onShowSplitAgent?: (id: string) => void;
  onHideSplitAgent?: (id: string) => void;
  onFocusSplitAgent?: (id: string) => void;
}) {
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCopiedLink(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const sessionUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/room/${roomId}`
      : `/room/${roomId}`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(sessionUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 1500);
    } catch {
      window.prompt("Copy this session link:", sessionUrl);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/55 px-0 sm:px-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full sm:max-w-lg bg-[#1a1a1a] border border-[#2b2b2b] sm:rounded-lg rounded-t-lg shadow-xl max-h-[88dvh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Room settings"
      >
        <div className="flex items-center justify-between px-4 h-11 border-b border-[#2b2b2b] shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Settings2 className="h-4 w-4 text-[#a0a0a0] shrink-0" strokeWidth={1.75} />
            <h2 className="text-[14px] font-medium text-[#e4e4e4] truncate">
              Settings
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-7 px-2 rounded-md text-[12px] text-[#a0a0a0] hover:text-[#e4e4e4] border border-transparent hover:border-[#2b2b2b]"
          >
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5 min-h-0">
          <section className="space-y-1.5">
            <h3 className="text-[11px] uppercase tracking-wide text-[#6e6e6e]">
              Session
            </h3>
            <p className="text-[13px] text-[#e4e4e4] font-medium truncate">
              {roomName}
            </p>
            <p className="text-[12px] text-[#a0a0a0]">
              {roomRoleLabel(myRole)}
              {" · "}
              {runtime === "cloud" ? "Cloud" : "Local"}
              {" · "}
              {controlModeLabel(controlMode)}
              {" · "}
              {approvalModeLabel(approvalMode)}
              {selectedAgent?.planMode ? " · Plan mode" : ""}
            </p>
            <p className="text-[11px] text-[#6e6e6e]">
              {controlModeDescription(controlMode)}{" "}
              {approvalModeDescription(approvalMode)}
            </p>
            {runtime === "local" && (
              <p className="text-[11px] text-[#a07a3a]">
                Local agents can operate on the host machine. Invite viewers for
                watch-only access.
              </p>
            )}
          </section>

          {(splitAvailable || onBroadcastEnabledChange) && (
            <section className="space-y-2">
              <h3 className="text-[11px] uppercase tracking-wide text-[#6e6e6e]">
                View
              </h3>
              {onBroadcastEnabledChange && (
                <div className="flex items-center justify-between gap-3 rounded-md border border-[#2b2b2b] bg-[#141414] px-3 py-2.5">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <Radio
                      className="h-4 w-4 text-[#a0a0a0] shrink-0 mt-0.5"
                      strokeWidth={1.75}
                    />
                    <div className="min-w-0">
                      <p className="text-[12px] text-[#e4e4e4]">
                        Broadcast to agents
                      </p>
                      <p className="text-[11px] text-[#6e6e6e]">
                        When on, send one message to every visible pane from the
                        view icon
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      onBroadcastEnabledChange(!broadcastEnabled)
                    }
                    aria-pressed={Boolean(broadcastEnabled)}
                    className={`h-8 px-2.5 rounded-md text-[11px] border shrink-0 ${
                      broadcastEnabled
                        ? "border-[#4d9fff] bg-[#1a2430] text-[#8ec5ff]"
                        : "border-[#2b2b2b] bg-[#1f1f1f] text-[#a0a0a0]"
                    }`}
                  >
                    {broadcastEnabled ? "On" : "Off"}
                  </button>
                </div>
              )}
              {splitAvailable &&
                splitAgents &&
                visibleAgentIds &&
                statusByAgent &&
                onShowSplitAgent &&
                onHideSplitAgent && (
                  <div className="rounded-md border border-[#2b2b2b] bg-[#141414] px-3 py-2.5 space-y-2">
                    <div className="flex items-start gap-2.5">
                      <Eye
                        className="h-4 w-4 text-[#a0a0a0] shrink-0 mt-0.5"
                        strokeWidth={1.75}
                      />
                      <div className="min-w-0">
                        <p className="text-[12px] text-[#e4e4e4]">
                          Visible agents
                        </p>
                        <p className="text-[11px] text-[#6e6e6e]">
                          Choose which panes stay open in split view
                        </p>
                      </div>
                    </div>
                    <SplitAgentPicker
                      agents={splitAgents}
                      visibleIds={visibleAgentIds}
                      statusByAgent={statusByAgent}
                      onShow={onShowSplitAgent}
                      onHide={onHideSplitAgent}
                      onFocus={onFocusSplitAgent}
                    />
                  </div>
                )}
            </section>
          )}

          <section className="space-y-2">
            <h3 className="text-[11px] uppercase tracking-wide text-[#6e6e6e]">
              Panels
            </h3>
            {onOpenAgents && (
              <button
                type="button"
                onClick={onOpenAgents}
                className="w-full flex items-center gap-2.5 rounded-md border border-[#2b2b2b] bg-[#141414] px-3 py-2.5 text-left hover:border-[#3c3c3c] transition-colors"
              >
                <Bot className="h-4 w-4 text-[#a0a0a0] shrink-0" strokeWidth={1.75} />
                <div className="min-w-0">
                  <p className="text-[12px] text-[#e4e4e4]">Agents</p>
                  <p className="text-[11px] text-[#6e6e6e]">
                    Add, stop, or switch agents
                  </p>
                </div>
              </button>
            )}
            {onOpenMemory && (
              <button
                type="button"
                onClick={onOpenMemory}
                className="w-full flex items-center gap-2.5 rounded-md border border-[#2b2b2b] bg-[#141414] px-3 py-2.5 text-left hover:border-[#3c3c3c] transition-colors"
              >
                <BookOpen className="h-4 w-4 text-[#a0a0a0] shrink-0" strokeWidth={1.75} />
                <div className="min-w-0">
                  <p className="text-[12px] text-[#e4e4e4]">Memory</p>
                  <p className="text-[11px] text-[#6e6e6e]">
                    Shared notes and repo map
                  </p>
                </div>
              </button>
            )}
            {onOpenChanges && (
              <button
                type="button"
                onClick={onOpenChanges}
                className="w-full flex items-center gap-2.5 rounded-md border border-[#2b2b2b] bg-[#141414] px-3 py-2.5 text-left hover:border-[#3c3c3c] transition-colors"
              >
                {runtime === "cloud" ? (
                  <Cloud className="h-4 w-4 text-[#a0a0a0] shrink-0" strokeWidth={1.75} />
                ) : (
                  <GitCompare className="h-4 w-4 text-[#a0a0a0] shrink-0" strokeWidth={1.75} />
                )}
                <div className="min-w-0">
                  <p className="text-[12px] text-[#e4e4e4]">
                    {runtime === "cloud" ? "Cloud" : "Changes"}
                  </p>
                  <p className="text-[11px] text-[#6e6e6e]">
                    {runtime === "cloud"
                      ? "Cloud run and pull request"
                      : "File diffs from the current agent"}
                  </p>
                </div>
              </button>
            )}
            {onOpenMembers && (
              <button
                type="button"
                onClick={onOpenMembers}
                className="w-full flex items-center gap-2.5 rounded-md border border-[#2b2b2b] bg-[#141414] px-3 py-2.5 text-left hover:border-[#3c3c3c] transition-colors"
              >
                <Users className="h-4 w-4 text-[#a0a0a0] shrink-0" strokeWidth={1.75} />
                <div className="min-w-0">
                  <p className="text-[12px] text-[#e4e4e4]">Members</p>
                  <p className="text-[11px] text-[#6e6e6e]">
                    People in this session
                  </p>
                </div>
              </button>
            )}
            {onOpenFlag && (
              <button
                type="button"
                onClick={onOpenFlag}
                className="w-full flex items-center gap-2.5 rounded-md border border-[#2b2b2b] bg-[#141414] px-3 py-2.5 text-left hover:border-[#3c3c3c] transition-colors"
              >
                <Bell className="h-4 w-4 text-[#e8a23a] shrink-0" strokeWidth={1.75} />
                <div className="min-w-0">
                  <p className="text-[12px] text-[#e4e4e4]">Flag for review</p>
                  <p className="text-[11px] text-[#6e6e6e]">
                    Ping the room or Slack
                  </p>
                </div>
              </button>
            )}
          </section>

          {canManage && (
            <section className="space-y-2.5">
              <h3 className="text-[11px] uppercase tracking-wide text-[#6e6e6e]">
                Collaboration
              </h3>
              <label className="block space-y-1">
                <span className="text-[12px] text-[#a0a0a0]">Control mode</span>
                <select
                  value={controlMode}
                  disabled={savingControlMode}
                  onChange={(e) =>
                    onControlModeChange(e.target.value as ControlMode)
                  }
                  className="w-full h-9 px-2 rounded-md bg-[#252525] border border-[#2b2b2b] text-[13px] text-[#e4e4e4] outline-none focus:border-[#4d9fff]"
                >
                  <option value="open">Open collaboration</option>
                  <option value="driver">Driver enforced</option>
                  <option value="host">Host only</option>
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-[12px] text-[#a0a0a0]">Approval gates</span>
                <select
                  value={approvalMode}
                  disabled={savingApprovalMode}
                  onChange={(e) =>
                    onApprovalModeChange(e.target.value as ApprovalMode)
                  }
                  className="w-full h-9 px-2 rounded-md bg-[#252525] border border-[#2b2b2b] text-[13px] text-[#e4e4e4] outline-none focus:border-[#c9a227]"
                >
                  <option value="off">Approvals off</option>
                  <option value="dangerous">Approve dangerous</option>
                  <option value="all">Approve all tools</option>
                </select>
              </label>
              <div className="flex items-center justify-between gap-3 rounded-md border border-[#2b2b2b] bg-[#141414] px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-[12px] text-[#e4e4e4]">Auto memory</p>
                  <p className="text-[11px] text-[#6e6e6e]">
                    After a successful run, save corrections and handoffs silently
                  </p>
                </div>
                <button
                  type="button"
                  disabled={savingAutoMemory}
                  onClick={() =>
                    onAutoMemoryChange(
                      autoMemory === "extract" ? "off" : "extract",
                    )
                  }
                  className={`h-8 px-2.5 rounded-md text-[11px] border shrink-0 disabled:opacity-40 ${
                    autoMemory === "extract"
                      ? "border-[#4d9fff] bg-[#1a2430] text-[#8ec5ff]"
                      : "border-[#2b2b2b] bg-[#1f1f1f] text-[#a0a0a0]"
                  }`}
                >
                  {autoMemory === "extract" ? "On" : "Off"}
                </button>
              </div>
              {selectedAgent && (
                <div className="flex items-center justify-between gap-3 rounded-md border border-[#2b2b2b] bg-[#141414] px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-[12px] text-[#e4e4e4]">Plan mode</p>
                    <p className="text-[11px] text-[#6e6e6e] truncate">
                      {selectedAgent.label} — read-only explore / propose
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={planModeBusy}
                    onClick={onTogglePlanMode}
                    className={`h-8 px-2.5 rounded-md text-[11px] border shrink-0 disabled:opacity-40 ${
                      selectedAgent.planMode
                        ? "border-[#4d9fff] bg-[#1a2430] text-[#8ec5ff]"
                        : "border-[#2b2b2b] bg-[#1f1f1f] text-[#a0a0a0]"
                    }`}
                  >
                    {selectedAgent.planMode ? "On" : "Off"}
                  </button>
                </div>
              )}
            </section>
          )}

          {canManage && (
            <section className="space-y-2">
              <h3 className="text-[11px] uppercase tracking-wide text-[#6e6e6e]">
                Notifications
              </h3>
              <div className="flex items-center justify-between gap-3 rounded-md border border-[#2b2b2b] bg-[#141414] px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-[12px] text-[#e4e4e4]">Slack</p>
                  <p className="text-[11px] text-[#6e6e6e]">
                    {slackConfigured
                      ? "Connected for review pings"
                      : "Not configured"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onOpenSlack}
                  className={`h-8 px-2.5 rounded-md text-[11px] border shrink-0 ${
                    slackConfigured
                      ? "border-[#2a4a35] bg-[#1c2a22] text-[#7ddea8]"
                      : "border-[#2b2b2b] bg-[#1f1f1f] text-[#a0a0a0]"
                  }`}
                >
                  {slackConfigured ? "Manage" : "Connect"}
                </button>
              </div>
            </section>
          )}

          <section className="space-y-2">
            <h3 className="text-[11px] uppercase tracking-wide text-[#6e6e6e]">
              Sharing
            </h3>
            <button
              type="button"
              onClick={() => void handleCopyLink()}
              className="w-full flex items-center gap-2.5 rounded-md border border-[#2b2b2b] bg-[#141414] px-3 py-2.5 text-left hover:border-[#3c3c3c] transition-colors"
            >
              <Link2 className="h-4 w-4 text-[#a0a0a0] shrink-0" strokeWidth={1.75} />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] text-[#e4e4e4]">
                  {copiedLink ? "Link copied" : "Copy session link"}
                </p>
                <p className="text-[11px] text-[#6e6e6e] truncate">{sessionUrl}</p>
              </div>
            </button>
            <button
              type="button"
              onClick={onOpenInvites}
              className="w-full flex items-center gap-2.5 rounded-md border border-[#2b2b2b] bg-[#141414] px-3 py-2.5 text-left hover:border-[#3c3c3c] transition-colors"
            >
              <Share2 className="h-4 w-4 text-[#a0a0a0] shrink-0" strokeWidth={1.75} />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] text-[#e4e4e4]">Invite links</p>
                <p className="text-[11px] text-[#6e6e6e]">
                  {canManage
                    ? "Create and manage join links"
                    : "View active invite links"}
                </p>
              </div>
            </button>
          </section>

          <section className="space-y-2">
            <h3 className="text-[11px] uppercase tracking-wide text-[#6e6e6e]">
              Actions
            </h3>
            <button
              type="button"
              disabled={exporting}
              onClick={onExport}
              className="w-full flex items-center gap-2.5 rounded-md border border-[#2b2b2b] bg-[#141414] px-3 py-2.5 text-left hover:border-[#3c3c3c] transition-colors disabled:opacity-50"
            >
              <Download className="h-4 w-4 text-[#a0a0a0] shrink-0" strokeWidth={1.75} />
              <span className="text-[12px] text-[#e4e4e4]">
                {exporting ? "Exporting…" : "Export transcript"}
              </span>
            </button>
            {canManage && (
              <button
                type="button"
                disabled={stopping}
                onClick={onStopSession}
                className="w-full flex items-center gap-2.5 rounded-md border border-[#3c2b2b] bg-[#1a1414] px-3 py-2.5 text-left hover:border-[#5a3a3a] transition-colors disabled:opacity-50"
              >
                <StopCircle className="h-4 w-4 text-[#f07070] shrink-0" strokeWidth={1.75} />
                <span className="text-[12px] text-[#f07070]">
                  {stopping ? "Stopping…" : "Stop session"}
                </span>
              </button>
            )}
            {!amHost && (
              <button
                type="button"
                onClick={onLeave}
                className="w-full flex items-center justify-center rounded-md border border-[#2b2b2b] bg-[#141414] px-3 py-2.5 text-[12px] text-[#a0a0a0] hover:text-[#f07070] hover:border-[#3c2b2b] transition-colors"
              >
                Leave session
              </button>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
