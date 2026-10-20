type Props = {
  present: number;
  absent: number;
  total: number;
  rate: number;
  size?: number;
};

export default function AttendanceRingChart({ present, absent, total, rate, size = 130 }: Props) {
  const strokeWidth = size >= 140 ? 12 : 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const presentPct = total > 0 ? present / total : 0;
  const absentPct = total > 0 ? absent / total : 0;
  const presentDash = presentPct * circumference;
  const absentDash = absentPct * circumference;
  const gap = total > 0 ? 3 : 0;
  const fontSize = size >= 140 ? 'text-4xl' : 'text-3xl';
  const labelSize = size >= 140 ? 'text-[11px]' : 'text-[10px]';

  const gid = 'ring-grad';

  return (
    <div className="relative premium-ring-container" style={{ width: size + 20, height: size + 20 }}>
      {/* Glow halo behind ring */}
      <div className="premium-ring-glow" />
      <svg width={size + 20} height={size + 20} className="-rotate-90 premium-ring-svg">
        <defs>
          <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f4d878" />
            <stop offset="50%" stopColor="#d4af37" />
            <stop offset="100%" stopColor="#9b7620" />
          </linearGradient>
          <filter id="ring-blur-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {/* Track */}
        <circle
          cx={(size + 20) / 2}
          cy={(size + 20) / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.10)"
          strokeWidth={strokeWidth}
        />
        {/* Present arc with gradient + glow */}
        {total > 0 && (
          <>
            <circle
              cx={(size + 20) / 2}
              cy={(size + 20) / 2}
              r={radius}
              fill="none"
              stroke={`url(#${gid})`}
              strokeWidth={strokeWidth}
              strokeDasharray={`${Math.max(presentDash - gap, 0)} ${circumference - Math.max(presentDash - gap, 0)}`}
              strokeLinecap="round"
              filter="url(#ring-blur-glow)"
              style={{ transition: 'stroke-dasharray 0.8s cubic-bezier(0.22,1,0.36,1)' }}
            />
            {/* Absent arc */}
            <circle
              cx={(size + 20) / 2}
              cy={(size + 20) / 2}
              r={radius}
              fill="none"
              stroke="#ef4444"
              strokeWidth={strokeWidth * 0.7}
              strokeDasharray={`${Math.max(absentDash - gap, 0)} ${circumference - Math.max(absentDash - gap, 0)}`}
              strokeDashoffset={-(presentDash)}
              strokeLinecap="round"
              opacity={0.6}
              style={{ transition: 'stroke-dasharray 0.8s cubic-bezier(0.22,1,0.36,1), stroke-dashoffset 0.8s cubic-bezier(0.22,1,0.36,1)' }}
            />
          </>
        )}
      </svg>
      {/* Frosted glass center circle */}
      <div className="premium-ring-center">
        <span className={`${fontSize} font-black text-white premium-stat`}>{rate}%</span>
        <span className={`${labelSize} text-slate-400 mt-0.5`}>نسبة الحضور</span>
      </div>
    </div>
  );
}
