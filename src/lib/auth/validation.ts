import { z } from "zod";
import { US_TIMEZONES } from "@/lib/geocode";

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

const districtName = z.string().trim().min(1, "Give the district a name").max(80, "Name is too long");

export const districtCreateSchema = z.object({
  name: districtName,
  organizationId: z.string().min(1).max(64).optional(),
});

export const districtPatchSchema = z
  .object({
    name: districtName.optional(),
    /** The full set of locations that belong here; any not listed are moved out. */
    locationIds: idList.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Nothing to change" });

export const memberPatchSchema = z
  .object({
    name: z.string().trim().max(80, "Name is too long").optional(),
    role: customerRole.optional(),
    districtIds: idList.optional(),
    locationIds: idList.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Nothing to change" });

/** A restaurant as the owner enters it: the street, not the coordinates — those are looked up. */
const locationFields = {
  name: z.string().trim().min(1, "Give the restaurant a name").max(80, "Name is too long"),
  address: z.string().trim().min(1, "Enter the street address").max(120, "Address is too long"),
  city: z.string().trim().min(1, "Enter the city").max(60, "City is too long"),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "State is the two-letter code, e.g. CA"),
  zip: z.string().trim().regex(/^\d{5}(-\d{4})?$/, "ZIP is five digits"),
  timezone: z.enum(US_TIMEZONES),
};

export const locationCreateSchema = z.object({
  ...locationFields,
  timezone: locationFields.timezone.optional(),
  organizationId: z.string().min(1).max(64).optional(),
});

export const locationPatchSchema = z
  .object({
    name: locationFields.name.optional(),
    address: locationFields.address.optional(),
    city: locationFields.city.optional(),
    state: locationFields.state.optional(),
    zip: locationFields.zip.optional(),
    timezone: locationFields.timezone.optional(),
    /** false deactivates, true brings it back; the rest of the row is untouched either way. */
    active: z.boolean().optional(),
    /** The full set of managers / technicians assigned here; any not listed are taken off. */
    managerIds: idList.optional(),
    technicianIds: idList.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Nothing to change" });

/** Refrigerants the form offers; anything else is typed under "Other". */
export const REFRIGERANTS = ["R-410A", "R-22", "R-32", "R-454B", "R-448A"] as const;

const nameplate = (max = 80) => z.string().trim().max(max, "Too long").transform((v) => v || null).nullable().optional();

/**
 * The unit's passport as a technician fills it in at the unit. Every field optional, every
 * field free text as written on the part, except the year, which is a year.
 */
export const passportPatchSchema = z
  .object({
    model: nameplate(80),
    serial: nameplate(80),
    year: z.number().int().min(1950).max(new Date().getFullYear()).nullable().optional(),
    refrigerant: nameplate(40),
    belts: nameplate(80),
    capacitor: nameplate(80),
    filter: nameplate(80),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Nothing to change" });
