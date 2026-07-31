"use client";

export function RoomDiagram() {
  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-[#191919]/10 bg-white shadow-[0_30px_80px_rgba(25,25,25,0.08)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(25,25,25,0.08),transparent_28%),radial-gradient(circle_at_80%_10%,rgba(25,25,25,0.05),transparent_25%)]" />
      <svg viewBox="0 0 720 460" className="relative z-10 block w-full h-auto" role="img" aria-label="Shared Steer room with Cursor and Claude agents">
        <defs>
          <linearGradient id="roomPanel" x1="0" x2="1">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="100%" stopColor="#F7F5F0" />
          </linearGradient>
          <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="20" stdDeviation="22" floodColor="#191919" floodOpacity="0.10" />
          </filter>
        </defs>
        <rect x="52" y="50" width="616" height="360" rx="34" fill="url(#roomPanel)" filter="url(#softShadow)" />
        <rect x="80" y="84" width="560" height="42" rx="21" fill="#191919" fillOpacity="0.06" />
        <circle cx="110" cy="105" r="6" fill="#191919" fillOpacity="0.35" />
        <circle cx="132" cy="105" r="6" fill="#191919" fillOpacity="0.22" />
        <circle cx="154" cy="105" r="6" fill="#191919" fillOpacity="0.16" />
        <circle className="landing-pulse" cx="500" cy="105" r="4" fill="#3ECF8E" />
        <text x="512" y="110" fill="#191919" fillOpacity="0.42" fontSize="13" fontFamily="Inter">live room</text>

        <rect x="90" y="154" width="270" height="210" rx="22" fill="#191919" fillOpacity="0.055" />
        <rect x="112" y="178" width="170" height="12" rx="6" fill="#191919" fillOpacity="0.22" />
        <rect x="112" y="208" width="208" height="10" rx="5" fill="#191919" fillOpacity="0.10" />
        <rect x="112" y="230" width="188" height="10" rx="5" fill="#191919" fillOpacity="0.10" />
        <rect x="112" y="252" width="224" height="10" rx="5" fill="#191919" fillOpacity="0.10" />
        <path className="landing-draw" d="M118 310 C158 285, 195 334, 236 302 S307 296, 328 272" fill="none" stroke="#191919" strokeOpacity="0.48" strokeWidth="3" strokeLinecap="round" />
        <circle className="landing-pulse" cx="328" cy="272" r="8" fill="#191919" fillOpacity="0.28" />

        <rect x="390" y="154" width="108" height="36" rx="12" fill="#191919" />
        <text x="414" y="177" fill="white" fontSize="12" fontFamily="Inter" fontWeight="500">Cursor</text>
        <rect x="508" y="154" width="112" height="36" rx="12" fill="#FFFFFF" stroke="#191919" strokeOpacity="0.16" />
        <text x="528" y="177" fill="#191919" fontSize="12" fontFamily="Inter" fontWeight="500">Claude</text>

        <rect x="390" y="204" width="230" height="70" rx="18" fill="#191919" />
        <text x="414" y="236" fill="white" fontSize="14" fontFamily="Inter" fontWeight="500">Two agents editing</text>
        <rect x="414" y="250" width="144" height="8" rx="4" fill="white" fillOpacity="0.28" />

        <rect x="390" y="290" width="230" height="74" rx="18" fill="#FFFFFF" stroke="#191919" strokeOpacity="0.12" />
        <text x="414" y="318" fill="#191919" fillOpacity="0.78" fontSize="13" fontFamily="Inter" fontWeight="500">Diff stream</text>
        <rect x="414" y="334" width="54" height="8" rx="4" fill="#3ECF8E" fillOpacity="0.55" />
        <rect x="478" y="334" width="74" height="8" rx="4" fill="#191919" fillOpacity="0.10" />

        <g className="landing-float-slow">
          <circle cx="156" cy="72" r="22" fill="#191919" />
          <text x="148" y="78" fill="white" fontSize="16" fontFamily="Inter" fontWeight="600">A</text>
        </g>
        <g className="landing-float">
          <circle cx="610" cy="118" r="22" fill="#FFFFFF" stroke="#191919" strokeOpacity="0.16" />
          <text x="602" y="124" fill="#191919" fontSize="16" fontFamily="Inter" fontWeight="600">J</text>
        </g>
        <g className="landing-float-delay">
          <circle cx="594" cy="386" r="22" fill="#191919" fillOpacity="0.08" />
          <text x="586" y="392" fill="#191919" fontSize="16" fontFamily="Inter" fontWeight="600">M</text>
        </g>
      </svg>
    </div>
  );
}

