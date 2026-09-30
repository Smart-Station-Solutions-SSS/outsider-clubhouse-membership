import { useEffect, useRef, useState } from 'react';
import { api, type IdCheck } from '../lib/api';
import { cleanNationalId, niceDate } from '../lib/format';
import { Camera, Check, IdCard } from './icons';
import { Alert, Button, cx, ErrorText, Field, Input } from './ui';

const outcomeText: Record<IdCheck['outcome'], string> = {
  MATCHED: 'ID verified.',
  MISMATCH: 'We could not read the card.',
  UNREADABLE: 'We could not read the card. Use a sharp, well-lit photo of the front, filling the frame.',
  UNAVAILABLE: 'Automatic ID reading is unavailable right now.',
  MANUAL: 'ID saved.',
};

/**
 * A photo of the front of the card. The server reads the national ID number off it (OCR) and
 * with it the birth date. After 3 unreadable photos the person may type the number instead and
 * staff review the photo. When an admin approves this flow anyway (`adminReview`), no OCR runs:
 * the number is typed next to the photo from the start.
 */
export function IdPhotoCheck({
  clubId,
  purpose,
  adminReview,
  onResult,
  result,
}: {
  clubId: string;
  purpose: 'membership' | 'day-use';
  adminReview: boolean;
  onResult: (r: IdCheck | null) => void;
  result: IdCheck | null;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [typedId, setTypedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  /** Only the latest request may set the result (admin-review mode saves as the person types). */
  const latest = useRef(0);

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const send = async (fields: { photo?: File; nationalId?: string }) => {
    const form = new FormData();
    form.append('clubId', clubId);
    form.append('purpose', purpose);
    if (result) form.append('checkId', result.checkId);
    if (fields.nationalId) form.append('nationalId', fields.nationalId);
    if (fields.photo) form.append('photo', fields.photo);
    const n = ++latest.current;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<IdCheck>('/id-check', form);
      if (n === latest.current) onResult(res);
    } catch (e) {
      if (n === latest.current) setError(e);
    } finally {
      if (n === latest.current) setBusy(false);
    }
  };

  const saved = Boolean(result?.canSubmit);
  /** Admin-review mode stays editable: every change is saved again. */
  const locked = !adminReview && saved;
  const verified = result?.outcome === 'MATCHED';
  /** OCR gave up after 3 tries: only the typed number is still needed. */
  const ocrFallback = !adminReview && Boolean(result?.manualEntry) && !locked;

  // Admin-review mode has no button: the number and photo are saved as soon as both are filled in.
  useEffect(() => {
    if (!adminReview) return;
    if (file && typedId.length === 14) void send({ photo: file, nationalId: typedId });
    else {
      latest.current++;
      onResult(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminReview, file, typedId]);

  const idField = (
    <Field label="National ID number" hint="14 digits, as printed on the card. Your age — and your price — is read from it.">
      <div className="relative">
        <IdCard className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" />
        <Input
          inputMode="numeric"
          autoComplete="off"
          value={typedId}
          disabled={locked}
          onChange={(e) => setTypedId(cleanNationalId(e.target.value))}
          placeholder="14-digit number"
          className="pl-12 pr-14 font-mono tracking-[0.1em] sm:tracking-[0.2em]"
        />
        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-stone-400">{typedId.length}/14</span>
      </div>
    </Field>
  );

  return (
    <div className="space-y-5">
      {adminReview && idField}

      <div>
        <span className="mb-1.5 block text-sm font-medium text-stone-700">Photo of the front of your ID card</span>
        <label
          className={cx(
            'group relative flex cursor-pointer flex-col gap-4 overflow-hidden rounded-2xl sm:flex-row sm:items-center sm:gap-5 border-2 border-dashed p-4 transition',
            locked || ocrFallback ? 'cursor-default' : '',
            saved ? 'border-emerald-300 bg-emerald-50/60' : 'border-stone-300 bg-stone-50 hover:border-brand-400 hover:bg-brand-50/50',
          )}
        >
          <div className="grid h-40 w-full shrink-0 place-items-center sm:h-24 sm:w-36 overflow-hidden rounded-xl bg-white ring-1 ring-stone-200">
            {preview ? <img src={preview} alt="ID card preview" className="h-full w-full object-cover" /> : <Camera className="text-stone-400" width={28} height={28} />}
          </div>
          <div className="min-w-0 pr-10 text-sm sm:pr-8">
            <p className="break-all font-semibold text-stone-800">{file ? file.name : 'Take or upload a photo'}</p>
            <p className="mt-1 text-stone-500">Flat, well lit, all four corners visible. JPG or PNG up to 8 MB.</p>
          </div>
          {saved && (
            <span className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full bg-emerald-500 text-white">
              <Check width={18} height={18} strokeWidth={2.5} />
            </span>
          )}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            disabled={locked || ocrFallback}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="sr-only"
          />
        </label>
      </div>

      {adminReview && busy && <p className="text-sm text-stone-500">Saving your ID…</p>}

      {!adminReview && !locked && !ocrFallback && (
        <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={() => file && send({ photo: file })} loading={busy} disabled={!file}>
          {result ? 'Read the new photo' : 'Verify my ID'}
        </Button>
      )}

      {ocrFallback && (
        <>
          <Alert tone="info">
            We couldn't read your card automatically. Type the number printed on it — a staff member will check your ID photo before approving.
          </Alert>
          {idField}
          <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={() => send({ nationalId: typedId })} loading={busy} disabled={typedId.length !== 14}>
            Continue with this number
          </Button>
        </>
      )}

      <ErrorText error={error} />

      {result && saved && result.dateOfBirth && (
        <Alert tone={verified ? 'success' : 'info'}>
          {verified ? outcomeText.MATCHED : `${outcomeText.MANUAL} Staff will check your ID photo before approving.`} National ID:{' '}
          <strong className="font-mono">{result.nationalId}</strong> · Date of birth: <strong>{niceDate(result.dateOfBirth)}</strong>
        </Alert>
      )}
      {result && !locked && !ocrFallback && !adminReview && (
        <Alert tone="warning">
          {outcomeText[result.outcome]} <strong>{result.attemptsLeft}</strong> attempt{result.attemptsLeft === 1 ? '' : 's'} left.
        </Alert>
      )}
    </div>
  );
}
