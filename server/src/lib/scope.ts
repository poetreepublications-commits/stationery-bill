import type { Prisma } from "@prisma/client";
import type { AuthUser } from "../middleware/auth.js";
import { forbidden } from "./errors.js";

// Row-level visibility: a sales employee sees only assigned dealers; a dealer sees only itself.
export function dealerScope(u: AuthUser): Prisma.DealerWhereInput {
  switch (u.role) {
    case "SUPER_ADMIN":
    case "ACCOUNTS":
      return {};
    case "SALES":
      return { salesEmployeeId: u.id };
    case "DEALER":
      return { id: u.dealerId ?? -1 };
    default:
      throw forbidden();
  }
}

export function orderScope(u: AuthUser): Prisma.OrderWhereInput {
  switch (u.role) {
    case "SUPER_ADMIN":
    case "ACCOUNTS":
      return {};
    case "SALES":
      return { dealer: { salesEmployeeId: u.id } };
    case "DEALER":
      return { dealerId: u.dealerId ?? -1 };
    case "GODOWN":
      return { status: { in: ["SENT_TO_GODOWN", "PICKING", "PACKED", "DISPATCHED", "BILTY_UPLOADED", "DELIVERED"] } };
  }
}
