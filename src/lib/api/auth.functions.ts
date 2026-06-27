import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  createAdmin,
  getCurrentAdmin,
  hasAdminAccount,
  loginAdmin,
  logoutAdmin,
} from "@/lib/auth.server";

const credentialsSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
});

const createAccountSchema = credentialsSchema.extend({
  signup_code: z.string().max(200).optional(),
  password: z
    .string()
    .min(12)
    .max(200)
    .regex(/[a-z]/, "Inclua uma letra minúscula")
    .regex(/[A-Z]/, "Inclua uma letra maiúscula")
    .regex(/\d/, "Inclua um número")
    .regex(/[^A-Za-z0-9]/, "Inclua um símbolo"),
});

export const getAuthStatus = createServerFn({ method: "GET" }).handler(async () => ({
  hasAdmin: hasAdminAccount(),
  authenticated: Boolean(getCurrentAdmin()),
}));

export const createAdminAccount = createServerFn({ method: "POST" })
  .validator(createAccountSchema)
  .handler(async ({ data }) => ({
    ok: true,
    admin: createAdmin(data.email, data.password, data.signup_code),
  }));

export const loginAdminAccount = createServerFn({ method: "POST" })
  .validator(credentialsSchema)
  .handler(async ({ data }) => ({ ok: true, admin: loginAdmin(data.email, data.password) }));

export const logoutAdminAccount = createServerFn({ method: "POST" }).handler(async () => {
  logoutAdmin();
  return { ok: true };
});

export const getAdminSession = createServerFn({ method: "GET" }).handler(async () => {
  const admin = getCurrentAdmin();
  return { authenticated: Boolean(admin), admin };
});
