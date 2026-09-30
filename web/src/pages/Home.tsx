import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Arrow, Calendar, CardIcon, Clock, Dumbbell, IdCard, Qr, Shield, Sparkle, Sun, Users, Waves } from '../components/icons';
import { MemberCard } from '../components/MemberCard';
import { RequestSummary } from '../components/Passes';
import { PlanCard } from '../components/PlanCard';
import { Badge, buttonClass, Card, cx, ErrorText, Eyebrow, Loading, SectionTitle } from '../components/ui';
import { api, type Membership, type VisitRequest } from '../lib/api';
import { cardDate, daysUntil, guestPricing, money, niceDate, term, todayCairo } from '../lib/format';
import { useClub, useMe, type MeResponse } from '../lib/hooks';

export function Home() {
  const { catalog, isLoading, error } = useClub();
  const me = useMe();
  // An email-only account (no membership application) sees the visitor home page.
  const member = me.data && me.data.member.status !== 'ACCOUNT' ? me.data.member : null;
  // Same query the account page uses, so the two stay in sync.
  const memberships = useQuery({
    queryKey: ['memberships'],
    queryFn: () => api.get<{ memberships: Membership[] }>('/me/memberships'),
    enabled: member?.status === 'APPROVED',
  });
  const [bandId, setBandId] = useState<string | null>(null);

  // Default to the adult band (the widest priced one) once prices load.
  useEffect(() => {
    if (!catalog || bandId) return;
    const counts = catalog.ageBands.map((b) => ({ id: b.id, n: catalog.plans.filter((p) => p.prices.some((c) => c.ageBandId === b.id)).length, min: b.minAge }));
    const adult = counts.filter((c) => c.min >= 18).sort((a, b) => b.n - a.n)[0] ?? counts[0];
    if (adult) setBandId(adult.id);
  }, [catalog, bandId]);

  if (isLoading) return <Loading />;
  if (error) return <div className="mx-auto max-w-3xl p-6"><ErrorText error={error} /></div>;
  if (!catalog) return <p className="p-10 text-center text-stone-600">No clubhouse is open for registration yet.</p>;

  const priceFor = (prices: { ageBandId: string; price: number }[]) => prices.find((p) => p.ageBandId === bandId)?.price ?? null;
  const featuredId = [...catalog.plans].sort((a, b) => b.termMonths - a.termMonths)[0]?.id;
  const guests = guestPricing(catalog);
  const cheapestDay = Math.min(...catalog.dayUseFees.filter((f) => f.price > 0).map((f) => f.price));
  const joinTo = me.data ? '/account' : '/join';
  const today = todayCairo();
  const active = memberships.data?.memberships.find((m) => m.status === 'ACTIVE' && m.endsAt && m.endsAt >= today) ?? null;
  const firstName = member?.fullName.split(' ')[0] ?? '';

  return (
    <>
      {/* ── Hero ── */}
      <section className="bg-club relative overflow-hidden text-white">
        <div className="mx-auto grid grid-cols-1 max-w-6xl items-center gap-12 px-4 pb-20 pt-12 sm:px-6 sm:pb-24 sm:pt-16 lg:grid-cols-[1.1fr_1fr] lg:gap-14 lg:pt-24">
          <div className="animate-rise">
            <Eyebrow light>{member ? 'Welcome back' : 'Membership · Day passes · Guests'}</Eyebrow>
            <h1 className="mt-5 break-words font-display text-4xl font-medium leading-[1.05] tracking-tight sm:text-6xl">
              {member ? 'Good to see you, ' : 'Your place at '}
              <span className="text-gold-foil italic">{member ? firstName : catalog.name}</span>
            </h1>
            <p className="mt-6 max-w-lg text-base leading-relaxed sm:text-lg text-brand-100/85">
              {!member
                ? 'Apply online in minutes with your national ID. Choose a plan priced for your age, pay securely, and walk in with your digital card.'
                : active
                  ? `Your ${active.planName ?? ''} membership is active until ${niceDate(active.endsAt)}. Show your card at the gate and invite family and friends as your guests.`
                  : member.status === 'APPROVED'
                    ? 'Your application is approved. Pick a plan and pay online to activate your membership card.'
                    : member.status === 'PENDING_REVIEW'
                      ? "Thanks for applying. The club is reviewing your application and we'll email you as soon as it is approved."
                      : 'Your application was not approved. See your account for the reason and next steps.'}
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link to={joinTo} className={buttonClass('gold', 'lg')}>
                {!member ? 'Become a member' : active ? 'View my card' : member.status === 'APPROVED' ? 'Choose a plan' : 'Go to my account'}{' '}
                <Arrow width={18} height={18} />
              </Link>
              {!member && (
                <Link to="/day-pass" className={cx(buttonClass('secondary', 'lg'), 'border-white/25 bg-white/5 text-white hover:border-white/50 hover:bg-white/10 hover:text-white')}>
                  Book a day pass
                </Link>
              )}
            </div>
            <dl className="mt-10 grid max-w-md grid-cols-3 gap-4 border-t sm:mt-12 sm:gap-6 border-white/10 pt-6">
              {active?.endsAt ? (
                <>
                  <Stat value={String(daysUntil(active.endsAt, today) + 1)} label="Days left" />
                  <Stat value={String(active.guestsPerDay ?? 0)} label="Guests a day" />
                  <Stat value={guests.stat.value} label={guests.stat.label} />
                </>
              ) : (
                <>
                  <Stat value={String(catalog.plans.length)} label="Plans" />
                  {!member && <Stat value={Number.isFinite(cheapestDay) ? `${cheapestDay}` : '—'} label={`${catalog.currency} day pass from`} />}
                  <Stat value={guests.stat.value} label={guests.stat.label} />
                </>
              )}
            </dl>
          </div>

          <div className="relative mx-auto w-full max-w-sm animate-rise sm:max-w-md [animation-delay:150ms]">
            <div aria-hidden className="absolute -inset-10 rounded-full bg-gold-400/10 blur-3xl" />
            {active ? (
              <MemberCard
                clubName={me.data?.club.name ?? catalog.name}
                holder={member?.fullName ?? ''}
                plan={active.planName ?? 'Member'}
                number={active.cardNumber ?? ''}
                validFrom={cardDate(active.startsAt)}
                validTo={cardDate(active.endsAt)}
                className="relative -rotate-3"
              />
            ) : (
              <MemberCard clubName={catalog.name} holder={member?.fullName ?? 'Your name here'} plan="Annual" number="OCM · 2026 · 0001" validTo="Dec 2027" className="relative -rotate-3" />
            )}
            <div className="relative mt-6 ml-auto w-5/6 rotate-2 rounded-2xl bg-white p-3 sm:w-3/4 sm:p-4 text-stone-800 shadow-lift">
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
                  <Qr />
                </div>
                <div>
                  <p className="text-sm font-semibold">{active ? 'Member entry' : member ? 'Your digital card' : 'Day pass · Saturday'}</p>
                  <p className="text-xs text-stone-500">
                    {active ? 'Show your card at the gate' : member ? 'Ready as soon as your plan is paid' : 'Scan at the gate — no queue'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works (visitors only) ── */}
      {!member && (
      <section className="relative z-10 mx-auto -mt-12 max-w-6xl px-4 sm:px-6">
        <div className="grid grid-cols-1 gap-6 rounded-3xl bg-white p-5 shadow-lift ring-1 ring-stone-200/60 sm:p-8 md:grid-cols-3 md:gap-8">
          <HowStep n={1} icon={<IdCard />} title="Verify your ID">
            Upload a photo of your national ID. We read your age from it, so you only ever see your real price.
          </HowStep>
          <HowStep n={2} icon={<Shield />} title={catalog.membershipApproval === 'AUTO' ? 'Instant approval' : 'Quick review'}>
            {catalog.membershipApproval === 'AUTO'
              ? 'Verified applicants are approved on the spot.'
              : 'The club reviews your application and emails you as soon as it is approved.'}
          </HowStep>
          <HowStep n={3} icon={<CardIcon />} title="Pay & walk in">
            Pay by card through Paymob. Your digital membership card is ready immediately.
          </HowStep>
        </div>
      </section>
      )}

      {/* ── Member dashboard (signed-in members only) ── */}
      {me.data && member && <MemberSections me={me.data} active={active} />}

      {/* ── Plans (visitors only; members pick theirs in their account) ── */}
      {!member && (
      <section id="plans" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="flex flex-wrap items-end justify-between gap-x-6">
          <SectionTitle eyebrow="Membership" title="Choose your plan" subtitle="Prices depend on age. Pick an age group to see what you would pay." />
          <div className="mb-8 flex flex-wrap gap-2" role="radiogroup" aria-label="Age group">
            {catalog.ageBands.map((b) => (
              <button
                key={b.id}
                role="radio"
                aria-checked={bandId === b.id}
                onClick={() => setBandId(b.id)}
                className={cx(
                  'rounded-full px-4 py-2 text-sm font-medium transition',
                  bandId === b.id ? 'bg-brand-800 text-white shadow-soft' : 'bg-white text-stone-600 ring-1 ring-stone-200 hover:ring-brand-400',
                )}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
        {catalog.plans.length === 0 && (
          <div className="rounded-3xl border border-dashed border-stone-300 bg-white/60 px-6 py-12 text-center">
            <p className="font-display text-2xl text-brand-900">Membership plans are coming soon</p>
            <p className="mt-2 text-sm text-stone-600">The club is preparing its plans and prices. Please check back shortly.</p>
          </div>
        )}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {catalog.plans.map((p) => (
            <PlanCard
              key={p.id}
              name={p.name}
              description={p.description}
              termMonths={p.termMonths}
              guestsPerDay={p.guestsPerDay}
              guestTerms={guests.perGuest}
              price={priceFor(p.prices)}
              currency={catalog.currency}
              featured={p.id === featuredId}
              action={
                <Link to={joinTo} className={cx(buttonClass(p.id === featuredId ? 'gold' : 'primary'), 'w-full')}>
                  {me.data ? 'Choose in my account' : 'Apply now'}
                </Link>
              }
            />
          ))}
        </div>
      </section>
      )}

      {/* ── Amenities ── */}
      <section className="border-y border-stone-200/70 bg-white">
        <div className="mx-auto grid grid-cols-1 max-w-6xl gap-8 px-4 py-14 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          <Amenity icon={<Waves />} title="Pools" text="Swim, relax and cool off all season." />
          <Amenity icon={<Dumbbell />} title="Fitness" text="A fully equipped gym for members." />
          <Amenity icon={<Sun />} title="Outdoors" text="Lawns, courts and family areas." />
          <Amenity icon={<Users />} title="Bring guests" text={guests.amenity} />
        </div>
      </section>

      {/* ── Day pass (visitors only; members invite guests from their account) ── */}
      {!member && (
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="bg-club grid grid-cols-1 overflow-hidden rounded-[2rem] text-white shadow-lift md:grid-cols-2">
          <div className="p-6 sm:p-12">
            <Eyebrow light>No membership needed</Eyebrow>
            <h2 className="mt-3 font-display text-3xl font-medium tracking-tight sm:text-4xl">Just visiting? Get a day pass.</h2>
            <p className="mt-4 text-brand-100/85">
              Book a single day for you, your family or friends. Everyone gets their own QR code to scan at the gate.
            </p>
            <Link to="/day-pass" className={cx(buttonClass('gold', 'lg'), 'mt-8')}>
              <Calendar width={18} height={18} /> Book a day pass
            </Link>
          </div>
          <div className="bg-white/[0.04] p-6 sm:p-12">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-300">Day pass prices</p>
            <dl className="mt-5 divide-y divide-white/10">
              {catalog.ageBands.map((b) => {
                const price = catalog.dayUseFees.find((f) => f.ageBandId === b.id)?.price ?? null;
                return (
                  <div key={b.id} className="flex items-center justify-between gap-4 py-3">
                    <dt className="text-brand-100/85">{b.label}</dt>
                    <dd className="font-semibold">
                      {price === null ? <span className="font-normal text-brand-100/50">Not available</span> : price === 0 ? <span className="text-gold-300">Free</span> : money(price, catalog.currency)}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        </div>
      </section>
      )}

      {/* ── FAQ ── */}
      <section className="mx-auto max-w-3xl px-4 pb-16 sm:px-6 sm:pb-24">
        <SectionTitle eyebrow="Good to know" title="Questions" />
        <div className="space-y-3">
          {!member && (
            <>
              <Faq q="Why do you need my national ID?">
                Your age decides your price, and it is read directly from your national ID number. The ID photo also lets the
                club confirm who you are. Your ID is stored encrypted.
              </Faq>
              <Faq q="What if my ID photo can't be read?">
                You get three tries. If it still can't be read, you can submit anyway — a staff member checks your photo before
                approving.
              </Faq>
            </>
          )}
          {member && (
            <>
              <Faq q="When can I renew?">
                Any time from your account. A renewal starts the day after your current card ends, so you never lose days.
              </Faq>
              <Faq q="What do I show at the gate?">
                Your digital membership card in your account, together with your national ID. Guests show their own QR code.
              </Faq>
              <Faq q="Can I cancel a guest invitation?">
                Yes. Cancel it from your account any time before it is paid. Paid passes can't be refunded online, so please
                contact the club.
              </Faq>
            </>
          )}
          <Faq q="Can children join?">
            Yes. Children use the national ID number on their birth certificate, and are priced for their age group.
          </Faq>
          <Faq q="How do guests work?">
            Members invite guests from their account for a chosen day. {guests.sentence} and get their own QR code.
          </Faq>
        </div>
      </section>
    </>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <dt className="sr-only">{label}</dt>
      <dd className="font-display text-2xl text-gold-300 sm:text-3xl">{value}</dd>
      <p className="mt-1 text-xs text-brand-100/70">{label}</p>
    </div>
  );
}

function HowStep({ n, icon, title, children }: { n: number; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-4">
      <div className="relative shrink-0">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-700">{icon}</div>
        <span className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-gold-400 text-[11px] font-bold text-brand-950">{n}</span>
      </div>
      <div>
        <p className="font-semibold text-stone-900">{title}</p>
        <p className="mt-1 text-sm leading-relaxed text-stone-600">{children}</p>
      </div>
    </div>
  );
}

function Amenity({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="flex gap-4">
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gold-100 text-gold-600">{icon}</div>
      <div>
        <p className="font-semibold text-stone-900">{title}</p>
        <p className="mt-0.5 text-sm text-stone-600">{text}</p>
      </div>
    </div>
  );
}

function Faq({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="group rounded-2xl border border-stone-200 bg-white shadow-soft open:shadow-lift">
      {/* Padding lives on the summary so the whole row is the tap target. */}
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-medium text-stone-900 sm:px-6">
        {q}
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-700 transition group-open:rotate-45">+</span>
      </summary>
      <p className="-mt-1 px-5 pb-4 text-sm leading-relaxed text-stone-600 sm:px-6">{children}</p>
    </details>
  );
}

/** Quick actions, membership details and upcoming guests for a signed-in member. */
function MemberSections({ me, active }: { me: MeResponse; active: Membership | null }) {
  const { member, club } = me;
  const today = todayCairo();
  const guestsAllowed = Boolean(active?.guestsPerDay);
  // Same query the account page uses, so the two stay in sync.
  const requests = useQuery({
    queryKey: ['guest-requests'],
    queryFn: () => api.get<{ requests: VisitRequest[] }>('/me/guest-requests'),
    enabled: guestsAllowed,
  });
  const upcoming = (requests.data?.requests ?? [])
    .filter((r) => r.visitDate >= today && r.status !== 'CANCELLED' && r.status !== 'REJECTED')
    .sort((a, b) => a.visitDate.localeCompare(b.visitDate))
    .slice(0, 3);
  const daysLeft = active?.endsAt ? daysUntil(active.endsAt, today) + 1 : null;
  const renewSoon = daysLeft !== null && daysLeft <= 30;
  const totalDays = active?.startsAt && active.endsAt ? Math.max(1, daysUntil(active.endsAt, active.startsAt) + 1) : 1;
  const usedDays = Math.min(totalDays, Math.max(0, totalDays - (daysLeft ?? 0)));

  return (
    <>
      {/* Quick actions */}
      <section className="relative z-10 mx-auto -mt-12 max-w-6xl px-4 sm:px-6">
        <div className="grid grid-cols-1 gap-2 rounded-3xl bg-white p-3 shadow-lift ring-1 ring-stone-200/60 md:grid-cols-3 sm:p-4">
          {active ? (
            <>
              <QuickAction to="/account" icon={<CardIcon />} title="My card" text="Show it at the gate" />
              <QuickAction
                to={guestsAllowed ? '/guests' : '/account#plans'}
                icon={<Users />}
                title="Invite guests"
                text={guestsAllowed ? `Up to ${active.guestsPerDay} a day, ${guestPricing(club).perGuest}` : 'Upgrade to a plan with guests'}
              />
              <QuickAction
                to="/account#plans"
                icon={<Sparkle />}
                title={renewSoon ? 'Renew now' : 'Renew or upgrade'}
                text={renewSoon ? `Your card ends in ${daysLeft} day(s)` : 'Plans priced for your age'}
              />
            </>
          ) : member.status === 'APPROVED' ? (
            <>
              <QuickAction to="/account#plans" icon={<Sparkle />} title="Choose a plan" text="Priced for your age" />
              <QuickAction to="/account#plans" icon={<CardIcon />} title="Pay online" text="Card payment through Paymob" />
              <QuickAction to="/account" icon={<Qr />} title="Get your card" text="Ready as soon as you've paid" />
            </>
          ) : (
            <>
              <QuickAction to="/account" icon={<IdCard />} title="Application sent" text="Your ID is on file" done />
              <QuickAction
                to="/account"
                icon={<Clock />}
                title={member.status === 'REJECTED' ? 'Not approved' : 'Club review'}
                text={member.status === 'REJECTED' ? 'See the reason in your account' : "We'll email you when approved"}
              />
              <QuickAction to="/account" icon={<CardIcon />} title="Choose & pay" text="Then your card is ready" />
            </>
          )}
        </div>
      </section>

      {/* Membership details + upcoming guests */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <SectionTitle eyebrow="Your membership" title={active ? 'Membership at a glance' : 'Your account'} />
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1.35fr_1fr]">
          {/* Plan */}
          <div className="overflow-hidden rounded-3xl bg-white shadow-soft ring-1 ring-stone-200/80">
            {active ? (
              <>
                <div className="bg-club px-6 py-6 text-white sm:px-8 sm:py-7">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold-300">Current plan</p>
                      <h3 className="mt-1.5 break-words font-display text-2xl sm:text-3xl">{active.planName ?? 'Member'}</h3>
                    </div>
                    <Badge status="ACTIVE">Active</Badge>
                  </div>
                  <div className="mt-7 flex items-end justify-between gap-4">
                    <p>
                      <span className="font-display text-4xl text-gold-300 sm:text-5xl">{daysLeft}</span>
                      <span className="ml-2 text-sm text-brand-100/75">of {totalDays} days left</span>
                    </p>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={totalDays} aria-valuenow={usedDays} aria-label="Membership used">
                    <div className="h-full rounded-full bg-gradient-to-r from-gold-300 to-gold-500" style={{ width: `${Math.max(2, (usedDays / totalDays) * 100)}%` }} />
                  </div>
                  <div className="mt-2 flex justify-between text-xs text-brand-100/70">
                    <span>{cardDate(active.startsAt)}</span>
                    <span>{cardDate(active.endsAt)}</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 p-5 sm:p-6">
                  <Tile label="Term" value={active.termMonths ? term(active.termMonths) : '—'} />
                  <Tile label="Guests a day" value={active.guestsPerDay ? String(active.guestsPerDay) : 'Not included'} />
                  <Tile label="Paid" value={money(active.price, club.currency)} />
                  <Tile label="Card number" value={<span className="font-mono text-[0.95em]">{active.cardNumber ?? '—'}</span>} />
                </div>
                {renewSoon && (
                  <div className="mx-5 mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 px-5 py-4 sm:mx-6 sm:mb-6">
                    <p className="text-sm text-amber-900">Your card ends on {niceDate(active.endsAt)}. Renew now to keep your access.</p>
                    <Link to="/account#plans" className={buttonClass('gold')}>
                      Renew
                    </Link>
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 px-5 py-4 sm:px-6">
                  <p className="text-sm text-stone-500">Renewals start the day after your card ends.</p>
                  <Link to="/account" className={cx(buttonClass('ghost'), '-mr-2')}>
                    View my card <Arrow width={16} height={16} />
                  </Link>
                </div>
              </>
            ) : (
              <div className="p-6 sm:p-8">
                <Badge status={member.status}>
                  {member.status === 'APPROVED' ? 'Approved' : member.status === 'PENDING_REVIEW' ? 'Under review' : 'Not approved'}
                </Badge>
                <h3 className="mt-4 font-display text-2xl text-brand-900 sm:text-3xl">
                  {member.status === 'APPROVED' ? 'No active plan yet' : member.status === 'PENDING_REVIEW' ? 'We are reviewing your application' : 'Your application was not approved'}
                </h3>
                <p className="mt-2 text-stone-600">
                  {member.status === 'APPROVED'
                    ? 'Choose a plan priced for your age and pay online. Your digital card is ready straight away.'
                    : member.status === 'PENDING_REVIEW'
                      ? "You'll get an email as soon as the club approves you."
                      : 'See your account for the reason and next steps.'}
                </p>
                <Link to={member.status === 'APPROVED' ? '/account#plans' : '/account'} className={cx(buttonClass('gold'), 'mt-6')}>
                  {member.status === 'APPROVED' ? 'Choose a plan' : 'Go to my account'} <Arrow width={16} height={16} />
                </Link>
              </div>
            )}
          </div>

          <div className="space-y-6">
            {/* Guests */}
            <Card className="sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700">
                    <Users width={20} height={20} />
                  </div>
                  <p className="font-semibold text-stone-900">Upcoming guest visits</p>
                </div>
                {guestsAllowed && (
                  <Link to="/guests" className="text-sm font-semibold text-brand-700 hover:underline">
                    Manage
                  </Link>
                )}
              </div>
              <div className="mt-4">
                {!active ? (
                  <p className="text-sm text-stone-600">Once your membership is active you can invite guests from your account.</p>
                ) : !guestsAllowed ? (
                  <div className="rounded-2xl bg-stone-50 px-4 py-4">
                    <p className="text-sm text-stone-600">Your current plan doesn't include guests.</p>
                    <Link to="/account#plans" className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
                      See plans with guests <Arrow width={14} height={14} />
                    </Link>
                  </div>
                ) : requests.isLoading ? (
                  <Loading />
                ) : requests.error ? (
                  <ErrorText error={requests.error} />
                ) : upcoming.length === 0 ? (
                  <div className="rounded-2xl bg-stone-50 px-4 py-4">
                    <p className="text-sm text-stone-600">No visits booked. Each guest gets their own QR code.</p>
                    <Link to="/guests" className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
                      Invite someone <Arrow width={14} height={14} />
                    </Link>
                  </div>
                ) : (
                  <div className="divide-y divide-stone-100">
                    {upcoming.map((r) => (
                      <div key={r.id} className="py-3 first:pt-0 last:pb-0">
                        <RequestSummary r={r} currency={club.currency} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>

            {/* Personal details */}
            <Card className="sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-stone-900">Your details</p>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                  <Shield width={14} height={14} /> ID verified
                </span>
              </div>
              <dl className="mt-4 divide-y divide-stone-100">
                <Detail label="Email" value={member.email} />
                <Detail label="Phone" value={member.phone} />
                <Detail label="National ID" value={<span className="font-mono">{member.nationalIdMasked}</span>} />
                <Detail label="Date of birth" value={niceDate(member.dateOfBirth)} />
              </dl>
            </Card>
          </div>
        </div>
      </section>
    </>
  );
}

function QuickAction({ to, icon, title, text, done }: { to: string; icon: ReactNode; title: string; text: string; done?: boolean }) {
  return (
    <Link to={to} className="group flex items-center gap-4 rounded-2xl p-3 transition hover:bg-brand-50/60 sm:p-4">
      <div className={cx('grid h-12 w-12 shrink-0 place-items-center rounded-2xl', done ? 'bg-emerald-50 text-emerald-700' : 'bg-brand-50 text-brand-700')}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-stone-900">{title}</p>
        <p className="text-sm text-stone-600">{text}</p>
      </div>
      <Arrow width={16} height={16} className="shrink-0 text-stone-400 transition group-hover:translate-x-0.5 group-hover:text-brand-700" />
    </Link>
  );
}

function Tile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl bg-stone-50 px-4 py-3.5 ring-1 ring-inset ring-stone-100">
      <p className="text-xs text-stone-500">{label}</p>
      <p className="mt-1 break-words font-semibold text-stone-900">{value}</p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <dt className="shrink-0 text-sm text-stone-500">{label}</dt>
      <dd className="min-w-0 break-words text-right text-sm font-medium text-stone-900">{value}</dd>
    </div>
  );
}
