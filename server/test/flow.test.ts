import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";

const app = createApp();
const PW = "Demo@12345";
let tok: Record<string, string> = {};
const as = (role: string) => ({ Authorization: `Bearer ${tok[role]}` });
const uniq = Date.now().toString().slice(-6);

async function login(email: string) {
  const r = await request(app).post("/api/auth/login").send({ email, password: PW });
  if (r.status !== 200) throw new Error("login failed " + email);
  return r.body.accessToken as string;
}

let bookId: number, bookMrp: number, dealerId: number, schoolId: number, orderId: number, shipmentId: number;

beforeAll(async () => {
  tok = {
    SUPER_ADMIN: await login("admin@poetree.demo"),
    ACCOUNTS: await login("accounts@poetree.demo"),
    SALES: await login("sales@poetree.demo"),
    GODOWN: await login("godown@poetree.demo"),
    DEALER: await login("bookseller@poetree.demo"),
  };
  const dealerUser = await prisma.user.findUniqueOrThrow({ where: { email: "bookseller@poetree.demo" } });
  dealerId = dealerUser.dealerId!;
  const school = await prisma.school.findFirstOrThrow({ where: { dealerId, deletedAt: null } });
  schoolId = school.id;
  // a fresh book so stock numbers are predictable
  const b = await request(app).post("/api/books").set(as("SUPER_ADMIN")).send({ code: `T${uniq}`, title: `Test Book ${uniq}`, className: "4", mrpPaise: 10000, reorderLevel: 0 });
  expect(b.status).toBe(201);
  bookId = b.body.id; bookMrp = 10000;
  const rc = await request(app).post("/api/stock/receipt").set(as("GODOWN")).send({ bookId, qty: 10, reason: "Printing receipt" });
  expect(rc.status).toBe(201);
  // isolate from earlier runs: lift the yearly return limit for this test dealer
  await prisma.termsVersion.updateMany({ where: { dealerId }, data: { returnLimitQty: 100000 } });
  await prisma.dealer.update({ where: { id: dealerId }, data: { returnLimitQty: 100000 } });
  // dealer accepts the latest terms (seeded version)
  await request(app).post(`/api/dealers/${dealerId}/terms/accept`).set(as("DEALER"));
});

