import { Link } from "react-router-dom";
import { useData, Badge, Card } from "../components/common";
import { STATUS_LABEL } from "../api";

export default function Godown() {
  const { data, error } = useData<any[]>("/godown/queue");
  return (
    <>
      <h1>Godown queue</h1>
      {error && <div className="err">{error}</div>}
      <Card>
        <div className="scroll">
          <table>
            <thead><tr><th>Order</th><th>Dealer</th><th>Status</th><th>Lines pending</th><th></th></tr></thead>
            <tbody>
              {(data ?? []).map((o) => (
                <tr key={o.id}>
                  <td>{o.number}</td><td>{o.dealer}</td>
                  <td><Badge status={o.status} /> <span className="muted">{STATUS_LABEL[o.status]}</span></td>
                  <td>{o.pendingLines}{o.hasBackorder && <span className="pill warn" style={{ marginLeft: 6 }}>backorder</span>}</td>
                  <td><Link className="btn" style={{ padding: "8px 12px", minHeight: 36 }} to={`/godown/orders/${o.id}`}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && data.length === 0 && <p className="muted">Nothing to pick right now.</p>}
      </Card>
    </>
  );
}
