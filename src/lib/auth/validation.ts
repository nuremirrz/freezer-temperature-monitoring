import { z } from "zod";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "E-mail is too long")
  .refine((v) => EMAIL_RE.test(v), "Enter a valid e-mail address");

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password is too long");

export const registerSchema = z.object({
  name: z.string().trim().max(80, "Name is too long").optional(),
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required").max(128),
  rememberMe: z.boolean().optional(),
});

export const emailOnlySchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(16).max(200),
  password: passwordSchema,
});

export const deleteAccountSchema = z.object({
  password: z.string().min(1, "Password is required").max(128),
});

/** `admin` is not here on purpose: nobody hands out Qimby's own role by invitation. */
const customerRole = z.enum(["owner", "district_manager", "technician"]);
const idList = z.array(z.string().min(1).max(64)).max(200);

export const inviteSchema = z.object({
  email: emailSchema,
  name: z.string().trim().max(80, "Name is too long").optional(),
  role: customerRole,
  districtIds: idList.optional(),
  locationIds: idList.optional(),
  /** Only an admin needs to say which organization — everyone else is inside one already. */
  organizationId: z.string().min(1).max(64).optional(),
});

export const memberPatchSchema = z
  .object({
    name: z.string().trim().max(80, "Name is too long").optional(),
    role: customerRole.optional(),
    districtIds: idList.optional(),
    locationIds: idList.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Nothing to change" });
