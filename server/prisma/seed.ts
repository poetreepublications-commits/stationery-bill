import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { DEFAULTS } from "../src/services/settings.js";
import { fyOf } from "../src/lib/fy.js";

const prisma = new PrismaClient();
const PASSWORD = "Demo@12345";

async function main() {
  const hash = await bcrypt.hash(PASSWORD, 10);
  const mk = (name: string, email: string, role: any, extra: any = {}) =>
    prisma.user.upsert({ where: { email }, update: {}, create: { name, email, role, passwordHash: hash, ...extra } });

  const admin = await mk("Owner (Super Admin)", "admin@poetree.demo", "SUPER_ADMIN");
  await mk("Account Person", "accounts@poetree.demo", "ACCOUNTS");
  const sales = await mk("Sales Employee", "sales@poetree.demo", "SALES", { referralCode: "SALES01" });
  await mk("Godown Person", "godown@poetree.demo", "GODOWN");

  for (const [k, v] of Object.entries(DEFAULTS)) {
    await prisma.setting.upsert({ where: { key: k }, update: {}, create: { key: k, value: v as any } });
  }

  const books: [string, string, string, number][] = [
    ["MATH3", "Mathematics Class 3", "3", 12500], ["ENG3", "English Reader Class 3", "3", 9500],
    ["EVS3", "Environmental Studies Class 3", "3", 11000], ["MATH5", "Mathematics Class 5", "5", 16000],
    ["ENG5", "English Grammar Class 5", "5", 14500], ["SCI8", "Science Class 8", "8", 21000],
  ];
  const created = [];
  for (const [code, title, cls, mrp] of books) {
    created.push(await prisma.book.upsert({
      where: { code }, update: {},
      create: { code, title, className: cls, mrpPaise: mrp, isbn: `978000000${code.length}${created.length}`, reorderLevel: 20, hsn: "4902" },
    }));
  }
  for (const b of created) {
    const have = await prisma.stockEntry.count({ where: { bookId: b.id } });
    if (!have) await prisma.stockEntry.create({ data: { bookId: b.id, type: "OPENING", qty: 500, reason: "Opening stock" } });
  }
  await prisma.bookSet.upsert({
    where: { name: "Class 3 Full Set" }, update: {},
    create: { name: "Class 3 Full Set", className: "3", items: { create: created.filter((b) => b.className === "3").map((b) => ({ bookId: b.id, qty: 1 })) } },
  });

  const schoolDealer = await prisma.dealer.upsert({
    where: { id: 1 }, update: {},
    create: { id: 1, firmName: "Sunrise Public School", type: "SCHOOL", ownerName: "Principal Demo", mobile: "9000000001", email: "school@poetree.demo", city: "Ahmedabad", state: "Gujarat", pincode: "380001", status: "ACTIVE", salesEmployeeId: sales.id, creditLimitPaise: 5000000, creditDays: 60, defaultDiscountBp: 1000, openingBalancePaise: 0, returnLimitQty: 50 },
  });
  await prisma.user.upsert({ where: { email: "school@poetree.demo" }, update: { dealerId: schoolDealer.id }, create: { name: "Principal Demo", email: "school@poetree.demo", role: "DEALER", passwordHash: hash, dealerId: schoolDealer.id } });
  const bsDealer = await prisma.dealer.upsert({
    where: { id: 2 }, update: {},
    create: { id: 2, firmName: "Gurukul Book House", type: "BOOKSELLER", ownerName: "Mr. Demo Seller", mobile: "9000000002", email: "bookseller@poetree.demo", city: "Surat", state: "Gujarat", pincode: "395003", status: "ACTIVE", salesEmployeeId: sales.id, creditLimitPaise: 10000000, creditDays: 45, defaultDiscountBp: 1500 },
  });
  await prisma.user.upsert({ where: { email: "bookseller@poetree.demo" }, update: { dealerId: bsDealer.id }, create: { name: "Mr. Demo Seller", email: "bookseller@poetree.demo", role: "DEALER", passwordHash: hash, dealerId: bsDealer.id } });
  for (const [name, board] of [["Shanti Vidyalaya", "GSEB"], ["Nav Bharat School", "CBSE"]]) {
    const exists = await prisma.school.findFirst({ where: { dealerId: bsDealer.id, name } });
    if (!exists) await prisma.school.create({ data: { dealerId: bsDealer.id, name, board } });
  }
  for (const d of [schoolDealer, bsDealer]) {
    const t = await prisma.termsVersion.findFirst({ where: { dealerId: d.id } });
    if (!t) await prisma.termsVersion.create({
      data: { dealerId: d.id, version: 1, discountBp: d.defaultDiscountBp, creditLimitPaise: d.creditLimitPaise, creditDays: d.creditDays, returnLimitQty: 50, paymentTerms: "Net 45 days from invoice", returnPolicy: "Returns accepted for unsold books within the limit, subject to godown check.", clauses: "Disputes subject to local jurisdiction." },
    });
  }
  await prisma.target.upsert({ where: { salesId_period_kind: { salesId: sales.id, period: fyOf(), kind: "AMOUNT" } }, update: {}, create: { salesId: sales.id, period: fyOf(), kind: "AMOUNT", value: 50000000 } });
  console.log("Seed complete. Admin:", admin.email, "| password for all demo users:", PASSWORD);
}

main().finally(() => prisma.$disconnect());
