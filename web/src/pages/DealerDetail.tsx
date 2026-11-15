import { useParams, Link } from "react-router-dom";
import { useState } from "react";
import { api, rupees } from "../api";
import { useData, useAction, Msg, Badge, Card, Field } from "../components/common";
import { useAuth } from "../auth";

export default function DealerDetail() {
  const { id } = useParams();
  const { me } = useAuth();
  const fin = me?.role === "SUPER_ADMIN" || me?.role === "ACCOUNTS";
  const { data, error, reload } = useData<any>(`/dealers/${id}`, [id]);
  const schools = useData<any[]>(`/dealers/${id}/schools`, [id]);
  const terms = useData<any>(`/dealers/${id}/terms`, [id]);
  const ageing = useData<any>(`/dealers/${id}/ageing`, [id]);
  const act = useAction();
  const [school, setSchool] = useState({ name: "", board: "", address: "", contact: "" });
  const [t, setT] = useState<any>(null);
  if (error) return <div className="err">{error}</div>;
  if (!data) return <p>Loading…</p>;

  const addSchool = async () => {
    const r = await act.run(() => api(`/dealers/${id}/schools`, { body: school }), "School added");
    if (r) { setSchool({ name: "", board: "", address: "", contact: "" }); schools.reload(); }
  };
  const startTerms = () => setT(terms.data?.latest ? { discountBp: terms.data.latest.discountBp, creditLimitPaise: terms.data.latest.creditLimitPaise, creditDays: terms.data.latest.creditDays, returnLimitQty: terms.data.latest.returnLimitQty, paymentTerms: terms.data.latest.paymentTerms ?? "", returnPolicy: terms.data.latest.returnPolicy ?? "", clauses: terms.data.latest.clauses ?? "" } : { discountBp: 1000, creditLimitPaise: 0, creditDays: 30, returnLimitQty: 0, paymentTerms: "", returnPolicy: "", clauses: "" });
  const saveTerms = async () => {
    const r = await act.run(() => api(`/dealers/${id}/terms`, { body: { ...t, discountBp: Number(t.discountBp), creditLimitPaise: Math.round(Number(t.creditLimitPaise)), creditDays: Number(t.creditDays), returnLimitQty: Number(t.returnLimitQty) } }), "New terms version issued — dealer must accept again");
    if (r) { setT(null); terms.reload(); reload(); }
  };
  const approve = async () => { await act.run(() => api(`/dealers/${id}/approve`, { body: {} }), "Dealer approved"); reload(); };
  const setT2 = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setT({ ...t, [k]: e.target.value });

  return (
    <>
      <div className="row"><h1 style={{ margin: 0, flex: 1 }}>{data.firmName}</h1><Badge status={data.status} /></div>
      <p className="muted">{data.type.toLowerCase()} · {data.ownerName} · {data.mobile} · {data.email ?? "no email"} · {data.city}, {data.state} {data.pincode}</p>
      <Msg error={act.error} ok={act.ok} />
      <div className="row">
        {fin && data.status === "PENDING" && <button className="btn" onClick={approve}>Approve dealer</button>}
        <Link className="btn secondary" to={`/new-order`} style={{ textDecoration: "none" }}>Place order</Link>
        {fin && <Link className="btn secondary" to={`/finance?dealer=${id}`} style={{ textDecoration: "none" }}>Ledger &amp; payments</Link>}
      </div>

      <Card title="Commercial terms">
        {terms.data?.latest ? (
          <>
            <p>Version {terms.data.latest.version} · discount {terms.data.latest.discountBp / 100}% · credit limit {rupees(terms.data.latest.creditLimitPaise)} · credit days {terms.data.latest.creditDays} · return limit {terms.data.latest.returnLimitQty} copies/year</p>
            {terms.data.changes?.length > 0 && <div className="muted">Changed from previous: {terms.data.changes.map((c: any) => `${c.field} ${c.from} → ${c.to}`).join("; ")}</div>}
            <p className="muted">Dealer acceptance: {terms.data.accepted === null ? "—" : terms.data.accepted ? "accepted" : "pending"}</p>
          </>
        ) : <p className="muted">No terms issued yet. Ordering is blocked until terms are issued and accepted.</p>}
        {fin && (t ? (
          <>
            <div className="row">
              <Field label="Discount %"><input type="number" step="0.01" value={t.discountBp / 100} onChange={(e) => setT({ ...t, discountBp: Math.round(Number(e.target.value) * 100) })} /></Field>
              <Field label="Credit limit ₹"><input type="number" value={t.creditLimitPaise / 100} onChange={(e) => setT({ ...t, creditLimitPaise: Number(e.target.value) * 100 })} /></Field>
              <Field label="Credit days"><input type="number" value={t.creditDays} onChange={setT2("creditDays")} /></Field>
              <Field label="Return limit (copies / year, 0 = none)"><input type="number" value={t.returnLimitQty} onChange={setT2("returnLimitQty")} /></Field>
            </div>
            <Field label="Payment terms"><input value={t.paymentTerms} onChange={setT2("paymentTerms")} /></Field>
            <Field label="Return policy"><textarea rows={3} value={t.returnPolicy} onChange={setT2("returnPolicy")} /></Field>
            <Field label="Other clauses"><textarea rows={3} value={t.clauses} onChange={setT2("clauses")} /></Field>
            <div className="row" style={{ marginTop: 10 }}><button className="btn" onClick={saveTerms} disabled={act.busy}>Issue new version</button><button className="btn secondary" onClick={() => setT(null)}>Cancel</button></div>
          </>
        ) : <button className="btn secondary" onClick={startTerms}>{terms.data?.latest ? "Issue new version" : "Issue first terms"}</button>)}
        {terms.data?.versions?.length > 1 && <details style={{ marginTop: 10 }}><summary>Version history ({terms.data.versions.length})</summary>
          <ul>{terms.data.versions.map((v: any) => <li key={v.id}>v{v.version} · {new Date(v.effectiveFrom).toLocaleDateString("en-IN")} · discount {v.discountBp / 100}% · accepted by {v.acceptances.length}</li>)}</ul></details>}
      </Card>

      <Card title={`Schools (${schools.data?.length ?? 0})`}>
        {data.type === "SCHOOL" ? <p className="muted">School-type dealer: this school is the dealer itself.</p> : (
          <>
            <table><thead><tr><th>School</th><th>Board</th><th>Contact</th></tr></thead>
              <tbody>{(schools.data ?? []).map((s: any) => <tr key={s.id}><td>{s.name}</td><td>{s.board}</td><td>{s.contact}</td></tr>)}</tbody></table>
            <div className="row" style={{ marginTop: 10 }}>
              <Field label="School name"><input value={school.name} onChange={(e) => setSchool({ ...school, name: e.target.value })} /></Field>
              <Field label="Board"><input value={school.board} onChange={(e) => setSchool({ ...school, board: e.target.value })} /></Field>
              <Field label="Contact"><input value={school.contact} onChange={(e) => setSchool({ ...school, contact: e.target.value })} /></Field>
              <button className="btn" onClick={addSchool} disabled={!school.name || act.busy}>Add school</button>
            </div>
          </>
        )}
      </Card>

      {fin && ageing.data && (
        <Card title="Balance">
          <p>Outstanding <strong>{rupees(ageing.data.outstanding)}</strong> {ageing.data.overCreditLimit && <span className="pill bad">over credit limit</span>}</p>
          <p className="muted">0–30: {rupees(ageing.data.buckets["0-30"])} · 31–60: {rupees(ageing.data.buckets["31-60"])} · 61–90: {rupees(ageing.data.buckets["61-90"])} · 90+: {rupees(ageing.data.buckets["90+"])} · On account: {rupees(ageing.data.onAccount)}</p>
        </Card>
      )}
    </>
  );
}
