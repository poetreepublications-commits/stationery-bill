import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { wrap, parse } from "../lib/http.js";
import { HttpError } from "../lib/errors.js";
import { requireAuth, signAccess } from "../middleware/auth.js";
import { audit } from "../services/audit.js";
import { notify, sendEmail } from "../services/notify.js";

const r = Router();
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

async function issueTokens(userId: number, role: any, dealerId: number | null, name: string) {
  const refresh = crypto.randomBytes(48).toString("hex");
  await prisma.refreshToken.create({
    data: { tokenHash: sha(refresh), userId, expiresAt: new Date(Date.now() + 30 * 86400000) },
  });
  return { accessToken: signAccess({ id: userId, role, dealerId, name }), refreshToken: refresh };
}

r.post("/login", wrap(async (req, res) => {
  const { email, password } = parse(z.object({ email: z.string(), password: z.string() }), req.body);
  const u = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() }, include: { dealer: true } });
  if (!u || u.deletedAt || !u.active || !(await bcrypt.compare(password, u.passwordHash))) {
    throw new HttpError(401, "Wrong email or password");
  }
  const dealerId = u.dealer?.id ?? null;
  const tokens = await issueTokens(u.id, u.role, dealerId, u.name);
  res.json({ ...tokens, user: { id: u.id, name: u.name, email: u.email, role: u.role, dealerId, dealerType: u.dealer?.type ?? null } });
}));

r.post("/refresh", wrap(async (req, res) => {
  const { refreshToken } = parse(z.object({ refreshToken: z.string() }), req.body);
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: sha(refreshToken) }, include: { user: { include: { dealer: true } } } });
  if (!row || row.revoked || row.expiresAt < new Date() || !row.user.active) throw new HttpError(401, "Please log in again");
  // rotate
  await prisma.refreshToken.update({ where: { id: row.id }, data: { revoked: true } });
  const tokens = await issueTokens(row.user.id, row.user.role, row.user.dealer?.id ?? null, row.user.name);
  res.json(tokens);
}));

r.post("/logout", wrap(async (req, res) => {
  const { refreshToken } = parse(z.object({ refreshToken: z.string() }), req.body);
  await prisma.refreshToken.updateMany({ where: { tokenHash: sha(refreshToken) }, data: { revoked: true } });
  res.json({ ok: true });
}));

r.get("/me", requireAuth, wrap(async (req, res) => {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, include: { dealer: true } });
  res.json({ id: u.id, name: u.name, email: u.email, role: u.role, dealerId: u.dealer?.id ?? null, dealerType: u.dealer?.type ?? null, referralCode: u.referralCode });
}));

// Self-registration of a dealer. Stays PENDING until Accounts approves.
r.post("/register-dealer", wrap(async (req, res) => {
  const b = parse(z.object({
    firmName: z.string().min(2), type: z.enum(["SCHOOL", "BOOKSELLER"]),
    ownerName: z.string().min(2), mobile: z.string().min(10), email: z.string().email(),
    password: z.string().min(8), address: z.string().optional(), city: z.string().optional(),
    state: z.string().optional(), pincode: z.string().optional(), gstin: z.string().optional(),
    pan: z.string().optional(), referralCode: z.string().optional(),
  }), req.body);
  const exists = await prisma.user.findUnique({ where: { email: b.email.toLowerCase() } });
  if (exists) throw new HttpError(409, "This email is already registered");
  const sales = b.referralCode
    ? await prisma.user.findFirst({ where: { referralCode: b.referralCode, role: "SALES", active: true } })
    : null;
  const { password, email, referralCode, ...d } = b;
  const dealer = await prisma.dealer.create({
    data: { ...d, email, status: "PENDING", salesEmployeeId: sales?.id ?? null },
  });
  await prisma.user.create({
    data: { name: d.ownerName, email: email.toLowerCase(), phone: d.mobile, role: "DEALER", dealerId: dealer.id, passwordHash: await bcrypt.hash(password, 10) },
  });
  await audit(null, "Dealer", dealer.id, "SELF_REGISTER", null, dealer);
  const finance = await prisma.user.findMany({ where: { role: { in: ["ACCOUNTS", "SUPER_ADMIN"] }, active: true }, select: { id: true } });
  await notify(finance.map((f) => f.id), "New dealer registration", `${dealer.firmName} is waiting for approval.`, `/dealers/${dealer.id}`);
  res.status(201).json({ id: dealer.id, status: dealer.status, message: "Registered. Your account will be activated after Accounts approves it." });
}));

// Password reset: emails a 30-minute token (logged to console if SMTP is not set).
r.post("/forgot", wrap(async (req, res) => {
  const { email } = parse(z.object({ email: z.string() }), req.body);
  const u = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (u) {
    const token = jwt.sign({ sub: u.id, purpose: "reset" }, config.jwtSecret + u.passwordHash.slice(-10), { expiresIn: "30m" });
    await sendEmail(u.email, "Poetree password reset", `Use this token to reset your password (valid 30 min):\n\n${token}`);
  }
  res.json({ ok: true, message: "If the email exists, a reset token has been sent." });
}));

r.post("/reset", wrap(async (req, res) => {
  const { token, password } = parse(z.object({ token: z.string(), password: z.string().min(8) }), req.body);
  const decoded = jwt.decode(token) as { sub: number } | null;
  if (!decoded) throw new HttpError(400, "Invalid token");
  const u = await prisma.user.findUnique({ where: { id: decoded.sub } });
  if (!u) throw new HttpError(400, "Invalid token");
  try {
    jwt.verify(token, config.jwtSecret + u.passwordHash.slice(-10));
  } catch {
    throw new HttpError(400, "Token expired or invalid");
  }
  await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await bcrypt.hash(password, 10) } });
  await prisma.refreshToken.updateMany({ where: { userId: u.id }, data: { revoked: true } });
  res.json({ ok: true });
}));

export default r;