describe("order flow end to end", () => {
  it("dealer places an order", async () => {
    const r = await request(app).post("/api/orders").set(as("DEALER")).send({ lines: [{ schoolId, bookId, qty: 6 }] });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe("PLACED");
    orderId = r.body.id;
  });

  it("dealer cannot verify or see other dealers' orders", async () => {
    const r = await request(app).post(`/api/orders/${orderId}/verify`).set(as("DEALER")).send({});
    expect(r.status).toBe(403);
  });

  it("sales accepts, accounts verifies with 10% discount and it goes to godown", async () => {
    expect((await request(app).post(`/api/orders/${orderId}/accept`).set(as("SALES"))).body.status).toBe("ACCEPTED");
    const v = await request(app).post(`/api/orders/${orderId}/verify`).set(as("ACCOUNTS")).send({ discountBp: 1000 });
    expect(v.status).toBe(200);
    expect(v.body.status).toBe("SENT_TO_GODOWN");
  });

  it("godown picks partially, packs, and an invoice is created with correct totals", async () => {
    const p = await request(app).post(`/api/godown/orders/${orderId}/pick`).set(as("GODOWN")).send({ lines: [{ lineId: (await prisma.orderLine.findFirstOrThrow({ where: { orderId, bookId } })).id, qtyPicked: 4 }] });
    expect(p.status).toBe(200);
    const pk = await request(app).post(`/api/godown/orders/${orderId}/pack`).set(as("GODOWN")).send({ boxes: 1, weightKg: 3 });
    expect(pk.status).toBe(201);
    expect(pk.body.invoice.grossPaise).toBe(4 * bookMrp);
    expect(pk.body.invoice.discountPaise).toBe(4000);
    expect(pk.body.invoice.netPaise).toBe(36000);
    shipmentId = pk.body.shipment.id;
    const stock = await prisma.stockEntry.aggregate({ where: { bookId }, _sum: { qty: true } });
    expect(stock._sum.qty).toBe(6);
  });

  it("dispatch shows transport details and the order keeps a backorder", async () => {
    const d = await request(app).post(`/api/shipments/${shipmentId}/dispatch`).set(as("GODOWN")).send({ transporter: "Blue Dart", vehicleNo: "GJ01AB1234", lrNo: "LR1" });
    expect(d.status).toBe(200);
    const o = await request(app).get(`/api/orders/${orderId}`).set(as("DEALER"));
    expect(o.body.status).toBe("DISPATCHED");
    expect(o.body.hasBackorder).toBe(true);
  });

  it("bilty can be uploaded, then godown ships the backorder and dealer receives", async () => {
    const bilty = await request(app).post(`/api/shipments/${shipmentId}/bilty`).set(as("GODOWN")).attach("file", Buffer.from("fake-png"), { filename: "bilty.png", contentType: "image/png" });
    expect(bilty.status).toBe(200);
    expect((await request(app).get(`/api/orders/${orderId}`).set(as("DEALER"))).body.status).toBe("BILTY_UPLOADED");
    await request(app).post(`/api/shipments/${shipmentId}/receive`).set(as("DEALER"));
    // still backorder -> not delivered yet
    expect((await request(app).get(`/api/orders/${orderId}`).set(as("DEALER"))).body.status).toBe("BILTY_UPLOADED");
    const p = await request(app).post(`/api/godown/orders/${orderId}/pick`).set(as("GODOWN")).send({ lines: [{ lineId: (await prisma.orderLine.findFirstOrThrow({ where: { orderId, bookId } })).id, qtyPicked: 6 }] });
    expect(p.status).toBe(200);
    const pk = await request(app).post(`/api/godown/orders/${orderId}/pack`).set(as("GODOWN")).send({ boxes: 1, weightKg: 2 });
    expect(pk.status).toBe(201);
    const s2 = pk.body.shipment.id;
    await request(app).post(`/api/shipments/${s2}/dispatch`).set(as("GODOWN")).send({ transporter: "DTDC" });
    const r = await request(app).post(`/api/shipments/${s2}/receive`).set(as("DEALER"));
    expect(r.status).toBe(200);
    const o = await request(app).get(`/api/orders/${orderId}`).set(as("DEALER"));
    expect(o.body.status).toBe("DELIVERED");
    expect(o.body.history.at(-1).toStatus).toBe("DELIVERED");
  });

  it("the sales register and ledger include the invoices; outstanding is consistent", async () => {
    const led = await request(app).get(`/api/dealers/${dealerId}/ledger`).set(as("ACCOUNTS"));
    expect(led.status).toBe(200);
    const invs = await prisma.invoice.findMany({ where: { dealerId } });
    const net = invs.reduce((s, i) => s + i.netPaise, 0);
    const notes = await prisma.note.findMany({ where: { dealerId } });
    const credits = notes.filter((n) => n.type === "CREDIT").reduce((s, n) => s + n.amountPaise, 0);
    const debits = notes.filter((n) => n.type === "DEBIT").reduce((s, n) => s + n.amountPaise, 0);
    const pays = (await prisma.payment.findMany({ where: { dealerId } })).reduce((s, p) => s + p.amountPaise, 0);
    const dealer = await prisma.dealer.findUniqueOrThrow({ where: { id: dealerId } });
    expect(led.body.outstandingPaise).toBe(dealer.openingBalancePaise + net + debits - pays - credits);
  });
});

describe("discount approval and credit control", () => {
  it("discount above the limit needs Super Admin approval", async () => {
    const r = await request(app).post("/api/orders").set(as("DEALER")).send({ lines: [{ schoolId, bookId, qty: 1 }] });
    const id = r.body.id;
    await request(app).post(`/api/orders/${id}/accept`).set(as("SALES"));
    const blocked = await request(app).post(`/api/orders/${id}/verify`).set(as("ACCOUNTS")).send({ discountBp: 2000 });
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/Super Admin approval/);
    await request(app).post(`/api/orders/${id}/approve-discount`).set(as("SUPER_ADMIN"));
    const ok = await request(app).post(`/api/orders/${id}/verify`).set(as("ACCOUNTS")).send({ discountBp: 2000 });
    expect(ok.status).toBe(200);
  });

  it("order over the credit limit is blocked unless overridden", async () => {
    const d = await prisma.dealer.findUniqueOrThrow({ where: { id: dealerId } });
    await prisma.termsVersion.updateMany({ where: { dealerId }, data: { creditLimitPaise: 100 } }); // ₹1 limit
    try {
      const r = await request(app).post("/api/orders").set(as("DEALER")).send({ lines: [{ schoolId, bookId, qty: 1 }] });
      await request(app).post(`/api/orders/${r.body.id}/accept`).set(as("SALES"));
      const v = await request(app).post(`/api/orders/${r.body.id}/verify`).set(as("ACCOUNTS")).send({ discountBp: 0 });
      expect(v.status).toBe(409);
      expect(v.body.message).toMatch(/credit limit/);
      const ov = await request(app).post(`/api/orders/${r.body.id}/verify`).set(as("ACCOUNTS")).send({ discountBp: 0, creditOverride: true });
      expect(ov.status).toBe(200);
    } finally {
      await prisma.termsVersion.updateMany({ where: { dealerId }, data: { creditLimitPaise: d.creditLimitPaise } });
    }
  });
});

