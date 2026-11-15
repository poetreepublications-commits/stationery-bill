import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db.js";
import { wrap, parse, pageParams, paged } from "../lib/http.js";
import { HttpError, notFound } from "../lib/errors.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { audit } from "../services/audit.js";
import { DEFAULTS, getSetting, setSetting, type SettingsKey } from "../services/settings.js";
import { fyOf } from "../lib/fy.js";
import { stockByBook } from "./masters.js";

const r = Router();

// ---------- USERS (Super Admin) ----------
const userBody = z.object({
  name: z.string().min(2), email: z.string().email(), phone: z.string().optional(),
  role: z.enum(["SUPER_ADMIN", "ACCOUNTS", "SALES", "GODOWN"]), password: z.string().min(8).optional(),
  referralCode: z.string().min(4).optional().nullable(),
});

r.get("/users", requireRole("SUPER_ADMIN"), wrap(async (req, res) => {
  const { page, pageSize, skip, take } = pageParams(req.query);
  const where = { deletedAt: null, ...(req.query.role ? { role: req.query.role as any } : {}) };
  const [items, total] = await Promise.all([
    prisma.user.findMany({ where, skip, take, orderBy: { name: "asc" }, select: { id: true, name: true, email: true, phone: true, role: true, active: true, referralCode: true, dealerId: true } }),
    prisma.user.count({ where }),
  ]);
  res.json(paged(items, total, page, pageSize));
}));

r.post("/users", requireRole("SUPER_ADMIN"), wrap(async (req, res) => {
  const b = parse(userBody, req.body);
  const { password, ...rest } = b;
  const u = await prisma.user.create({
    data: {
      ...rest, email: b.email.toLowerCase(), referralCode: b.referralCode || null,
      passwordHash: await bcrypt.hash(password ?? Math.random().toString(36).slice(2) + "A1", 10),
    },
    select: { id: true, name: true, email: true, role: true, referralCode: true },
  });
  await audit(req.user!.id, "User", u.id, "CREATE", null, u);
  res.status(201).json(u);
}));

r.patch("/users/:id", requireRole("SUPER_ADMIN"), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const old = await prisma.user.findUnique({ where: { id }, select: { id: true, name: true, email: true, phone: true, role: true, active: true, referralCode: true } });
  if (!old) throw notFound();
  const b = parse(userBody.partial().extend({ active: z.boolean().optional() }), req.body);
  const { password, ...rest } = b;
  const data: any = { ...rest, email: b.email?.toLowerCase() };
  if (password) data.passwordHash = await bcrypt.hash(password, 10);
  const u = await prisma.user.update({ where: { id }, data, select: { id: true, name: true, email: true, role: true, active: true, referralCode: true } });
  await audit(req.user!.id, "User", id, "UPDATE", old, u);
  res.json(u);
}));

r.delete("/users/:id", requireRole("SUPER_ADMIN"), wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user!.id) throw new HttpError(400, "You cannot deactivate your own account");
  await prisma.user.update({ where: { id }, data: { active: false, deletedAt: new Date() } });
  await prisma.refreshToken.updateMany({ where: { userId: id }, data: { revoked: true } });
  await audit(req.user!.id, "User", id, "SOFT_DELETE");
  res.json({ ok: true });
}));

// Sales employees (for assignment dropdowns)
r.get("/sales-team", requireRole("SUPER_ADMIN", "ACCOUNTS"), wrap(async (_req, res) => {
  res.json(await prisma.user.findMany({ where: { role: "SALES", active: true, deletedAt: null }, select: { id: true, name: true } }));
}));

// ---------- SETTINGS ----------
r.get("/settings", wrap(async (req, res) => {
  const keys = Object.keys(DEFAULTS) as SettingsKey[];
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = await getSetting(k);
  if (req.user!.role === "DEALER") return res.json({ company: out.company });
  res.json(out);
}));

r.put("/settings/:key", requireRole("SUPER_ADMIN"), wrap(async (req, res) => {
  const key = req.params.key as SettingsKey;
  if (!(key in DEFAULTS)) throw notFound("Unknown setting");
  const old = await getSetting(key);
  await setSetting(key, req.body.value);
  await audit(req.user!.id, "Setting", key, "UPDATE", old, req.body.value);
  res.json({ key, value: req.body.value });
}));

