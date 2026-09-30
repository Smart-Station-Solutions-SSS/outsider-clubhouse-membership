import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { IdPhotoCheck } from '../components/IdPhotoCheck';
import { Lock } from '../components/icons';
import { Button, Card, ErrorText, Field, Input, Loading, PageBody, PageHero, Steps } from '../components/ui';
import { api, type IdCheck, type Member } from '../lib/api';
import { useClub, useMe } from '../lib/hooks';

export function Join() {
  const { clubId, catalog, isLoading } = useClub();
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const sentFrom = (useLocation().state as { from?: string } | null)?.from;
  const from = sentFrom && sentFrom !== '/account' ? sentFrom : null;
  const [step, setStep] = useState<0 | 1>(0);
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '', confirm: '' });
  const [check, setCheck] = useState<IdCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // A logged-in email-only account applies from here without re-entering email and password.
  const applying = me.data?.member.status === 'ACCOUNT';
  if (me.data && !applying) return <Navigate to={from ?? '/account'} replace />;
  if (isLoading || me.isLoading) return <Loading />;

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const passwordMismatch = !applying && form.confirm.length > 0 && form.password !== form.confirm;

  const next = (e: FormEvent) => {
    e.preventDefault();
    if (!passwordMismatch) setStep(1);
  };

  const submit = async () => {
    if (!check?.canSubmit || !check.nationalId || !clubId) return;
    setBusy(true);
    setError(null);
    try {
      const details = { fullName: form.fullName, phone: form.phone, nationalId: check.nationalId, idCheckId: check.checkId };
      const { member } = applying
        ? await api.post<{ member: Member }>('/me/apply', details)
        : await api.post<{ member: Member }>('/auth/signup', { ...details, clubId, email: form.email, password: form.password });
      await qc.invalidateQueries({ queryKey: ['me'] });
      // Came from the day pass page: go back there to book; otherwise to the account.
      if (from && !applying) navigate(from);
      else navigate('/account', { state: { justJoined: member.status } });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHero
        eyebrow="Membership application"
        title="Become a member"
        subtitle={
          catalog?.membershipApproval === 'AUTO'
            ? 'Verify your national ID and you can choose a plan and pay straight away.'
            : 'Apply online. As soon as the club approves your application, you can choose a plan and pay.'
        }
      >
        <div className="mt-8 max-w-md sm:mt-10">
          <Steps steps={['Your details', 'National ID']} current={step} />
        </div>
      </PageHero>
      <PageBody narrow>
        {step === 0 && (
          <Card className="animate-rise">
            <form onSubmit={next} className="space-y-5">
              <Field label="Full name (as on your ID)">
                <Input value={form.fullName} onChange={set('fullName')} required minLength={3} autoComplete="name" />
              </Field>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                {!applying && (
                  <Field label="Email">
                    <Input type="email" value={form.email} onChange={set('email')} required autoComplete="email" />
                  </Field>
                )}
                <Field label="Mobile number">
                  <Input type="tel" value={form.phone} onChange={set('phone')} required placeholder="01xxxxxxxxx" autoComplete="tel" />
                </Field>
              </div>
              {!applying && (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field label="Password" hint="At least 8 characters.">
                  <Input type="password" value={form.password} onChange={set('password')} required minLength={8} autoComplete="new-password" />
                </Field>
                <Field label="Confirm password" error={passwordMismatch ? 'Passwords do not match' : undefined}>
                  <Input type="password" value={form.confirm} onChange={set('confirm')} required autoComplete="new-password" />
                </Field>
              </div>
              )}
              <Button type="submit" size="lg" className="w-full">
                Continue
              </Button>
            </form>
            {!applying && (
            <p className="mt-6 text-center text-sm text-stone-600">
              Already a member?{' '}
              <Link to="/login" className="font-semibold text-brand-700 hover:underline">
                Log in
              </Link>
            </p>
            )}
          </Card>
        )}

        {step === 1 && (
          <Card className="animate-rise space-y-6">
            <div>
              <h2 className="font-display text-2xl text-brand-900">Verify your national ID</h2>
              <p className="mt-1 text-sm text-stone-600">We read your date of birth from your ID to show your correct price.</p>
            </div>
            {clubId && (
              <IdPhotoCheck
                clubId={clubId}
                purpose="membership"
                adminReview={catalog?.membershipApproval === 'ADMIN'}
                result={check}
                onResult={setCheck}
              />
            )}
            <ErrorText error={error} />
            <div className="flex flex-col-reverse gap-3 border-t border-stone-100 pt-6 sm:flex-row">
              <Button type="button" variant="secondary" onClick={() => setStep(0)}>
                Back
              </Button>
              <Button type="button" variant="gold" className="flex-1" onClick={submit} loading={busy} disabled={!check?.canSubmit}>
                Submit application
              </Button>
            </div>
            <p className="flex items-center justify-center gap-2 text-center text-xs text-stone-500">
              <Lock width={14} height={14} className="shrink-0" /> Your ID is encrypted and only seen by club staff.
            </p>
          </Card>
        )}
      </PageBody>
    </>
  );
}
