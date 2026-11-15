// Small API client. Access token in memory + refresh token in localStorage (per-browser login).
let access: string | null = null;
const RT = "poetree_refresh";

export const setAccess = (t: string | null) => { access = t; };
export const getRefresh = () => { try { return localStorage.getItem(RT); } catch { return null; } };
export const setRefresh = (t: string | null) => {
  try { t ? localStorage.setItem(RT, t) : localStorage.removeItem(RT); } catch { /* private mode */ }
};

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: any) { super(message); }
}

async function refreshAccess(): Promise<boolean> {
  const rt = getRefresh();
  if (!rt) return false;
  const r = await fetch("/api/auth/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken: rt }) });
  if (!r.ok) { setRefresh(null); return false; }
  const j = await r.json();
  setAccess(j.accessToken); setRefresh(j.refreshToken);
  return true;
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const doFetch = () => fetch(`/api${path}`, {
    method: opts.method ?? (opts.body || opts.form ? "POST" : "GET"),
    headers: {
      ...(opts.body && !opts.form ? { "content-type": "application/json" } : {}),
      ...(access ? { authorization: `Bearer ${access}` } : {}),
    },
    body: opts.form ?? (opts.body ? JSON.stringify(opts.body) : undefined),
  });
  let r = await doFetch();
  if (r.status === 401 && !path.startsWith("/auth/") && (await refreshAccess())) r = await doFetch();
  const ct = r.headers.get("content-type") ?? "";
  const data = ct.includes("application/json") ? await r.json() : await r.blob();
  if (!r.ok) throw new ApiError(r.status, (data as any)?.message ?? "Request failed", (data as any)?.details);
  return data as T;
}

export async function download(path: string, filename: string) {
  const r = await fetch(`/api${path}`, { headers: access ? { authorization: `Bearer ${access}` } : {} });
  if (!r.ok) throw new ApiError(r.status, "Download failed");
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export const rupees = (paise: number | null | undefined) =>
  paise == null ? "-" : (paise < 0 ? "-" : "") + "₹" + Math.abs(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const STATUS_LABEL: Record<string, string> = {
  PLACED: "Placed", ACCEPTED: "Accepted by sales", VERIFIED: "Verified", SENT_TO_GODOWN: "Sent to godown",
  PICKING: "Picking", PACKED: "Packed", DISPATCHED: "Dispatched", BILTY_UPLOADED: "Bilty uploaded",
  DELIVERED: "Delivered", CANCELLED: "Cancelled",
};
