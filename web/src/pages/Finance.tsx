import { useSearchParams } from "react-router-dom";
import { useState } from "react";
import { api, download, rupees } from "../api";
import { useData, useAction, Msg, Card, Field, Pager } from "../components/common";
import { useAuth } from "../auth";

export default function Finance() {
  const { me } = useAuth();
  const [sp] = useSearchParams();
  const isDealer = me?.role === "DEALER";
  const canPost = me?.role === "SUPER_ADMIN" || me?.role === "ACCOUNTS";
  const dealers = useData<any>(canPost ? "/dealers?pageSize=100&status=ACTIVE" : null);
  const [dealerId, setDealerId] = useState<string>(sp.get("dealer") ?? (isDealer ? String(me?.dealerId) : ""));
  const ledger = useData<any>(dealerId ? `/dealers/${dealerId}/ledger` : null, [dealerId]);
  const ageing = useData<any>(dealerId && canPost ? `/dealers/${dealerId}/ageing` : null, [dealerId]);
  const [pp, setPp] = useState(1);
  const pays = useData<any>(`/payments?page=${pp}${dealerId ? `&dealerId=${dealerId}` : ""}`, [dealerId, pp]);
  const act = useAction();
  const [pay, setPay] = useState({ amount: "", mode: "NEFT", reference: "", paidOn: new Date().toISOString().slice(0, 10) });
  const [dn, setDn] = useState({ amount: "", reason: "" });

  const record = async () => {
    const r = await act.run(() => api("/payments", { body: { dealerId: Number(dealerId), amountPaise: Math.round(Number(pay.amount) * 100), mode: pay.mode, reference: pay.reference || undefined, paidOn: pay.paidOn } }), "Payment recorded and allocated to oldest invoices");
    if (r) { setPay({ ...pay, amount: "", reference: "" }); ledger.reload(); pays.reload(); }
  };
  const debit = async () => {
    const r = await act.run(() => api(`/dealers/${dealerId}/debit-notes`, { body: { amountPaise: Math.round(Number(dn.amount) * 100), reason: dn.reason } }), "Debit note raised");
    if (r) { setDn({ amount: "", reason: "" }); ledger.reload(); }
  };

  return (
    <>
      <h1>Payments &amp; ledger</h1>
      <Msg error={act.error} ok={act.ok} />
      {canPost && (
        <Card>
          <Field label="Dealer">
            <select value={dealerId} onChange={(e) => setDealerId(e.target.value)}>
              <option value="">Choose dealer…</option>
              {(dealers.data?.items ?? []).map((d: any) => <option key={d.id} value={d.id}>{d.firmName}</option>)}
            </select>
          </Field>
        </Card>
      )}
      {dealerId && (
        <>
          <Card title="Balance">
            {ledger.data && <p style={{ fontSize: 22, margin: "4px 0" }}>Outstanding <strong>{rupees(ledger.data.outstandingPaise)}</strong></p>}
            {ageing.data && <>
              <p className="muted">0–30: {rupees(ageing.data.buckets["0-30"])} · 31–60: {rupees(ageing.data.buckets["31-60"])} · 61–90: {rupees(ageing.data.buckets["61-90"])} · 90+: {rupees(ageing.data.buckets["90+"])} · On account: {rupees(ageing.data.onAccount)}</p>
              {ageing.data.overCreditLimit && <div className="err">Over credit limit ({rupees(ageing.data.creditLimitPaise)})</div>}
            </>}
            <button className="btn secondary" onClick={() => download(`/dealers/${dealerId}/ledger?format=xlsx`, `ledger-${dealerId}.xlsx`)}>Download ledger (Excel)</button>
          </Card>
          {canPost && (
            <Card title="Record payment">
              <div className="row">
                <Field label="Amount ₹"><input type="number" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></Field>
                <Field label="Mode"><select value={pay.mode} onChange={(e) => setPay({ ...pay, mode: e.target.value })}><option>NEFT</option><option>CASH</option><option>CHEQUE</option><option>UPI</option><option>OTHER</option></select></Field>
                <Field label="Reference / UTR / cheque no."><input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></Field>
                <Field label="Date"><input type="date" value={pay.paidOn} onChange={(e) => setPay({ ...pay, paidOn: e.target.value })} /></Field>
              </div>
              <button className="btn" style={{ marginTop: 10 }} disabled={act.busy || !pay.amount} onClick={record}>Record payment</button>
            </Card>
          )}
          {canPost && (
            <Card title="Debit note (adjustment)">
              <div className="row">
                <Field label="Amount ₹"><input type="number" value={dn.amount} onChange={(e) => setDn({ ...dn, amount: e.target.value })} /></Field>
                <Field label="Reason"><input value={dn.reason} onChange={(e) => setDn({ ...dn, reason: e.target.value })} /></Field>
              </div>
              <button className="btn secondary" style={{ marginTop: 10 }} disabled={act.busy || !dn.amount || dn.reason.length < 3} onClick={debit}>Raise debit note</button>
            </Card>
          )}
          <Card title="Ledger">
            <div className="scroll"><table>
              <thead><tr><th>Date</th><th>Type</th><th>Reference</th><th className="right">Debit</th><th className="right">Credit</th><th className="right">Balance</th></tr></thead>
              <tbody>{(ledger.data?.rows ?? []).map((r: any, i: number) => (
                <tr key={i}><td>{new Date(r.date).toLocaleDateString("en-IN")}</td><td>{r.type}</td><td>{r.ref}</td>
                  <td className="right">{r.debit ? rupees(r.debit) : ""}</td><td className="right">{r.credit ? rupees(r.credit) : ""}</td><td className="right">{rupees(r.balance)}</td></tr>
              ))}</tbody>
            </table></div>
          </Card>
        </>
      )}
      <Card title="Payments received">
        <div className="scroll"><table>
          <thead><tr><th>Date</th><th>Dealer</th><th>Mode</th><th>Reference</th><th className="right">Amount</th><th></th></tr></thead>
          <tbody>{(pays.data?.items ?? []).map((p: any) => (
            <tr key={p.id}><td>{new Date(p.paidOn).toLocaleDateString("en-IN")}</td><td>{p.dealer.firmName}</td><td>{p.mode}</td><td>{p.reference ?? "-"}</td><td className="right">{rupees(p.amountPaise)}</td>
              <td><button className="btn secondary" style={{ minHeight: 34, padding: "4px 10px" }} onClick={() => download(`/payments/${p.id}/receipt.pdf`, `receipt-${p.id}.pdf`)}>Receipt</button></td></tr>
          ))}</tbody>
        </table></div>
        {pays.data && <Pager page={pays.data.page} pages={pays.data.pages} onChange={setPp} />}
      </Card>
    </>
  );
}
