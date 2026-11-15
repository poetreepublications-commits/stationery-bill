import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { prisma } from "../db.js";
import { wrap, parse, pageParams, paged } from "../lib/http.js";
import { HttpError, notFound, forbidden, badRequest } from "../lib/errors.js";
import { requireAuth, requireRole, type AuthUser } from "../middleware/auth.js";
import { orderScope, dealerScope } from "../lib/scope.js";
import { audit } from "../services/audit.js";
import { notify } from "../services/notify.js";
import {
  placeOrder, loadOrderForUser, transition, buildLines, orderSummary, backorderQty, availableFor,
  ensureTermsAccepted, getSetting, assertFyOpen, dealerOutstanding, exceedsCredit, needsDiscountApproval, isEditable, invoiceTotals,
} from "../services/orderService.js";
import { assignNumber, fyOf } from "../lib/fy.js";
import { bpOf } from "../lib/money.js";
import { config } from "../config.js";
import { currentTerms } from "./masters.js";

const r = Router();
const STAFF = ["SUPER_ADMIN", "ACCOUNTS", "SALES"] as const;
const FIN = ["SUPER_ADMIN", "ACCOUNTS"] as const;
const ORDER_INCLUDE = {
  dealer: { select: { id: true, firmName: true, type: true, salesEmployeeId: true, status: true, creditLimitPaise: true } },
  lines: { include: { school: { select: { id: true, name: true } }, book: { select: { id: true, code: true, title: true, mrpPaise: true } } }, orderBy: { id: "asc" as const } },
  history: { orderBy: { at: "asc" as const } },
  shipments: { include: { lines: true, invoice: true }, orderBy: { id: "asc" as const } },
} as const;

// ---------- ORDERS ----------
r.get("/orders", requireRole("SUPER_ADMIN", "ACCOUNTS", "SALES", "DEALER", "GODOWN"), wrap(async (req, res) => {
  const { page, pageSize, skip, take } = pageParams(req.query);
  const where = {
    AND: [
      orderScope(req.user!),
      req.query.status ? { status: req.query.status as any } : {},
      req.query.dealerId ? { dealerId: Number(req.query.dealerId) } : {},
      req.query.q ? { OR: [{ number: { contains: String(req.query.q), mode: "insensitive" as const } }, { dealer: { firmName: { contains: String(req.query.q), mode: "insensitive" as const } } }] } : {},
    ],
  };
  const [items, total] = await Promise.all([
    prisma.order.findMany({ where, skip, take, orderBy: { createdAt: "desc" }, include: { dealer: { select: { firmName: true } }, lines: { select: { qtyOrdered: true, unitMrpPaise: true, cancelled: true } } } }),
    prisma.order.count({ where }),
  ]);
  res.json(paged(items.map((o) => ({
    ...o, lines: undefined, itemCount: o.lines.filter((l) => !l.cancelled).reduce((s, l) => s + l.qtyOrdered, 0),
    grossPaise: o.lines.filter((l) => !l.cancelled).reduce((s, l) => s + l.qtyOrdered * l.unitMrpPaise, 0),
  })), total, page, pageSize));
}));

r.get("/orders/:id", requireRole("SUPER_ADMIN", "ACCOUNTS", "SALES", "DEALER", "GODOWN"), wrap(async (req, res) => {
  const order = await loadOrderForUser(Number(req.params.id), req.user!);
  const full = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: ORDER_INCLUDE });
  const summary = await orderSummary(order.id);
  const userIds = [...new Set(full.history.map((h) => h.userId).filter((x): x is number => !!x))];
  const names = new Map((await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  res.json({
    ...full, summary,
    history: full.history.map((h) => ({ ...h, userName: h.userId ? names.get(h.userId) ?? null : "System" })),
    lines: full.lines.map((l) => ({ ...l, backorderQty: backorderQty(l) })),
    hasBackorder: full.lines.some((l) => backorderQty(l) > 0),
  });
}));

const linesBody = z.object({ lines: z.array(z.object({ schoolId: z.number().int().optional(), bookId: z.number().int().optional(), setId: z.number().int().optional(), qty: z.number().int() })).min(1) });

