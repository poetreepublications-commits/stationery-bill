import { useState } from "react";
import { api, rupees } from "../api";
import { useData, useAction, Msg, Badge, Card, Field, Pager } from "../components/common";
import { useAuth } from "../auth";

export default function Returns() {
  const { me } = useAuth();
  const role = me?.role!;
  const [page, setPage] = useState(1);
  const { data, error, reload } = useData<any>(`/returns?page=${page}`, [page]);
  const books = useData<any>("/books?pageSize=100");
  const dealers = useData<any>(["SALES", "ACCOUNTS", "SUPER_ADMIN"].includes(role) ? "/dealers?pageSize=100&status=ACTIVE" : null);
  const act = useAction();
  const [dealerId, setDealerId] = useState("");
  const [reason, setReason] = useState("");
  const [rl, setRl] = useState<{ bookId: string; qty: number }[]>([{ bookId: "", qty: 1 }]);
  const [override, setOverride] = useState(false);
  const [limit, setLimit] = useState<any>(null);
  const [active, setActive] = useState<any>(null);
  const [recv, setRecv] = useState<Record<number, number>>({});
  const [appr, setAppr] = useState<Record<number, number>>({});
  const canCreate = ["DEALER", "SALES", "ACCOUNTS", "SUPER_ADMIN"].includes(role);
  const canFin = role === "ACCOUNTS" || role === "SUPER_ADMIN";

  const create = async () => {
    const body: any = { reason, lines: rl.filter((x) => x.bookId).map((x) => ({ bookId: Number(x.bookId), qty: x.qty })), override };
    if (role !== "DEALER") body.dealerId = Number(dealerId);
    try {
      await act.run(() => api("/returns", { body }), "Return request created");
      setReason(""); setRl([{ bookId: "", qty: 1 }]); setOverride(false); setLimit(null); reload();
    } catch (e: any) {
      if (e?.status === 409) setLimit(e.details);
    }
  };

  return (
    <>
      <h1>Returns</h1>
      <Msg error={act.error} ok={act.ok} />
      {canCreate && (
        <Card title="New return request">
          {role !== "DEALER" && (
            <Field label="Dealer"><select value={dealerId} onChange={(e) => setDealerId(e.target.value)}><option value="">Choose…</option>{(dealers.data?.items ?? []).map((d: any) => <option key={d.id} value={d.id}>{d.firmName}</option>)}</select></Field>
          )}
          {rl.map((x, i) => (
            <div className="row" key={i}>
              <Field label="Book"><select value={x.bookId} onChange={(e) => setRl(rl.map((y, j) => j === i ? { ...y, bookId: e.target.value } : y))}><option value="">Choose…</option>{(books.data?.items ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.code} · {b.title}</option>)}</select></Field>
              <Field label="Qty"><input type="number" min={1} value={x.qty} onChange={(e) => setRl(rl.map((y, j) => j === i ? { ...y, qty: Number(e.target.value) } : y))} /></Field>
            </div>
          ))}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn secondary" onClick={() => setRl([...rl, { bookId: "", qty: 1 }])}>+ Add book</button>
          </div>
          <Field label="Reason"><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          {limit && (
            <div className="err">
              Return limit reached for this year: limit {limit.limitQty}, already used {limit.usedQty}, remaining {limit.remainingQty}.
              {canFin && <label style={{ color: "inherit" }}><br /><input type="checkbox" style={{ width: "auto", minHeight: 0 }} checked={override} onChange={(e) => setOverride(e.target.checked)} /> Override the limit (Accounts/Super Admin only)</label>}
            </div>
          )}
          <button className="btn" style={{ marginTop: 10 }} disabled={act.busy || !reason || rl.every((x) => !x.bookId) || (role !== "DEALER" && !dealerId)} onClick={create}>Submit return</button>
        </Card>
      )}
      {error && <div className="err">{error}</div>}
      <Card>
        <div className="scroll"><table>
          <thead><tr><th>Return</th><th>Dealer</th><th>Books</th><th>Status</th><th></th></tr></thead>
          <tbody>{(data?.items ?? []).map((r: any) => (
            <tr key={r.id}>
              <td>{r.number}{r.overLimit && <span className="pill warn">over limit</span>}</td>
              <td>{r.dealer.firmName}</td>
              <td>{r.lines.map((l: any) => `${l.book.code} ×${l.qtyRequested}`).join(", ")}</td>
              <td><Badge status={r.status} />{r.note && <div className="muted">CN {r.note.number} · {rupees(r.note.amountPaise)}</div>}</td>
              <td><button className="btn secondary" style={{ minHeight: 34, padding: "4px 10px" }} onClick={() => setActive(r)}>Open</button></td>
            </tr>
          ))}</tbody>
        </table></div>
        {data && <Pager page={data.page} pages={data.pages} onChange={setPage} />}
      </Card>
      {active && (
        <Card title={`${active.number} · ${active.status.toLowerCase()}`} actions={<button className="btn secondary" onClick={() => setActive(null)}>Close</button>}>
          <p className="muted">{active.reason}</p>
          <table><thead><tr><th>Book</th><th className="right">Requested</th><th className="right">Received</th><th className="right">Approved</th><th>Remark</th></tr></thead>
            <tbody>{active.lines.map((l: any) => <tr key={l.id}><td>{l.book.code} · {l.book.title}</td><td className="right">{l.qtyRequested}</td><td className="right">{l.qtyReceived ?? "-"}</td><td className="right">{l.qtyApproved ?? "-"}</td><td>{l.remark ?? ""}</td></tr>)}</tbody></table>
          {active.status === "REQUESTED" && (role === "GODOWN" || role === "SUPER_ADMIN") && (
            <div style={{ marginTop: 10 }}>
              {active.lines.map((l: any) => (
                <div className="row" key={l.id}><Field label={`Received: ${l.book.code}`}><input type="number" min={0} max={l.qtyRequested} value={recv[l.id] ?? l.qtyRequested} onChange={(e) => setRecv({ ...recv, [l.id]: Number(e.target.value) })} /></Field></div>
              ))}
              <button className="btn" disabled={act.busy} onClick={async () => { const r = await act.run(() => api(`/returns/${active.id}/receive`, { body: { lines: active.lines.map((l: any) => ({ lineId: l.id, qtyReceived: recv[l.id] ?? l.qtyRequested })) } }), "Received at godown"); if (r) { setActive(null); reload(); } }}>Mark received at godown</button>
            </div>
          )}
          {active.status === "RECEIVED" && canFin && (
            <div style={{ marginTop: 10 }}>
              {active.lines.map((l: any) => (
                <div className="row" key={l.id}><Field label={`Approve: ${l.book.code} (received ${l.qtyReceived})`}><input type="number" min={0} max={l.qtyReceived ?? 0} value={appr[l.id] ?? l.qtyReceived ?? 0} onChange={(e) => setAppr({ ...appr, [l.id]: Number(e.target.value) })} /></Field></div>
              ))}
              <div className="row">
                <button className="btn" disabled={act.busy} onClick={async () => { const r = await act.run(() => api(`/returns/${active.id}/approve`, { body: { lines: active.lines.map((l: any) => ({ lineId: l.id, qtyApproved: appr[l.id] ?? l.qtyReceived ?? 0 })) } }), "Approved, credit note raised, stock updated"); if (r) { setActive(null); reload(); } }}>Approve &amp; raise credit note</button>
                <button className="btn danger" disabled={act.busy} onClick={async () => { const why = prompt("Reason for rejecting?"); if (!why) return; const r = await act.run(() => api(`/returns/${active.id}/reject`, { body: { reason: why } }), "Rejected"); if (r) { setActive(null); reload(); } }}>Reject</button>
              </div>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
