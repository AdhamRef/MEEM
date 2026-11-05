/** Temporary mark until the owner chooses a name and logo. Keep src/app/icon.svg in step with it. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden className={className}>
      <rect width="40" height="40" rx="11" fill="var(--surface-elevated)" />
      <path d="M12 26.5V15a2 2 0 0 1 3-1.73L20 16.2l5-2.93A2 2 0 0 1 28 15v11.5" stroke="var(--accent)" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 16.2V29" stroke="var(--accent)" strokeWidth="2.25" strokeLinecap="round" />
    </svg>
  );
}