r.post("/orders", requireRole("DEALER", "SALES", "SUPER_ADMIN", "ACCOUNTS"), wrap(async (req, res) => {
  const body = parse(linesBody.extend({ dealerId: z.number().int().optional() }), req.body);
  const u = req.user!;
  let dealerId: number;
  if (u.role === "DEALER") dealerId = u.dealerId!;
  else {
    if (!body.dealerId) throw badRequest("Choose a dealer");
    const ok = await prisma.dealer.findFirst({ where: { AND: [dealerScope(u), { id: body.dealerId }] } });
    if (!ok) throw notFound("Dealer not found");
    dealerId = body.dealerId;
  }
  const order = await placeOrder(dealerId, u, body.lines);
  res.status(201).json(order);
}));

// Edit lines (replace the set of lines). Allowed by dealer or sales until Accounts verifies.
r.put("/orders/:id/lines", requireRole("DEALER", "SALES", "SUPER_ADMIN"), wrap(async (req, res) => {
  const order = await loadOrderForUser(Number(req.params.id), req.user!);
  if (!isEditable(order.status)) throw new HttpError(409, "Order is locked after Accounts verification");
  const body = parse(linesBody, req.body);
  const oldLines = await prisma.orderLine.findMany({ where: { orderId: order.id } });
  const newLines = await buildLines(order.dealerId, order.dealer.type, body.lines);
  await prisma.$transaction([
    prisma.orderLine.deleteMany({ where: { orderId: order.id } }),
    prisma.orderLine.createMany({ data: newLines.map((l) => ({ orderId: order.id, schoolId: l.schoolId, bookId: l.bookId, qtyOrdered: l.qty, unitMrpPaise: l.unitMrpPaise })) }),
    prisma.order.update({ where: { id: order.id }, data: { updatedAt: new Date() } }),
  ]);
  await audit(req.user!.id, "Order", order.id, "EDIT_LINES", oldLines, newLines);
  const who = req.user!.role === "DEALER" ? "dealer" : "sales team";
  await notify([order.dealer.salesEmployeeId, (await prisma.user.findUnique({ where: { dealerId: order.dealerId } }))?.id].filter((x) => x !== req.user!.id),
    "Order changed", `${order.number} was edited by the ${who}.`, `/orders/${order.id}`);
  res.json(await orderSummary(order.id));
}));

r.post("/orders/:id/accept", requireRole("SALES", "SUPER_ADMIN"), wrap(async (req, res) => {
  const order = await loadOrderForUser(Number(req.params.id), req.user!);
  if (req.user!.role === "SALES" && order.dealer.salesEmployeeId !== req.user!.id) throw forbidden();
  const updated = await transition(order.id, "ACCEPTED", req.user!, req.body?.note);
  res.json(updated);
}));

r.post("/orders/:id/cancel", requireRole("DEALER", "SALES", "SUPER_ADMIN"), wrap(async (req, res) => {
  const order = await loadOrderForUser(Number(req.params.id), req.user!);
  if (!isEditable(order.status)) throw new HttpError(409, "Order can no longer be cancelled");
  const updated = await transition(order.id, "CANCELLED", req.user!, req.body?.reason ?? "Cancelled");
  res.json(updated);
}));

// Super Admin approves a discount above the configured limit.
r.post("/orders/:id/approve-discount", requireRole("SUPER_ADMIN"), wrap(async (req, res) => {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: Number(req.params.id) } });
  const updated = await prisma.order.update({ where: { id: order.id }, data: { discountApproved: true } });
  await audit(req.user!.id, "Order", order.id, "APPROVE_DISCOUNT", { discountBp: order.discountBp }, { discountBp: order.discountBp });
  await notify([(await prisma.dealer.findUnique({ where: { id: order.dealerId } }))?.salesEmployeeId], "Discount approved", `Discount on ${order.number} approved.`, `/orders/${order.id}`);
  res.json(updated);
}));

