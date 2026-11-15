import { useParams, Link } from "react-router-dom";
import { useState } from "react";
import { api, download, rupees, STATUS_LABEL } from "../api";
import { useData, useAction, Msg, Badge, Card, Field } from "../components/common";
import { useAuth } from "../auth";

export default function OrderDetail() {
  const { id } = useParams();
  const { me } = useAuth();
  const { data, error, reload } = useData<any>(`/orders/${id}`, [id]);
  const act = useAction();
  const [discount, setDiscount] = useState<string>("");
  const [remarks, setRemarks] = useState("");
  const [override, setOverride] = useState(false);
  const [creditInfo, setCreditInfo] = useState<any>(null);
  const role = me?.role;

  if (error) return <div className="err">{error}</div>;
  if (!data) return <p>Loading…</p>;
  const o = data;
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    const r = await act.run(fn, msg);
    if (r !== undefined) await reload();
  };
  const verify = async () => {
    const body: any = { remarks: remarks || undefined, creditOverride: override };
    if (discount !== "") body.discountBp = Math.round(Number(discount) * 100);
    try {
      await act.run(() => api(`/orders/${id}/verify`, { body }), "Verified and sent to godown");
      await reload();
    } catch { /* message is in act.error */ }
  };
  const canEditLines = ["PLACED", "ACCEPTED"].includes(o.status) && (role === "DEALER" || role === "SALES" || role === "SUPER_ADMIN");

  return (
    <>
      <div className="row"><h1 style={{ margin: 0, flex: 1 }}>{o.number}</h1><Badge status={o.status} /></div>
      <p className="muted">{o.dealer.firmName} · placed {new Date(o.createdAt).toLocaleString("en-IN")}</p>
      <Msg error={act.error} ok={act.ok} />

      <Card title="Progress">
        <ol className="timeline">
          {o.history.map((h: any) => (
            <li key={h.id}>
              <strong>{STATUS_LABEL[h.toStatus]}</strong> <span className="muted">· {new Date(h.at).toLocaleString("en-IN")} · {h.userName ?? "System"}</span>
              {h.note && <div className="muted">{h.note}</div>}
            </li>
          ))}
        </ol>
      </Card>

      <Card title="Actions">
        <div className="row">
          {role === "SALES" && o.status === "PLACED" && <button className="btn" disabled={act.busy} onClick={() => run(() => api(`/orders/${id}/accept`, { body: {} }), "Accepted")}>Accept order</button>}
          {(role === "DEALER" || role === "SALES" || role === "SUPER_ADMIN") && ["PLACED", "ACCEPTED"].includes(o.status) && (
            <button className="btn danger" disabled={act.busy} onClick={() => { if (confirm("Cancel this order?")) run(() => api(`/orders/${id}/cancel`, { body: { reason: "Cancelled by user" } }), "Order cancelled"); }}>Cancel order</button>
          )}
          {role === "SUPER_ADMIN" && o.discountNeedsApproval && !o.discountApproved && (
            <button className="btn" onClick={() => run(() => api(`/orders/${id}/approve-discount`, { body: {} }), "Discount approved")}>Approve discount</button>
          )}
          {o.shipments.map((s: any) => (
            <button key={s.id} className="btn secondary" onClick={() => download(`/invoices/${s.invoice?.id}/pdf`, `${s.invoice?.number?.replace(/\//g, "-")}.pdf`)} disabled={!s.invoice}>
              Invoice {s.invoice?.number ?? ""} (PDF)
            </button>
          ))}
        </div>
        {o.discountNeedsApproval && !o.discountApproved && <p className="muted">Discount is above the limit and waits for Super Admin approval.</p>}
        {o.creditOverride && <p className="muted">Credit limit was overridden by Accounts for this order.</p>}
      </Card>

      {role === "ACCOUNTS" || role === "SUPER_ADMIN" ? (
        o.status === "ACCEPTED" && (
          <Card title="Verify (accounts)">
            <div className="row">
              <Field label={`Discount % (default ${(o.dealer.defaultDiscountBp ?? 0) / 100})`}><input type="number" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="Leave blank for default" /></Field>
              <Field label="Remarks"><input value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
            </div>
            <label><input type="checkbox" style={{ width: "auto", minHeight: 0 }} checked={override} onChange={(e) => setOverride(e.target.checked)} /> Allow over-credit-limit order (override)</label>
            <div style={{ marginTop: 10 }}><button className="btn" disabled={act.busy} onClick={verify}>Verify &amp; send to godown</button></div>
          </Card>
        )
      ) : null}

      <Card title={`Lines (${o.lines.length})`}>
        <div className="scroll">
          <table>
            <thead><tr><th>School</th><th>Code</th><th>Book</th><th className="right">Ordered</th><th className="right">Picked</th><th className="right">Shipped</th><th className="right">Backorder</th><th className="right">MRP</th></tr></thead>
            <tbody>
              {o.lines.map((l: any) => (
                <tr key={l.id}>
                  <td>{l.school.name}</td><td>{l.book.code}</td><td>{l.book.title}</td>
                  <td className="right">{l.qtyOrdered}</td><td className="right">{l.qtyPicked}</td><td className="right">{l.qtyDispatched}</td>
                  <td className="right">{l.backorderQty || "-"}</td><td className="right">{rupees(l.unitMrpPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">Gross {rupees(o.summary.grossPaise)} · Discount {(o.summary.discountBp / 100)}% · Net {rupees(o.summary.netPaise)}</p>
        {canEditLines && <p className="muted">Lines can still be changed while the order is {STATUS_LABEL[o.status]?.toLowerCase()}.</p>}
      </Card>

      {o.shipments.length > 0 && (
        <Card title="Shipments">
          {o.shipments.map((s: any) => (
            <div key={s.id} style={{ borderBottom: "1px solid var(--line)", padding: "8px 0" }}>
              <strong>{s.number}</strong> · {s.invoice?.number} · {s.transporter ?? "not dispatched"} {s.lrNo ? `· LR ${s.lrNo}` : ""} {s.vehicleNo ? `· ${s.vehicleNo}` : ""}
              <div className="muted">{s.dispatchedAt ? `Dispatched ${new Date(s.dispatchedAt).toLocaleDateString("en-IN")}` : "Packed, not dispatched"} {s.receivedAt ? `· Received ${new Date(s.receivedAt).toLocaleDateString("en-IN")}` : ""}</div>
              <div className="row" style={{ marginTop: 6 }}>
                {s.dispatchedAt && !s.receivedAt && (role === "DEALER" || role === "SALES" || role === "ACCOUNTS" || role === "SUPER_ADMIN") && (
                  <button className="btn" disabled={act.busy} onClick={() => run(() => api(`/shipments/${s.id}/receive`, { body: {} }), "Marked as received")}>Mark received</button>
                )}
                {s.biltyPath && <button className="btn secondary" onClick={() => download(`/shipments/${s.id}/bilty`, `bilty-${s.number.replace(/\//g, "-")}`)}>View bilty</button>}
              </div>
            </div>
          ))}
        </Card>
      )}
      {(data.hasBackorder && ["DISPATCHED", "BILTY_UPLOADED"].includes(data.status)) && <p className="muted">Part of this order is pending. Remaining books will be dispatched as a separate shipment with its own invoice.</p>}
      <p><Link to="/orders">← Back to orders</Link></p>
    </>
  );
}
