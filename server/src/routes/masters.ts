import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { prisma } from "../db.js";
import { wrap, parse, pageParams, paged } from "../lib/http.js";
import { HttpError, notFound, forbidden } from "../lib/errors.js";
import { requireAuth, requireRole, type AuthUser } from "../middleware/auth.js";
import { audit } from "../services/audit.js";
import { notify } from "../services/notify.js";
import { dealerScope } from "../lib/scope.js";
import { config } from "../config.js";

const r = Router();
const FIN = ["SUPER_ADMIN", "ACCOUNTS"] as const;
const STAFF = ["SUPER_ADMIN", "ACCOUNTS", "SALES"] as const;
const contains = (q: unknown) => (q ? { contains: String(q), mode: "insensitive" as const } : undefined);


// ---------- DEALERS ----------
const dealerBody = z.object({
  firmName: z.string().min(2), type: z.enum(["SCHOOL", "BOOKSELLER"]).default("SCHOOL"),
  ownerName: z.string().min(2), mobile: z.string().min(10), email: z.string().email().optional().or(z.literal("")),
  address: z.string().optional(), city: z.string().optional(), state: z.string().optional(),
  pincode: z.string().optional(), gstin: z.string().optional(), pan: z.string().optional(),
  salesEmployeeId: z.number().int().optional().nullable(),
  creditLimitPaise: z.number().int().min(0).default(0), creditDays: z.number().int().min(0).default(30),
  defaultDiscountBp: z.number().int().min(0).max(10000).default(0),
  openingBalancePaise: z.number().int().default(0), returnLimitQty: z.number().int().min(0).default(0),
  // optional login for the dealer
  loginPassword: z.string().min(8).optional(),
});
const financePatch = ["creditLimitPaise", "creditDays", "defaultDiscountBp", "openingBalancePaise", "returnLimitQty", "salesEmployeeId", "status"];

r.get("/dealers", requireRole(...STAFF, "DEALER"), wrap(async (req, res) => {
  const { page, pageSize, skip, take } = pageParams(req.query);
  const where = {
    AND: [
      dealerScope(req.user!), { deletedAt: null },
      req.query.status ? { status: req.query.status as any } : {},
      req.query.q ? { OR: [{ firmName: contains(req.query.q) }, { mobile: contains(req.query.q) }, { city: contains(req.query.q) }] } : {},
    ],
  };
  const [items, total] = await Promise.all([
    prisma.dealer.findMany({ where, skip, take, orderBy: { firmName: "asc" }, include: { salesEmployee: { select: { id: true, name: true } } } }),
    prisma.dealer.count({ where }),
  ]);
  res.json(paged(items, total, page, pageSize));
}));

r.get("/dealers/:id", requireRole(...STAFF, "DEALER"), wrap(async (req, res) => {
  const d = await prisma.dealer.findFirst({
    where: { AND: [dealerScope(req.user!), { id: Number(req.params.id) }] },
    include: { schools: { where: { deletedAt: null } }, salesEmployee: { select: { id: true, name: true } } },
  });
  if (!d) throw notFound("Dealer not found");
  res.json(d);
}));

