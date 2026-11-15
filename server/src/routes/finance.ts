import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { wrap, parse, pageParams, paged } from "../lib/http.js";
import { HttpError, notFound, forbidden, badRequest, conflict } from "../lib/errors.js";
import { requireAuth, requireRole, type AuthUser } from "../middleware/auth.js";
import { dealerScope } from "../lib/scope.js";
import { audit } from "../services/audit.js";
import { notify } from "../services/notify.js";
import { dealerLedger, dealerOutstanding, dealerAgeing, allocatePayment } from "../services/ledger.js";
import { getSetting, assertFyOpen } from "../services/settings.js";
import { assignNumber, fyOf } from "../lib/fy.js";
import { bpOf } from "../lib/money.js";
import { invoicePdf } from "../services/pdf.js";
import { backorderQty } from "../services/orderService.js";
import { currentTerms } from "./masters.js";
import { stockByBook } from "./masters.js";
import { formatINR } from "../lib/money.js";
import { toXlsx } from "../services/export.js";
import { reportRows, REPORTS } from "../services/reports.js";

const r = Router();
const FIN = ["SUPER_ADMIN", "ACCOUNTS"] as const;

// ---------- INVOICES & PDFs ----------
r.get("/invoices", wrap(async (req, res) => {
  const { page, pageSize, skip, take } = pageParams(req.query);
  const where = { dealer: req.user!.role === "GODOWN" ? {} : dealerScope(req.user!), ...(req.query.dealerId ? { dealerId: Number(req.query.dealerId) } : {}) };
  const [items, total] = await Promise.all([
    prisma.invoice.findMany({ where, skip, take, orderBy: { createdAt: "desc" }, include: { dealer: { select: { firmName: true } }, shipment: { select: { number: true, order: { select: { number: true } } } } } }),
    prisma.invoice.count({ where }),
  ]);
  res.json(paged(items, total, page, pageSize));
}));

async function invoiceVisible(invoiceId: number, u: AuthUser) {
  const inv = await prisma.invoice.findFirst({ where: { id: invoiceId, dealer: dealerScope(u) } });
  if (!inv) throw notFound("Invoice not found");
  return inv;
}