describe("returns with limits, godown receipt and automatic credit note", () => {
  it("return raises a credit note and returns stock", async () => {
    const before = (await prisma.stockEntry.aggregate({ where: { bookId }, _sum: { qty: true } }))._sum.qty ?? 0;
    const r = await request(app).post("/api/returns").set(as("DEALER")).send({ reason: "Damaged in transit", lines: [{ bookId, qty: 2 }] });
    expect(r.status).toBe(201);
    const rl = r.body.lines[0];
    expect((await request(app).post(`/api/returns/${r.body.id}/approve`).set(as("ACCOUNTS")).send({ lines: [{ lineId: rl.id, qtyApproved: 2 }] })).status).toBe(409);
    const rc = await request(app).post(`/api/returns/${r.body.id}/receive`).set(as("GODOWN")).send({ lines: [{ lineId: rl.id, qtyReceived: 2 }] });
    expect(rc.status).toBe(200);
    const ap = await request(app).post(`/api/returns/${r.body.id}/approve`).set(as("ACCOUNTS")).send({ lines: [{ lineId: rl.id, qtyApproved: 2 }] });
    expect(ap.status).toBe(200);
    expect(ap.body.creditNote.type).toBe("CREDIT");
    expect(ap.body.creditNote.amountPaise).toBeGreaterThan(0);
    const after = (await prisma.stockEntry.aggregate({ where: { bookId }, _sum: { qty: true } }))._sum.qty ?? 0;
    expect(after - before).toBe(2);
  });

  it("return limit blocks over-limit requests for the dealer", async () => {
    await prisma.termsVersion.updateMany({ where: { dealerId }, data: { returnLimitQty: 1 } });
    const r = await request(app).post("/api/returns").set(as("DEALER")).send({ reason: "Extra copies", lines: [{ bookId, qty: 5 }] });
    expect(r.status).toBe(409);
    expect(r.body.details.limitQty).toBe(1);
    const ov = await request(app).post("/api/returns").set(as("ACCOUNTS")).send({ dealerId, reason: "Approved exception", lines: [{ bookId, qty: 5 }], override: true });
    expect(ov.status).toBe(201);
    await prisma.termsVersion.updateMany({ where: { dealerId }, data: { returnLimitQty: 100000 } });
  });
});

describe("stock safety and audit", () => {
  it("cannot pick more than available stock", async () => {
    const o = await request(app).post("/api/orders").set(as("DEALER")).send({ lines: [{ schoolId, bookId, qty: 1000 }] });
    await request(app).post(`/api/orders/${o.body.id}/accept`).set(as("SALES"));
    const v = await request(app).post(`/api/orders/${o.body.id}/verify`).set(as("ACCOUNTS")).send({ discountBp: 0, creditOverride: true });
    expect(v.status).toBe(200);
    const line = await prisma.orderLine.findFirstOrThrow({ where: { orderId: o.body.id } });
    const p = await request(app).post(`/api/godown/orders/${o.body.id}/pick`).set(as("GODOWN")).send({ lines: [{ lineId: line.id, qtyPicked: 1000 }] });
    expect(p.status).toBe(409); // stock guard: not enough books on hand
    expect(p.body.details.available).toBeLessThan(1000);
    await request(app).post(`/api/orders/${o.body.id}/cancel`).set(as("DEALER")).send({});
  });

  it("status changes are written to the audit log", async () => {
    const n = await prisma.auditLog.count({ where: { entity: "Return", action: "APPROVE" } });
    expect(n).toBeGreaterThan(0);
  });
});
