"use client";

import { useEffect, useState } from "react";
import { Phone } from "lucide-react";
import {
  fetchVoiceApprovalSettings,
  updateVoiceApprovalSettings,
} from "../../lib/api";
import type { VoiceApprovalSettings } from "../../../shared/voiceApprovals";

export default function VoiceApprovalCard() {
  const [settings, setSettings] = useState<VoiceApprovalSettings | null>(null);
  const [phone, setPhone] = useState("");
  const [optIn, setOptIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchVoiceApprovalSettings()
      .then((next) => {
        if (cancelled) return;
        setSettings(next);
        setPhone(next.phoneE164 || "");
        setOptIn(next.optIn);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const enable = Boolean(phone.trim()) && optIn;
      const next = await updateVoiceApprovalSettings({
        phoneE164: phone,
        optIn: enable,
      });
      setSettings(next);
      setPhone(next.phoneE164 || "");
      setOptIn(next.optIn);
      setNotice(
        next.optIn
          ? "We’ll call this number when an agent needs tool approval."
          : "Saved. Approval calls are off.",
      );
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
          <Phone className="h-4 w-4" strokeWidth={1.75} />
        </div>
        <div>
          <h2 className="text-[15px] font-medium text-[#e4e4e4]">
            Call me for approvals
          </h2>
          <p className="text-[12px] text-[#6e6e6e] mt-0.5">
            When an agent pauses for a tool permission, Steer can call this
            number. Say approve or deny. The in-room button still works.
          </p>
        </div>
      </div>

      <label className="text-[12px] text-[#a0a0a0] block">
        Phone (E.164)
        <input
          value={phone}
          onChange={(e) => {
            const next = e.target.value;
            setPhone(next);
            if (next.trim()) setOptIn(true);
          }}
          placeholder="+9198XXXXXXXX"
          autoComplete="tel"
          className="mt-1 w-full h-9 px-2.5 rounded-md bg-[#252525] border border-[#2b2b2b] text-[13px] text-[#e4e4e4] outline-none focus:border-[#4d9fff]"
        />
      </label>

      <label className="mt-3 flex items-center gap-2 text-[12px] text-[#a0a0a0]">
        <input
          type="checkbox"
          checked={optIn}
          onChange={(e) => setOptIn(e.target.checked)}
        />
        Call me when a tool needs approval
      </label>

      {settings?.phoneE164 && !optIn && (
        <p className="text-[12px] text-[#e8a23a] mt-3">
          Number is saved but calls are off. Check the box and Save — that’s
          why the last approval skipped with “opt-in off”.
        </p>
      )}
      {settings && !settings.callingConfigured && (
        <p className="text-[12px] text-[#e8a23a] mt-3">
          Calling isn’t configured on this server yet. Your number is saved;
          calls start once Sarvam env vars are set.
        </p>
      )}
      {error && <p className="text-[12px] text-[#f07070] mt-3">{error}</p>}
      {notice && <p className="text-[12px] text-[#3ecf8e] mt-3">{notice}</p>}

      <button
        type="button"
        disabled={busy}
        onClick={() => void save()}
        className="mt-4 h-8 px-3 rounded-md bg-[#e4e4e4] text-[#141414] text-[12px] font-medium disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save phone"}
      </button>
    </section>
  );
}
