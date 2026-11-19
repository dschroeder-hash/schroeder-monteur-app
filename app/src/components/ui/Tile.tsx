import Link from 'next/link';

/** Dashboard tile: status with count. Green only as accent line, no green surfaces (CD). */
export function Tile({
  label,
  value,
  href,
  tone = 'default',
}: {
  label: string;
  value: number | string;
  href?: string;
  tone?: 'default' | 'warning' | 'danger';
}) {
  const accent =
    tone === 'danger' ? 'border-l-danger' : tone === 'warning' ? 'border-l-warning' : 'border-l-accent';
  const body = (
    <div
      className={`flex min-h-24 flex-col justify-between rounded-card border border-border border-l-[6px] ${accent} bg-surface p-4`}
    >
      <span className="text-sm font-medium text-text-muted">{label}</span>
      <span className="font-emphasis text-3xl">{value}</span>
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-card">
      {body}
    </Link>
  ) : (
    body
  );
}
