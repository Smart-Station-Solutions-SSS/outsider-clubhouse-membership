import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Clock, Shield, Users, X } from '../components/icons';
import { MemberCard } from '../components/MemberCard';
import { PlanCard } from '../components/PlanCard';
import { Alert, Button, buttonClass, Card, ErrorText, Loading, PageBody, PageHero, SectionTitle } from '../components/ui';
import { api, type Checkout, type Membership, type PlanQuote } from '../lib/api';
import { cardDate, daysUntil, guestPricing, money, niceDate, todayCairo } from '../lib/format';
import { useMe, type MeResponse } from '../lib/hooks';

const goPay = (c: Checkout) => window.location.assign(c.checkoutUrl);

export function Account() {
  const me = useMe();
  const location = useLocation();
  if (me.isLoading) return <Loading />;
  if (!me.data) return <Navigate to="/login" replace />;
  const { member, club } = me.data;
  const justJoined = (location.state as { justJoined?: string } | null)?.justJoined;

  return (
    <>
      <PageHero eyebrow={club.name} title={member.fullName ? `Hello, ${member.fullName.split(' ')[0]}` : 'Hello'} subtitle={member.email} />
      <PageBody>
        <div className="space-y-12 sm:space-y-16">
          {justJoined && (
            <Alert tone="success">
              {justJoined === 'APPROVED' ? 'Welcome! Your account is approved — choose a plan below.' : 'Application submitted! We will email you as soon as it is reviewed.'}
            </Alert>
          )}

          {member.status === 'ACCOUNT' && (
            <Card className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <div className="flex-1">
                <h2 className="font-display text-2xl text-brand-900">Your account is ready</h2>
                <p className="mt-1 text-stone-600">Book a day pass for you and your family, or apply for membership to get a card and invite guests.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link to="/day-pass" className={buttonClass('gold')}>
                  Book a day pass
                </Link>
                <Link to="/join" className={buttonClass('secondary')}>
                  Apply for membership
                </Link>
              </div>
            </Card>
          )}
          {member.status === 'PENDING_REVIEW' && (
            <Card className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
              <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-700">
                <Clock width={26} height={26} />
              </div>
              <div>
                <h2 className="font-display text-2xl text-brand-900">Your application is under review</h2>
                <p className="mt-1 text-stone-600">
                  The club is checking your details. You'll get an email as soon as you're approved — then you can choose a plan here.
                </p>
                {member.ocrStatus === 'MISMATCH_FLAGGED' && (
                  <p className="mt-2 text-sm text-stone-500">A staff member will check your ID photo against your ID number.</p>
                )}
              </div>
            </Card>
          )}
          {member.status === 'REJECTED' && (
            <Card className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
              <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-red-100 text-red-700">
                <X width={26} height={26} />
              </div>
              <div>
                <h2 className="font-display text-2xl text-brand-900">Application not approved</h2>
                <p className="mt-1 text-stone-600">
                  {member.reviewNote ? `Reason: ${member.reviewNote}. ` : ''}Please contact the club for details.
                </p>
              </div>
            </Card>
          )}
          {member.status === 'APPROVED' && <MembershipSection me={me.data} />}
        </div>
      </PageBody>
    </>
  );
}