// Accounts verifies: sets discount, checks credit, then sends to godown.
r.post("/orders/:id/verify", requireRole(...FIN), wrap(async (req, res) => {
  const b = parse(z.object({ discountBp: z.number().int().min(0).max(10000).optional(), remarks: z.string().optional(), creditOverride: z.boolean().default(false) }), req.body);
  const order = await prisma.order.findUniqueOrThrow({ where: { id: Number(req.params.id) }, include: { dealer: true, lines: true } });
  if (order.status !== "ACCEPTED") throw new HttpError(409, `Order must be accepted by sales first (currently ${order.status})`);
  const isSuper = req.user!.role === "SUPER_ADMIN";
  const terms = await currentTerms(order.dealerId);
  const discountBp = b.discountBp ?? terms?.discountBp ?? order.dealer.defaultDiscountBp;
  const limit = await getSetting("discount_approval_limit_bp");
  const approved = order.discountApproved && order.discountBp === discountBp;
  if (needsDiscountApproval(discountBp, limit) && !approved && !isSuper) {
    await prisma.order.update({ where: { id: order.id }, data: { discountBp, discountNeedsApproval: true, discountApproved: false } });
    throw new HttpError(409, `Discount ${discountBp / 100}% is above the ${limit / 100}% limit. Super Admin approval needed.`, { discountBp, limitBp: limit });
  }
  const gross = order.lines.filter((l) => !l.cancelled).reduce((s, l) => s + l.qtyOrdered * l.unitMrpPaise, 0);
  const net = gross - bpOf(gross, discountBp);
  const outstanding = await dealerOutstanding(order.dealerId);
  const creditLimit = terms?.creditLimitPaise ?? order.dealer.creditLimitPaise;
  if (exceedsCredit(outstanding, net, creditLimit) && !b.creditOverride) {
    throw new HttpError(409, "This order takes the dealer over their credit limit", { outstandingPaise: outstanding, orderNetPaise: net, creditLimitPaise: creditLimit });
  }
  await prisma.order.update({
    where: { id: order.id },
    data: {
      discountBp, discountNeedsApproval: needsDiscountApproval(discountBp, limit), discountApproved: approved || isSuper,
      creditOverride: exceedsCredit(outstanding, net, creditLimit) ? true : order.creditOverride,
      remarks: b.remarks ?? order.remarks,
    },
  });
  await audit(req.user!.id, "Order", order.id, "VERIFY", { discountBp: order.discountBp }, { discountBp, creditOverride: b.creditOverride, outstanding, net });
  await transition(order.id, "VERIFIED", req.user!, b.remarks);
  const sent = await transition(order.id, "SENT_TO_GODOWN", req.user!, "Verified by accounts");
  res.json(sent);
}));

// ---------- GODOWN ----------
r.get("/godown/queue", requireRole("GODOWN", "SUPER_ADMIN", "ACCOUNTS"), wrap(async (req, res) => {
  const orders = await prisma.order.findMany({
    where: { status: { in: ["SENT_TO_GODOWN", "PICKING", "PACKED", "DISPATCHED", "BILTY_UPLOADED"] } },
    include: { dealer: { select: { firmName: true } }, lines: { include: { book: { select: { code: true, title: true } } } } },
    orderBy: { updatedAt: "asc" },
  });
  res.json(orders.map((o) => {
    const open = o.lines.filter((l) => !l.cancelled && backorderQty(l) > 0);
    return { id: o.id, number: o.number, status: o.status, dealer: o.dealer.firmName, pendingLines: open.length, hasBackorder: open.length > 0 && ["DISPATCHED", "BILTY_UPLOADED"].includes(o.status), updatedAt: o.updatedAt };
  }).filter((o) => !["DISPATCHED", "BILTY_UPLOADED"].includes(o.status) || o.hasBackorder));
}));

// Availability per line: what's ordered, picked, shipped, and stock shortfall.
r.get("/godown/orders/:id", requireRole("GODOWN", "SUPER_ADMIN", "ACCOUNTS"), wrap(async (req, res) => {
  const o = await prisma.order.findUniqueOrThrow({ where: { id: Number(req.params.id) }, include: { dealer: true, lines: { include: { school: true, book: true } } } });
  const rows = [];
  for (const l of o.lines) {
    if (l.cancelled) continue;
    const available = await availableFor(l.id, l.bookId);
    rows.push({
      lineId: l.id, school: l.school.name, bookId: l.bookId, code: l.book.code, isbn: null, title: l.book.title,
      qtyOrdered: l.qtyOrdered, qtyPicked: l.qtyPicked, qtyDispatched: l.qtyDispatched,
      toPick: Math.max(0, l.qtyOrdered - l.qtyDispatched - l.qtyPicked),
      backorder: backorderQty(l), inStock: available + Math.max(0, l.qtyPicked - l.qtyDispatched),
    });
  }
  const shipments = await prisma.shipment.findMany({ where: { orderId: o.id }, include: { invoice: true }, orderBy: { id: "asc" } });
  res.json({ id: o.id, number: o.number, status: o.status, dealer: o.dealer.firmName, lines: rows, shipments });
}));

