import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "../api";

export function useData<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try { setData(await api<T>(path)); setError(null); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}

export function Msg({ error, ok }: { error?: string | null; ok?: string | null }) {
  if (error) return <div className="err" role="alert">{error}</div>;
  if (ok) return <div className="ok-msg" role="status">{ok}</div>;
  return null;
}

export function Badge({ status }: { status: string }) {
  const cls = /DELIVERED|APPROVED|ACTIVE|VERIFIED|RECEIVED/.test(status) ? "ok"
    : /CANCEL|REJECT|PENDING|INACTIVE/.test(status) ? "bad" : "warn";
  return <span className={`pill ${cls}`}>{status.replace(/_/g, " ").toLowerCase()}</span>;
}

export function Pager({ page, pages, onChange }: { page: number; pages: number; onChange: (p: number) => void }) {
  return (
    <div className="pager">
      <button className="btn secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>Prev</button>
      <span className="muted">Page {page} of {pages}</span>
      <button className="btn secondary" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</button>
    </div>
  );
}

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card">
      {(title || actions) && <div className="row" style={{ marginBottom: 8 }}><h2 style={{ margin: 0, flex: 1 }}>{title}</h2>{actions}</div>}
      {children}
    </section>
  );
}

// Run an async action and surface errors (including 409 messages from business rules).
export function useAction() {
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
    setBusy(true); setError(null); setOk(null);
    try { const r = await fn(); if (success) setOk(success); return r; }
    catch (e) { setError(e instanceof ApiError ? e.message : "Something went wrong"); }
    finally { setBusy(false); }
    return undefined;
  };
  return { error, ok, busy, run, setError, setOk };
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div><label>{label}</label>{children}</div>;
}