r.get("/invoices/:id/pdf", wrap(async (req, res) => {
  const inv = await invoiceVisible(Number(req.params.id), req.user!);
  const pdf = await invoicePdf(inv.id);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${inv.number.replace(/\//g, "-")}.pdf"`);
  res.send(pdf);
}));

// ---------- PAYMENTS ----------
const payBody = z.object({
  dealerId: z.number().int(), amountPaise: z.number().int().positive(),
  mode: z.enum(["CASH", "CHEQUE", "NEFT", "UPI", "OTHER"]), reference: z.string().optional(), paidOn: z.string(),
});

r.get("/payments", requireRole(...FIN, "DEALER", "SALES"), wrap(async (req, res) => {
  const { page, pageSize, skip, take } = pageParams(req.query);
  const where = { dealer: dealerScope(req.user!), ...(req.query.dealerId ? { dealerId: Number(req.query.dealerId) } : {}) };
  const [items, total] = await Promise.all([
    prisma.payment.findMany({ where, skip, take, orderBy: { paidOn: "desc" }, include: { dealer: { select: { firmName: true } } } }),
    prisma.payment.count({ where }),
  ]);
  res.json(paged(items, total, page, pageSize));
}));

r.post("/payments", requireRole(...FIN), wrap(async (req, res) => {
  const b = parse(payBody, req.body);
  const paidOn = new Date(b.paidOn);
  await assertFyOpen(fyOf(paidOn));
  const p = await prisma.payment.create({ data: { dealerId: b.dealerId, amountPaise: b.amountPaise, mode: b.mode, reference: b.reference, paidOn } });
  const unallocated = await allocatePayment(p.id, b.dealerId);
  await audit(req.user!.id, "Payment", p.id, "CREATE", null, { ...p, unallocated });
  const du = await prisma.user.findUnique({ where: { dealerId: b.dealerId } });
  await notify([du?.id], "Payment received", `We received ${formatINR(b.amountPaise)} (${b.mode}${b.reference ? " " + b.reference : ""}).`, "/ledger");
  res.status(201).json({ payment: p, unallocatedPaise: unallocated });
}));

r.get("/payments/:id/receipt.pdf", wrap(async (req, res) => {
  const p = await prisma.payment.findFirst({ where: { id: Number(req.params.id), dealer: dealerScope(req.user!) }, include: { dealer: true, allocations: { include: { invoice: true } } } });
  if (!p) throw notFound();
  const co = await getSetting("company");
  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({ size: "A4", margin: 48 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  doc.fontSize(16).text(co.name, { align: "center" }).fontSize(12).text("PAYMENT RECEIPT", { align: "center" }).moveDown();
  doc.fontSize(10).text(`Receipt no: RCT-${p.id}`).text(`Date: ${p.paidOn.toISOString().slice(0, 10)}`).text(`Received from: ${p.dealer.firmName}`)
    .text(`Amount: ${formatINR(p.amountPaise)}`).text(`Mode: ${p.mode}  Reference: ${p.reference ?? "-"}`).moveDown();
  for (const a of p.allocations) doc.text(`Applied to ${a.invoice.number}: ${formatINR(a.amountPaise)}`);
  doc.end();
  await new Promise((resolve) => doc.on("end", resolve));
  res.setHeader("Content-Type", "application/pdf");
  res.send(Buffer.concat(chunks));
}));

// ---------- LEDGER / OUTSTANDING ----------
r.get("/dealers/:id/ledger", wrap(async (req, res) => {
  const d = await prisma.dealer.findFirst({ where: { AND: [dealerScope(req.user!), { id: Number(req.params.id) }] } });
  if (!d) throw notFound();
  const rows = await dealerLedger(d.id);
  if (req.query.format === "xlsx") {
    const buf = await toXlsx("Ledger", ["Date", "Type", "Reference", "Debit", "Credit", "Balance"],
      rows.map((x) => [x.date.toISOString().slice(0, 10), x.type, x.ref, x.debit / 100, x.credit / 100, x.balance / 100]));
    res.setHeader("Content-Disposition", `attachment; filename="ledger-${d.id}.xlsx"`);
    return res.type("xlsx").send(buf);
  }
  res.json({ dealer: d.firmName, outstandingPaise: await dealerOutstanding(d.id), rows });
}));

r.get("/dealers/:id/ageing", wrap(async (req, res) => {
  const d = await prisma.dealer.findFirst({ where: { AND: [dealerScope(req.user!), { id: Number(req.params.id) }] } });
  if (!d) throw notFound();
  const ag = await dealerAgeing(d.id);
  const terms = await currentTerms(d.id);
  const creditLimit = terms?.creditLimitPaise ?? d.creditLimitPaise;
  res.json({ ...ag, creditLimitPaise: creditLimit, overCreditLimit: creditLimit > 0 && ag.outstanding > creditLimit });
}));

// ---------- DEBIT NOTE (manual adjustment) ----------
r.post("/dealers/:id/debit-notes", requireRole(...FIN), wrap(async (req, res) => {
  const b = parse(z.object({ amountPaise: z.number().int().positive(), reason: z.string().min(3) }), req.body);
  const fy = fyOf(); await assertFyOpen(fy);
  const note = await prisma.note.create({ data: { type: "DEBIT", number: await assignNumber("DN", fy), dealerId: Number(req.params.id), amountPaise: b.amountPaise, reason: b.reason, fy } });
  await audit(req.user!.id, "Note", note.id, "CREATE_DEBIT", null, note);
  res.status(201).json(note);
}));

r.get("/notes", wrap(async (req, res) => {
  const { page, pageSize, skip, take } = pageParams(req.query);
  const where = { dealer: dealerScope(req.user!), ...(req.query.type ? { type: req.query.type as any } : {}) };
  const [items, total] = await Promise.all([
    prisma.note.findMany({ where, skip, take, orderBy: { createdAt: "desc" }, include: { dealer: { select: { firmName: true } } } }),
    prisma.note.count({ where }),
  ]);
  res.json(paged(items, total, page, pageSize));
}));

// ---------- RETURNS ----------
const RETURN_INCLUDE = {
  dealer: { select: { id: true, firmName: true, salesEmployeeId: true } },
  lines: { include: { book: { select: { code: true, title: true, mrpPaise: true } } } },
  schools: { include: { school: { select: { id: true, name: true } } } },
  note: true,
} as const;

r.get("/returns", wrap(async (req, res) => {
  const { page, pageSize, skip, take } = pageParams(req.query);
  const u = req.user!;
  const where = {
    dealer: u.role === "GODOWN" ? {} : dealerScope(u),
    ...(req.query.status ? { status: req.query.status as any } : {}),
    ...(u.role === "GODOWN" ? { status: { in: ["REQUESTED", "RECEIVED", "APPROVED"] as any } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.returnRequest.findMany({ where, skip, take, orderBy: { createdAt: "desc" }, include: RETURN_INCLUDE }),
    prisma.returnRequest.count({ where }),
  ]);
  res.json(paged(items, total, page, pageSize));
}));

// Return limit used this financial year (requests not rejected).
export async function returnedThisFy(dealerId: number, fy: string) {
  const agg = await prisma.returnLine.aggregate({
    where: { return: { dealerId, status: { not: "REJECTED" }, createdAt: { gte: fyStart(fy) } } },
    _sum: { qtyRequested: true },
  });
  return agg._sum.qtyRequested ?? 0;
}
function fyStart(fy: string) { return new Date(Number(fy.slice(0, 4)), 3, 1); }

r.post("/returns", requireRole("DEALER", "SALES", ...FIN), wrap(async (req, res) => {
  const b = parse(z.object({
    dealerId: z.number().int().optional(), reason: z.string().min(3),
    lines: z.array(z.object({ bookId: z.number().int(), schoolId: z.number().int().optional(), qty: z.number().int().min(1), remark: z.string().optional() })).min(1),
    override: z.boolean().default(false),
  }), req.body);
  const u = req.user!;
  const dealerId = u.role === "DEALER" ? u.dealerId! : (b.dealerId ?? 0);
  const dealer = await prisma.dealer.findFirst({ where: { AND: [dealerScope(u), { id: dealerId }] } });
  if (!dealer) throw notFound("Dealer not found");
  const terms = await currentTerms(dealerId);
  const limit = terms?.returnLimitQty || dealer.returnLimitQty || (await getSetting("default_return_limit_qty"));
  const requested = b.lines.reduce((s, l) => s + l.qty, 0);
  const fy = fyOf();
  const used = await returnedThisFy(dealerId, fy);
  const overLimit = limit > 0 && used + requested > limit;
  const canOverride = FIN.includes(u.role as any);
  if (overLimit && !(canOverride && b.override)) {
    throw conflict("Return limit exceeded for this year", { limitQty: limit, usedQty: used, requestedQty: requested, remainingQty: Math.max(0, limit - used) });
  }
  // Discount for credit note = discount on the dealer's most recent order of that book, else terms discount.
  const lines = [];
  for (const l of b.lines) {
    const book = await prisma.book.findUniqueOrThrow({ where: { id: l.bookId } });
    const lastOrder = await prisma.orderLine.findFirst({ where: { bookId: l.bookId, order: { dealerId, status: "DELIVERED" } }, orderBy: { id: "desc" }, include: { order: true } });
    lines.push({
      bookId: l.bookId, qtyRequested: l.qty, unitMrpPaise: book.mrpPaise,
      discountBp: lastOrder?.order.discountBp ?? terms?.discountBp ?? dealer.defaultDiscountBp, remark: l.remark,
    });
  }
  const created = await prisma.returnRequest.create({
    data: {
      number: await assignNumber("RET", fy), dealerId, reason: b.reason, overLimit: overLimit, overrideBy: overLimit ? u.id : null,
      createdById: u.id, lines: { create: lines },
      schools: { create: [...new Set(b.lines.map((l) => l.schoolId).filter((x): x is number => !!x))].map((schoolId) => ({ schoolId })) },
    },
    include: RETURN_INCLUDE,
  });
  await audit(u.id, "Return", created.id, "CREATE", null, { number: created.number, requested, overLimit });
  const fin = await prisma.user.findMany({ where: { role: { in: ["ACCOUNTS", "SUPER_ADMIN", "GODOWN"] }, active: true }, select: { id: true } });
  await notify([...fin.map((x) => x.id), dealer.salesEmployeeId], "Return requested", `${created.number} from ${dealer.firmName}.`, `/returns/${created.id}`);
  res.status(201).json(created);
}));

r.post("/returns/:id/receive", requireRole("GODOWN", "SUPER_ADMIN"), wrap(async (req, res) => {
  const b = parse(z.object({ lines: z.array(z.object({ lineId: z.number().int(), qtyReceived: z.number().int().min(0), remark: z.string().optional() })) }), req.body);
  const ret = await prisma.returnRequest.findUniqueOrThrow({ where: { id: Number(req.params.id) }, include: { lines: true } });
  if (ret.status !== "REQUESTED") throw conflict(`Return is ${ret.status}`);
  for (const l of b.lines) {
    const line = ret.lines.find((x) => x.id === l.lineId);
    if (!line) throw badRequest("Unknown return line");
    if (l.qtyReceived > line.qtyRequested) throw badRequest("Received more than requested");
    await prisma.returnLine.update({ where: { id: line.id }, data: { qtyReceived: l.qtyReceived, remark: l.remark ?? line.remark } });
  }
  const updated = await prisma.returnRequest.update({ where: { id: ret.id }, data: { status: "RECEIVED" }, include: RETURN_INCLUDE });
  await audit(req.user!.id, "Return", ret.id, "RECEIVE", { status: ret.status }, { status: "RECEIVED" });
  res.json(updated);
}));

// Accounts approves: credit note raised automatically and approved quantities go back into stock.
r.post("/returns/:id/approve", requireRole(...FIN), wrap(async (req, res) => {
  const b = parse(z.object({ lines: z.array(z.object({ lineId: z.number().int(), qtyApproved: z.number().int().min(0) })) }), req.body);
  const ret = await prisma.returnRequest.findUniqueOrThrow({ where: { id: Number(req.params.id) }, include: { lines: true } });
  if (ret.status !== "RECEIVED") throw conflict("Godown must receive the books before approval");
  const fy = fyOf(); await assertFyOpen(fy);
  let amount = 0;
  const ops: any[] = [];
  for (const line of ret.lines) {
    const a = b.lines.find((x) => x.lineId === line.id)?.qtyApproved ?? 0;
    if (a > (line.qtyReceived ?? 0)) throw badRequest(`Approved qty for ${line.id} is more than received`);
    amount += a * line.unitMrpPaise - bpOf(a * line.unitMrpPaise, line.discountBp);
    ops.push(prisma.returnLine.update({ where: { id: line.id }, data: { qtyApproved: a } }));
    if (a > 0) ops.push(prisma.stockEntry.create({ data: { bookId: line.bookId, type: "RETURN", qty: a, refType: "Return", refId: ret.id, reason: `Return ${ret.number}`, userId: req.user!.id } }));
  }
  const rounded = Math.round(amount / 100) * 100;
  const note = await prisma.note.create({ data: { type: "CREDIT", number: await assignNumber("CN", fy), dealerId: ret.dealerId, returnId: ret.id, amountPaise: rounded, reason: `Return ${ret.number}`, fy } });
  await prisma.$transaction([...ops, prisma.returnRequest.update({ where: { id: ret.id }, data: { status: "APPROVED" } })]);
  await audit(req.user!.id, "Return", ret.id, "APPROVE", { status: "RECEIVED" }, { status: "APPROVED", creditNote: note.number, amountPaise: rounded });
  const du = await prisma.user.findUnique({ where: { dealerId: ret.dealerId } });
  await notify([du?.id], "Return approved, credit note raised", `${note.number} for ${formatINR(rounded)}.`, "/ledger");
  res.json({ returnId: ret.id, creditNote: note });
}));

r.post("/returns/:id/reject", requireRole(...FIN), wrap(async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().min(3) }), req.body);
  const ret = await prisma.returnRequest.findUniqueOrThrow({ where: { id: Number(req.params.id) } });
  if (ret.status === "APPROVED") throw conflict("Already approved");
  const updated = await prisma.returnRequest.update({ where: { id: ret.id }, data: { status: "REJECTED", reason: `${ret.reason ?? ""} | Rejected: ${reason}` } });
  await audit(req.user!.id, "Return", ret.id, "REJECT", null, { reason });
  res.json(updated);
}));

// ---------- TARGETS ----------
r.put("/targets", requireRole(...FIN), wrap(async (req, res) => {
  const b = parse(z.object({ salesId: z.number().int(), period: z.string().regex(/^\d{4}-\d{2}$/), kind: z.enum(["AMOUNT", "QTY"]), value: z.number().int().min(0) }), req.body);
  const t = await prisma.target.upsert({
    where: { salesId_period_kind: { salesId: b.salesId, period: b.period, kind: b.kind } },
    create: b, update: { value: b.value },
  });
  await audit(req.user!.id, "Target", t.id, "SET", null, t);
  res.json(t);
}));

r.get("/targets/progress", wrap(async (req, res) => {
  const period = String(req.query.period ?? fyOf());
  const u = req.user!;
  if (u.role === "DEALER" || u.role === "GODOWN") throw forbidden();
  const salesIds = u.role === "SALES" ? [u.id] : (await prisma.user.findMany({ where: { role: "SALES", deletedAt: null }, select: { id: true } })).map((x) => x.id);
  const out = [];
  for (const salesId of salesIds) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: salesId } });
    const dealers = await prisma.dealer.findMany({ where: { salesEmployeeId: salesId, deletedAt: null }, select: { id: true, firmName: true } });
    const dealerIds = dealers.map((d) => d.id);
    const invs = await prisma.invoice.findMany({ where: { dealerId: { in: dealerIds }, fy: period }, include: { shipment: { include: { lines: true } } } });
    const credit = await prisma.note.groupBy({ by: ["dealerId"], where: { dealerId: { in: dealerIds }, type: "CREDIT", fy: period }, _sum: { amountPaise: true } });
    const returns = await prisma.returnLine.findMany({ where: { return: { dealerId: { in: dealerIds }, status: "APPROVED", createdAt: { gte: fyStart(period) } } }, select: { qtyApproved: true, return: { select: { dealerId: true } } } });
    const targets = await prisma.target.findMany({ where: { salesId, period } });
    const byDealer = dealers.map((d) => {
      const net = invs.filter((i) => i.dealerId === d.id).reduce((s, i) => s + i.netPaise, 0) - (credit.find((c) => c.dealerId === d.id)?._sum.amountPaise ?? 0);
      const qty = invs.filter((i) => i.dealerId === d.id).reduce((s, i) => s + i.shipment.lines.reduce((x, l) => x + l.qty, 0), 0)
        - returns.filter((x) => x.return.dealerId === d.id).reduce((s, x) => s + (x.qtyApproved ?? 0), 0);
      return { dealerId: d.id, firm: d.firmName, netPaise: net, qty };
    });
    const achievedAmount = byDealer.reduce((s, x) => s + x.netPaise, 0);
    const achievedQty = byDealer.reduce((s, x) => s + x.qty, 0);
    const amt = targets.find((t) => t.kind === "AMOUNT")?.value ?? 0;
    const qtyT = targets.find((t) => t.kind === "QTY")?.value ?? 0;
    out.push({
      salesId, name: user.name, period,
      amount: { target: amt, achieved: achievedAmount, remaining: Math.max(0, amt - achievedAmount), pct: amt ? Math.round((achievedAmount / amt) * 1000) / 10 : null },
      qty: { target: qtyT, achieved: achievedQty, remaining: Math.max(0, qtyT - achievedQty), pct: qtyT ? Math.round((achievedQty / qtyT) * 1000) / 10 : null },
      dealers: byDealer,
    });
  }
  res.json(out);
}));

// ---------- REPORTS ----------
r.get("/reports", requireRole(...FIN, "SALES"), wrap(async (_req, res) => {
  res.json(REPORTS);
}));

r.get("/reports/:name", requireRole(...FIN, "SALES"), wrap(async (req, res) => {
  const name = String(req.params.name);
  if (!REPORTS.some((x) => x.key === name)) throw notFound("Unknown report");
  const { headers, rows, title } = await reportRows(name, req.query as Record<string, string>, req.user!);
  if (req.query.format === "xlsx") {
    const buf = await toXlsx(title, headers, rows);
    res.setHeader("Content-Disposition", `attachment; filename="${name}.xlsx"`);
    return res.type("xlsx").send(buf);
  }
  res.json({ title, headers, rows });
}));

export default r;
