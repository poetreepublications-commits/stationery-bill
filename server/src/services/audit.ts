import { prisma } from "../db.js";

// Records who changed what, with old and new values.
export async function audit(
  userId: number | null | undefined,
  entity: string,
  entityId: number | string,
  action: string,
  oldValue: unknown = null,
  newValue: unknown = null,
) {
  await prisma.auditLog.create({
    data: {
      userId: userId ?? null,
      entity,
      entityId: String(entityId),
      action,
      oldValue: (oldValue ?? undefined) as any,
      newValue: (newValue ?? undefined) as any,
    },
  });
}
