import { prisma } from "../db.js";
import { HttpError } from "../lib/errors.js";

export const DEFAULTS = {
  company: {
    name: "Poetree Publications", address: "[Address]", phone: "[Phone]", email: "[Email]",
    gstin: "", bank: "[Bank name, account no., IFSC]", signatory: "Authorised Signatory",
  },
  discount_approval_limit_bp: 1000,      // 10%
  default_return_limit_qty: 0,           // 0 = none
  invoice_prefix: "INV",
  locked_fys: [] as string[],
};
export type SettingsKey = keyof typeof DEFAULTS;

export async function getSetting<K extends SettingsKey>(key: K): Promise<(typeof DEFAULTS)[K]> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return (row ? row.value : DEFAULTS[key]) as (typeof DEFAULTS)[K];
}

export async function setSetting(key: SettingsKey, value: unknown) {
  await prisma.setting.upsert({ where: { key }, create: { key, value: value as any }, update: { value: value as any } });
}

export async function assertFyOpen(fy: string) {
  const locked = await getSetting("locked_fys");
  if (locked.includes(fy)) throw new HttpError(409, `Financial year ${fy} is closed and locked`);
}
