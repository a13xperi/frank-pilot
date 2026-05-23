import { z } from "zod";

export const createApplicationSchema = z.object({
  propertyId: z.string().guid(),
  unitNumber: z.string().max(20).optional(),

  // Applicant info
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  ssn: z.string().regex(/^\d{3}-?\d{2}-?\d{4}$/, "Invalid SSN format"),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
    .refine(
      (d) => {
        const dob = new Date(d);
        if (Number.isNaN(dob.getTime())) return false;
        if (dob > new Date()) return false;
        const ageMs = Date.now() - dob.getTime();
        const ageYears = ageMs / (1000 * 60 * 60 * 24 * 365.25);
        return ageYears >= 18 && ageYears <= 120;
      },
      "Applicant must be at least 18 and date of birth must be in the past"
    ),
  email: z.string().email().optional(),
  phone: z.string().max(20).optional(),

  // Current address
  currentAddressLine1: z.string().max(255).optional(),
  currentAddressLine2: z.string().max(255).optional(),
  currentCity: z.string().max(100).optional(),
  currentState: z.string().length(2).optional(),
  currentZip: z.string().max(10).optional(),

  // Employment
  employerName: z.string().max(255).optional(),
  employerPhone: z.string().max(20).optional(),
  employmentStartDate: z.string().optional(),
  annualIncome: z.number().min(0).optional(),
  householdSize: z.number().int().min(1).max(8).default(1),

  // Rental history
  previousLandlordName: z.string().max(255).optional(),
  previousLandlordPhone: z.string().max(20).optional(),
  previousRentalAddress: z.string().max(500).optional(),
  previousRentalDurationMonths: z.number().int().min(0).optional(),

  // Emergency contact
  emergencyContactName: z.string().max(255).optional(),
  emergencyContactPhone: z.string().max(20).optional(),
  emergencyContactRelationship: z.string().max(100).optional(),

  // Lease preferences
  requestedLeaseTermMonths: z.number().int().min(1).max(60).default(12),
  requestedRentAmount: z.number().min(0).optional(),
  requestedMoveInDate: z.string().optional(),
});

export const submitApplicationSchema = z.object({
  applicationId: z.string().guid(),
});

export const updateApplicationSchema = createApplicationSchema.partial().omit({
  ssn: true, // SSN cannot be updated after creation
});

export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;
export type UpdateApplicationInput = z.infer<typeof updateApplicationSchema>;
