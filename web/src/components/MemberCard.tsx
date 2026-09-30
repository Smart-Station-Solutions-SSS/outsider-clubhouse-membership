import { Logo } from './icons';
import { cx } from './ui';

/** The membership card, drawn like the physical card (also used as the hero illustration). */
export function MemberCard({
  clubName,
  holder,
  plan,
  number,
  validFrom,
  validTo,
  className,
}: {
  clubName: string;
  holder: string;
  plan: string;
  number: string;
  validFrom?: string;
  validTo?: string;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'card-foil @container relative aspect-[1.586] w-full overflow-hidden rounded-[1.4rem] text-white shadow-lift ring-1 ring-white/10',
        className,
      )}
    >
      <div aria-hidden className="absolute -right-16 -top-16 h-56 w-56 rounded-full border border-gold-300/20" />
      <div aria-hidden className="absolute -right-6 -top-6 h-36 w-36 rounded-full border border-gold-300/20" />
      <div className="relative flex h-full flex-col justify-between p-4 @xs:p-5 @sm:p-7">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 @sm:gap-2.5">
            <Logo className="h-6 w-6 shrink-0 @sm:h-8 @sm:w-8" />
            <span className="truncate font-display text-base @sm:text-lg">{clubName}</span>
          </div>
          <span className="shrink-0 whitespace-nowrap rounded-full bg-gold-300/15 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] @sm:px-3 @sm:py-1 @sm:text-[11px] text-gold-200 ring-1 ring-gold-300/30">
            {plan}
          </span>
        </div>
        <div aria-hidden className="h-6 w-8 rounded-md @xs:h-7 @xs:w-10 @sm:h-9 @sm:w-12 bg-gradient-to-br from-gold-200 via-gold-400 to-gold-600 opacity-90" />
        <div>
          <p className="truncate font-mono text-sm tracking-[0.15em] text-white/95 @xs:text-base @sm:text-lg @sm:tracking-[0.2em] @md:text-xl">{number}</p>
          <div className="mt-2 flex items-end justify-between gap-3 @sm:mt-3 @sm:gap-4">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.2em] text-white/50">Member</p>
              <p className="truncate text-sm font-medium @sm:text-base">{holder}</p>
            </div>
            {validTo && (
              <div className="shrink-0 text-right">
                <p className="text-[10px] uppercase tracking-[0.2em] text-white/50">Valid</p>
                <p className="text-sm font-medium @sm:text-base">
                  {validFrom ? `${validFrom} – ` : ''}
                  {validTo}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
