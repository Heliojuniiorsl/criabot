import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { deleteCookie, getCookie, getRequest, setCookie } from "@tanstack/react-start/server";

import { sqlite } from "./database.server";

const cookieName = "criabot_session";
const sessionDurationSeconds = 30 * 24 * 60 * 60;

export type AccountRole = "admin" | "creator";

type AdminRow = {
  id: string;
  email: string;
  password_hash: string;
  role: AccountRole;
};

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password: string, encoded: string) {
  const [algorithm, salt, stored] = encoded.split("$");
  if (algorithm !== "scrypt" || !salt || !stored) return false;
  const expected = Buffer.from(stored, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function cookieOptions() {
  const request = getRequest();
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const secure = forwardedProto === "https" || new URL(request.url).protocol === "https:";
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: sessionDurationSeconds,
  };
}

function createSession(adminId: string) {
  sqlite.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").run(new Date().toISOString());
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionDurationSeconds * 1000).toISOString();
  sqlite
    .prepare("INSERT INTO admin_sessions (token_hash, admin_id, expires_at) VALUES (?, ?, ?)")
    .run(hashSessionToken(token), adminId, expiresAt);
  setCookie(cookieName, token, cookieOptions());
}

function getSessionCookie() {
  return getCookie(cookieName);
}

export function hasAdminAccount() {
  const row = sqlite.prepare("SELECT COUNT(*) AS total FROM admin_accounts").get() as {
    total: number;
  };
  return row.total > 0;
}

export function createAccount(email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const alreadyHasAdmin = hasAdminAccount();
  const role: AccountRole = alreadyHasAdmin ? "creator" : "admin";

  const existing = sqlite
    .prepare("SELECT id FROM admin_accounts WHERE email = ? COLLATE NOCASE")
    .get(normalizedEmail);
  if (existing) throw new Error("Ja existe uma conta com este e-mail");

  const id = randomUUID();
  sqlite
    .prepare("INSERT INTO admin_accounts (id, email, password_hash, role) VALUES (?, ?, ?, ?)")
    .run(id, normalizedEmail, hashPassword(password), role);
  createSession(id);
  return {
    id,
    email: normalizedEmail,
    role,
  };
}

export function loginAdmin(email: string, password: string) {
  const account = sqlite
    .prepare(
      "SELECT id, email, password_hash, role FROM admin_accounts WHERE email = ? COLLATE NOCASE",
    )
    .get(email.trim()) as AdminRow | undefined;
  if (!account || !verifyPassword(password, account.password_hash)) {
    throw new Error("E-mail ou senha incorretos");
  }
  createSession(account.id);
  return {
    id: account.id,
    email: account.email,
    role: account.role ?? "admin",
  };
}

export function logoutAdmin() {
  const token = getSessionCookie();
  if (token)
    sqlite.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(hashSessionToken(token));
  deleteCookie(cookieName, { ...cookieOptions(), maxAge: 0 });
  deleteCookie("criabot_session_public", { ...cookieOptions(), maxAge: 0 });
  deleteCookie("botvendassl_session", { ...cookieOptions(), maxAge: 0 });
}

export function getCurrentAdmin() {
  const token = getSessionCookie();
  if (!token) return null;
  const row = sqlite
    .prepare(
      `SELECT a.id, a.email, a.role, s.expires_at
       FROM admin_sessions s
       JOIN admin_accounts a ON a.id = s.admin_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(hashSessionToken(token), new Date().toISOString()) as
    | { id: string; email: string; role: AccountRole | null; expires_at: string }
    | undefined;
  return row ? { id: row.id, email: row.email, role: row.role ?? "admin" } : null;
}

export function requireAdminSession() {
  const admin = getCurrentAdmin();
  if (!admin) throw new Error("Nao autenticado");
  if (admin.role !== "admin") throw new Error("Acesso restrito ao administrador da plataforma");
  return admin;
}

export function requireAccountSession() {
  const account = getCurrentAdmin();
  if (!account) throw new Error("Nao autenticado");
  return account;
}
