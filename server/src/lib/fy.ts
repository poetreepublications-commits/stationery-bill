import { prisma } from "../db.js";

// Indian financial year: April to March. 2026-05-10 -> "2026-27"
export function fyOf(date: Date = new Date()): string {
  const y = date.getFullYear();
  const startYear = date.getMonth() >= 3 ? y : y - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export async function nextNumber(key: string): Promise<number> {
  const row = await prisma.counter.upsert({
    where: { key },
    create: { key, value: 1 },
    update: { value: { increment: 1 } },
  });
  return row.value;
}

// e.g. formatNumber("INV", "2026-27", 7) -> "INV/2026-27/0007"
export const formatNumber = (prefix: string, fy: string, n: number) =>
  `${prefix}/${fy}/${String(n).padStart(4, "0")}`;

export async function assignNumber(prefix: string, fy: string): Promise<string> {
  return formatNumber(prefix, fy, await nextNumber(`${prefix}:${fy}`));
}
