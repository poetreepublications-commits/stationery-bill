import { useState } from "react";
import { api, rupees } from "../api";
import { useData, useAction, Msg, Pager, Card, Field } from "../components/common";
import { useAuth } from "../auth";

export default function Books() {
  const { me } = useAuth();
  const [tab, setTab] = useState<"stock" | "catalogue" | "sets">("stock");
  return (
    <>
      <h1>Books &amp; stock</h1>
      <div className="tabs">
        {(["stock", "catalogue", "sets"] as const).map((k) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{k === "stock" ? "Stock" : k === "catalogue" ? "Catalogue" : "Class sets"}</button>)}
      </div>
      {tab === "stock" && <StockTab canEdit={me?.role !== "SALES"} />}
      {tab === "catalogue" && <Catalogue canEdit={me?.role === "SUPER_ADMIN" || me?.role === "ACCOUNTS"} />}
      {tab === "sets" && <Sets canEdit={me?.role === "SUPER_ADMIN" || me?.role === "ACCOUNTS"} />}
    </>
  );
}

function StockTab({ canEdit }: { canEdit: boolean }) {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const { data, error, reload } = useData<any>(`/stock?page=${page}&q=${encodeURIComponent(q)}`, [page, q]);
  const books = useData<any>("/books?pageSize=100");
  const act = useAction();
  const [mv, setMv] = useState({ bookId: "", qty: "", reason: "", type: "RECEIPT" });
  const submit = async () => {
    const path = mv.type === "RECEIPT" ? "/stock/receipt" : "/stock/adjust";
    const qty = mv.type === "ADJUST" ? Number(mv.qty) : Math.abs(Number(mv.qty));
    const r = await act.run(() => api(path, { body: { bookId: Number(mv.bookId), qty, reason: mv.reason, ...(mv.type === "OPENING" ? { type: "OPENING" } : {}) } }), "Stock updated");
    if (r) { setMv({ ...mv, qty: "", reason: "" }); reload(); }
  };
  return (
    <>
      {data && data.lowStockCount > 0 && <div className="err">{data.lowStockCount} book(s) at or below reorder level.</div>}
      <Msg error={act.error} ok={act.ok} />
      {canEdit && (
        <Card title="Receive from printing / adjust">
          <div className="row">
            <Field label="Book"><select value={mv.bookId} onChange={(e) => setMv({ ...mv, bookId: e.target.value })}><option value="">Choose…</option>{(books.data?.items ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.code} · {b.title}</option>)}</select></Field>
            <Field label="Type"><select value={mv.type} onChange={(e) => setMv({ ...mv, type: e.target.value })}><option value="RECEIPT">Receipt from printing (+)</option><option value="ADJUST">Adjustment (+/−)</option><option value="OPENING">Opening stock (+)</option></select></Field>
            <Field label="Qty"><input type="number" value={mv.qty} onChange={(e) => setMv({ ...mv, qty: e.target.value })} /></Field>
            <Field label="Reason"><input value={mv.reason} onChange={(e) => setMv({ ...mv, reason: e.target.value })} placeholder="e.g. Batch 12 printed" /></Field>
          </div>
          <button className="btn" style={{ marginTop: 10 }} disabled={act.busy || !mv.bookId || !mv.qty || mv.reason.length < 3} onClick={submit}>Save stock entry</button>
        </Card>
      )}
      <Card>
        <Field label="Search"><input value={q} onChange={(e) => { setPage(1); setQ(e.target.value); }} /></Field>
        {error && <div className="err">{error}</div>}
        <div className="scroll"><table>
          <thead><tr><th>Code</th><th>Title</th><th>Class</th><th className="right">On hand</th><th className="right">Reorder at</th><th></th></tr></thead>
          <tbody>{(data?.items ?? []).map((b: any) => (
            <tr key={b.id}><td>{b.code}</td><td>{b.title}</td><td>{b.className}</td><td className="right">{b.onHand}</td><td className="right">{b.reorderLevel}</td>
              <td>{b.lowStock && <span className="pill bad">low</span>}</td></tr>
          ))}</tbody>
        </table></div>
        {data && <Pager page={data.page} pages={data.pages} onChange={setPage} />}
      </Card>
    </>
  );
}

