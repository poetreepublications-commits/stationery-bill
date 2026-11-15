import { prisma } from "../db.js";
import { HttpError, badRequest, forbidden, notFound } from "../lib/errors.js";
import type { AuthUser } from "../middleware/auth.js";
import { canTransition, type OrderStatus, isEditable, exceedsCredit, needsDiscountApproval } from "../lib/orderMachine.js";
import { bpOf, invoiceTotals } from "../lib/money.js";
import { assignNumber, fyOf } from "../lib/fy.js";
import { audit } from "./audit.js";
import { notify } from "./notify.js";
import { getSetting, assertFyOpen } from "./settings.js";
import { dealerOutstanding } from "./ledger.js";
import { stockByBook } from "../routes/masters.js";
import { currentTerms } from "../routes/masters.js";

export interface LineInput { schoolId?: number; bookId?: number; setId?: number; qty: number }

export async function ensureTermsAccepted(dealerId: number, userId: number, role: AuthUser["role"]) {
  const dealer = await prisma.dealer.findUniqueOrThrow({ where: { id: dealerId } });
  if (dealer.status !== "ACTIVE") throw forbidden("Dealer is not approved yet");
  const latest = await currentTerms(dealerId);
  if (!latest) throw forbidden("Accounts has not issued terms & conditions for this dealer yet");
  if (role === "DEALER") {
    const acc = await prisma.termsAcceptance.findFirst({ where: { termsVersionId: latest.id, userId } });
    if (!acc) throw new HttpError(403, "Please accept the latest terms & conditions before ordering");
  } else {
    const acc = await prisma.termsAcceptance.findFirst({ where: { termsVersionId: latest.id, user: { dealerId } } });
    if (!acc) throw new HttpError(403, "The dealer has not accepted the latest terms & conditions yet");
  }
  return dealer;
}

// Turns school/book/set inputs into priced order lines. Set = quantity of each item in the set.
export async function buildLines(dealerId: number, dealerType: string, inputs: LineInput[]) {
  if (!inputs.length) throw badRequest("Add at least one line");
  const schools = await prisma.school.findMany({ where: { dealerId, deletedAt: null } });
  const out: { schoolId: number; bookId: number; qty: number; unitMrpPaise: number }[] = [];
  for (const i of inputs) {
    if (!Number.isInteger(i.qty) || i.qty < 1) throw badRequest("Quantity must be a whole number of 1 or more");
    let schoolId = i.schoolId;
    if (!schoolId && dealerType === "SCHOOL") schoolId = schools[0]?.id;
    const school = schools.find((s) => s.id === schoolId);
    if (!school) throw badRequest("Pick a school for each line");
    const items = i.setId
      ? (await prisma.bookSetItem.findMany({ where: { setId: i.setId }, include: { book: true } })).map((x) => ({ book: x.book, qty: x.qty * i.qty }))
      : [{ book: await prisma.book.findFirst({ where: { id: i.bookId, deletedAt: null, active: true } }), qty: i.qty }];
    for (const it of items) {
      if (!it.book) throw badRequest("Book not found or inactive");
      out.push({ schoolId: school.id, bookId: it.book.id, qty: it.qty, unitMrpPaise: it.book.mrpPaise });
    }
  }
  return out;
}

const orderNumber = async () => assignNumber("ORD", fyOf());

export async function placeOrder(dealerId: number, u: AuthUser, inputs: LineInput[]) {
  const dealer = await ensureTermsAccepted(dealerId, u.id, u.role);
  const lines = await buildLines(dealerId, dealer.type, inputs);
  const order = await prisma.order.create({
    data: {
      number: await orderNumber(), dealerId, placedById: u.id, status: "PLACED",
      lines: { create: lines.map((l) => ({ schoolId: l.schoolId, bookId: l.bookId, qtyOrdered: l.qty, unitMrpPaise: l.unitMrpPaise })) },
      history: { create: { toStatus: "PLACED", userId: u.id, note: "Order placed" } },
    },
  });
  await audit(u.id, "Order", order.id, "CREATE", null, { number: order.number, lines: lines.length });
  const sales = dealer.salesEmployeeId;
  await notify([sales], "New order placed", `${order.number} from ${dealer.firmName}.`, `/orders/${order.id}`);
  return order;
}