r.post("/dealers", requireRole(...STAFF), wrap(async (req, res) => {
  const b = parse(dealerBody, req.body);
  const u = req.user!;
  // Sales-created dealers wait for Accounts approval; Accounts/Super Admin create active dealers.
  const isFin = u.role === "SUPER_ADMIN" || u.role === "ACCOUNTS";
  if (!isFin && (b.creditLimitPaise || b.defaultDiscountBp || b.openingBalancePaise || b.returnLimitQty)) {
    throw forbidden("Only Accounts can set credit, discount, opening balance or return limits");
  }
  const { loginPassword, ...data } = b;
  const dealer = await prisma.dealer.create({
    data: {
      ...data, email: data.email || null,
      status: isFin ? "ACTIVE" : "PENDING",
      salesEmployeeId: isFin ? (data.salesEmployeeId ?? null) : u.id,
    },
  });
  if (data.type === "SCHOOL") {
    // A School-type dealer is its own only school.
    await prisma.school.create({ data: { dealerId: dealer.id, name: data.firmName, address: data.address, contact: data.mobile } });
  }
  if (loginPassword && data.email) {
    await prisma.user.create({
      data: { name: data.ownerName, email: data.email.toLowerCase(), phone: data.mobile, role: "DEALER", dealerId: dealer.id, passwordHash: await bcrypt.hash(loginPassword, 10) },
    });
  }
  await audit(u.id, "Dealer", dealer.id, "CREATE", null, dealer);
  if (!isFin) {
    const fin = await prisma.user.findMany({ where: { role: { in: ["ACCOUNTS", "SUPER_ADMIN"] }, active: true }, select: { id: true } });
    await notify(fin.map((x) => x.id), "Dealer awaiting approval", `${dealer.firmName} added by ${u.name}.`, `/dealers/${dealer.id}`);
  }
  res.status(201).json(dealer);
}));

r.patch("/dealers/:id", requireRole(...STAFF), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const old = await prisma.dealer.findFirst({ where: { id, deletedAt: null, AND: [dealerScope(req.user!)] } });
  if (!old) throw notFound("Dealer not found");
  const b = parse(dealerBody.partial().extend({ status: z.enum(["PENDING", "ACTIVE", "INACTIVE"]).optional() }), req.body);
  const isFin = req.user!.role !== "SALES";
  if (!isFin && Object.keys(b).some((k) => financePatch.includes(k))) throw forbidden("Only Accounts can change finance fields");
  const { loginPassword, ...data } = b;
  const updated = await prisma.dealer.update({ where: { id }, data: { ...data, email: data.email || undefined } as any });
  await audit(req.user!.id, "Dealer", id, "UPDATE", old, updated);
  res.json(updated);
}));

r.post("/dealers/:id/approve", requireRole(...FIN), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const d = await prisma.dealer.findFirst({ where: { id, deletedAt: null } });
  if (!d) throw notFound();
  const updated = await prisma.dealer.update({ where: { id }, data: { status: "ACTIVE" } });
  await audit(req.user!.id, "Dealer", id, "APPROVE", d, updated);
  const dealerUser = await prisma.user.findUnique({ where: { dealerId: id } });
  await notify([dealerUser?.id, updated.salesEmployeeId], "Dealer approved", `${updated.firmName} is now active. Accept the terms and conditions to start ordering.`, `/dealers/${id}`);
  res.json(updated);
}));

r.post("/dealers/:id/assign", requireRole(...FIN), wrap(async (req, res) => {
  const { salesEmployeeId } = parse(z.object({ salesEmployeeId: z.number().int() }), req.body);
  const id = Number(req.params.id);
  const old = await prisma.dealer.findUniqueOrThrow({ where: { id } });
  const updated = await prisma.dealer.update({ where: { id }, data: { salesEmployeeId } });
  await audit(req.user!.id, "Dealer", id, "ASSIGN_SALES", { salesEmployeeId: old.salesEmployeeId }, { salesEmployeeId });
  res.json(updated);
}));

r.delete("/dealers/:id", requireRole("SUPER_ADMIN"), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const d = await prisma.dealer.update({ where: { id }, data: { deletedAt: new Date(), status: "INACTIVE" } });
  await audit(req.user!.id, "Dealer", id, "SOFT_DELETE", null, { deleted: true });
  res.json(d);
}));

// ---------- SCHOOLS ----------
const schoolBody = z.object({ name: z.string().min(2), address: z.string().optional(), board: z.string().optional(), contact: z.string().optional() });

r.get("/dealers/:id/schools", wrap(async (req, res) => {
  const dealer = await prisma.dealer.findFirst({ where: { AND: [dealerScope(req.user!), { id: Number(req.params.id) }] } });
  if (!dealer) throw notFound();
  res.json(await prisma.school.findMany({ where: { dealerId: dealer.id, deletedAt: null }, orderBy: { name: "asc" } }));
}));

