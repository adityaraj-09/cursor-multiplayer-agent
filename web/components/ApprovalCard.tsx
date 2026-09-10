"use client";

import { useMemo, useState } from "react";
import type { ApprovalRequestInfo } from "../../shared/events";
import { isShellTool } from "../../shared/approvals";
import {
  ToolApproval,
  ToolApprovalCode,
  type ToolApprovalStatus,
} from "./agents/tool-approval";

interface ApprovalCardProps {
  request: ApprovalRequestInfo;
  /** False when the current user is the driver (cannot self-approve) or a viewer. */
  canDecide: boolean;
  deciding?: boolean;
  agentName?: string;
  onDecide: (approved: boolean, alwaysAllow?: boolean) => void;
}

function toCardStatus(
  request: ApprovalRequestInfo,
  deciding: boolean,
): ToolApprovalStatus {
  if (request.status === "denied") return "denied";
  if (request.status === "expired") return "expired";
  if (request.status === "approved") return "complete";
  if (deciding) return "approving";
  return "pending";
}

function previewLine(text: string, max = 140): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1)}…`;
}

export default function ApprovalCard({
  request,
  canDecide,
  deciding,
  agentName,
  onDecide,
}: ApprovalCardProps) {
  const [detailsOpen, setDetailsOpen] = useState(request.status === "pending");
  const status = toCardStatus(request, Boolean(deciding));
  const shell = isShellTool(request.toolName);
  const pending = request.status === "pending";
  const parameters = useMemo(() => {
    const rows = [];
    if (request.detail) {
      rows.push({
        id: "detail",
        label: shell ? "Command" : "Details",
        value: (
          <ToolApprovalCode
            code={request.detail}
            language={shell ? "bash" : "text"}
          />
        ),
      });
    }
    if (request.path) {
      rows.push({
        id: "path",
        label: "Path",
        value: (
          <span className="font-mono text-xs break-all">{request.path}</span>
        ),
      });
    }
    return rows;
  }, [request.detail, request.path, shell]);

  const description = pending
    ? request.detail
      ? previewLine(request.detail)
      : request.path
        ? `The agent wants to use ${request.toolName} on ${request.path}.`
        : `The agent wants to run ${request.toolName}.`
    : request.decidedByName
      ? `${request.status} by ${request.decidedByName}`
      : undefined;

  const viewerNote =
    pending && !canDecide
      ? "Waiting for another editor to approve or deny."
      : undefined;

  return (
    <ToolApproval
      tool={request.toolName}
      agent={agentName}
      title={
        pending ? `Allow ${request.toolName} to run?` : `${request.toolName}`
      }
      description={description}
      note={viewerNote}
      status={status}
      open={detailsOpen}
      onOpenChange={setDetailsOpen}
      parameters={parameters}
      onApprove={
        pending && canDecide ? () => onDecide(true, false) : undefined
      }
      onAlwaysAllow={
        pending && canDecide ? () => onDecide(true, true) : undefined
      }
      onDeny={pending && canDecide ? () => onDecide(false) : undefined}
    />
  );
}
