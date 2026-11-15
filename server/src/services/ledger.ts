import { prisma } from "../db.js";

export interface LedgerRow { date: Date; type: string; ref: string; debit: number; credit: number; balance: number }

// Outstanding = opening + invoices + debit notes - payments - credit notes.
export async function dealerOutstanding(dealerId: number): Promise<number> {
  const d = await prisma.dealer.findUniqueOrThrow({ where: { id: dealerId } });
  const [inv, notes, pays] = await Promise.all([
    prisma.invoice.aggregate({ where: { dealerId }, _sum: { netPaise: true } }),
    prisma.note.groupBy({ by: ["type"], where: { dealerId }, _sum: { amountPaise: true } }),
    prisma.payment.aggregate({ where: { dealerId }, _sum: { amountPaise: true } }),
  ]);
  const sumNote = (t: "CREDIT" | "DEBIT") => notes.find((n) => n.type === t)?._sum.amountPaise ?? 0;
  return d.openingBalancePaise + (inv._sum.netPaise ?? 0) + sumNote("DEBIT") - (pays._sum.amountPaise ?? 0) - sumNote("CREDIT");
}

// Full dealer ledger with running balance, oldest first.
export async function dealerLedger(dealerId: number): Promise<LedgerRow[]> {
  const d = await prisma.dealer.findUniqueOrThrow({ where: { id: dealerId } });
  const [invoices, payments, notes] = await Promise.all([
    prisma.invoice.findMany({ where: { dealerId } }),
    prisma.payment.findMany({ where: { dealerId } }),
    prisma.note.findMany({ where: { dealerId } }),
  ]);
  const rows: Omit<LedgerRow, "balance">[] = [
    ...invoices.map((i) => ({ date: i.createdAt, type: "Invoice", ref: i.number, debit: i.netPaise, credit: 0 })),
    ...payments.map((p) => ({ date: p.paidOn, type: `Payment (${p.mode})`, ref: p.reference ?? `#${p.id}`, debit: 0, credit: p.amountPaise })),
    ...notes.map((n) => n.type === "CREDIT"
      ? { date: n.createdAt, type: "Credit Note", ref: n.number, debit: 0, credit: n.amountPaise }
      : { date: n.createdAt, type: "Debit Note", ref: n.number, debit: n.amountPaise, credit: 0 }),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());
  let bal = d.openingBalancePaise;
  const out: LedgerRow[] = [{ date: d.createdAt, type: "Opening balance", ref: "", debit: d.openingBalancePaise, credit: 0, balance: bal }];
  for (const r of rows) { bal += r.debit - r.credit; out.push({ ...r, balance: bal }); }
  return out;
}

// Ageing of open items: invoices and debit notes by date; opening balance in 90+.
export async function dealerAgeing(dealerId: number) {
  const d = await prisma.dealer.findUniqueOrThrow({ where: { id: dealerId } });
  const invoices = await prisma.invoice.findMany({ where: { dealerId }, include: { allocations: true } });
  const debits = await prisma.note.findMany({ where: { dealerId, type: "DEBIT" } });
  const now = Date.now();
  const buckets = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": d.openingBalancePaise };
  for (const i of invoices) {
    const open = i.netPaise - i.allocations.reduce((s, a) => s + a.amountPaise, 0);
    if (open <= 0) continue;
    const days = (now - i.createdAt.getTime()) / 86400000;
    bucketAdd(buckets, days, open);
  }
  for (const n of debits) bucketAdd(buckets, (now - n.createdAt.getTime()) / 86400000, n.amountPaise);
  const payments = await prisma.payment.findMany({ where: { dealerId }, include: { allocations: true } });
  const unallocatedPayments = payments.reduce((s, p) => s + p.amountPaise - p.allocations.reduce((x, a) => x + a.amountPaise, 0), 0);
  const credits = await prisma.note.aggregate({ where: { dealerId, type: "CREDIT" }, _sum: { amountPaise: true } });
  const onAccount = unallocatedPayments + (credits._sum.amountPaise ?? 0);
  const totalOpen = Object.values(buckets).reduce((a, b) => a + b, 0);
  return { buckets, onAccount, outstanding: totalOpen - onAccount };
}

function bucketAdd(b: Record<string, number>, days: number, amt: number) {
  const k = days <= 30 ? "0-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+";
  b[k] += amt;
}

// Auto-allocate a payment to open invoices, oldest first.
export async function allocatePayment(paymentId: number, dealerId: number) {
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { allocations: true } });
  let remaining = payment.amountPaise - payment.allocations.reduce((s, a) => s + a.amountPaise, 0);
  const invoices = await prisma.invoice.findMany({ where: { dealerId }, include: { allocations: true }, orderBy: { createdAt: "asc" } });
  for (const inv of invoices) {
    if (remaining <= 0) break;
    const open = inv.netPaise - inv.allocations.reduce((s, a) => s + a.amountPaise, 0);
    if (open <= 0) continue;
    const take = Math.min(open, remaining);
    await prisma.paymentAllocation.create({ data: { paymentId, invoiceId: inv.id, amountPaise: take } });
    remaining -= take;
  }
  return remaining; // unallocated (on account)
}