r.post("/dealers/:id/schools", requireRole(...STAFF, "DEALER"), wrap(async (req, res) => {
  const dealer = await prisma.dealer.findFirst({ where: { AND: [dealerScope(req.user!), { id: Number(req.params.id) }] } });
  if (!dealer) throw notFound();
  if (dealer.type === "SCHOOL") throw new HttpError(400, "A School-type dealer orders for itself and does not add schools");
  const s = await prisma.school.create({ data: { ...parse(schoolBody, req.body), dealerId: dealer.id } });
  await audit(req.user!.id, "School", s.id, "CREATE", null, s);
  res.status(201).json(s);
}));

r.patch("/schools/:id", requireRole(...STAFF, "DEALER"), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const s = await prisma.school.findFirst({ where: { id, deletedAt: null, dealer: dealerScope(req.user!) } });
  if (!s) throw notFound();
  const updated = await prisma.school.update({ where: { id }, data: parse(schoolBody.partial(), req.body) });
  await audit(req.user!.id, "School", id, "UPDATE", s, updated);
  res.json(updated);
}));

r.delete("/schools/:id", requireRole(...STAFF, "DEALER"), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const s = await prisma.school.findFirst({ where: { id, deletedAt: null, dealer: dealerScope(req.user!) } });
  if (!s) throw notFound();
  await prisma.school.update({ where: { id }, data: { deletedAt: new Date() } });
  await audit(req.user!.id, "School", id, "SOFT_DELETE", s, null);
  res.json({ ok: true });
}));

// ---------- TERMS & CONDITIONS (versioned, two-sided acceptance) ----------
const termsBody = z.object({
  discountBp: z.number().int().min(0).max(10000),
  creditLimitPaise: z.number().int().min(0),
  creditDays: z.number().int().min(0),
  returnLimitQty: z.number().int().min(0),
  paymentTerms: z.string().optional(), returnPolicy: z.string().optional(), clauses: z.string().optional(),
});
const TERM_FIELDS = ["discountBp", "creditLimitPaise", "creditDays", "returnLimitQty", "paymentTerms", "returnPolicy", "clauses"] as const;

// Returns the version history, the current version, and what changed from the previous one.
export async function currentTerms(dealerId: number) {
  return prisma.termsVersion.findFirst({ where: { dealerId }, orderBy: { version: "desc" } });
}

r.get("/dealers/:id/terms", wrap(async (req, res) => {
  const dealerId = Number(req.params.id);
  const d = await prisma.dealer.findFirst({ where: { AND: [dealerScope(req.user!), { id: dealerId }] } });
  if (!d) throw notFound();
  const versions = await prisma.termsVersion.findMany({ where: { dealerId }, orderBy: { version: "desc" }, include: { acceptances: { include: { user: { select: { name: true } } } } } });
  const latest = versions[0] ?? null;
  const previous = versions[1] ?? null;
  const changes = latest && previous
    ? TERM_FIELDS.filter((f) => String((latest as any)[f] ?? "") !== String((previous as any)[f] ?? "")).map((f) => ({ field: f, from: (previous as any)[f], to: (latest as any)[f] }))
    : [];
  const mine = latest && req.user!.role === "DEALER"
    ? await prisma.termsAcceptance.findFirst({ where: { termsVersionId: latest.id, userId: req.user!.id } })
    : null;
  res.json({ latest, changes, accepted: req.user!.role === "DEALER" ? !!mine : null, acceptedAt: mine?.acceptedAt ?? null, versions });
}));

r.post("/dealers/:id/terms", requireRole(...FIN), wrap(async (req, res) => {
  const dealerId = Number(req.params.id);
  const b = parse(termsBody, req.body);
  const dealer = await prisma.dealer.findUnique({ where: { id: dealerId } });
  if (!dealer) throw notFound();
  const last = await currentTerms(dealerId);
  const version = await prisma.termsVersion.create({ data: { ...b, dealerId, version: (last?.version ?? 0) + 1, createdById: req.user!.id } });
  // Terms are the source of truth: mirror the commercial fields onto the dealer record.
  await prisma.dealer.update({
    where: { id: dealerId },
    data: { defaultDiscountBp: b.discountBp, creditLimitPaise: b.creditLimitPaise, creditDays: b.creditDays, returnLimitQty: b.returnLimitQty },
  });
  await audit(req.user!.id, "Terms", version.id, "NEW_VERSION", last, version);
  const dealerUser = await prisma.user.findUnique({ where: { dealerId } });
  await notify([dealerUser?.id], "Terms & conditions updated", `Version ${version.version} needs your acceptance before you can order.`, `/terms`);
  res.status(201).json(version);
}));

