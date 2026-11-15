// All money is integer paise. Discounts are integer basis points (1000 = 10%).
export const bpOf = (amount: number, bp: number): number => Math.round((amount * bp) / 10000);

export function formatINR(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const rupees = Math.abs(paise) / 100;
  const [int, dec] = rupees.toFixed(2).split(".");
  // Indian grouping: last 3, then groups of 2
  let head = int.slice(0, -3);
  const tail = int.slice(-3);
  head = head.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${sign}₹${head ? head + "," : ""}${tail}.${dec}`;
}

export interface InvoiceLineInput { qty: number; unitMrpPaise: number; discountBp: number }
export interface InvoiceTotals {
  grossPaise: number; discountPaise: number; freightPaise: number;
  roundOffPaise: number; netPaise: number;
}

// Totals for an invoice. Discount is computed per line (rounded), then freight added,
// then the payable amount is rounded to the nearest rupee and the difference is round-off.
export function invoiceTotals(lines: InvoiceLineInput[], freightPaise = 0): InvoiceTotals {
  let gross = 0, discount = 0;
  for (const l of lines) {
    const lineGross = l.qty * l.unitMrpPaise;
    gross += lineGross;
    discount += bpOf(lineGross, l.discountBp);
  }
  const beforeRound = gross - discount + freightPaise;
  const rounded = Math.round(beforeRound / 100) * 100;
  return {
    grossPaise: gross,
    discountPaise: discount,
    freightPaise,
    roundOffPaise: rounded - beforeRound,
    netPaise: rounded,
  };
}

export function amountInWords(paise: number): string {
  const n = Math.round(paise / 100);
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
    "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (x: number) => x < 20 ? ones[x] : tens[Math.floor(x / 10)] + (x % 10 ? " " + ones[x % 10] : "");
  const three = (x: number) => {
    const h = Math.floor(x / 100), r = x % 100;
    return (h ? ones[h] + " Hundred" + (r ? " " : "") : "") + (r ? two(r) : "");
  };
  if (n === 0) return "Zero Rupees Only";
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000), lakh = Math.floor((n % 10000000) / 100000),
    thou = Math.floor((n % 100000) / 1000), rest = n % 1000;
  if (crore) parts.push(two(crore) + " Crore");
  if (lakh) parts.push(two(lakh) + " Lakh");
  if (thou) parts.push(two(thou) + " Thousand");
  if (rest) parts.push(three(rest));
  return parts.join(" ") + " Rupees Only";
}
