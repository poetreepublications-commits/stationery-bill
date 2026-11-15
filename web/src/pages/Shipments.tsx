import { useState } from "react";
import { download, rupees } from "../api";
import { useData, Pager, Card, Badge } from "../components/common";

export default function Shipments() {
  const [page, setPage] = useState(1);
  const { data, error } = useData<any>(`/shipments?page=${page}`, [page]);
  return (
    <>
      <h1>Dispatches</h1>
      {error && <div className="err">{error}</div>}
      <Card>
        <div className="scroll"><table>
          <thead><tr><th>Shipment</th><th>Order</th><th>Invoice</th><th>Status</th><th>Dispatched</th><th></th></tr></thead>
          <tbody>{(data?.items ?? []).map((s: any) => (
            <tr key={s.id}>
              <td>{s.number}</td><td>{s.order.number}</td><td>{s.invoice?.number ?? "-"}{s.invoice && <div className="muted">{rupees(s.invoice.netPaise)}</div>}</td>
              <td>{s.receivedAt ? <Badge status="DELIVERED" /> : s.dispatchedAt ? <Badge status="DISPATCHED" /> : <Badge status="PACKED" />}</td>
              <td>{s.dispatchedAt ? new Date(s.dispatchedAt).toLocaleDateString("en-IN") : "-"}</td>
              <td>{s.invoice && <button className="btn secondary" style={{ minHeight: 34, padding: "4px 10px" }} onClick={() => download(`/invoices/${s.invoice.id}/pdf`, `${s.invoice.number.replace(/\//g, "-")}.pdf`)}>Invoice PDF</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
        {data && <Pager page={data.page} pages={data.pages} onChange={setPage} />}
      </Card>
    </>
  );
}