export async function loadOrderForUser(id: number, u: AuthUser) {
  const order = await prisma.order.findUnique({ where: { id }, include: { dealer: true } });
  if (!order) throw notFound("Order not found");
  if (u.role === "DEALER" && order.dealerId !== u.dealerId) throw notFound("Order not found");
  if (u.role === "SALES" && order.dealer.salesEmployeeId !== u.id) throw notFound("Order not found");
  if (u.role === "GODOWN" && order.status === "PLACED") throw notFound("Order not found");
  return order;
}

// Moves the order through the pipeline, records history and notifies the right people.
export async function transition(orderId: number, to: OrderStatus, u: AuthUser | null, note?: string) {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { dealer: true } });
  if (!canTransition(order.status, to)) throw new HttpError(409, `Order cannot move from ${order.status} to ${to}`);
  const updated = await prisma.order.update({
    where: { id: orderId },
    data: { status: to, history: { create: { fromStatus: order.status, toStatus: to, userId: u?.id ?? null, note } } },
  });
  const dealerUser = await prisma.user.findUnique({ where: { dealerId: order.dealerId } });
  const godown = await prisma.user.findMany({ where: { role: "GODOWN", active: true }, select: { id: true } });
  const fin = await prisma.user.findMany({ where: { role: { in: ["ACCOUNTS", "SUPER_ADMIN"] }, active: true }, select: { id: true } });
  const link = `/orders/${orderId}`;
  const label = to.replace(/_/g, " ").toLowerCase();
  const base = `${order.number} is now ${label}.`;
  const sales = order.dealer.salesEmployeeId;
  switch (to) {
    case "ACCEPTED": await notify([dealerUser?.id, ...fin.map((x) => x.id)], "Order accepted by sales", base, link); break;
    case "VERIFIED": await notify([dealerUser?.id, sales], "Order verified", base, link); break;
    case "SENT_TO_GODOWN": await notify(godown.map((x) => x.id), "New order for dispatch", base, link); break;
    case "PACKED": await notify(fin.map((x) => x.id), "Order packed, invoice ready", base, link); break;
    case "DISPATCHED": await notify([dealerUser?.id, sales], "Order dispatched", base, link); break;
    case "BILTY_UPLOADED": await notify([dealerUser?.id, sales], "Transport bilty uploaded", base, link); break;
    case "DELIVERED": await notify([dealerUser?.id, sales, ...fin.map((x) => x.id)], "Order received by dealer", base, link); break;
    case "CANCELLED": await notify([dealerUser?.id, sales], "Order cancelled", base, link); break;
  }
  return updated;
}

export async function orderSummary(orderId: number) {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  const lines = await prisma.orderLine.findMany({ where: { orderId, cancelled: false } });
  const gross = lines.reduce((s, l) => s + l.qtyOrdered * l.unitMrpPaise, 0);
  const discount = bpOf(gross, order.discountBp);
  return { grossPaise: gross, discountPaise: discount, netPaise: gross - discount, discountBp: order.discountBp };
}

// Ordered - dispatched, per line (the godown's shortfall that becomes backorder).
export const backorderQty = (l: { qtyOrdered: number; qtyDispatched: number; cancelled: boolean }) =>
  l.cancelled ? 0 : Math.max(0, l.qtyOrdered - l.qtyDispatched);

// Stock that can still be promised to this line: on hand minus what other open orders have picked.
export async function availableFor(lineId: number, bookId: number): Promise<number> {
  const onHand = (await stockByBook([bookId]))[bookId] ?? 0;
  const others = await prisma.orderLine.findMany({
    where: { bookId, id: { not: lineId }, cancelled: false, order: { status: { notIn: ["DELIVERED", "CANCELLED"] } } },
    select: { qtyPicked: true, qtyDispatched: true },
  });
  const reserved = others.reduce((s, l) => s + Math.max(0, l.qtyPicked - l.qtyDispatched), 0);
  return onHand - reserved;
}

export { getSetting, assertFyOpen, dealerOutstanding, exceedsCredit, needsDiscountApproval, isEditable, invoiceTotals };
