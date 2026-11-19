import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const styles: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-hover',
  secondary: 'bg-surface text-text border-2 border-border hover:bg-surface-muted',
  danger: 'bg-danger text-surface hover:opacity-90',
  ghost: 'bg-transparent text-text hover:bg-surface-muted',
};

/** Glove-friendly button: min. 48 px touch target (CD section 8). `size="lg"` for stamp actions (64 px). */
export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'md' | 'lg' }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-card px-5 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        size === 'lg' ? 'min-h-touch-lg text-lg' : 'min-h-touch text-base'
      } ${styles[variant]} ${className}`}
      {...props}
    />
  );
}
