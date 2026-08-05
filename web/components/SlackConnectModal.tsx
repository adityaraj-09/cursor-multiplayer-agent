"use client";

import { useCallback, useEffect, useState } from "react";
import {
  clearRoomSlackWebhook,
  fetchRoomSlackWebhook,
  setRoomSlackWebhook,
} from "../lib/api";

export default function SlackConnectModal({
  roomId,
  open,
  onClose,
  canManage,
  onUpdated,
}: {
  roomId: string;
  open: boolean;
  onClose: () => void;
  canManage: boolean;
  onUpdated?: (configured: boolean, hint?: string | null) => void;
}) {
  const [webhookUrl, setWebhookUrl] = useState("");
  const [configured, setConfigured] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [envFallback, setEnvFallback] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const status = await fetchRoomSlackWebhook(roomId);
      setConfigured(status.configured);
      setHint(status.hint);
      setEnvFallback(status.envFallback);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load status");
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    if (!open) return;
    setWebhookUrl("");
    void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleSave = async () => {
    if (!canManage) return;
    setSaving(true);
    setError("");
    try {
      const result = await setRoomSlackWebhook(roomId, webhookUrl.trim());
      setConfigured(true);
      setHint(result.hint);
      setWebhookUrl("");
      onUpdated?.(true, result.hint);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save webhook");
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    if (!canManage) return;
    if (!window.confirm("Remove this room’s Slack webhook?")) return;
    setSaving(true);
    setError("");
    try {
      await clearRoomSlackWebhook(roomId);
      setConfigured(false);
      setHint(null);
      onUpdated?.(false, null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove webhook");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/55 px-0 sm:px-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full sm:max-w-md bg-[#1a1a1a] border border-[#2b2b2b] sm:rounded-lg rounded-t-lg shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Connect Slack"
      >
        <div className="flex items-center justify-between px-4 h-11 border-b border-[#2b2b2b]">
          <h2 className="text-[14px] font-medium text-[#e4e4e4]">
            Slack notifications
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="h-7 px-2 rounded-md text-[12px] text-[#a0a0a0] hover:text-[#e4e4e4] border border-transparent hover:border-[#2b2b2b]"
          >
            Close
          </button>
        </div>

        <div className="px-4 py-3 space-y-3">
          <p className="text-[12px] text-[#6e6e6e]">
            Paste a Slack Incoming Webhook URL. It is encrypted at rest and used
            when someone flags this session for review.
          </p>

          {loading ? (
            <p className="text-[12px] text-[#6e6e6e]">Loading…</p>
          ) : (
            <>
              <div className="rounded-md border border-[#2b2b2b] bg-[#141414] px-3 py-2 text-[12px]">
                {configured ? (
                  <p className="text-[#3ecf8e]">
                    Connected{hint ? ` · ${hint}` : ""}
                  </p>
                ) : envFallback ? (
                  <p className="text-[#a0a0a0]">
                    No room webhook — using server{" "}
                    <code className="text-[#c9c9c9]">SLACK_WEBHOOK_URL</code>{" "}
                    fallback.
                  </p>
                ) : (
                  <p className="text-[#a0a0a0]">Not connected.</p>
                )}
              </div>

              {canManage ? (
                <>
                  <label className="block">
                    <span className="text-[11px] text-[#a0a0a0]">
                      Incoming webhook URL
                    </span>
                    <input
                      type="password"
                      autoComplete="off"
                      value={webhookUrl}
                      onChange={(e) => setWebhookUrl(e.target.value)}
                      placeholder="https://hooks.slack.com/services/…"
                      className="mt-1 w-full h-9 px-3 bg-[#252525] border border-[#2b2b2b] rounded-md text-[13px] text-[#e4e4e4] placeholder:text-[#6e6e6e] outline-none focus:border-[#4d9fff]"
                    />
                  </label>
                  <div className="flex gap-2 justify-end">
                    {configured && (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void handleClear()}
                        className="h-9 px-3 rounded-md text-[12px] text-[#f07070] border border-[#3c2b2b] disabled:opacity-40"
                      >
                        Disconnect
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={saving || !webhookUrl.trim()}
                      onClick={() => void handleSave()}
                      className="h-9 px-3 rounded-md bg-[#e4e4e4] text-[#141414] text-[12px] font-medium hover:bg-white disabled:opacity-40"
                    >
                      {saving ? "Saving…" : configured ? "Replace" : "Connect"}
                    </button>
                  </div>
                </>
              ) : (
                <p className="text-[12px] text-[#6e6e6e]">
                  Only the host can connect or change the Slack webhook.
                </p>
              )}
            </>
          )}

          {error && <p className="text-[12px] text-[#f07070]">{error}</p>}
        </div>
      </div>
    </div>
  );
}
