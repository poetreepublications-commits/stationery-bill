import { describe, it, expect } from "vitest";
import { invoiceTotals, bpOf, amountInWords, formatINR } from "../src/lib/money.js";
import { canTransition, needsDiscountApproval, exceedsCredit } from "../src/lib/orderMachine.js";
import { fyOf, formatNumber } from "../src/lib/fy.js";

describe("money", () => {
  it("applies percentage discount per line in integer paise", () => {
    expect(bpOf(10000, 1000)).toBe(1000);       // 10% of ₹100
    expect(bpOf(12500, 1550)).toBe(1938);       // 15.5% of ₹125 = 19.375 -> 19.38
  });
  it("computes invoice totals with round-off to the rupee", () => {
    const t = invoiceTotals([
      { qty: 3, unitMrpPaise: 12500, discountBp: 1000 }, // gross 37500, disc 3750
      { qty: 2, unitMrpPaise: 9500, discountBp: 1000 },  // gross 19000, disc 1900
    ]);
    expect(t.grossPaise).toBe(56500);
    expect(t.discountPaise).toBe(5650);
    expect(t.netPaise % 100).toBe(0);
    expect(t.netPaise).toBe(50900);             // 508.50 rounded to 509? 50850 -> 50900
    expect(t.roundOffPaise).toBe(50900 - 50850);
  });
  it("adds freight before rounding and keeps totals balanced", () => {
    const t = invoiceTotals([{ qty: 1, unitMrpPaise: 10001, discountBp: 0 }], 250);
    expect(t.netPaise - (t.grossPaise - t.discountPaise + t.freightPaise)).toBe(t.roundOffPaise);
  });
  it("writes amounts in words", () => {
    expect(amountInWords(50900 * 100 / 100 * 1)).toBe("Five Hundred Nine Rupees Only");
    expect(amountInWords(12345600)).toBe("One Lakh Twenty Three Thousand Four Hundred Fifty Six Rupees Only");
  });
  it("formats in Indian grouping", () => {
    expect(formatINR(12345678)).toBe("₹1,23,456.78");
    expect(formatINR(-50000)).toBe("-₹500.00");
  });
});

describe("order status machine", () => {
  it("allows the normal pipeline", () => {
    const path = ["PLACED", "ACCEPTED", "VERIFIED", "SENT_TO_GODOWN", "PICKING", "PACKED", "DISPATCHED", "BILTY_UPLOADED", "DELIVERED"] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i], path[i + 1])).toBe(true);
  });
  it("blocks skipping steps and changes after delivery", () => {
    expect(canTransition("PLACED", "PACKED")).toBe(false);
    expect(canTransition("ACCEPTED", "PICKING")).toBe(false);
    expect(canTransition("DELIVERED", "CANCELLED")).toBe(false);
  });
  it("only allows cancel before accounts verifies", () => {
    expect(canTransition("PLACED", "CANCELLED")).toBe(true);
    expect(canTransition("ACCEPTED", "CANCELLED")).toBe(true);
    expect(canTransition("VERIFIED", "CANCELLED")).toBe(false);
  });
  it("allows a backorder to be picked again after dispatch", () => {
    expect(canTransition("DISPATCHED", "PICKING")).toBe(true);
  });
});

describe("discount and credit rules", () => {
  it("flags discounts above the limit", () => {
    expect(needsDiscountApproval(1000, 1000)).toBe(false);
    expect(needsDiscountApproval(1001, 1000)).toBe(true);
  });
  it("blocks orders that push outstanding over credit limit", () => {
    expect(exceedsCredit(400000, 200000, 500000)).toBe(true);
    expect(exceedsCredit(300000, 200000, 500000)).toBe(false);
    expect(exceedsCredit(900000, 1000, 0)).toBe(false); // 0 = no limit set
  });
});

describe("financial year", () => {
  it("runs April to March", () => {
    expect(fyOf(new Date(2026, 3, 1))).toBe("2026-27");
    expect(fyOf(new Date(2026, 2, 31))).toBe("2025-26");
  });
  it("formats document numbers", () => {
    expect(formatNumber("INV", "2026-27", 7)).toBe("INV/2026-27/0007");
  });
});
