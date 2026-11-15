// Pure order status rules. Kept free of I/O so it can be unit tested.
export const ORDER_STATUSES = [
  "PLACED", "ACCEPTED", "VERIFIED", "SENT_TO_GODOWN", "PICKING", "PACKED",
  "DISPATCHED", "BILTY_UPLOADED", "DELIVERED", "CANCELLED",
] as const;
export type OrderStatus = typeof ORDER_STATUSES[number];

// Which statuses allow the dealer / sales to edit lines or cancel.
export const EDITABLE_STATUSES: OrderStatus[] = ["PLACED", "ACCEPTED"];

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PLACED: ["ACCEPTED", "CANCELLED"],
  ACCEPTED: ["VERIFIED", "CANCELLED"],
  VERIFIED: ["SENT_TO_GODOWN"],
  SENT_TO_GODOWN: ["PICKING"],
  PICKING: ["PACKED", "PICKING"],
  PACKED: ["DISPATCHED"],
  DISPATCHED: ["BILTY_UPLOADED", "DELIVERED", "PICKING"],
  BILTY_UPLOADED: ["DELIVERED", "PICKING"],
  DELIVERED: [],
  CANCELLED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal order status change ${from} -> ${to}`);
  }
}

export const isEditable = (s: OrderStatus) => EDITABLE_STATUSES.includes(s);

// Discount above the configured limit needs Super Admin approval before verification.
export function needsDiscountApproval(discountBp: number, limitBp: number): boolean {
  return discountBp > limitBp;
}

// Credit check: a dealer with a credit limit cannot exceed it without an explicit override.
export function exceedsCredit(outstandingPaise: number, orderNetPaise: number, creditLimitPaise: number): boolean {
  return creditLimitPaise > 0 && outstandingPaise + orderNetPaise > creditLimitPaise;
}
