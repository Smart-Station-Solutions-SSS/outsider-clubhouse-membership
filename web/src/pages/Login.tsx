import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Check, Logo } from '../components/icons';
import { Button, ErrorText, Field, Input } from '../components/ui';
import { api } from '../lib/api';
import { useClub, useMe } from '../lib/hooks';

export function Login() {
  const me = useMe();
  const { catalog } = useClub();
  const qc = useQueryClient();
  const navigate = useNavigate();
  /** Where the visitor was sent from (e.g. the day pass page), to return there after logging in. */
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/account';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (me.data) return <Navigate to={from} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/login', { email, password });
      await qc.invalidateQueries({ queryKey: ['me'] });
      navigate(from);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto grid grid-cols-1 max-w-5xl gap-0 px-4 py-10 sm:px-6 sm:py-14 md:grid-cols-2">
      <div className="bg-club hidden flex-col justify-between rounded-l-[2rem] p-8 text-white md:flex lg:p-10">
        <Logo className="h-12 w-12" />
        <div>
          <h2 className="font-display text-3xl font-medium leading-tight">Welcome back to {catalog?.name ?? 'the club'}.</h2>
          <ul className="mt-6 space-y-3 text-sm text-brand-100/85">
            {['Book day passes and get your QR codes', 'See your application status', 'Pay for your membership and invite guests'].map((t) => (
              <li key={t} className="flex items-center gap-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-gold-400/20 text-gold-300">
                  <Check width={14} height={14} strokeWidth={2.5} />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-brand-100/50">Visitors and members</p>
      </div>
      <div className="rounded-[2rem] bg-white p-6 shadow-lift ring-1 ring-stone-200/70 sm:p-12 md:rounded-l-none">
        <h1 className="font-display text-3xl font-medium text-brand-900 sm:text-4xl">Log in</h1>
        <p className="mt-2 text-stone-600">Use the email you signed up with.</p>
        <form onSubmit={submit} className="mt-6 space-y-5 sm:mt-8">
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </Field>
          <Field label="Password">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          </Field>
          <ErrorText error={error} />
          <Button type="submit" size="lg" className="w-full" loading={busy}>
            Log in
          </Button>
        </form>
        <p className="mt-8 text-center text-sm text-stone-600">
          No account yet?{' '}
          <Link to="/register" state={{ from }} className="font-semibold text-brand-700 hover:underline">
            Create one
          </Link>{' '}
          · Want membership?{' '}
          <Link to="/join" className="font-semibold text-brand-700 hover:underline">
            Apply
          </Link>
        </p>
      </div>
    </div>
  );
}