// Pick: set picked quantity per line (absolute), checked against stock.
r.post("/godown/orders/:id/pick", requireRole("GODOWN", "SUPER_ADMIN"), wrap(async (req, res) => {
  const body = parse(z.object({ lines: z.array(z.object({ lineId: z.number().int(), qtyPicked: z.number().int().min(0) })) }), req.body);
  const order = await prisma.order.findUniqueOrThrow({ where: { id: Number(req.params.id) }, include: { lines: true } });
  if (!["SENT_TO_GODOWN", "PICKING", "DISPATCHED", "BILTY_UPLOADED"].includes(order.status)) throw new HttpError(409, `Cannot pick an order that is ${order.status}`);
  for (const p of body.lines) {
    const l = order.lines.find((x) => x.id === p.lineId);
    if (!l) throw badRequest(`Line ${p.lineId} is not on this order`);
    if (p.qtyPicked < l.qtyDispatched) throw badRequest(`Cannot pick below already shipped qty for ${p.lineId}`);
    if (p.qtyPicked > l.qtyOrdered) throw badRequest("Cannot pick more than ordered");
    const available = await availableFor(l.id, l.bookId);
    if (p.qtyPicked - l.qtyDispatched > available) throw new HttpError(409, "Not enough stock for this line", { lineId: l.id, available });
    await prisma.orderLine.update({ where: { id: l.id }, data: { qtyPicked: p.qtyPicked } });
  }
  if (order.status !== "PICKING") await transition(order.id, "PICKING", req.user!, "Picking started");
  res.json(await orderSummary(order.id));
}));

// Barcode scan: +1 on the first open line for this ISBN/code.
r.post("/godown/orders/:id/scan", requireRole("GODOWN", "SUPER_ADMIN"), wrap(async (req, res) => {
  const { code } = parse(z.object({ code: z.string().min(1) }), req.body);
  const order = await prisma.order.findUniqueOrThrow({ where: { id: Number(req.params.id) }, include: { lines: { include: { book: true } } } });
  const book = await prisma.book.findFirst({ where: { OR: [{ isbn: code }, { code }], deletedAt: null } });
  if (!book) throw notFound("No book with this ISBN/code");
  const line = order.lines.find((l) => l.bookId === book.id && !l.cancelled && l.qtyPicked < l.qtyOrdered);
  if (!line) throw new HttpError(409, `${book.title} is not pending on this order`);
  const available = await availableFor(line.id, line.bookId);
  if (line.qtyPicked + 1 - line.qtyDispatched > available) throw new HttpError(409, `${book.title}: out of stock`, { available });
  const updated = await prisma.orderLine.update({ where: { id: line.id }, data: { qtyPicked: { increment: 1 } } });
  if (!["PICKING"].includes(order.status)) await transition(order.id, "PICKING", req.user!, "Picking started");
  res.json({ book: book.title, lineId: updated.id, qtyPicked: updated.qtyPicked, qtyOrdered: updated.qtyOrdered });
}));

