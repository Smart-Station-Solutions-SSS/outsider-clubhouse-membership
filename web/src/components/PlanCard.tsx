import type { ReactNode } from 'react';
import { money, term } from '../lib/format';
import { Check } from './icons';
import { cx } from './ui';

/** One membership plan. `featured` renders the dark "best value" variant. */
export function PlanCard({
  name,
  description,
  termMonths,
  guestsPerDay,
  guestTerms,
  price,
  currency,
  priceNote,
  featured,
  action,
}: {
  name: string;
  description: string | null;
  termMonths: number;
  guestsPerDay: number;
  /** e.g. "at 25% off" or "from 150 EGP each" (see guestPricing). */
  guestTerms: string;
  price: number | null;
  currency: string;
  priceNote?: string;
  featured?: boolean;
  action: ReactNode;
}) {
  const perMonth = price !== null && termMonths > 1 ? price / termMonths : null;
  const perks = [
    'Full clubhouse access',
    guestsPerDay ? `${guestsPerDay} guest${guestsPerDay > 1 ? 's' : ''} a day ${guestTerms}` : 'Member-only access',
    'Digital membership card',
  ];

  return (
    <div
      className={cx(
        'relative flex flex-col rounded-3xl p-6 transition sm:p-7 duration-300 hover:-translate-y-1',
        featured ? 'bg-club text-white shadow-lift ring-1 ring-gold-400/40' : 'border border-stone-200/80 bg-white shadow-soft hover:shadow-lift',
      )}
    >
      {featured && (
        <span className="absolute -top-3 left-7 rounded-full bg-gradient-to-b from-gold-300 to-gold-500 px-3 py-1 text-xs font-semibold text-brand-950 shadow-soft">
          Best value
        </span>
      )}
      <p className={cx('text-xs font-semibold uppercase tracking-[0.2em]', featured ? 'text-gold-300' : 'text-gold-600')}>{term(termMonths)}</p>
      <h3 className={cx('mt-2 font-display text-2xl font-medium', featured ? 'text-white' : 'text-brand-900')}>{name}</h3>
      {description && <p className={cx('mt-2 text-sm', featured ? 'text-brand-100/80' : 'text-stone-600')}>{description}</p>}

      <div className="mt-6 min-h-[4.5rem]">
        {price === null ? (
          <p className={cx('text-sm', featured ? 'text-brand-100/70' : 'text-stone-500')}>Not offered for this age group</p>
        ) : (
          <>
            <p className="flex flex-wrap items-baseline gap-x-1.5">
              <span className={cx('font-display text-4xl font-medium', featured ? 'text-gold-foil' : 'text-brand-900')}>
                {price.toLocaleString('en-EG')}
              </span>
              <span className={cx('text-sm font-medium', featured ? 'text-brand-100/80' : 'text-stone-500')}>{currency}</span>
            </p>
            <p className={cx('mt-1 text-xs', featured ? 'text-brand-100/70' : 'text-stone-500')}>
              {perMonth ? `≈ ${money(Math.round(perMonth), currency)} / month` : priceNote ?? 'per person'}
            </p>
          </>
        )}
      </div>

      <ul className="mt-6 space-y-2.5 text-sm">
        {perks.map((p) => (
          <li key={p} className="flex items-center gap-2.5">
            <span className={cx('grid h-5 w-5 shrink-0 place-items-center rounded-full', featured ? 'bg-gold-400/20 text-gold-300' : 'bg-brand-50 text-brand-600')}>
              <Check width={13} height={13} strokeWidth={2.5} />
            </span>
            <span className={featured ? 'text-brand-50' : 'text-stone-700'}>{p}</span>
          </li>
        ))}
      </ul>
      <div className="mt-8 flex-1" />
      {action}
    </div>
  );
}
