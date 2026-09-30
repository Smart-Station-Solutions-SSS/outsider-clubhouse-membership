import type { PersonDraft } from '../lib/api';
import { cleanNationalId } from '../lib/format';
import { Camera, Check, X } from './icons';
import { Button, Input } from './ui';

/** Editable list of people (name + national ID), used for day-use companions and guests. */
export function PeopleEditor({
  people,
  onChange,
  max = 10,
  withPhone,
  withIdPhoto,
  firstLocked,
  addLabel = 'Add person',
}: {
  people: PersonDraft[];
  onChange: (p: PersonDraft[]) => void;
  max?: number;
  withPhone?: boolean;
  /** Ask for a photo of each person's ID card (or birth certificate). */
  withIdPhoto?: boolean;
  /** The first row is the verified buyer; their details come from above. */
  firstLocked?: boolean;
  addLabel?: string;
}) {
  const update = (i: number, patch: Partial<PersonDraft>) => onChange(people.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  return (
    <div className="space-y-3">
      {people.map((p, i) => {
        const locked = firstLocked && i === 0;
        return (
          <div key={i} className="flex items-start gap-2 rounded-2xl sm:gap-3 border border-stone-200 bg-stone-50/70 p-3 sm:p-4">
            <span className="mt-2.5 hidden h-7 w-7 shrink-0 sm:grid place-items-center rounded-full bg-white text-xs font-semibold text-brand-700 ring-1 ring-stone-200">
              {i + 1}
            </span>
            <div className="grid grid-cols-1 min-w-0 flex-1 gap-2 sm:grid-cols-2">
              <Input placeholder="Full name" value={p.fullName} disabled={locked} onChange={(e) => update(i, { fullName: e.target.value })} aria-label={`Person ${i + 1} name`} />
              <Input
                placeholder="National ID"
                inputMode="numeric"
                value={p.nationalId}
                disabled={locked}
                className="font-mono tracking-wider"
                onChange={(e) => update(i, { nationalId: cleanNationalId(e.target.value) })}
                aria-label={`Person ${i + 1} national ID`}
              />
              {withPhone && (
                <Input
                  className="sm:col-span-2"
                  placeholder="Mobile (optional)"
                  inputMode="tel"
                  value={p.phone ?? ''}
                  onChange={(e) => update(i, { phone: e.target.value })}
                  aria-label={`Person ${i + 1} phone`}
                />
              )}
              {withIdPhoto && (
                <label
                  className={
                    'flex cursor-pointer items-center gap-2 rounded-xl border border-dashed px-3 py-2.5 text-sm transition sm:col-span-2 ' +
                    (p.photo ? 'border-emerald-300 bg-emerald-50/60 text-emerald-800' : 'border-stone-300 bg-white text-stone-600 hover:border-brand-400')
                  }
                >
                  {p.photo ? <Check width={16} height={16} className="shrink-0" /> : <Camera width={16} height={16} className="shrink-0" />}
                  <span className="min-w-0 truncate">{p.photo ? p.photo.name : 'Photo of their national ID (or birth certificate)'}</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    capture="environment"
                    className="sr-only"
                    onChange={(e) => update(i, { photo: e.target.files?.[0] ?? null })}
                    aria-label={`Person ${i + 1} ID photo`}
                  />
                </label>
              )}
            </div>
            {locked ? (
              <span className="mt-2.5 shrink-0 rounded-full bg-gold-100 px-2.5 py-1 text-xs font-semibold text-gold-600">You</span>
            ) : (
              <button
                type="button"
                onClick={() => onChange(people.filter((_, j) => j !== i))}
                aria-label={`Remove person ${i + 1}`}
                className="mt-1.5 shrink-0 rounded-full p-2.5 text-stone-400 transition hover:bg-red-50 hover:text-red-600"
              >
                <X width={18} height={18} />
              </button>
            )}
          </div>
        );
      })}
      {people.length < max && (
        <Button type="button" variant="ghost" onClick={() => onChange([...people, { fullName: '', nationalId: '' }])}>
          + {addLabel}
        </Button>
      )}
      <p className="text-xs text-stone-500">Children use the national ID number printed on their birth certificate.</p>
    </div>
  );
}

export const peopleReady = (people: PersonDraft[]) =>
  people.length > 0 && people.every((p) => p.fullName.trim().length >= 3 && p.nationalId.length === 14);
