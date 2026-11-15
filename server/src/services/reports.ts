import { prisma } from "../db.js";
import type { AuthUser } from "../middleware/auth.js";
import { dealerAgeing } from "./ledger.js";
import { stockByBook } from "../routes/masters.js";
import { backorderQty } from "./orderService.js";

export const REPORTS = [
  { key: "sales-register", title: "Sales register (invoices)" },
  { key: "dealer-sales", title: "Dealer-wise sales" },
  { key: "school-sales", title: "School-wise sales" },
  { key: "book-sales", title: "Book-wise sales" },
  { key: "class-sales", title: "Class-wise sales" },
  { key: "outstanding", title: "Outstanding & ageing" },
  { key: "collections", title: "Collections" },
  { key: "returns", title: "Returns register" },
  { key: "credit-notes", title: "Credit & debit notes" },
  { key: "stock", title: "Stock summary" },
  { key: "stock-movements", title: "Stock movements" },
  { key: "pending-orders", title: "Pending orders & backorders" },
  { key: "dispatch-register", title: "Dispatch register (transporter-wise)" },
];

const rupees = (p: number) => Math.round(p) / 100;
const range = (q: Record<string, string>) => ({
  gte: q.from ? new Date(q.from) : new Date("2000-01-01"),
  lte: q.to ? new Date(q.to + "T23:59:59") : new Date("2100-01-01"),
});