// Pack: create shipment from what is picked, deduct stock, generate invoice.
r.post("/godown/orders/:id/pack", requireRole("GODOWN", "SUPER_ADMIN"), wrap(async (req, res) => {
  const b = parse(z.object({ boxes: z.number().int().min(1), weightKg: z.number().min(0), freightPaise: z.number().int().min(0).default(0) }), req.body);
  const order = await prisma.order.findUniqueOrThrow({ where: { id: Number(req.params.id) }, include: { lines: { include: { book: true } }, dealer: true } });
  if (order.status !== "PICKING") throw new HttpError(409, `Order must be in picking to pack (currently ${order.status})`);
  const toShip = order.lines.filter((l) => !l.cancelled && l.qtyPicked - l.qtyDispatched > 0);
  if (!toShip.length) throw badRequest("Nothing picked to pack");
  const fy = fyOf();
  await assertFyOpen(fy);
  const onHandRows = await prisma.stockEntry.groupBy({ by: ["bookId"], where: { bookId: { in: toShip.map((l) => l.bookId) } }, _sum: { qty: true } });
  for (const l of toShip) {
    const have = onHandRows.find((x) => x.bookId === l.bookId)?._sum.qty ?? 0;
    if (have < l.qtyPicked - l.qtyDispatched) throw new HttpError(409, `Stock short for ${l.book.title}`, { have });
  }
  const prefix = await getSetting("invoice_prefix");
  const result = await prisma.$transaction(async (tx) => {
    const shipment = await tx.shipment.create({
      data: {
        number: await assignNumber("SHP", fy), orderId: order.id, boxes: b.boxes, weightKg: b.weightKg,
        lines: { create: toShip.map((l) => ({ orderLineId: l.id, qty: l.qtyPicked - l.qtyDispatched, unitMrpPaise: l.unitMrpPaise, discountBp: order.discountBp })) },
      },
      include: { lines: true },
    });
    for (const l of toShip) {
      const qty = l.qtyPicked - l.qtyDispatched;
      await tx.orderLine.update({ where: { id: l.id }, data: { qtyDispatched: l.qtyPicked } });
      await tx.stockEntry.create({ data: { bookId: l.bookId, type: "DISPATCH", qty: -qty, refType: "Shipment", refId: shipment.id, reason: `Dispatch ${shipment.number}`, userId: req.user!.id } });
    }
    const totals = invoiceTotals(
      shipment.lines.map((s) => ({ qty: s.qty, unitMrpPaise: s.unitMrpPaise, discountBp: s.discountBp })),
      b.freightPaise,
    );
    const invoice = await tx.invoice.create({
      data: {
        number: await assignNumber(prefix, fy), dealerId: order.dealerId, shipmentId: shipment.id, fy, ...totals,
      },
    });
    return { shipment, invoice };
  });
  await audit(req.user!.id, "Shipment", result.shipment.id, "PACK", null, { number: result.shipment.number, invoice: result.invoice.number });
  await transition(order.id, "PACKED", req.user!, `Packed ${result.shipment.number}, invoice ${result.invoice.number}`);
  res.status(201).json({ shipment: result.shipment, invoice: result.invoice });
}));

// ---------- SHIPMENTS ----------
r.get("/shipments", requireRole("SUPER_ADMIN", "ACCOUNTS", "SALES", "DEALER", "GODOWN"), wrap(async (req, res) => {
  const { page, pageSize, skip, take } = pageParams(req.query);
  const where = { order: orderScope(req.user!) };
  const [items, total] = await Promise.all([
    prisma.shipment.findMany({ where, skip, take, orderBy: { createdAt: "desc" }, include: { order: { select: { number: true, dealerId: true } }, invoice: true } }),
    prisma.shipment.count({ where }),
  ]);
  res.json(paged(items, total, page, pageSize));
}));

async function loadShipment(id: number, u: AuthUser) {
  const s = await prisma.shipment.findUnique({ where: { id }, include: { order: { include: { dealer: true } } } });
  if (!s) throw notFound("Shipment not found");
  if (u.role === "DEALER" && s.order.dealerId !== u.dealerId) throw notFound("Shipment not found");
  if (u.role === "SALES" && s.order.dealer.salesEmployeeId !== u.id) throw notFound("Shipment not found");
  return s;
}

r.post("/shipments/:id/dispatch", requireRole("GODOWN", "SUPER_ADMIN"), wrap(async (req, res) => {
  const b = parse(z.object({ transporter: z.string().min(2), vehicleNo: z.string().optional(), lrNo: z.string().optional(), eWayBill: z.string().optional(), dispatchedAt: z.string().optional() }), req.body);
  const s = await loadShipment(Number(req.params.id), req.user!);
  if (s.dispatchedAt) throw new HttpError(409, "Already dispatched");
  const updated = await prisma.shipment.update({
    where: { id: s.id },
    data: { transporter: b.transporter, vehicleNo: b.vehicleNo, lrNo: b.lrNo, eWayBill: b.eWayBill, dispatchedAt: b.dispatchedAt ? new Date(b.dispatchedAt) : new Date() },
  });
  await audit(req.user!.id, "Shipment", s.id, "DISPATCH", null, updated);
  await transition(s.orderId, "DISPATCHED", req.user!, `Dispatched via ${b.transporter}`);
  const left = await prisma.orderLine.findMany({ where: { orderId: s.orderId } });
  if (left.some((l) => backorderQty(l) > 0)) {
    await notify([(await prisma.user.findUnique({ where: { dealerId: s.order.dealerId } }))?.id], "Part of your order is pending", `${s.order.number}: remaining books will follow in a separate shipment.`, `/orders/${s.orderId}`);
  }
  res.json(updated);
}));