function Catalogue({ canEdit }: { canEdit: boolean }) {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [isbn, setIsbn] = useState("");
  const { data, error, reload } = useData<any>(`/books?page=${page}&q=${encodeURIComponent(q)}`, [page, q]);
  const act = useAction();
  const blank = { code: "", title: "", isbn: "", className: "", subject: "", mrp: "", hsn: "", reorderLevel: "0" };
  const [b, setB] = useState<any>(blank);
  const lookup = async () => { if (!isbn) return; const r = await api<any>(`/books?isbn=${encodeURIComponent(isbn)}`); if (r.items?.[0]) setQ(r.items[0].code); else act.setError("No book with that ISBN"); };
  const save = async () => {
    const r = await act.run(() => api("/books", { body: { code: b.code, title: b.title, isbn: b.isbn || null, className: b.className || undefined, subject: b.subject || undefined, mrpPaise: Math.round(Number(b.mrp) * 100), hsn: b.hsn || undefined, reorderLevel: Number(b.reorderLevel) } }), "Book added");
    if (r) { setB(blank); reload(); }
  };
  return (
    <>
      <Msg error={act.error} ok={act.ok} />
      {canEdit && (
        <Card title="Add book">
          <div className="row">
            <Field label="Code"><input value={b.code} onChange={(e) => setB({ ...b, code: e.target.value })} /></Field>
            <Field label="Title"><input value={b.title} onChange={(e) => setB({ ...b, title: e.target.value })} /></Field>
            <Field label="ISBN barcode"><input value={b.isbn} onChange={(e) => setB({ ...b, isbn: e.target.value })} /></Field>
          </div>
          <div className="row">
            <Field label="Class"><input value={b.className} onChange={(e) => setB({ ...b, className: e.target.value })} /></Field>
            <Field label="Subject"><input value={b.subject} onChange={(e) => setB({ ...b, subject: e.target.value })} /></Field>
            <Field label="MRP ₹"><input type="number" value={b.mrp} onChange={(e) => setB({ ...b, mrp: e.target.value })} /></Field>
            <Field label="HSN"><input value={b.hsn} onChange={(e) => setB({ ...b, hsn: e.target.value })} /></Field>
            <Field label="Reorder level"><input type="number" value={b.reorderLevel} onChange={(e) => setB({ ...b, reorderLevel: e.target.value })} /></Field>
          </div>
          <button className="btn" style={{ marginTop: 10 }} disabled={act.busy || !b.code || !b.title || !b.mrp} onClick={save}>Save book</button>
        </Card>
      )}
      <Card>
        <div className="row">
          <Field label="Search title, code or ISBN"><input value={q} onChange={(e) => { setPage(1); setQ(e.target.value); }} /></Field>
          <Field label="Look up by ISBN"><input value={isbn} onChange={(e) => setIsbn(e.target.value)} onKeyDown={(e) => e.key === "Enter" && lookup()} /></Field>
        </div>
        {error && <div className="err">{error}</div>}
        <div className="scroll"><table>
          <thead><tr><th>Code</th><th>ISBN</th><th>Title</th><th>Class</th><th className="right">MRP</th><th className="right">Stock</th></tr></thead>
          <tbody>{(data?.items ?? []).map((x: any) => <tr key={x.id}><td>{x.code}</td><td>{x.isbn}</td><td>{x.title}</td><td>{x.className}</td><td className="right">{rupees(x.mrpPaise)}</td><td className="right">{x.onHand}</td></tr>)}</tbody>
        </table></div>
        {data && <Pager page={data.page} pages={data.pages} onChange={setPage} />}
      </Card>
    </>
  );
}

function Sets({ canEdit }: { canEdit: boolean }) {
  const sets = useData<any[]>("/book-sets");
  const books = useData<any>("/books?pageSize=100");
  const act = useAction();
  const [name, setName] = useState(""); const [cls, setCls] = useState("");
  const [items, setItems] = useState<{ bookId: string; qty: number }[]>([]);
  const save = async () => {
    const r = await act.run(() => api("/book-sets", { body: { name, className: cls || undefined, items: items.map((i) => ({ bookId: Number(i.bookId), qty: i.qty })) } }), "Set saved");
    if (r) { setName(""); setCls(""); setItems([]); sets.reload(); }
  };
  return (
    <>
      <Msg error={act.error} ok={act.ok} />
      {canEdit && (
        <Card title="New class set">
          <div className="row"><Field label="Set name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Class 4 Full Set" /></Field><Field label="Class"><input value={cls} onChange={(e) => setCls(e.target.value)} /></Field></div>
          {items.map((it, i) => (
            <div className="row" key={i}>
              <Field label="Book"><select value={it.bookId} onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, bookId: e.target.value } : x))}><option value="">Choose…</option>{(books.data?.items ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.code} · {b.title}</option>)}</select></Field>
              <Field label="Qty per student"><input type="number" value={it.qty} onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, qty: Number(e.target.value) } : x))} /></Field>
            </div>
          ))}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn secondary" onClick={() => setItems([...items, { bookId: "", qty: 1 }])}>+ Add book to set</button>
            <button className="btn" disabled={act.busy || !name || items.length === 0 || items.some((i) => !i.bookId)} onClick={save}>Save set</button>
          </div>
        </Card>
      )}
      <Card>
        {(sets.data ?? []).map((s: any) => (
          <div key={s.id} style={{ borderBottom: "1px solid var(--line)", padding: "8px 0" }}>
            <strong>{s.name}</strong> <span className="muted">{s.items.length} books</span>
            <div className="muted">{s.items.map((i: any) => `${i.book.code} ×${i.qty}`).join(" · ")}</div>
          </div>
        ))}
      </Card>
    </>
  );
}