r.post("/settings/lock-fy", requireRole("SUPER_ADMIN"), wrap(async (req, res) => {
  const { fy } = parse(z.object({ fy: z.string().regex(/^\d{4}-\d{2}$/) }), req.body);
  if (fy === fyOf()) throw new HttpError(400, "The current financial year cannot be locked");
  const locked = await getSetting("locked_fys");
  if (!locked.includes(fy)) await setSetting("locked_fys", [...locked, fy]);
  await audit(req.user!.id, "FinancialYear", fy, "LOCK");
  res.json({ locked: [...locked, fy] });
}));

// ---------- AUDIT LOG ----------
r.get("/audit", requireRole("SUPER_ADMIN"), wrap(async (req, res) => {
  const { page, pageSize, skip, take } = pageParams(req.query);
  const where = {
    ...(req.query.entity ? { entity: String(req.query.entity) } : {}),
    ...(req.query.entityId ? { entityId: String(req.query.entityId) } : {}),
    ...(req.query.userId ? { userId: Number(req.query.userId) } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({ where, skip, take, orderBy: { at: "desc" } }),
    prisma.auditLog.count({ where }),
  ]);
  const ids = [...new Set(items.map((i) => i.userId).filter((x): x is number => !!x))];
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const name = new Map(users.map((u) => [u.id, u.name]));
  res.json(paged(items.map((i) => ({ ...i, userName: i.userId ? name.get(i.userId) ?? null : null })), total, page, pageSize));
}));

// ---------- NOTIFICATIONS ----------
r.get("/notifications", wrap(async (req, res) => {
  const { page, pageSize, skip, take } = pageParams(req.query);
  const where = { userId: req.user!.id };
  const [items, total, unread] = await Promise.all([
    prisma.notification.findMany({ where, skip, take, orderBy: { createdAt: "desc" } }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { ...where, read: false } }),
  ]);
  res.json({ ...paged(items, total, page, pageSize), unread });
}));

r.post("/notifications/:id/read", wrap(async (req, res) => {
  await prisma.notification.updateMany({ where: { id: Number(req.params.id), userId: req.user!.id }, data: { read: true } });
  res.json({ ok: true });
}));

r.post("/notifications/read-all", wrap(async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.user!.id, read: false }, data: { read: true } });
  res.json({ ok: true });
}));

// ---------- DASHBOARD (role-based summary) ----------
r.get("/dashboard", wrap(async (req, res) => {
  const u = req.user!;
  const fy = fyOf();
  const openStatuses = ["PLACED", "ACCEPTED", "VERIFIED", "SENT_TO_GODOWN", "PICKING", "PACKED", "DISPATCHED", "BILTY_UPLOADED"] as const;
  if (u.role === "DEALER") {
    const orders = await prisma.order.count({ where: { dealerId: u.dealerId!, status: { in: [...openStatuses] } } });
    const pendingTerms = await prisma.termsVersion.findFirst({ where: { dealerId: u.dealerId! }, orderBy: { version: "desc" } });
    const accepted = pendingTerms ? await prisma.termsAcceptance.findFirst({ where: { termsVersionId: pendingTerms.id, userId: u.id } }) : null;
    return res.json({ openOrders: orders, termsPendingAcceptance: !!pendingTerms && !accepted });
  }
  if (u.role === "GODOWN") {
    const counts = await prisma.order.groupBy({ by: ["status"], where: { status: { in: ["SENT_TO_GODOWN", "PICKING", "PACKED"] } }, _count: true });
    const books = await prisma.book.findMany({ where: { deletedAt: null }, select: { id: true, reorderLevel: true } });
    const oh = await stockByBook(books.map((b) => b.id));
    const low = books.filter((b) => (oh[b.id] ?? 0) <= b.reorderLevel).length;
    return res.json({ queue: counts, lowStockBooks: low });
  }
  if (u.role === "SALES") {
    const dealers = await prisma.dealer.count({ where: { salesEmployeeId: u.id, deletedAt: null } });
    const pending = await prisma.order.count({ where: { dealer: { salesEmployeeId: u.id }, status: { in: ["PLACED"] } } });
    return res.json({ dealers, ordersToAccept: pending });
  }
  const [dealersPending, ordersToVerify, dealersTotal, outstanding] = await Promise.all([
    prisma.dealer.count({ where: { status: "PENDING", deletedAt: null } }),
    prisma.order.count({ where: { status: "ACCEPTED" } }),
    prisma.dealer.count({ where: { status: "ACTIVE", deletedAt: null } }),
    prisma.invoice.aggregate({ where: { fy }, _sum: { netPaise: true } }),
  ]);
  res.json({ fy, dealersPending, ordersToVerify, activeDealers: dealersTotal, salesThisFyPaise: outstanding._sum.netPaise ?? 0 });
}));

export default r;
