"use client";

export default function CreateTeamCard({
  name,
  onNameChange,
  onCreate,
  onCancel,
  busy,
  error,
}: {
  name: string;
  onNameChange: (value: string) => void;
  onCreate: () => void;
  onCancel?: () => void;
  busy?: boolean;
  error?: string;
}) {
  return (
    <div className="mb-6 rounded-xl border border-[#2b2b2b] bg-[#1a1a1a] p-4">
      <p className="text-[13px] text-[#e4e4e4] mb-1">Create a team workspace</p>
      <p className="text-[11px] text-[#6e6e6e] mb-3">
        Each team can connect its own GitHub account and shared API keys.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Acme Engineering"
          className="flex-1 h-9 px-2.5 rounded-md bg-[#252525] border border-[#2b2b2b] text-[13px] text-[#e4e4e4] outline-none focus:border-[#4d9fff]"
          onKeyDown={(e) => {
            if (e.key === "Enter") onCreate();
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={onCreate}
          className="h-9 px-3 rounded-md bg-[#e4e4e4] text-[#141414] text-[12px] font-medium hover:bg-white disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create team"}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="h-9 px-3 rounded-md text-[12px] text-[#a0a0a0]"
          >
            Cancel
          </button>
        )}
      </div>
      {error && <p className="text-[12px] text-[#f07070] mt-2">{error}</p>}
    </div>
  );
}