export function WorkflowDiagram() {
  const labels = ["Create", "Invite", "Steer"];
  return (
    <div className="relative rounded-[2rem] border border-[#191919]/10 bg-[#FAFAF8] p-6 sm:p-8 overflow-hidden">
      <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-[#191919]/[0.04]" />
      <svg viewBox="0 0 520 220" className="relative z-10 w-full h-auto" aria-hidden>
        <path className="landing-draw" d="M90 120 C170 40, 260 200, 350 120 S440 70, 460 120" fill="none" stroke="#191919" strokeOpacity="0.22" strokeWidth="2.5" strokeLinecap="round" />
        <circle className="landing-pulse" r="6" fill="#191919" fillOpacity="0.5">
          <animateMotion dur="4s" repeatCount="indefinite" path="M90 120 C170 40, 260 200, 350 120 S440 70, 460 120" />
        </circle>
        {labels.map((label, index) => {
          const x = 90 + index * 160;
          const y = index % 2 === 0 ? 120 : 84;
          return (
            <g key={label} className="landing-rise" style={{ animationDelay: `${index * 90}ms` }}>
              <circle cx={x} cy={y} r="38" fill={index === 2 ? "#191919" : "#FFFFFF"} stroke="#191919" strokeOpacity="0.14" />
              <text x={x} y={y + 5} textAnchor="middle" fill={index === 2 ? "#FFFFFF" : "#191919"} fontSize="13" fontFamily="Inter" fontWeight="500">{label}</text>
              <text x={x} y={y + 66} textAnchor="middle" fill="#191919" fillOpacity="0.40" fontSize="12" fontFamily="Inter">0{index + 1}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function RuntimeDiagram() {
  return (
    <div className="rounded-[2rem] border border-[#191919]/10 bg-white p-6 sm:p-8 shadow-[0_20px_70px_rgba(25,25,25,0.06)]">
      <svg viewBox="0 0 620 360" className="w-full h-auto" role="img" aria-label="Local and cloud runtime diagram">
        <defs>
          <marker id="runtimeArrow" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="#191919" fillOpacity="0.35" />
          </marker>
        </defs>
        <rect x="40" y="44" width="190" height="118" rx="26" fill="#FAFAF8" stroke="#191919" strokeOpacity="0.10" />
        <text x="70" y="88" fill="#191919" fontSize="18" fontFamily="Georgia">Local CLI</text>
        <text x="70" y="118" fill="#191919" fillOpacity="0.52" fontSize="13" fontFamily="Inter">Cursor + Claude</text>
        <rect x="70" y="132" width="96" height="8" rx="4" fill="#191919" fillOpacity="0.14" />

        <rect x="390" y="44" width="190" height="118" rx="26" fill="#FAFAF8" stroke="#191919" strokeOpacity="0.10" />
        <text x="420" y="88" fill="#191919" fontSize="18" fontFamily="Georgia">Cloud</text>
        <text x="420" y="118" fill="#191919" fillOpacity="0.52" fontSize="13" fontFamily="Inter">SDK + E2B</text>
        <rect x="420" y="132" width="96" height="8" rx="4" fill="#191919" fillOpacity="0.14" />

        <rect x="205" y="220" width="210" height="96" rx="30" fill="#191919" />
        <text x="310" y="258" textAnchor="middle" fill="#FFFFFF" fontSize="20" fontFamily="Georgia">Steer room</text>
        <text x="310" y="286" textAnchor="middle" fill="#FFFFFF" fillOpacity="0.56" fontSize="13" fontFamily="Inter">multi-agent session</text>

        <path className="landing-draw" d="M230 108 C282 120, 282 206, 260 220" fill="none" stroke="#191919" strokeOpacity="0.35" strokeWidth="2.5" markerEnd="url(#runtimeArrow)" />
        <path className="landing-draw" d="M390 108 C340 126, 344 206, 362 220" fill="none" stroke="#191919" strokeOpacity="0.35" strokeWidth="2.5" markerEnd="url(#runtimeArrow)" />
        <circle className="landing-pulse" cx="310" cy="220" r="8" fill="#191919" fillOpacity="0.25" />
      </svg>
    </div>
  );
}
