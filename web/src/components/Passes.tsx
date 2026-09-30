import { QRCodeSVG } from 'qrcode.react';
import type { Pass, VisitRequest } from '../lib/api';
import { money, niceDate, statusLabel } from '../lib/format';
import { Calendar, Users } from './icons';
import { Badge, cx } from './ui';

/** Ticket-style passes with a tear line; the QR appears once paid. */
export function PassGrid({ passes, currency }: { passes: Pass[]; currency: string }) {
  return (
    <div className="@container">
    <div className={cx('grid grid-cols-1 gap-5', passes.length > 1 && '@xl:grid-cols-2 @4xl:grid-cols-3', passes.length === 1 && 'mx-auto max-w-sm')}>
      {passes.map((p) => (
        <div key={p.id} className={cx('overflow-hidden rounded-3xl bg-white shadow-soft ring-1 ring-stone-200', p.status === 'USED' && 'opacity-70')}>
          <div className="bg-club px-5 py-4 text-white">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold-300">{p.kind === 'GUEST' ? 'Guest pass' : 'Day pass'}</p>
              <Badge status={p.status}>{statusLabel[p.status] ?? p.status}</Badge>
            </div>
            <p className="mt-2 break-words font-display text-xl">{p.fullName}</p>
            <p className="text-xs text-brand-100/70">{niceDate(p.visitDate)}</p>
          </div>
          <div className="relative border-t-2 border-dashed border-stone-200">
            <span aria-hidden className="absolute -left-3 -top-3 h-6 w-6 rounded-full bg-cream" />
            <span aria-hidden className="absolute -right-3 -top-3 h-6 w-6 rounded-full bg-cream" />
          </div>
          <div className="flex flex-col items-center px-4 py-5">
            {p.qrToken ? (
              <>
                <div className="w-full max-w-[320px] rounded-2xl bg-white p-2 ring-1 ring-stone-200">
                  <QRCodeSVG value={p.qrToken} size={320} level="M" marginSize={1} fgColor="#062a1f" style={{ width: '100%', height: 'auto', display: 'block' }} />
                </div>
                <p className="mt-3 max-w-full break-all text-center font-mono text-[11px] text-stone-400">{p.qrToken}</p>
              </>
            ) : (
              <p className="py-6 text-sm text-stone-500">{money(p.price, currency)}</p>
            )}
            <p className="mt-1 text-xs text-stone-400">{p.nationalIdMasked}</p>
          </div>
        </div>
      ))}
    </div>
    </div>
  );
}

export function RequestSummary({ r, currency }: { r: VisitRequest; currency: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-700">{r.kind === 'GUEST' ? <Users /> : <Calendar />}</div>
        <div className="min-w-0">
          <p className="font-semibold text-stone-900">
            {r.kind === 'GUEST' ? 'Guests' : 'Day pass'} · {niceDate(r.visitDate)}
          </p>
          <p className="text-sm text-stone-500">
            {r.passes.length} {r.passes.length === 1 ? 'person' : 'people'} · {money(r.total, currency)}
          </p>
        </div>
      </div>
      <Badge status={r.status}>{statusLabel[r.status] ?? r.status}</Badge>
    </div>
  );
}