function MembershipSection({ me }: { me: MeResponse }) {
  const qc = useQueryClient();
  const memberships = useQuery({ queryKey: ['memberships'], queryFn: () => api.get<{ memberships: Membership[] }>('/me/memberships') });
  const plans = useQuery({ queryKey: ['my-plans'], queryFn: () => api.get<{ currency: string; age: number; plans: PlanQuote[] }>('/me/plans') });

  const order = useMutation({
    mutationFn: async (planId: string) => {
      const { membership } = await api.post<{ membership: Membership }>('/me/memberships', { planId });
      return api.post<Checkout>(`/me/memberships/${membership.id}/pay`);
    },
    onSuccess: goPay,
    onSettled: () => qc.invalidateQueries({ queryKey: ['memberships'] }),
  });
  const pay = useMutation({ mutationFn: (id: string) => api.post<Checkout>(`/me/memberships/${id}/pay`), onSuccess: goPay });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/me/memberships/${id}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['memberships'] }),
  });

  // Home page links land on /account#plans; scroll there once the section exists.
  const { hash } = useLocation();
  const loaded = !memberships.isLoading && !plans.isLoading;
  useEffect(() => {
    if (loaded && hash) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth' });
  }, [loaded, hash]);

  if (!loaded) return <Loading />;
  const currency = me.club.currency;
  const list = memberships.data?.memberships ?? [];
  const today = todayCairo();
  const active = list.find((m) => m.status === 'ACTIVE' && m.endsAt && m.endsAt >= today);
  const pending = list.find((m) => m.status === 'PENDING_PAYMENT');
  const quotes = plans.data?.plans ?? [];
  const featuredId = [...quotes].sort((a, b) => b.termMonths - a.termMonths)[0]?.planId;

  return (
    <>
      <section className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[1.1fr_1fr]">
        {active ? (
          <MemberCard
            clubName={me.club.name}
            holder={me.member.fullName}
            plan={active.planName ?? 'Member'}
            number={active.cardNumber ?? ''}
            validFrom={cardDate(active.startsAt)}
            validTo={cardDate(active.endsAt)}
          />
        ) : (
          <Card className="flex min-h-56 flex-col justify-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-600">Approved</p>
            <h2 className="mt-2 font-display text-2xl text-brand-900 sm:text-3xl">You're in — pick a plan</h2>
            <p className="mt-2 text-stone-600">Your application is approved. Choose a membership below and pay online to activate your card.</p>
          </Card>
        )}
        <div className="space-y-4">
          {active?.endsAt && (
            <Card className="flex items-center justify-between p-6 sm:p-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-600">Membership</p>
                <p className="mt-1 text-sm text-stone-600">Renews or ends {niceDate(active.endsAt)}</p>
              </div>
              <div className="text-right">
                <p className="font-display text-4xl text-brand-900">{daysUntil(active.endsAt, today) + 1}</p>
                <p className="text-xs text-stone-500">days left</p>
              </div>
            </Card>
          )}
          <Card className="space-y-3 sm:p-6">
            <p className="flex items-center gap-2 text-sm text-stone-600">
              <Shield width={16} height={16} className="shrink-0 text-brand-600" /> ID verified · born {niceDate(me.member.dateOfBirth)}
            </p>
            {active && (
              <p className="flex items-center gap-2 text-sm text-stone-600">
                <Users width={16} height={16} className="shrink-0 text-brand-600" />
                {active.guestsPerDay ? `Up to ${active.guestsPerDay} guest(s) a day ${guestPricing(me.club).perGuest}` : 'This plan does not include guests'}
              </p>
            )}
          </Card>
          {pending && (
            <Card className="border-amber-200 bg-amber-50/60 sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">Awaiting payment</p>
              <p className="mt-2 font-display text-2xl text-brand-900">
                {pending.planName} · {money(pending.price, currency)}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="gold" onClick={() => pay.mutate(pending.id)} loading={pay.isPending}>
                  Pay now
                </Button>
                <Button variant="danger" onClick={() => cancel.mutate(pending.id)} loading={cancel.isPending}>
                  Cancel
                </Button>
              </div>
            </Card>
          )}
          <ErrorText error={pay.error ?? cancel.error} />
        </div>
      </section>

      <section id="plans" className="scroll-mt-24">
        <SectionTitle
          eyebrow="Plans"
          title={active ? 'Renew or upgrade' : 'Choose your plan'}
          subtitle={`Priced for your age (${plans.data?.age}).${active ? ' A renewal starts the day after your current card ends.' : ''}`}
        />
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {quotes.map((p) => (
            <PlanCard
              key={p.planId}
              name={p.name}
              description={p.description}
              termMonths={p.termMonths}
              guestsPerDay={p.guestsPerDay}
              guestTerms={guestPricing(me.club).perGuest}
              price={p.price}
              currency={currency}
              featured={p.planId === featuredId}
              action={
                <Button
                  variant={p.planId === featuredId ? 'gold' : 'primary'}
                  className="w-full"
                  disabled={p.price === null}
                  loading={order.isPending && order.variables === p.planId}
                  onClick={() => order.mutate(p.planId)}
                >
                  Choose & pay
                </Button>
              }
            />
          ))}
        </div>
        <div className="mt-4">
          <ErrorText error={order.error} />
        </div>
      </section>

    </>
  );
}
