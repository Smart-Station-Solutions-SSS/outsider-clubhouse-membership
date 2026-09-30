import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Calendar, Lock } from '../components/icons';
import { IdPhotoCheck } from '../components/IdPhotoCheck';
import { PassGrid, RequestSummary } from '../components/Passes';
import { PeopleEditor, peopleReady } from '../components/PeopleEditor';
import { Button, Card, Empty, ErrorText, Field, Input, Loading, PageBody, PageHero } from '../components/ui';
import { api, type Checkout, type IdCheck, type Membership, type PersonDraft, type VisitRequest } from '../lib/api';
import { addDaysIso, money, niceDate, todayCairo } from '../lib/format';
import { useClub, useMe } from '../lib/hooks';

const goPay = (c: Checkout) => window.location.assign(c.checkoutUrl);

type Quote = { total: number; people: { fullName: string; price: number }[] };

/**
 * Day passes are booked from an account by anyone without an active membership (members with one
 * invite guests instead). The account holder always comes: with the ID on file from a membership
 * application, or — email-only account — with their name, mobile and an ID photo given here.
 */
export function DayPass() {
  const me = useMe();
  const location = useLocation();
  const { catalog } = useClub();
  const memberships = useQuery({
    queryKey: ['memberships'],
    queryFn: () => api.get<{ memberships: Membership[] }>('/me/memberships'),
    enabled: me.data?.member.status === 'APPROVED',
  });

  if (me.isLoading) return <Loading />;
  if (!me.data) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (memberships.isLoading && me.data.member.status === 'APPROVED') return <Loading />;
  const today = todayCairo();
  const active = memberships.data?.memberships.some((m) => m.status === 'ACTIVE' && m.endsAt && m.endsAt >= today);
  if (active) return <Navigate to="/guests" replace />;

  const auto = catalog?.dayUseApproval === 'AUTO';
  return (
    <>
      <PageHero
        eyebrow="Day pass"
        title="A day at the club"
        subtitle={
          auto
            ? 'No membership needed. Pay online and get a QR code for everyone in your group.'
            : 'No membership needed. Send a request — once the club approves it, pay here and get your QR codes.'
        }
      />
      <PageBody>
        {me.data.member.status === 'REJECTED' ? (
          <Empty icon={<Calendar />} title="Your account was not approved">
            Please contact the club for details.
          </Empty>
        ) : (
          <DayPassBooking
            clubId={me.data.club.id}
            onFile={me.data.member.status === 'ACCOUNT' ? null : me.data.member.fullName}
            currency={me.data.club.currency}
            auto={auto}
          />
        )}
      </PageBody>
    </>
  );
}

