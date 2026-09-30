import { z } from 'zod';

export const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date');
export const phone = z.string().trim().regex(/^\+?[0-9 ()-]{8,20}$/, 'Enter a valid phone number');
export const name = z.string().trim().min(3, 'Enter the full name').max(120);
export const email = z.string().trim().email('Enter a valid email').max(200);
export const nationalId = z.string().trim().min(14, 'Enter the 14-digit national ID').max(20);

export const person = z.object({ fullName: name, nationalId, phone: phone.optional().nullable() });

export const decision = z.object({ note: z.string().max(500).optional() });

export const priceCell = z.object({ ageBandId: z.string().uuid(), price: z.number().min(0).max(1_000_000).nullable() });
