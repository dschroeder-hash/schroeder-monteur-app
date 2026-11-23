/**
 * Green standard tractor, side view (cab with large glass, long hood, big rear wheels, red rims) – in the style of
 * the tractors in the Schröder workshop. No manufacturer logo or name. `spin` turns the wheels.
 */
export function TractorArt({ className = '', spin = false }: { className?: string; spin?: boolean }) {
  const wheel = spin ? 'tractor-wheel-spin' : '';
  return (
    <svg viewBox="0 0 172 108" className={className} aria-hidden>
      {/* chassis and front axle */}
      <rect x="62" y="66" width="86" height="10" rx="3" fill="#3d4245" />
      {/* hood */}
      <path d="M74 42 h66 q14 0 16 12 l2 14 h-84 z" fill="#5b9a32" />
      <path d="M74 42 h66 q14 0 16 12 l1 5 h-83 z" fill="#6fb33e" />
      <rect x="150" y="54" width="9" height="13" rx="2" fill="#2c3133" />
      <rect x="152" y="56" width="5" height="3" rx="1" fill="#fff7c2" />
      <rect x="152" y="61" width="5" height="3" rx="1" fill="#fff7c2" />
      {/* hood stripe and exhaust */}
      <rect x="80" y="50" width="62" height="3" rx="1.5" fill="#d9dee0" />
      <rect x="96" y="22" width="5" height="22" rx="2" fill="#7b8285" />
      <rect x="95" y="20" width="7" height="4" rx="1.5" fill="#5d6366" />
      {/* cab */}
      <path d="M26 54 V20 q0-10 10-12 h34 q8 0 9 8 l3 38 z" fill="#5b9a32" />
      <path d="M33 50 V22 q0-7 7-8 h28 q5 0 6 5 l3 31 z" fill="#bfe3f2" />
      <path d="M33 50 V22 q0-7 7-8 h10 l-6 36 z" fill="#d8f0fa" />
      <rect x="54" y="14" width="3" height="37" fill="#3d4245" />
      <path d="M22 10 q2-8 12-8 h40 q10 0 10 8 v3 h-62 z" fill="#2f3437" />
      <rect x="24" y="50" width="56" height="8" rx="2" fill="#4c8628" />
      {/* rear fender */}
      <path d="M6 66 q2-34 40-34 q36 0 40 34 h-9 q-3-25-31-25 q-29 0-31 25 z" fill="#5b9a32" />
      {/* rear wheel */}
      <g className={wheel} style={{ transformOrigin: '46px 74px' }}>
        <circle cx="46" cy="74" r="31" fill="#1f2224" />
        <circle cx="46" cy="74" r="31" fill="none" stroke="#33383b" strokeWidth="5" strokeDasharray="5 4" />
        <circle cx="46" cy="74" r="18" fill="#c8102e" />
        <circle cx="46" cy="74" r="7" fill="#e8e9ea" />
        <rect x="44" y="57" width="4" height="34" fill="#8e0c21" />
        <rect x="29" y="72" width="34" height="4" fill="#8e0c21" />
      </g>
      {/* front wheel */}
      <g className={wheel} style={{ transformOrigin: '136px 86px' }}>
        <circle cx="136" cy="86" r="19" fill="#1f2224" />
        <circle cx="136" cy="86" r="19" fill="none" stroke="#33383b" strokeWidth="4" strokeDasharray="4 3" />
        <circle cx="136" cy="86" r="11" fill="#c8102e" />
        <circle cx="136" cy="86" r="4" fill="#e8e9ea" />
        <rect x="134.5" y="76" width="3" height="20" fill="#8e0c21" />
      </g>
      <path d="M120 70 q16-14 32 0 z" fill="#5b9a32" />
    </svg>
  );
}
