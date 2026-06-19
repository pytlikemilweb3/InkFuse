export default function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      {/* gallery frame */}
      <rect x="2.5" y="2.5" width="27" height="27" rx="3" stroke="var(--bone)" strokeWidth="2" />
      {/* ink drop */}
      <path d="M16 7c4.2 5 5.6 8 5.6 11a5.6 5.6 0 1 1-11.2 0c0-3 1.4-6 5.6-11z" fill="var(--red)" />
    </svg>
  );
}
