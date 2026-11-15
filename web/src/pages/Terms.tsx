import { useData, useAction, Msg, Card } from "../components/common";
import { api } from "../api";
import { useAuth } from "../auth";

// Dealer view: read the latest terms (with changes highlighted) and accept them.
export default function Terms() {
  const { me } = useAuth();
  const { data, error, reload } = useData<any>(me?.dealerId ? `/dealers/${me.dealerId}/terms` : null, [me?.dealerId]);
  const act = useAction();
  if (!me?.dealerId) return <p className="muted">Terms are shown to dealers.</p>;
  if (error) return <div className="err">{error}</div>;
  if (!data) return <p>Loading…</p>;
  const l = data.latest;
  return (
    <>
      <h1>Terms &amp; conditions</h1>
      <Msg error={act.error} ok={act.ok} />
      {!l ? <p className="muted">Accounts has not issued terms yet.</p> : (
        <Card title={`Version ${l.version}`}>
          {data.changes.length > 0 && (
            <div className="err" style={{ background: "#fff1d6", color: "#7a4a00" }}>
              Changed since your last version:
              <ul>{data.changes.map((c: any) => <li key={c.field}><strong>{c.field}</strong>: {String(c.from)} → <strong>{String(c.to)}</strong></li>)}</ul>
            </div>
          )}
          <ul>
            <li>Discount: {l.discountBp / 100}%</li>
            <li>Credit days: {l.creditDays}</li>
            <li>Return limit: {l.returnLimitQty} copies per year</li>
            {l.paymentTerms && <li>Payment: {l.paymentTerms}</li>}
            {l.returnPolicy && <li>Returns: {l.returnPolicy}</li>}
            {l.clauses && <li>{l.clauses}</li>}
          </ul>
          {data.accepted ? <p className="ok-msg">Accepted on {new Date(data.acceptedAt).toLocaleString("en-IN")}</p> : (
            <button className="btn" disabled={act.busy} onClick={async () => { const r = await act.run(() => api(`/dealers/${me.dealerId}/terms/accept`, { body: {} }), "Thank you — terms accepted"); if (r) reload(); }}>I accept these terms</button>
          )}
        </Card>
      )}
    </>
  );
}
