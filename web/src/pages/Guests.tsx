import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Users } from '../components/icons';
import { PassGrid, RequestSummary } from '../components/Passes';
import { PeopleEditor, peopleReady } from '../components/PeopleEditor';
import { Button, Card, Empty, ErrorText, Field, Input, Loading, PageBody, PageHero } from '../components/ui';
import { api, type Checkout, type IdCheck, type Membership, type PersonDraft, type VisitRequest } from '../lib/api';
import { addDaysIso, guestPricing, money, todayCairo } from '../lib/format';
import { useMe, type MeResponse } from '../lib/hooks';

const goPay = (c: Checkout) => window.location.assign(c.checkoutUrl);

/** Members invite guests for a day; every invite waits for the club's approval, then the member pays. */
export function Guests() {
  const me = useMe();
  const memberships = useQuery({
    queryKey: ['memberships'],
    queryFn: () => api.get<{ memberships: Membership[] }>('/me/memberships'),
    enabled: me.data?.member.status === 'APPROVED',
  });
  if (me.isLoading) return <Loading />;
  if (!me.data) return <Navigate to="/login" replace />;
  const { member, club } = me.data;
  if (member.status === 'APPROVED' && memberships.isLoading) return <Loading />;

  const today = todayCairo();
  const active = memberships.data?.memberships.find((m) => m.status === 'ACTIVE' && m.endsAt && m.endsAt >= today);

  return (
    <>
      {/* The pricing lives in the hero: headings inside PageBody would sit on the dark hero overlap. */}
      <PageHero
        eyebrow={club.name}
        title="Invite guests"
        subtitle={
          active?.guestsPerDay
            ? `${guestPricing(club).sentence}. Up to ${active.guestsPerDay} per day. The club approves each invite, then you pay online.`
            : 'Bring family and friends to the club for a day.'
        }
      />
      <PageBody>
        {active ? (
          <GuestsSection me={me.data} membership={active} />
        ) : (
          <Empty icon={<Users />} title="You need an active membership to invite guests">
            <Link to="/account#plans" className="font-semibold text-brand-700 hover:underline">
              Choose a plan
            </Link>
          </Empty>
        )}
      </PageBody>
    </>
  );
}

function GuestsSection({ me, membership }: { me: MeResponse; membership: Membership }) {
  const qc = useQueryClient();
  const today = todayCairo();
  const lastDay = membership.endsAt && membership.endsAt < addDaysIso(today, 60) ? membership.endsAt : addDaysIso(today, 60);
  const [visitDate, setVisitDate] = useState(today);
  const [guests, setGuests] = useState<PersonDraft[]>([{ fullName: '', nationalId: '' }]);
  const requests = useQuery({ queryKey: ['guest-requests'], queryFn: () => api.get<{ requests: VisitRequest[] }>('/me/guest-requests') });

  const people = guests.map((g) => ({ fullName: g.fullName, nationalId: g.nationalId, phone: g.phone }));
  const ready = peopleReady(guests);
  const quote = useQuery({
    queryKey: ['guest-quote', visitDate, people],
    queryFn: () => api.post<{ total: number; guests: { fullName: string; price: number }[] }>('/me/guest-quote', { visitDate, guests: people }),
    enabled: ready,
    retry: false,
  });
  const invite = useMutation({
    mutationFn: async () => {
      // Each guest's ID photo is saved with their typed number; the admin compares the two.
      const withPhotos = [];
      for (const g of guests) {
        const form = new FormData();
        form.append('clubId', me.club.id);
        form.append('purpose', 'guest');
        form.append('nationalId', g.nationalId);
        form.append('photo', g.photo!);
        const check = await api.post<IdCheck>('/id-check', form);
        withPhotos.push({ fullName: g.fullName, nationalId: g.nationalId, phone: g.phone, idCheckId: check.checkId });
      }
      return api.post<{ request: VisitRequest }>('/me/guest-requests', { visitDate, guests: withPhotos });
    },
    onSuccess: async ({ request }) => {
      setGuests([{ fullName: '', nationalId: '' }]);
      await qc.invalidateQueries({ queryKey: ['guest-requests'] });
      if (request.status === 'APPROVED') goPay(await api.post<Checkout>(`/me/guest-requests/${request.id}/pay`));
    },
  });
  const pay = useMutation({ mutationFn: (id: string) => api.post<Checkout>(`/me/guest-requests/${id}/pay`), onSuccess: goPay });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/me/guest-requests/${id}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['guest-requests'] }),
  });

  if (!membership.guestsPerDay) {
    return (
      <section id="guests" className="scroll-mt-24">
        <Empty icon={<Users />} title="Your plan does not include guests">
          The club has not enabled guest invites for this plan yet. Please contact the club.
        </Empty>
      </section>
    );
  }
  const currency = me.club.currency;
  const list = requests.data?.requests ?? [];

  return (
    <section id="guests" className="scroll-mt-24">
      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[1fr_1.1fr]">
        <Card className="space-y-5">
          <Field label="Visit date">
            <Input type="date" value={visitDate} min={today} max={lastDay} onChange={(e) => setVisitDate(e.target.value)} className="sm:max-w-xs" />
          </Field>
          <PeopleEditor people={guests} onChange={setGuests} max={membership.guestsPerDay} withPhone withIdPhoto addLabel="Add guest" />
          {quote.data && (
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-2xl bg-brand-50 px-5 py-4">
              <span className="text-sm text-brand-800">Total for {quote.data.guests.length} guest(s)</span>
              <span className="font-display text-2xl text-brand-900">{money(quote.data.total, currency)}</span>
            </div>
          )}
          {quote.error && <ErrorText error={quote.error} />}
          <ErrorText error={invite.error} />
          <Button variant="gold" size="lg" className="w-full" onClick={() => invite.mutate()} disabled={!ready || !quote.data || guests.some((g) => !g.photo)} loading={invite.isPending}>
            Send invitation
          </Button>
        </Card>

        <div className="space-y-4">
          {list.length === 0 && (
            <Empty icon={<Users />} title="No guests yet">
              Your invitations and their QR codes will appear here.
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
        </div>
      </div>
    </section>
  );
}
