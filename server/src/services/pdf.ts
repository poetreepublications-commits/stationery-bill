import PDFDocument from "pdfkit";
import { prisma } from "../db.js";
import { getSetting } from "./settings.js";
import { formatINR, amountInWords } from "../lib/money.js";

// Invoice with three copies: Original, Duplicate, Transport. Each on its own page.
export async function invoicePdf(invoiceId: number): Promise<Buffer> {
  const inv = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: {
      dealer: true,
      shipment: { include: { order: true, lines: { include: { orderLine: { include: { school: true, book: true } } } } } },
    },
  });
  const co = await getSetting("company");
  const doc = new PDFDocument({ size: "A4", margin: 36 });
  const chunks: Buffer[] = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const copies = ["ORIGINAL", "DUPLICATE", "TRANSPORT COPY"];
  copies.forEach((label, idx) => {
    if (idx > 0) doc.addPage();
    doc.fontSize(16).text(co.name, { align: "center" });
    doc.fontSize(9).text(`${co.address} | ${co.phone} | ${co.email}`, { align: "center" });
    if (co.gstin) doc.text(`GSTIN: ${co.gstin}`, { align: "center" });
    doc.moveDown(0.5).fontSize(12).text(`TAX INVOICE (${label})`, { align: "center", underline: true });
    doc.moveDown(0.5).fontSize(10);
    doc.text(`Invoice No: ${inv.number}`, 36, doc.y, { continued: false });
    doc.text(`Date: ${inv.createdAt.toISOString().slice(0, 10)}`);
    doc.text(`Order: ${inv.shipment.order.number}   Shipment: ${inv.shipment.number}`);
    doc.moveDown(0.3).text(`Bill to: ${inv.dealer.firmName}`);
    doc.text(`${inv.dealer.address ?? ""} ${inv.dealer.city ?? ""} ${inv.dealer.state ?? ""} ${inv.dealer.pincode ?? ""}`);
    doc.moveDown(0.5);

    // School-wise breakup
    const bySchool = new Map<string, typeof inv.shipment.lines>();
    for (const l of inv.shipment.lines) {
      const k = l.orderLine.school.name;
      bySchool.set(k, [...(bySchool.get(k) ?? []), l]);
    }
    for (const [school, lines] of bySchool) {
      doc.font("Helvetica-Bold").fontSize(10).text(`School: ${school}`);
      doc.font("Helvetica").fontSize(9);
      let y = doc.y + 2;
      doc.text("Code", 36, y, { width: 60 }).text("Title", 96, y, { width: 200 }).text("Qty", 300, y, { width: 40, align: "right" })
        .text("MRP", 345, y, { width: 70, align: "right" }).text("Disc %", 420, y, { width: 50, align: "right" }).text("Amount", 475, y, { width: 84, align: "right" });
      doc.moveTo(36, y + 12).lineTo(559, y + 12).stroke();
      y += 16;
      for (const l of lines) {
        const gross = l.qty * l.unitMrpPaise;
        const amt = gross - Math.round((gross * l.discountBp) / 10000);
        doc.text(l.orderLine.book.code, 36, y, { width: 60 }).text(l.orderLine.book.title, 96, y, { width: 200 })
          .text(String(l.qty), 300, y, { width: 40, align: "right" }).text(formatINR(l.unitMrpPaise), 345, y, { width: 70, align: "right" })
          .text((l.discountBp / 100).toFixed(2), 420, y, { width: 50, align: "right" }).text(formatINR(amt), 475, y, { width: 84, align: "right" });
        y += 14;
      }
      doc.y = y + 6;
    }

    doc.moveDown(0.5).fontSize(10);
    const row = (k: string, v: number) => { doc.text(k, 350, doc.y, { width: 120, align: "right" }).text(formatINR(v), 475, doc.y - 12, { width: 84, align: "right" }); };
    row("Gross (MRP)", inv.grossPaise);
    row("Discount", -inv.discountPaise);
    if (inv.freightPaise) row("Freight", inv.freightPaise);
    row("Round off", inv.roundOffPaise);
    doc.font("Helvetica-Bold");
    row("Net amount", inv.netPaise);
    doc.font("Helvetica").moveDown(0.5);
    doc.text(`Amount in words: ${amountInWords(inv.netPaise)}`);
    doc.moveDown(0.5).fontSize(9).text(`Transport: ${inv.shipment.transporter ?? "-"}  Vehicle: ${inv.shipment.vehicleNo ?? "-"}  LR/Bilty: ${inv.shipment.lrNo ?? "-"}  E-way bill: ${inv.shipment.eWayBill ?? "-"}`);
    doc.text(`Boxes: ${inv.shipment.boxes ?? "-"}  Weight: ${inv.shipment.weightKg ?? "-"} kg`);
    doc.moveDown(1).text(`Bank: ${co.bank}`);
    doc.moveDown(2).text(`For ${co.name}`, { align: "right" }).moveDown(1).text(co.signatory, { align: "right" });
  });
  doc.end();
  return done;
}
