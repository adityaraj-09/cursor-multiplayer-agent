"use client";

import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import {
  fetchIssueSettings,
  updateIssueSettings,
  type IssueSettingsInfo,
} from "../../lib/api";

export default function IssuePickupCard({
  orgId,
  canManage = true,
}: {
  orgId?: string;
  canManage?: boolean;
}) {
  const [settings, setSettings] = useState<IssueSettingsInfo | null>(null);
  const [delayMin, setDelayMin] = useState("10");
  const [autoStart, setAutoStart] = useState(true);
  const [maxConcurrent, setMaxConcurrent] = useState("2");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchIssueSettings({ orgId: orgId || "personal" })
      .then((next) => {
        if (cancelled) return;
        setSettings(next);
        setDelayMin(String(Math.round(next.defaultPickupDelayMs / 60000)));
        setAutoStart(next.autoStart);
        setMaxConcurrent(String(next.maxConcurrent));
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load pickup");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const save = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const minutes = Number(delayMin);
      const next = await updateIssueSettings({
        orgId,
        defaultPickupDelayMs: Math.round(
          (Number.isFinite(minutes) ? minutes : 10) * 60_000,
        ),
        autoStart,
        maxConcurrent: Number(maxConcurrent) || 2,
      });
      setSettings(next);
      setNotice("Pickup settings saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-[#2b2b2b] bg-[#1a1a1a] p-5">
      <div className="flex items-start gap-3 mb-4">
        <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-[#252525] text-[#e4e4e4]">
          <Timer className="h-4 w-4" strokeWidth={1.75} />
        </div>
        <div>
          <h2 className="text-[15px] font-medium text-[#e4e4e4]">
            Issue pickup
          </h2>
          <p className="text-[12px] text-[#6e6e6e] mt-0.5">
            How long the headless agent waits before picking up a queued issue.
            Runs never create a session room.
          </p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-[12px] text-[#a0a0a0]">
          Delay (minutes)
          <input
            value={delayMin}
            onChange={(e) => setDelayMin(e.target.value)}
            disabled={!canManage}
            className="mt-1 w-full h-9 px-2.5 rounded-md bg-[#252525] border border-[#2b2b2b] text-[13px] text-[#e4e4e4] outline-none focus:border-[#4d9fff] disabled:opacity-50"
          />
        </label>
        <label className="text-[12px] text-[#a0a0a0]">
          Max concurrent
          <input
            value={maxConcurrent}
            onChange={(e) => setMaxConcurrent(e.target.value)}
            disabled={!canManage}
            className="mt-1 w-full h-9 px-2.5 rounded-md bg-[#252525] border border-[#2b2b2b] text-[13px] text-[#e4e4e4] outline-none focus:border-[#4d9fff] disabled:opacity-50"
          />
        </label>
        <label className="flex items-center gap-2 text-[12px] text-[#a0a0a0] sm:mt-6">
          <input
            type="checkbox"
            checked={autoStart}
            disabled={!canManage}
            onChange={(e) => setAutoStart(e.target.checked)}
          />
          Queue on create
        </label>
      </div>
      {error && <p className="text-[12px] text-[#f07070] mt-3">{error}</p>}
      {notice && <p className="text-[12px] text-[#3ecf8e] mt-3">{notice}</p>}
      {canManage && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="mt-4 h-8 px-3 rounded-md bg-[#e4e4e4] text-[#141414] text-[12px] font-medium disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save pickup"}
        </button>
      )}
      {settings && (
        <p className="text-[11px] text-[#6e6e6e] mt-2">
          Current default: {Math.round(settings.defaultPickupDelayMs / 60000)} min
          · {settings.maxConcurrent} at a time
        </p>
      )}
    </section>
  );
}