function DayPassBooking({ clubId, onFile, currency, auto }: { clubId: string; onFile: string | null; currency: string; auto: boolean }) {
  const qc = useQueryClient();
  const today = todayCairo();
  const [visitDate, setVisitDate] = useState(today);
  const [companions, setCompanions] = useState<PersonDraft[]>([]);
  // Email-only account: who is booking, proven with a photo of their ID.
  const [buyer, setBuyer] = useState({ fullName: '', phone: '' });
  const [check, setCheck] = useState<IdCheck | null>(null);
  const buyerReady = Boolean(onFile) || (buyer.fullName.trim().length >= 3 && buyer.phone.trim().length >= 8 && Boolean(check?.canSubmit && check.nationalId));
  const buyerBody = onFile || !check?.nationalId ? undefined : { ...buyer, nationalId: check.nationalId, idCheckId: check.checkId };
  const requests = useQuery({ queryKey: ['day-use'], queryFn: () => api.get<{ requests: VisitRequest[] }>('/me/day-use') });

  const ready = buyerReady && (companions.length === 0 || peopleReady(companions));
  const quote = useQuery({
    queryKey: ['day-quote', visitDate, companions, buyerBody?.fullName, buyerBody?.nationalId],
    queryFn: () =>
      api.post<Quote>('/me/day-use/quote', {
        visitDate,
        companions,
        buyer: buyerBody && { fullName: buyerBody.fullName, nationalId: buyerBody.nationalId },
      }),
    enabled: ready,
    retry: false,
  });
  const book = useMutation({
    mutationFn: () => api.post<{ request: VisitRequest }>('/me/day-use', { visitDate, companions, buyer: buyerBody }),
    onSuccess: async ({ request }) => {
      setCompanions([]);
      if (!onFile) setCheck(null);
      await qc.invalidateQueries({ queryKey: ['day-use'] });
      if (request.status === 'APPROVED') goPay(await api.post<Checkout>(`/me/day-use/${request.id}/pay`));
    },
  });
  const pay = useMutation({ mutationFn: (id: string) => api.post<Checkout>(`/me/day-use/${id}/pay`), onSuccess: goPay });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/me/day-use/${id}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['day-use'] }),
  });
  const list = requests.data?.requests ?? [];

  return (
    <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[1fr_1.1fr]">
      <div className="space-y-6">
        <Section n={1} title="When">
          <Field label="Visit date">
            <Input type="date" value={visitDate} min={today} max={addDaysIso(today, 60)} onChange={(e) => setVisitDate(e.target.value)} className="sm:max-w-xs" />
          </Field>
        </Section>

        {!onFile && (
          <Section n={2} title="About you">
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field label="Full name (as on your ID)">
                  <Input value={buyer.fullName} onChange={(e) => setBuyer({ ...buyer, fullName: e.target.value })} autoComplete="name" />
                </Field>
                <Field label="Mobile number">
                  <Input type="tel" value={buyer.phone} onChange={(e) => setBuyer({ ...buyer, phone: e.target.value })} placeholder="01xxxxxxxxx" autoComplete="tel" />
                </Field>
              </div>
              <IdPhotoCheck clubId={clubId} purpose="day-use" adminReview={!auto} result={check} onResult={setCheck} />
            </div>
          </Section>
        )}

        <Section n={onFile ? 2 : 3} title="Who's coming?">
          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-2xl border border-stone-200 bg-stone-50/70 p-3 sm:p-4">
              <span className="min-w-0 flex-1 truncate font-medium text-stone-800">{onFile ?? (buyer.fullName || 'You')}</span>
              <span className="shrink-0 rounded-full bg-gold-100 px-2.5 py-1 text-xs font-semibold text-gold-600">{onFile ? 'You · ID on file' : 'You'}</span>
            </div>
            <PeopleEditor people={companions} onChange={setCompanions} max={9} addLabel="Add family member or friend" />
          </div>
        </Section>

        <Card className="space-y-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-600">Your visit · {niceDate(visitDate)}</p>
          {quote.data?.people.map((p, i) => (
            <div key={i} className="flex justify-between gap-3 text-sm">
              <span className="truncate text-stone-600">{p.fullName}</span>
              <span className="shrink-0 font-medium">{p.price === 0 ? 'Free' : money(p.price, currency)}</span>
            </div>
          ))}
          {quote.error && <ErrorText error={quote.error} />}
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 border-t border-stone-100 pt-4">
            <span className="text-sm text-stone-600">Total</span>
            <span className="font-display text-3xl text-brand-900">{quote.data ? money(quote.data.total, currency) : '—'}</span>
          </div>
          <ErrorText error={book.error} />
          <Button variant="gold" size="lg" className="w-full" onClick={() => book.mutate()} loading={book.isPending} disabled={!ready || !quote.data}>
            {auto ? 'Continue to payment' : 'Send request'}
          </Button>
          <p className="flex items-center justify-center gap-1.5 text-xs text-stone-500">
            <Lock width={13} height={13} /> Secure card payment by Paymob
          </p>
        </Card>
      </div>

      <div className="space-y-4">
        {list.length === 0 && (
          <Empty icon={<Calendar />} title="No day passes yet">
            Your requests and their QR codes will appear here.
          </Empty>
        )}
        {list.map((r) => (
          <Card key={r.id} className="space-y-5 sm:p-6">
            <RequestSummary r={r} currency={currency} />
            {r.status === 'REJECTED' && r.reviewNote && <p className="text-sm text-red-700">Reason: {r.reviewNote}</p>}
            {(r.status === 'APPROVED' || r.status === 'PENDING_REVIEW') && (
              <div className="flex flex-wrap gap-2">
                {r.status === 'APPROVED' && (
                  <Button variant="gold" onClick={() => pay.mutate(r.id)} loading={pay.isPending && pay.variables === r.id}>
                    Pay {money(r.total, currency)}
                  </Button>
                )}
                <Button variant="danger" onClick={() => cancel.mutate(r.id)}>
                  Cancel
                </Button>
              </div>
            )}
            {r.status === 'PAID' && <PassGrid passes={r.passes} currency={currency} />}
          </Card>
        ))}
        <ErrorText error={pay.error ?? cancel.error} />
        <p className="text-center text-xs text-stone-500">
          Have a membership? <Link to="/guests" className="font-semibold text-brand-700 hover:underline">Invite guests instead</Link>
        </p>
      </div>
    </div>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <Card>
      <div className="mb-5 flex items-center gap-3 sm:mb-6">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gold-100 text-sm font-semibold text-gold-600">{n}</span>
        <h2 className="font-display text-xl text-brand-900 sm:text-2xl">{title}</h2>
      </div>
      {children}
    </Card>
  );
}
