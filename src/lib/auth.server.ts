import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { deleteCookie, getCookie, getRequest, setCookie } from "@tanstack/react-start/server";

import { sqlite } from "./database.server";

const cookieName = "criabot_session";
const legacyCookieName = "botvendassl_session";
const sessionDurationSeconds = 30 * 24 * 60 * 60;

type AdminRow = { id: string; email: string; password_hash: string };

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

function safeEqualText(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
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
  return getCookie(cookieName) ?? getCookie(legacyCookieName);
}

export function hasAdminAccount() {
  const row = sqlite.prepare("SELECT COUNT(*) AS total FROM admin_accounts").get() as {
    total: number;
  };
  return row.total > 0;
}

export function createAdmin(email: string, password: string, signupCode?: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const alreadyHasAdmin = hasAdminAccount();

  if (alreadyHasAdmin) {
    const expectedCode = process.env.ADMIN_SIGNUP_CODE?.trim();
    if (!expectedCode) throw new Error("Configure ADMIN_SIGNUP_CODE para liberar novos cadastros");
    if (!signupCode || !safeEqualText(signupCode.trim(), expectedCode)) {
      throw new Error("Codigo de cadastro invalido");
    }
  }

  const existing = sqlite
    .prepare("SELECT id FROM admin_accounts WHERE email = ? COLLATE NOCASE")
    .get(normalizedEmail);
  if (existing) throw new Error("Ja existe uma conta com este e-mail");

  const id = randomUUID();
  sqlite
    .prepare("INSERT INTO admin_accounts (id, email, password_hash) VALUES (?, ?, ?)")
    .run(id, normalizedEmail, hashPassword(password));
  createSession(id);
  return { id, email: normalizedEmail };
}

export function loginAdmin(email: string, password: string) {
  const account = sqlite
    .prepare("SELECT id, email, password_hash FROM admin_accounts WHERE email = ? COLLATE NOCASE")
    .get(email.trim()) as AdminRow | undefined;
  if (!account || !verifyPassword(password, account.password_hash)) {
    throw new Error("E-mail ou senha incorretos");
  }
  createSession(account.id);
  return { id: account.id, email: account.email };
}

export function logoutAdmin() {
  const token = getSessionCookie();
  if (token)
    sqlite.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(hashSessionToken(token));
  deleteCookie(cookieName, { ...cookieOptions(), maxAge: 0 });
  deleteCookie(legacyCookieName, { ...cookieOptions(), maxAge: 0 });
}

export function getCurrentAdmin() {
  const token = getSessionCookie();
  if (!token) return null;
  const row = sqlite
    .prepare(
      `SELECT a.id, a.email, s.expires_at
       FROM admin_sessions s
       JOIN admin_accounts a ON a.id = s.admin_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(hashSessionToken(token), new Date().toISOString()) as
    | { id: string; email: string; expires_at: string }
    | undefined;
  return row ? { id: row.id, email: row.email } : null;
}

export function requireAdminSession() {
  const admin = getCurrentAdmin();
  if (!admin) throw new Error("Nao autenticado");
  return admin;
}
