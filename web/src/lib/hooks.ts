import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiError, type Catalog, type Member } from './api';

const CLUB_KEY = 'ocm.club';

function readStoredClub(): string | null {
  try {
    return localStorage.getItem(CLUB_KEY);
  } catch {
    return null;
  }
}

/** The clubhouse this visitor is browsing: their saved choice, else the first one. */
export function useClub() {
  const [chosen, setChosen] = useState<string | null>(readStoredClub);
  const clubs = useQuery({
    queryKey: ['clubs'],
    queryFn: () => api.get<{ clubs: { id: string; name: string }[] }>('/clubs'),
    staleTime: 5 * 60 * 1000,
  });
  const list = clubs.data?.clubs ?? [];
  const clubId = list.find((c) => c.id === chosen)?.id ?? list[0]?.id ?? null;
  const catalog = useQuery({
    queryKey: ['catalog', clubId],
    queryFn: () => api.get<Catalog>(`/clubs/${clubId}/catalog`),
    enabled: Boolean(clubId),
  });
  const choose = (id: string) => {
    setChosen(id);
    try {
      localStorage.setItem(CLUB_KEY, id);
    } catch {
      /* private mode */
    }
  };
  return { clubs: list, clubId, choose, catalog: catalog.data, isLoading: clubs.isLoading || catalog.isLoading, error: clubs.error ?? catalog.error };
}

export type MeResponse = { member: Member; club: {
    id: string;
    name: string;
    currency: string;
    guestDiscountPercent: number;
    guestFees: { ageBandId: string; ageBandLabel: string; price: number }[];
  };
};

/** The logged-in member, or null when logged out. */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<MeResponse>('/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 30 * 1000,
  });
}