export async function reportRows(name: string, q: Record<string, string>, u: AuthUser) {
  const title = REPORTS.find((x) => x.key === name)!.title;
  const dt = range(q);
  const fy = q.fy;
  const invWhere = { createdAt: dt, ...(fy ? { fy } : {}) };
  switch (name) {
    case "sales-register": {
      const invs = await prisma.invoice.findMany({ where: invWhere, include: { dealer: true, shipment: { include: { order: true } } }, orderBy: { createdAt: "asc" } });
      return { title, headers: ["Date", "Invoice", "Order", "Dealer", "Gross", "Discount", "Freight", "Net"], rows: invs.map((i) => [i.createdAt.toISOString().slice(0, 10), i.number, i.shipment.order.number, i.dealer.firmName, rupees(i.grossPaise), rupees(i.discountPaise), rupees(i.freightPaise), rupees(i.netPaise)]) };
    }
    case "dealer-sales": {
      const invs = await prisma.invoice.findMany({ where: invWhere, include: { dealer: true } });
      const m = new Map<string, number>();
      for (const i of invs) m.set(i.dealer.firmName, (m.get(i.dealer.firmName) ?? 0) + i.netPaise);
      return { title, headers: ["Dealer", "Net sales"], rows: [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, rupees(v)]) };
    }
    case "school-sales":
    case "book-sales":
    case "class-sales": {
      const lines = await prisma.shipmentLine.findMany({
        where: { shipment: { invoice: { is: invWhere } } },
        include: { orderLine: { include: { school: true, book: true } } },
      });
      const key = (l: (typeof lines)[number]) =>
        name === "school-sales" ? l.orderLine.school.name : name === "book-sales" ? `${l.orderLine.book.code} ${l.orderLine.book.title}` : (l.orderLine.book.className ?? "-");
      const m = new Map<string, { qty: number; amt: number }>();
      for (const l of lines) {
        const k = key(l), gross = l.qty * l.unitMrpPaise;
        const cur = m.get(k) ?? { qty: 0, amt: 0 };
        cur.qty += l.qty; cur.amt += gross - Math.round((gross * l.discountBp) / 10000);
        m.set(k, cur);
      }
      const label = name === "school-sales" ? "School" : name === "book-sales" ? "Book" : "Class";
      return { title, headers: [label, "Qty", "Net amount"], rows: [...m].sort((a, b) => b[1].amt - a[1].amt).map(([k, v]) => [k, v.qty, rupees(v.amt)]) };
    }
    case "outstanding": {
      const dealers = await prisma.dealer.findMany({ where: { deletedAt: null } });
      const rows = [];
      for (const d of dealers) {
        const a = await dealerAgeing(d.id);
        if (a.outstanding === 0 && a.onAccount === 0) continue;
        rows.push([d.firmName, rupees(a.outstanding), rupees(a.buckets["0-30"]), rupees(a.buckets["31-60"]), rupees(a.buckets["61-90"]), rupees(a.buckets["90+"]), rupees(a.onAccount)]);
      }
      return { title, headers: ["Dealer", "Outstanding", "0-30", "31-60", "61-90", "90+", "On account"], rows };
    }
    case "collections": {
      const pays = await prisma.payment.findMany({ where: { paidOn: dt }, include: { dealer: true } });
      return { title, headers: ["Date", "Dealer", "Mode", "Reference", "Amount"], rows: pays.map((p) => [p.paidOn.toISOString().slice(0, 10), p.dealer.firmName, p.mode, p.reference ?? "", rupees(p.amountPaise)]) };
    }
    case "returns": {
      const rets = await prisma.returnRequest.findMany({ where: { createdAt: dt }, include: { dealer: true, lines: { include: { book: true } } } });
      const rows: (string | number)[][] = [];
      for (const r of rets) for (const l of r.lines) rows.push([r.createdAt.toISOString().slice(0, 10), r.number, r.dealer.firmName, l.book.code, l.qtyRequested, l.qtyReceived ?? "", l.qtyApproved ?? "", r.status]);
      return { title, headers: ["Date", "Return", "Dealer", "Book", "Requested", "Received", "Approved", "Status"], rows };
    }
    case "credit-notes": {
      const notes = await prisma.note.findMany({ where: { createdAt: dt }, include: { dealer: true } });
      return { title, headers: ["Date", "Note", "Type", "Dealer", "Amount", "Reason"], rows: notes.map((n) => [n.createdAt.toISOString().slice(0, 10), n.number, n.type, n.dealer.firmName, rupees(n.amountPaise), n.reason ?? ""]) };
    }
    case "stock": {
      const books = await prisma.book.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" } });
      const oh = await stockByBook(books.map((b) => b.id));
      return { title, headers: ["Code", "Title", "Class", "On hand", "Reorder level", "Low?"], rows: books.map((b) => [b.code, b.title, b.className ?? "", oh[b.id] ?? 0, b.reorderLevel, (oh[b.id] ?? 0) <= b.reorderLevel ? "YES" : ""]) };
    }
    case "stock-movements": {
      const mv = await prisma.stockEntry.findMany({ where: { createdAt: dt }, include: { book: true }, orderBy: { createdAt: "asc" } });
      return { title, headers: ["Date", "Book", "Type", "Qty", "Reason"], rows: mv.map((m) => [m.createdAt.toISOString().slice(0, 10), m.book.code, m.type, m.qty, m.reason ?? ""]) };
    }
    case "pending-orders": {
      const orders = await prisma.order.findMany({ where: { status: { notIn: ["DELIVERED", "CANCELLED"] } }, include: { dealer: true, lines: true } });
      return { title, headers: ["Order", "Dealer", "Status", "Ordered qty", "Backorder qty", "Placed"], rows: orders.map((o) => [o.number, o.dealer.firmName, o.status, o.lines.reduce((s, l) => s + l.qtyOrdered, 0), o.lines.reduce((s, l) => s + backorderQty(l), 0), o.createdAt.toISOString().slice(0, 10)]) };
    }
    case "dispatch-register": {
      const sh = await prisma.shipment.findMany({ where: { dispatchedAt: dt }, include: { order: { include: { dealer: true } }, lines: true } });
      return { title, headers: ["Dispatched", "Shipment", "Order", "Dealer", "Transporter", "Vehicle", "LR no", "E-way bill", "Boxes", "Qty"], rows: sh.map((s) => [s.dispatchedAt?.toISOString().slice(0, 10) ?? "", s.number, s.order.number, s.order.dealer.firmName, s.transporter ?? "", s.vehicleNo ?? "", s.lrNo ?? "", s.eWayBill ?? "", s.boxes ?? "", s.lines.reduce((x, l) => x + l.qty, 0)]) };
    }
  }
  throw new Error("unknown report");
}