// Bilty photos are kept in the database (memory upload), so they survive serverless hosting (Vercel has no persistent disk).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 }, fileFilter: (_req, file, cb) => cb(null, /image\/(jpeg|png|webp)|application\/pdf/.test(file.mimetype)) });

r.post("/shipments/:id/bilty", requireRole("GODOWN", "ACCOUNTS", "SALES", "SUPER_ADMIN"), upload.single("file"), wrap(async (req, res) => {
  const s = await loadShipment(Number(req.params.id), req.user!);
  if (!req.file) throw badRequest("Upload a photo or PDF of the bilty/LR");
  const updated = await prisma.shipment.update({ where: { id: s.id }, data: { biltyData: req.file.buffer, biltyMime: req.file.mimetype, biltyPath: "db" } });
  await audit(req.user!.id, "Shipment", s.id, "BILTY_UPLOAD", null, { bytes: req.file.size, mime: req.file.mimetype });
  const order = await prisma.order.findUniqueOrThrow({ where: { id: s.orderId } });
  if (order.status === "DISPATCHED") await transition(order.id, "BILTY_UPLOADED", req.user!, "Bilty uploaded");
  res.json(updated);
}));

// Dealer (or sales/accounts) confirms receipt. Order becomes DELIVERED when all shipments are received and no backorder remains.
r.post("/shipments/:id/receive", requireRole("DEALER", "SALES", "ACCOUNTS", "SUPER_ADMIN"), wrap(async (req, res) => {
  const s = await loadShipment(Number(req.params.id), req.user!);
  if (!s.dispatchedAt) throw new HttpError(409, "Not dispatched yet");
  const updated = await prisma.shipment.update({ where: { id: s.id }, data: { receivedAt: new Date() } });
  await audit(req.user!.id, "Shipment", s.id, "RECEIVED", null, { receivedAt: updated.receivedAt });
  const shipments = await prisma.shipment.findMany({ where: { orderId: s.orderId } });
  const lines = await prisma.orderLine.findMany({ where: { orderId: s.orderId } });
  const allReceived = shipments.every((x) => x.receivedAt);
  const noBackorder = lines.every((l) => backorderQty(l) === 0);
  const order = await prisma.order.findUniqueOrThrow({ where: { id: s.orderId } });
  if (allReceived && noBackorder && ["DISPATCHED", "BILTY_UPLOADED"].includes(order.status)) {
    await transition(order.id, "DELIVERED", req.user!, "Received by dealer");
  }
  res.json(updated);
}));

r.get("/shipments/:id", requireRole("SUPER_ADMIN", "ACCOUNTS", "SALES", "DEALER", "GODOWN"), wrap(async (req, res) => {
  const s = await loadShipment(Number(req.params.id), req.user!);
  res.json(await prisma.shipment.findUniqueOrThrow({
    where: { id: s.id },
    include: { invoice: true, order: { select: { number: true, dealerId: true } }, lines: { include: { orderLine: { include: { book: { select: { code: true, title: true } }, school: { select: { name: true } } } } } } },
  }));
}));

r.get("/shipments/:id/bilty", requireRole("SUPER_ADMIN", "ACCOUNTS", "SALES", "DEALER", "GODOWN"), wrap(async (req, res) => {
  const s = await loadShipment(Number(req.params.id), req.user!);
  const row = await prisma.shipment.findUnique({ where: { id: s.id }, select: { biltyData: true, biltyMime: true } });
  if (!row?.biltyData) throw notFound("No bilty uploaded yet");
  res.setHeader("Content-Type", row.biltyMime ?? "application/octet-stream");
  res.send(Buffer.from(row.biltyData));
}));

export default r;
