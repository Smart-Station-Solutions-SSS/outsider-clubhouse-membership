import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router-dom';
import { Clock } from '../components/icons';
import { PassGrid, RequestSummary } from '../components/Passes';
import { Alert, Button, Card, ErrorText, Loading, PageBody, PageHero } from '../components/ui';
import { api, type Checkout, type VisitRequest } from '../lib/api';
import { money } from '../lib/format';

/** A day-pass buyer's private page (no account): status, payment, QR codes. */
export function Visit() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const t = params.get('t') ?? '';
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['visit', id],
    queryFn: () => api.get<{ request: VisitRequest; club: { name: string; currency: string } }>(`/visits/${id}?t=${encodeURIComponent(t)}`),
    refetchInterval: (query) => (query.state.data?.request.status === 'PENDING_REVIEW' ? 30000 : false),
  });
  const pay = useMutation({
    mutationFn: () => api.post<Checkout>(`/visits/${id}/pay?t=${encodeURIComponent(t)}`),
    onSuccess: (c) => window.location.assign(c.checkoutUrl),
  });
  const cancel = useMutation({
    mutationFn: () => api.post(`/visits/${id}/cancel?t=${encodeURIComponent(t)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['visit', id] }),
  });

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <div className="mx-auto max-w-xl px-4 py-10 sm:p-10"><ErrorText error={q.error ?? new Error('Not found')} /></div>;
  const { request: r, club } = q.data;
  const paid = r.status === 'PAID';

  return (
    <>
      <PageHero eyebrow={club.name} title={paid ? 'See you at the club' : 'Your day pass'} subtitle={paid ? 'Show each QR code at the gate on your visit day.' : 'Bookmark this page — it is your private link to pay and to get your QR codes.'} />
      <PageBody>
        <div className="space-y-8">
          <Card className="space-y-5">
            <RequestSummary r={r} currency={club.currency} />
            {r.status === 'PENDING_REVIEW' && (
              <Alert tone="warning">
                <span className="inline-flex items-center gap-2">
                  <Clock width={16} height={16} /> The club is reviewing your request. We'll email you as soon as it's approved.
                </span>
              </Alert>
            )}
            {r.status === 'REJECTED' && <Alert tone="error">Your request was not approved.{r.reviewNote ? ` Reason: ${r.reviewNote}` : ''}</Alert>}
            {(r.status === 'APPROVED' || r.status === 'PENDING_REVIEW') && (
              <div className="flex flex-wrap gap-2">
                {r.status === 'APPROVED' && (
                  <Button variant="gold" size="lg" onClick={() => pay.mutate()} loading={pay.isPending}>
                    Pay {money(r.total, club.currency)}
                  </Button>
                )}
                <Button variant="danger" onClick={() => cancel.mutate()} loading={cancel.isPending}>
                  Cancel booking
                </Button>
              </div>
            )}
            <ErrorText error={pay.error ?? cancel.error} />
          </Card>
          {paid && <PassGrid passes={r.passes} currency={club.currency} />}
        </div>
      </PageBody>
    </>
  );
}
