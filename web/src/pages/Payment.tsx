import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { CardIcon, Check, Lock, X } from '../components/icons';
import { Button, buttonClass, ErrorText, Loading, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { money } from '../lib/format';

type Status = { id: string; status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'CANCELED'; amount: number; currency: string; kind: 'MEMBERSHIP' | 'VISIT'; failureReason: string | null };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-club min-h-[70vh] px-4 py-10 sm:py-16">
      <div className="animate-rise mx-auto max-w-md rounded-[2rem] bg-white p-6 text-center shadow-lift sm:p-10">{children}</div>
    </div>
  );
}

/** Where Paymob sends the buyer back. The webhook decides the outcome; this page polls it. */
export function PaymentResult() {
  const [params] = useSearchParams();
  const paymentId = params.get('paymentId') ?? '';
  const q = useQuery({
    queryKey: ['payment', paymentId],
    queryFn: () => api.get<Status>(`/payments/${paymentId}/status`),
    enabled: Boolean(paymentId),
    refetchInterval: (query) => (query.state.data?.status === 'PENDING' ? 3000 : false),
  });

  if (!paymentId) return <Shell><ErrorText error={new Error('Missing payment reference')} /></Shell>;
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <Shell><ErrorText error={q.error} /></Shell>;
  const p = q.data;
  const ok = p.status === 'COMPLETED';
  const failed = p.status === 'FAILED' || p.status === 'CANCELED';

  return (
    <Shell>
      <div
        className={
          'mx-auto grid h-20 w-20 place-items-center rounded-full ' +
          (ok ? 'bg-emerald-100 text-emerald-600' : failed ? 'bg-red-100 text-red-600' : 'bg-brand-50 text-brand-600')
        }
      >
        {ok ? <Check width={38} height={38} strokeWidth={2.2} /> : failed ? <X width={36} height={36} /> : <Spinner />}
      </div>
      <h1 className="mt-6 font-display text-2xl text-brand-900 sm:text-3xl">
        {ok ? 'Payment received' : failed ? 'Payment not completed' : 'Confirming payment…'}
      </h1>
      <p className="mt-3 text-stone-600">
        {ok
          ? `${money(p.amount, p.currency)} paid. ${p.kind === 'MEMBERSHIP' ? 'Your membership is now active.' : 'Your QR passes are ready.'}`
          : failed
            ? `The payment did not go through${p.failureReason ? ` (${p.failureReason})` : ''}. You can try again.`
            : 'This usually takes a few seconds. Please keep this page open.'}
      </p>
      <div className="mt-8">
        {p.kind === 'MEMBERSHIP' ? (
          <Link to="/account" className={buttonClass(ok ? 'gold' : 'primary', 'lg')}>
            Go to my account
          </Link>
        ) : (
          <p className="text-sm text-stone-500">Open the link from your email to see your QR codes.</p>
        )}
      </div>
    </Shell>
  );
}

/** Development-only stand-in for the Paymob checkout (PAYMOB_MOCK=true on the server). */
export function MockPay() {
  const { paymentId } = useParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const q = useQuery({ queryKey: ['payment', paymentId], queryFn: () => api.get<Status>(`/payments/${paymentId}/status`) });

  const finish = async (success: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/payments/${paymentId}/mock`, { success });
      window.location.assign(`/payment/result?paymentId=${paymentId}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  if (q.isLoading) return <Loading />;
  return (
    <Shell>
      <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">Test mode — no card is charged</span>
      <div className="mx-auto mt-6 grid h-16 w-16 place-items-center rounded-2xl bg-brand-50 text-brand-700">
        <CardIcon width={30} height={30} />
      </div>
      <p className="mt-4 text-sm text-stone-500">Amount due</p>
      {q.data && <p className="font-display text-4xl text-brand-900">{money(q.data.amount, q.data.currency)}</p>}
      <div className="mt-6 space-y-3 text-left">
        <ErrorText error={error ?? q.error} />
      </div>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Button variant="gold" size="lg" className="flex-1" onClick={() => finish(true)} loading={busy}>
          Pay now
        </Button>
        <Button variant="secondary" size="lg" onClick={() => finish(false)} disabled={busy}>
          Decline
        </Button>
      </div>
      <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs text-stone-400">
        <Lock width={13} height={13} className="shrink-0" /> In production this is Paymob's secure checkout
      </p>
    </Shell>
  );
}
