import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.").max(254);
export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(128)
  .refine((p) => /[a-zA-Z]/.test(p) && /\d/.test(p), "Include at least one letter and one number.");

export const signupSchema = z.object({
  displayName: z.string().trim().min(1, "Tell us what to call you.").max(80),
  email: emailSchema,
  password: passwordSchema,
  acceptTerms: z.literal(true, { message: "Please accept the terms to continue." }),
});
export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1, "Enter your password.").max(128) });
export const forgotSchema = z.object({ email: emailSchema });
export const resetSchema = z.object({ password: passwordSchema });

export const scoreSchema = z.object({
  scoreDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid date."),
  value: z.coerce.number({ message: "Enter your Stableford points." }).int("Whole numbers only.").min(1, "Between 1 and 45.").max(45, "Between 1 and 45."),
});

export const onboardingSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  charityId: z.string().uuid("Choose a charity."),
  charityPercent: z.coerce.number().min(10, "The minimum is 10%.").max(100).refine((n) => Number.isInteger(n * 100), "Use at most two decimals."),
  plan: z.enum(["monthly", "yearly"]),
  acceptTerms: z.literal(true, { message: "Please accept the terms to continue." }),
});

export const contactSchema = z.object({
  name: z.string().trim().min(1, "Your name, please.").max(100),
  email: emailSchema,
  topic: z.enum(["general", "support", "charity", "press"]),
  message: z.string().trim().min(10, "A few more words, please.").max(4000),
  website: z.string().max(0).optional(), // honeypot
});

export const charitySchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Lowercase letters, numbers and hyphens.").max(80),
  shortDescription: z.string().trim().max(240).optional().or(z.literal("")),
  description: z.string().trim().max(8000).optional().or(z.literal("")),
  category: z.string().trim().max(60).optional().or(z.literal("")),
  location: z.string().trim().max(80).optional().or(z.literal("")),
  websiteUrl: z.string().trim().url().max(300).optional().or(z.literal("")),
  imageUrl: z.string().trim().url().max(500).optional().or(z.literal("")),
  imageAlt: z.string().trim().max(200).optional().or(z.literal("")),
  status: z.enum(["active", "inactive", "archived"]),
  isFeatured: z.coerce.boolean().optional(),
});

export const drawCreateSchema = z.object({
  periodMonth: z.string().regex(/^\d{4}-\d{2}$/, "Pick a month."),
  title: z.string().trim().min(3).max(120),
  cutoffDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mode: z.enum(["random", "weighted"]),
  weightBias: z.enum(["frequent", "rare"]).default("frequent"),
  weightSmoothing: z.coerce.number().int().min(0).max(100).default(1),
});

export const tierConfigSchema = z
  .object({
    s5: z.coerce.number().int().min(0).max(10000),
    s4: z.coerce.number().int().min(0).max(10000),
    s3: z.coerce.number().int().min(0).max(10000),
    unclaimedPolicy: z.enum(["reserve", "jackpot"]),
  })
  .refine((v) => v.s5 + v.s4 + v.s3 === 10000, { message: "Tier shares must total exactly 100% (10000 basis points)." });

export const evidenceReviewSchema = z.object({
  evidenceId: z.string().uuid(),
  decision: z.enum(["approve", "reject"]),
  reason: z.string().trim().max(500).optional().or(z.literal("")),
});

export const payoutSchema = z.object({
  winningId: z.string().uuid(),
  reference: z.string().trim().min(4, "Enter the transfer reference (min 4 characters).").max(80),
  method: z.string().trim().max(40).optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

export type ActionState = { ok: boolean; message?: string; errors?: Record<string, string>; data?: Record<string, unknown> };

export function zodErrors(e: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of e.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export function formObject(fd: FormData): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string") o[k] = v;
  for (const k of ["acceptTerms", "isFeatured"]) o[k] = fd.get(k) === "on" || fd.get(k) === "true";
  return o;
}
