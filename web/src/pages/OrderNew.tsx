import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { api, rupees } from "../api";
import { useData, useAction, Msg, Field, Card } from "../components/common";
import { useAuth } from "../auth";

type Line = { key: number; schoolId: string; bookId: string; setId: string; qty: number };
interface Book { id: number; code: string; title: string; className: string; mrpPaise: number; isbn: string | null }

export default function OrderNew() {
  const nav = useNavigate();
  const { me } = useAuth();
  const isDealer = me?.role === "DEALER";
  const dealers = useData<any>(isDealer ? null : "/dealers?pageSize=100");
  const [dealerId, setDealerId] = useState<string>(me?.dealerId ? String(me.dealerId) : "");
  const dealer = isDealer ? null : (dealers.data?.items ?? []).find((d: any) => String(d.id) === dealerId);
  const schools = useData<any[]>(dealerId ? `/dealers/${dealerId}/schools` : null, [dealerId]);
  const books = useData<any>("/books?pageSize=100");
  const sets = useData<any[]>("/book-sets");
  const [lines, setLines] = useState<Line[]>([{ key: 1, schoolId: "", bookId: "", setId: "", qty: 1 }]);
  const [search, setSearch] = useState("");
  const act = useAction();

  const update = (key: number, patch: Partial<Line>) => setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const total = useMemo(() => lines.reduce((s, l) => {
    const b = (books.data?.items ?? []).find((x: Book) => String(x.id) === l.bookId);
    return s + (b ? b.mrpPaise * l.qty : 0);
  }, 0), [lines, books.data]);

  const filtered: Book[] = (books.data?.items ?? []).filter((b: Book) => !search || `${b.title} ${b.code} ${b.isbn ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  const schoolsList = schools.data ?? [];
  const isSchool = (dealer?.type ?? me?.dealerType) === "SCHOOL";

  const submit = async () => {
    const payload = lines.filter((l) => l.bookId || l.setId).map((l) => ({
      schoolId: l.schoolId ? Number(l.schoolId) : undefined,
      ...(l.setId ? { setId: Number(l.setId) } : { bookId: Number(l.bookId) }),
      qty: l.qty,
    }));
    const r = await act.run(() => api("/orders", { body: { dealerId: isDealer ? undefined : Number(dealerId), lines: payload } }), "Order placed");
    if (r) nav(`/orders/${(r as any).id}`);
  };

  return (
    <>
      <h1>New order</h1>
      <Card>
        {!isDealer && (
          <Field label="Dealer">
            <select value={dealerId} onChange={(e) => setDealerId(e.target.value)}>
              <option value="">Choose dealer…</option>
              {(dealers.data?.items ?? []).map((d: any) => <option key={d.id} value={d.id}>{d.firmName} ({d.type.toLowerCase()})</option>)}
            </select>
          </Field>
        )}
        <p className="muted">Quick order: pick a class set to fill all its books at once.</p>
        <div className="row">
          {(sets.data ?? []).map((s: any) => (
            <button key={s.id} className="btn secondary" onClick={() => setLines([...lines, { key: Date.now(), schoolId: "", bookId: "", setId: String(s.id), qty: 1 }])}>+ {s.name}</button>
          ))}
        </div>
      </Card>
      <Card title="Books">
        <Field label="Search books (title, code or ISBN)"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type to filter" /></Field>
        {lines.map((l, i) => (
          <div key={l.key} className="row" style={{ borderBottom: "1px solid var(--line)", padding: "10px 0" }}>
            {!isSchool && (
              <div><label>School</label>
                <select value={l.schoolId} onChange={(e) => update(l.key, { schoolId: e.target.value })}>
                  <option value="">Choose school…</option>
                  {schoolsList.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
            {l.setId ? (
              <div><label>Set</label><input disabled value={(sets.data ?? []).find((s: any) => String(s.id) === l.setId)?.name ?? ""} /></div>
            ) : (
              <div><label>Book</label>
                <select value={l.bookId} onChange={(e) => update(l.key, { bookId: e.target.value })}>
                  <option value="">Choose book…</option>
                  {filtered.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.title} · {rupees(b.mrpPaise)}</option>)}
                </select>
              </div>
            )}
            <div style={{ flex: "0 0 110px" }}><label>Qty {l.setId ? "(sets)" : ""}</label>
              <input type="number" min={1} value={l.qty} onChange={(e) => update(l.key, { qty: Math.max(1, Number(e.target.value)) })} />
            </div>
            <button className="btn danger" style={{ flex: "0 0 auto" }} onClick={() => setLines(lines.filter((x) => x.key !== l.key))} aria-label={`Remove line ${i + 1}`}>Remove</button>
          </div>
        ))}
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn secondary" onClick={() => setLines([...lines, { key: Date.now(), schoolId: "", bookId: "", setId: "", qty: 1 }])}>+ Add book</button>
          <div className="right" style={{ flex: 1 }}><span className="muted">Total at MRP (before discount)</span><div style={{ fontSize: 22, fontWeight: 700 }}>{rupees(total)}</div></div>
        </div>
      </Card>
      <Msg error={act.error} />
      <button className="btn" style={{ width: "100%" }} disabled={act.busy || (!isDealer && !dealerId) || lines.every((l) => !l.bookId && !l.setId)} onClick={submit}>
        {act.busy ? "Placing…" : "Place order"}
      </button>
    </>
  );
}
