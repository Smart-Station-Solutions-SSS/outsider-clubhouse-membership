import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api, type Membership } from '../lib/api';
import { todayCairo } from '../lib/format';
import { useClub, useMe } from '../lib/hooks';
import { Lock, Logo, Shield } from './icons';
import { buttonClass, cx } from './ui';

const navClass = ({ isActive }: { isActive: boolean }) =>
  cx('rounded-full px-4 py-2 text-sm font-medium transition', isActive ? 'bg-white/10 text-white' : 'text-brand-100/80 hover:text-white');

export function Layout() {
  const me = useMe();
  const { clubs, clubId, choose, catalog } = useClub();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
    window.scrollTo(0, 0);
  }, [pathname]);

  const logout = async () => {
    await api.post('/auth/logout');
    qc.setQueryData(['me'], null);
    navigate('/');
  };

  // Same query the account and guests pages use, so the tabs follow a payment straight away.
  const memberships = useQuery({
    queryKey: ['memberships'],
    queryFn: () => api.get<{ memberships: Membership[] }>('/me/memberships'),
    enabled: me.data?.member.status === 'APPROVED',
  });
  const today = todayCairo();
  const isMember = Boolean(memberships.data?.memberships.some((m) => m.status === 'ACTIVE' && m.endsAt && m.endsAt >= today));

  const clubName = catalog?.name ?? 'The Clubhouse';

  const links = (
    <>
      <NavLink to="/" end className={navClass}>
        Membership
      </NavLink>
      {/* Members with an active card invite guests; everyone else books day passes. */}
      {isMember ? (
        <NavLink to="/guests" className={navClass}>
          Guests
        </NavLink>
      ) : (
        <NavLink to="/day-pass" className={navClass}>
          Day pass
        </NavLink>
      )}
      {me.data ? (
        <>
          <NavLink to="/account" className={navClass}>
            My account
          </NavLink>
          <button onClick={logout} className="rounded-full px-4 py-2 text-left text-sm font-medium text-brand-100/80 hover:text-white">
            Log out
          </button>
        </>
      ) : (
        <>
          <NavLink to="/login" className={navClass}>
            Log in
          </NavLink>
          <Link to="/join" className={cx(buttonClass('gold'), 'lg:ml-2')}>
            Become a member
          </Link>
        </>
      )}
    </>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-brand-950 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link to="/" className="flex min-w-0 items-center gap-3">
            <Logo className="h-8 w-8 shrink-0 sm:h-9 sm:w-9" />
            <span className="truncate font-display text-lg font-medium tracking-tight sm:text-xl">{clubName}</span>
          </Link>
          <nav className="hidden shrink-0 items-center gap-1 lg:flex">{links}</nav>
          <button
            className="shrink-0 rounded-full p-2.5 text-white lg:hidden"
            aria-label="Menu"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
        {open && <nav className="flex flex-col gap-1 border-t border-white/10 px-4 py-3 sm:px-6 lg:hidden">{links}</nav>}
        {clubs.length > 1 && !me.data && (
          <div className="mx-auto max-w-6xl px-4 pb-2 sm:px-6">
            <select
              aria-label="Choose clubhouse"
              value={clubId ?? ''}
              onChange={(e) => choose(e.target.value)}
              className="max-w-full rounded-full border border-white/20 bg-transparent px-3 py-1.5 text-base text-white sm:py-1 sm:text-xs"
            >
              {clubs.map((c) => (
                <option key={c.id} value={c.id} className="text-stone-900">
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="bg-brand-950 text-brand-100/80">
        <div className="mx-auto grid grid-cols-1 max-w-6xl gap-10 px-4 py-12 sm:grid-cols-2 sm:px-6 sm:py-14 md:grid-cols-[1.4fr_1fr_1fr]">
          <div className="sm:col-span-2 md:col-span-1">
            <div className="flex items-center gap-3 text-white">
              <Logo className="h-9 w-9" />
              <span className="font-display text-xl">{clubName}</span>
            </div>
            <p className="mt-4 max-w-sm text-sm leading-relaxed">
              Membership and day passes for guests of the community. Apply online, pay securely and walk in with a QR code.
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-300">Visit</p>
            <ul className="mt-4 space-y-2 text-sm">
              <li>
                <Link to="/" className="hover:text-white">
                  Membership plans
                </Link>
              </li>
              <li>
                <Link to={isMember ? '/guests' : '/day-pass'} className="hover:text-white">
                  {isMember ? 'Invite guests' : 'Book a day pass'}
                </Link>
              </li>
              <li>
                <Link to={me.data ? '/account' : '/login'} className="hover:text-white">
                  {me.data ? 'My account' : 'Member login'}
                </Link>
              </li>
            </ul>
          </div>
          <div className="space-y-3 text-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-300">Secure</p>
            <p className="flex items-center gap-2">
              <Lock className="text-gold-300" width={16} height={16} /> Card payments by Paymob
            </p>
            <p className="flex items-center gap-2">
              <Shield className="text-gold-300" width={16} height={16} /> National IDs stored encrypted
            </p>
          </div>
        </div>
        <div className="border-t border-white/10 px-4 py-5 text-center text-xs text-brand-100/50">© {new Date().getFullYear()} {clubName}</div>
      </footer>
    </div>
  );
}
