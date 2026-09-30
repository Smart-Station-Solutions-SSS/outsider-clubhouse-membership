import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { Check } from './icons';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'gold' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'lg';
  loading?: boolean;
};

export const buttonClass = (variant: ButtonProps['variant'] = 'primary', size: ButtonProps['size'] = 'md') =>
  cx(
    'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45',
    size === 'md' ? 'px-5 py-2.5 text-sm' : 'px-7 py-3.5 text-base',
    variant === 'primary' && 'bg-brand-800 text-white shadow-soft hover:bg-brand-700 hover:shadow-lift',
    variant === 'gold' && 'bg-gradient-to-b from-gold-300 to-gold-500 text-brand-950 shadow-soft hover:brightness-105 hover:shadow-lift',
    variant === 'secondary' && 'border border-stone-300 bg-white text-stone-800 hover:border-brand-400 hover:text-brand-800',
    variant === 'ghost' && 'text-brand-700 hover:bg-brand-50',
    variant === 'danger' && 'text-red-700 hover:bg-red-50',
  );

export function Button({ variant, size, loading, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button {...rest} disabled={disabled || loading} className={cx(buttonClass(variant, size), className)}>
      {loading && <Spinner small />}
      {children}
    </button>
  );
}

export function Spinner({ small }: { small?: boolean }) {
  return (
    <span
      aria-hidden
      className={cx('inline-block animate-spin rounded-full border-2 border-current border-r-transparent', small ? 'h-4 w-4' : 'h-7 w-7')}
    />
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-3xl border border-stone-200/80 bg-white p-5 shadow-soft sm:p-8', className)}>{children}</div>;
}

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-stone-700">{label}</span>
      {children}
      {hint && !error && <span className="mt-1.5 block text-xs text-stone-500">{hint}</span>}
      {error && <span className="mt-1.5 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx(
        'w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-base text-stone-900 sm:text-sm transition placeholder:text-stone-400 hover:border-stone-400 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100 disabled:bg-stone-100 disabled:text-stone-500',
        props.className,
      )}
    />
  );
}

export function Alert({ tone = 'info', children }: { tone?: 'info' | 'success' | 'warning' | 'error'; children: ReactNode }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx(
        'flex gap-3 rounded-2xl border px-4 py-3.5 text-sm leading-relaxed',
        tone === 'info' && 'border-sky-200 bg-sky-50 text-sky-900',
        tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-900',
        tone === 'warning' && 'border-amber-200 bg-amber-50 text-amber-900',
        tone === 'error' && 'border-red-200 bg-red-50 text-red-800',
      )}
    >
      <span
        aria-hidden
        className={cx(
          'mt-1.5 h-2 w-2 shrink-0 rounded-full',
          tone === 'info' && 'bg-sky-500',
          tone === 'success' && 'bg-emerald-500',
          tone === 'warning' && 'bg-amber-500',
          tone === 'error' && 'bg-red-500',
        )}
      />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

const badgeTone: Record<string, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  PAID: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  APPROVED: 'bg-sky-100 text-sky-800 ring-sky-200',
  PENDING_PAYMENT: 'bg-amber-100 text-amber-800 ring-amber-200',
  PENDING_REVIEW: 'bg-amber-100 text-amber-800 ring-amber-200',
  USED: 'bg-stone-100 text-stone-600 ring-stone-200',
  EXPIRED: 'bg-stone-100 text-stone-600 ring-stone-200',
  CANCELLED: 'bg-stone-100 text-stone-600 ring-stone-200',
  REJECTED: 'bg-red-100 text-red-800 ring-red-200',
};

export function Badge({ status, children }: { status: string; children: ReactNode }) {
  return (
    <span className={cx('inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset', badgeTone[status] ?? 'bg-stone-100 text-stone-700 ring-stone-200')}>
      {children}
    </span>
  );
}

export function Eyebrow({ children, light }: { children: ReactNode; light?: boolean }) {
  return (
    <p className={cx('flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em]', light ? 'text-gold-300' : 'text-gold-600')}>
      <span className={cx('h-px w-6', light ? 'bg-gold-300' : 'bg-gold-500')} />
      {children}
    </p>
  );
}

/** Dark banner at the top of inner pages. */
export function PageHero({ eyebrow, title, subtitle, children }: { eyebrow?: string; title: ReactNode; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <section className="bg-club text-white">
      <div className="mx-auto max-w-6xl px-4 pb-24 pt-10 sm:px-6 sm:pt-16">
        {eyebrow && <Eyebrow light>{eyebrow}</Eyebrow>}
        <h1 className="mt-3 break-words font-display text-3xl font-medium tracking-tight sm:text-5xl">{title}</h1>
        {subtitle && <p className="mt-4 max-w-2xl break-words text-base leading-relaxed text-brand-100/90">{subtitle}</p>}
        {children}
      </div>
    </section>
  );
}

/** White content column that overlaps the page hero. */
export function PageBody({ children, narrow }: { children: ReactNode; narrow?: boolean }) {
  return <div className={cx('relative mx-auto -mt-16 px-4 pb-20 sm:px-6', narrow ? 'max-w-2xl' : 'max-w-6xl')}>{children}</div>;
}

export function SectionTitle({ eyebrow, title, subtitle }: { eyebrow?: string; title: string; subtitle?: ReactNode }) {
  return (
    <div className="mb-6 sm:mb-8">
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 className="mt-2 font-display text-2xl font-medium tracking-tight text-brand-900 sm:text-4xl">{title}</h2>
      {subtitle && <p className="mt-3 max-w-2xl text-stone-600">{subtitle}</p>}
    </div>
  );
}

export function Steps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-2 sm:gap-3">
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s} className="flex flex-1 items-center gap-2 sm:gap-3">
            <span
              className={cx(
                'grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-semibold transition',
                done && 'bg-gold-400 text-brand-950',
                active && 'bg-white text-brand-900 ring-4 ring-gold-400/40',
                !done && !active && 'bg-white/10 text-white/70 ring-1 ring-white/20',
              )}
            >
              {done ? <Check width={16} height={16} strokeWidth={2.5} /> : i + 1}
            </span>
            <span className={cx('hidden text-sm font-medium sm:block', active || done ? 'text-white' : 'text-white/60')}>{s}</span>
            {i < steps.length - 1 && <span className={cx('h-px flex-1', done ? 'bg-gold-400' : 'bg-white/20')} />}
          </li>
        );
      })}
    </ol>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <Alert tone="error">{error instanceof Error ? error.message : 'Something went wrong'}</Alert>;
}

export function Loading() {
  return (
    <div className="flex justify-center py-24 text-brand-600">
      <Spinner />
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="rounded-3xl border border-dashed border-stone-300 bg-white/60 px-6 py-10 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-brand-50 text-brand-600">{icon}</div>
      <p className="mt-4 font-semibold text-stone-900">{title}</p>
      {children && <div className="mt-1 text-sm text-stone-600">{children}</div>}
    </div>
  );
}
