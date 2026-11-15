import { useState } from "react";
import { download, api, rupees } from "../api";
import { useData, Card, Field, Pager } from "../components/common";
import { useAuth } from "../auth";

export default function Reports() {
  const { me } = useAuth();
  const reports = useData<any[]>("/reports");
  const [key, setKey] = useState("sales-register");
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const qs = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString();
  const rep = useData<any>(`/reports/${key}?${qs}`, [key, from, to]);
  const progress = useData<any[]>(me?.role === "SALES" || me?.role === "SUPER_ADMIN" || me?.role === "ACCOUNTS" ? "/targets/progress" : null);
  const [target, setTarget] = useState({ salesId: "", kind: "AMOUNT", value: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const isFin = me?.role !== "SALES";
  const salesTeam = useData<any[]>(isFin ? "/sales-team" : null);

  return (
    <>
      <h1>Reports &amp; targets</h1>
      <Card title="Sales targets (FY)">
        {(progress.data ?? []).map((p) => (
          <div key={p.salesId} style={{ borderBottom: "1px solid var(--line)", padding: "10px 0" }}>
            <strong>{p.name}</strong> · FY {p.period}
            <div className="grid" style={{ marginTop: 8 }}>
              <div><div className="muted">Amount target</div>{p.amount.target ? `${rupees(p.amount.target)} · achieved ${rupees(p.amount.achieved)} (${p.amount.pct}%) · remaining ${rupees(p.amount.remaining)}` : "not set"}</div>
              <div><div className="muted">Quantity target</div>{p.qty.target ? `${p.qty.target} · achieved ${p.qty.achieved} (${p.qty.pct}%) · remaining ${p.qty.remaining}` : "not set"}</div>
            </div>
            {p.dealers.length > 0 && <details><summary>Dealer-wise breakup</summary><ul>{p.dealers.map((d: any) => <li key={d.dealerId}>{d.firm}: {rupees(d.netPaise)} · {d.qty} copies</li>)}</ul></details>}
          </div>
        ))}
        {isFin && (
          <div className="row" style={{ marginTop: 12 }}>
            <Field label="Sales employee"><select value={target.salesId} onChange={(e) => setTarget({ ...target, salesId: e.target.value })}><option value="">Choose…</option>{(salesTeam.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Field label="Type"><select value={target.kind} onChange={(e) => setTarget({ ...target, kind: e.target.value })}><option value="AMOUNT">Amount ₹</option><option value="QTY">Quantity (copies)</option></select></Field>
            <Field label="Target value"><input type="number" value={target.value} onChange={(e) => setTarget({ ...target, value: e.target.value })} /></Field>
            <button className="btn" disabled={!target.salesId || !target.value} onClick={async () => {
              const fyStart = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;
              const value = target.kind === "AMOUNT" ? Math.round(Number(target.value) * 100) : Number(target.value);
              await api("/targets", { method: "PUT", body: { salesId: Number(target.salesId), period: `${fyStart}-${String((fyStart + 1) % 100).padStart(2, "0")}`, kind: target.kind, value } });
              setMsg("Target saved"); progress.reload();
            }}>Save target</button>
          </div>
        )}
        {msg && <div className="ok-msg">{msg}</div>}
      </Card>

      <Card title="Reports">
        <div className="row">
          <Field label="Report"><select value={key} onChange={(e) => setKey(e.target.value)}>{(reports.data ?? []).map((r: any) => <option key={r.key} value={r.key}>{r.title}</option>)}</select></Field>
          <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <button className="btn" onClick={() => download(`/reports/${key}?${qs}&format=xlsx`, `${key}.xlsx`)}>Download Excel</button>
        </div>
        {rep.error && <div className="err">{rep.error}</div>}
        {rep.data && (
          <div className="scroll" style={{ marginTop: 12 }}><table>
            <thead><tr>{rep.data.headers.map((h: string) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{rep.data.rows.slice(0, 200).map((r: any[], i: number) => <tr key={i}>{r.map((c, j) => <td key={j}>{typeof c === "number" && rep.data.headers[j].match(/amount|sales|net|debit|credit|balance|outstanding|discount|gross|0-30|31-60|61-90|90\+|on account|gross/i) ? c.toLocaleString("en-IN", { minimumFractionDigits: 2 }) : c}</td>)}</tr>)}</tbody>
          </table></div>
        )}
        {rep.data && <p className="muted">{rep.data.rows.length} rows{rep.data.rows.length > 200 ? " (showing first 200 — download Excel for all)" : ""}</p>}
      </Card>
    </>
  );
}