r.post("/dealers/:id/terms/accept", requireRole("DEALER"), wrap(async (req, res) => {
  const dealerId = Number(req.params.id);
  if (req.user!.dealerId !== dealerId) throw forbidden();
  const latest = await currentTerms(dealerId);
  if (!latest) throw new HttpError(400, "No terms have been issued yet");
  const existing = await prisma.termsAcceptance.findFirst({ where: { termsVersionId: latest.id, userId: req.user!.id } });
  if (existing) return res.json(existing);
  const acc = await prisma.termsAcceptance.create({
    data: { termsVersionId: latest.id, userId: req.user!.id, ip: req.ip, device: String(req.headers["user-agent"] ?? "").slice(0, 200) },
  });
  await audit(req.user!.id, "Terms", latest.id, "ACCEPT", null, { version: latest.version });
  res.status(201).json(acc);
}));

// ---------- BOOKS ----------
const bookBody = z.object({
  code: z.string().min(1), isbn: z.string().optional().nullable(), title: z.string().min(1),
  className: z.string().optional(), subject: z.string().optional(), series: z.string().optional(),
  board: z.string().optional(), mrpPaise: z.number().int().min(0), hsn: z.string().optional(),
  weightGrams: z.number().int().optional(), reorderLevel: z.number().int().min(0).default(0), active: z.boolean().default(true),
});

r.get("/books", wrap(async (req, res) => {
  const { page, pageSize, skip, take } = pageParams(req.query);
  const q = req.query.q;
  const where = {
    deletedAt: null,
    ...(req.query.isbn ? { isbn: String(req.query.isbn) } : {}),
    ...(req.query.className ? { className: String(req.query.className) } : {}),
    ...(q ? { OR: [{ title: contains(q) }, { code: contains(q) }, { isbn: contains(q) }, { subject: contains(q) }] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.book.findMany({ where, skip, take, orderBy: [{ className: "asc" }, { code: "asc" }] }),
    prisma.book.count({ where }),
  ]);
  const onHand = await stockByBook(items.map((b) => b.id));
  res.json(paged(items.map((b) => ({ ...b, onHand: onHand[b.id] ?? 0 })), total, page, pageSize));
}));

export async function stockByBook(bookIds: number[]): Promise<Record<number, number>> {
  if (!bookIds.length) return {};
  const rows = await prisma.stockEntry.groupBy({ by: ["bookId"], where: { bookId: { in: bookIds } }, _sum: { qty: true } });
  return Object.fromEntries(rows.map((r) => [r.bookId, r._sum.qty ?? 0]));
}

r.post("/books", requireRole(...FIN, "GODOWN"), wrap(async (req, res) => {
  const b = parse(bookBody, req.body);
  const book = await prisma.book.create({ data: { ...b, isbn: b.isbn || null } });
  await audit(req.user!.id, "Book", book.id, "CREATE", null, book);
  res.status(201).json(book);
}));

r.patch("/books/:id", requireRole(...FIN, "GODOWN"), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const old = await prisma.book.findUnique({ where: { id } });
  if (!old) throw notFound();
  const updated = await prisma.book.update({ where: { id }, data: parse(bookBody.partial(), req.body) });
  await audit(req.user!.id, "Book", id, "UPDATE", old, updated);
  res.json(updated);
}));

