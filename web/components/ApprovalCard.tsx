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
  agentRunning?: boolean;
  onDecide: (approved: boolean, alwaysAllow?: boolean) => void;
}

function toCardStatus(
  request: ApprovalRequestInfo,
  deciding: boolean,
  agentRunning: boolean,
): ToolApprovalStatus {
  if (request.status === "denied") return "denied";
  if (request.status === "expired") return "error";
  if (request.status === "approved") {
    if (agentRunning) return "running";
    return "complete";
  }
  if (deciding) return "approving";
  return "pending";
}

export default function ApprovalCard({
  request,
  canDecide,
  deciding,
  agentRunning,
  onDecide,
}: ApprovalCardProps) {
  const [detailsOpen, setDetailsOpen] = useState(request.status === "pending");
  const status = toCardStatus(request, Boolean(deciding), Boolean(agentRunning));
  const shell = isShellTool(request.toolName);
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

  const pending = request.status === "pending";
  const decidedNote =
    !pending && request.decidedByName
      ? `${request.status} by ${request.decidedByName}`
      : pending && !canDecide
        ? "Waiting for another editor (not the current driver) to approve or deny."
        : undefined;

  return (
    <div className="max-w-lg">
      <ToolApproval
        tool={request.toolName}
        title={
          pending ? "Allow this tool to run?" : `${request.toolName} access`
        }
        description={
          decidedNote ||
          (pending
            ? "The agent wants to run this action in the current workspace."
            : undefined)
        }
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
    </div>
  );
}
