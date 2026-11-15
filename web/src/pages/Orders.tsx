import { Link, useSearchParams } from "react-router-dom";
import { useState } from "react";
import { useData, Badge, Pager, Card } from "../components/common";
import { rupees, STATUS_LABEL } from "../api";
import { useAuth } from "../auth";

const FILTERS = ["", "PLACED", "ACCEPTED", "VERIFIED", "SENT_TO_GODOWN", "PICKING", "PACKED", "DISPATCHED", "BILTY_UPLOADED", "DELIVERED", "CANCELLED"];

export default function Orders() {
  const { me } = useAuth();
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page), ...(status ? { status } : {}), ...(q ? { q } : {}) }).toString();
  const { data, error } = useData<any>(`/orders?${qs}`, [status, q, page]);
  return (
    <>
      <h1>Orders</h1>
      <Card>
        <div className="row">
          <div><label>Search order no. or dealer</label><input value={q} onChange={(e) => { setPage(1); setQ(e.target.value); }} placeholder="e.g. ORD/2026-27" /></div>
          <div><label>Status</label>
            <select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
              {FILTERS.map((f) => <option key={f} value={f}>{f ? STATUS_LABEL[f] : "All"}</option>)}
            </select>
          </div>
        </div>
      </Card>
      {error && <div className="err">{error}</div>}
      <Card>
        <div className="scroll">
          <table>
            <thead><tr><th>Order</th><th>Dealer</th><th>Items</th><th>Value (MRP)</th><th>Status</th><th>Placed</th></tr></thead>
            <tbody>
              {(data?.items ?? []).map((o: any) => (
                <tr key={o.id}>
                  <td><Link to={`/orders/${o.id}`}>{o.number}</Link></td>
                  <td>{o.dealer.firmName}</td>
                  <td>{o.itemCount}</td>
                  <td>{rupees(o.grossPaise)}</td>
                  <td><Badge status={o.status} /></td>
                  <td>{new Date(o.createdAt).toLocaleDateString("en-IN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && <Pager page={data.page} pages={data.pages} onChange={setPage} />}
        {me?.role === "DEALER" && !data?.items?.length && <p className="muted">No orders yet. <Link to="/new-order">Place your first order</Link>.</p>}
      </Card>
    </>
  );
}
