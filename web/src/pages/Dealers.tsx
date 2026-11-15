import { Link } from "react-router-dom";
import { useState } from "react";
import { api } from "../api";
import { useData, Badge, Pager, Card, Msg, useAction, Field } from "../components/common";
import { useAuth } from "../auth";

export default function Dealers() {
  const { me } = useAuth();
  const [q, setQ] = useState(""); const [status, setStatus] = useState(""); const [page, setPage] = useState(1);
  const { data, error, reload } = useData<any>(`/dealers?page=${page}&q=${encodeURIComponent(q)}&status=${status}`, [q, status, page]);
  const [adding, setAdding] = useState(false);
  const act = useAction();
  const [f, setF] = useState<any>({ firmName: "", type: "SCHOOL", ownerName: "", mobile: "", email: "", city: "", state: "", pincode: "", address: "", gstin: "", pan: "" });
  const fin = me?.role === "SUPER_ADMIN" || me?.role === "ACCOUNTS";
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const add = async () => {
    const r = await act.run(() => api("/dealers", { body: { ...f, email: f.email || undefined } }), fin ? "Dealer created" : "Dealer added — waiting for Accounts approval");
    if (r) { setAdding(false); setF({ ...f, firmName: "", ownerName: "", mobile: "", email: "" }); reload(); }
  };
  const approve = async (id: number) => { await act.run(() => api(`/dealers/${id}/approve`, { body: {} }), "Approved"); reload(); };

  return (
    <>
      <div className="row"><h1 style={{ margin: 0, flex: 1 }}>Dealers</h1><button className="btn" onClick={() => setAdding(!adding)}>{adding ? "Close" : "+ Add dealer"}</button></div>
      <Msg error={act.error} ok={act.ok} />
      {adding && (
        <Card title="New dealer">
          <div className="row">
            <Field label="Firm / school name"><input value={f.firmName} onChange={set("firmName")} /></Field>
            <Field label="Type"><select value={f.type} onChange={set("type")}><option value="SCHOOL">School</option><option value="BOOKSELLER">Bookseller</option></select></Field>
            <Field label="Owner name"><input value={f.ownerName} onChange={set("ownerName")} /></Field>
          </div>
          <div className="row">
            <Field label="Mobile"><input value={f.mobile} onChange={set("mobile")} /></Field>
            <Field label="Email (for login)"><input value={f.email} onChange={set("email")} /></Field>
            <Field label="City"><input value={f.city} onChange={set("city")} /></Field>
            <Field label="State"><input value={f.state} onChange={set("state")} /></Field>
          </div>
          <div className="row">
            <Field label="Address"><input value={f.address} onChange={set("address")} /></Field>
            <Field label="Pincode"><input value={f.pincode} onChange={set("pincode")} /></Field>
            <Field label="GSTIN / PAN (optional)"><input value={f.gstin} onChange={set("gstin")} /></Field>
          </div>
          <p className="muted">Login password for the dealer (optional, min 8 chars) can be set after creation by Super Admin. Credit, discount and return limits are set in Terms.</p>
          <button className="btn" style={{ marginTop: 10 }} disabled={act.busy} onClick={add}>Save dealer</button>
        </Card>
      )}
      <Card>
        <div className="row">
          <div><label>Search name, city or mobile</label><input value={q} onChange={(e) => { setPage(1); setQ(e.target.value); }} /></div>
          <div><label>Status</label><select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}><option value="">All</option><option value="PENDING">Pending approval</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></div>
        </div>
      </Card>
      {error && <div className="err">{error}</div>}
      <Card>
        <div className="scroll">
          <table>
            <thead><tr><th>Dealer</th><th>Type</th><th>City</th><th>Sales</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {(data?.items ?? []).map((d: any) => (
                <tr key={d.id}>
                  <td><Link to={`/dealers/${d.id}`}>{d.firmName}</Link><div className="muted">{d.ownerName} · {d.mobile}</div></td>
                  <td>{d.type.toLowerCase()}</td><td>{d.city}</td><td>{d.salesEmployee?.name ?? "-"}</td>
                  <td><Badge status={d.status} /></td>
                  <td>{fin && d.status === "PENDING" && <button className="btn" style={{ minHeight: 36, padding: "6px 12px" }} onClick={() => approve(d.id)}>Approve</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && <Pager page={data.page} pages={data.pages} onChange={setPage} />}
      </Card>
    </>
  );
}
