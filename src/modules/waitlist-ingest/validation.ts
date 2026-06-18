import { z } from 'zod';

// A wait-list row is callable if we have a usable phone and a name. Email and
// bedroom count are nice-to-have — we don't reject a real prospect over a dirty
// email cell in an exported CSV.
export const waitlistRowSchema = z
  .object({
    phone: z.string().regex(/^\d{10,15}$/, 'phone must be 10–15 digits'),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    email: z.string().optional(),
    bedroomCount: z.number().int().min(0).max(6).optional(),
    sourcePosition: z.number().int().optional(),
    sourceDateAdded: z.string().optional(),
    sourceApplicantId: z.string().optional(),
  })
  .refine((r) => Boolean(r.firstName || r.lastName), { message: 'name required' });

export type ValidWaitlistRow = z.infer<typeof waitlistRowSchema>;