r.delete("/books/:id", requireRole(...FIN), wrap(async (req, res) => {
  const id = Number(req.params.id);
  await prisma.book.update({ where: { id }, data: { deletedAt: new Date(), active: false } });
  await audit(req.user!.id, "Book", id, "SOFT_DELETE");
  res.json({ ok: true });
}));

// ---------- BOOK SETS ----------
r.get("/book-sets", wrap(async (_req, res) => {
  res.json(await prisma.bookSet.findMany({ include: { items: { include: { book: true } } }, orderBy: { name: "asc" } }));
}));

const setBody = z.object({
  name: z.string().min(2), className: z.string().optional(),
  items: z.array(z.object({ bookId: z.number().int(), qty: z.number().int().min(1).default(1) })),
});

r.post("/book-sets", requireRole(...FIN), wrap(async (req, res) => {
  const b = parse(setBody, req.body);
  const set = await prisma.bookSet.create({
    data: { name: b.name, className: b.className, items: { create: b.items } },
    include: { items: true },
  });
  await audit(req.user!.id, "BookSet", set.id, "CREATE", null, set);
  res.status(201).json(set);
}));

r.put("/book-sets/:id", requireRole(...FIN), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const b = parse(setBody, req.body);
  const old = await prisma.bookSet.findUnique({ where: { id }, include: { items: true } });
  if (!old) throw notFound();
  const set = await prisma.$transaction(async (tx) => {
    await tx.bookSetItem.deleteMany({ where: { setId: id } });
    return tx.bookSet.update({ where: { id }, data: { name: b.name, className: b.className, items: { create: b.items } }, include: { items: true } });
  });
  await audit(req.user!.id, "BookSet", id, "UPDATE", old, set);
  res.json(set);
}));

// ---------- STOCK LEDGER ----------
r.get("/stock", requireRole(...FIN, "GODOWN"), wrap(async (req, res) => {
  const { page, pageSize, skip, take } = pageParams(req.query);
  const books = await prisma.book.findMany({
    where: { deletedAt: null, ...(req.query.q ? { OR: [{ title: contains(req.query.q) }, { code: contains(req.query.q) }] } : {}) },
    orderBy: { code: "asc" }, skip, take,
  });
  const total = await prisma.book.count({ where: { deletedAt: null } });
  const onHand = await stockByBook(books.map((b) => b.id));
  const rows = books.map((b) => ({ id: b.id, code: b.code, title: b.title, className: b.className, reorderLevel: b.reorderLevel, onHand: onHand[b.id] ?? 0, lowStock: (onHand[b.id] ?? 0) <= b.reorderLevel }));
  res.json({ ...paged(rows, total, page, pageSize), lowStockCount: rows.filter((x) => x.lowStock).length });
}));

r.get("/stock/:bookId/movements", requireRole(...FIN, "GODOWN"), wrap(async (req, res) => {
  res.json(await prisma.stockEntry.findMany({ where: { bookId: Number(req.params.bookId) }, orderBy: { createdAt: "desc" }, take: 500 }));
}));

const movementBody = z.object({ bookId: z.number().int(), qty: z.number().int().refine((n) => n !== 0, "qty cannot be 0"), reason: z.string().min(3) });

r.post("/stock/receipt", requireRole(...FIN, "GODOWN"), wrap(async (req, res) => {
  const b = parse(movementBody, req.body);
  if (b.qty <= 0) throw new HttpError(400, "Receipt qty must be positive");
  const e = await prisma.stockEntry.create({ data: { bookId: b.bookId, type: "RECEIPT", qty: b.qty, reason: b.reason, userId: req.user!.id } });
  res.status(201).json(e);
}));

r.post("/stock/adjust", requireRole(...FIN, "GODOWN"), wrap(async (req, res) => {
  const b = parse(movementBody, req.body);
  const type = req.body.type === "OPENING" ? "OPENING" : "ADJUSTMENT";
  const e = await prisma.stockEntry.create({ data: { bookId: b.bookId, type, qty: b.qty, reason: b.reason, userId: req.user!.id } });
  await audit(req.user!.id, "Stock", b.bookId, "ADJUST", null, e);
  res.status(201).json(e);
}));

export default r;
