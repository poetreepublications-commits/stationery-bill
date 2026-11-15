import { useState } from "react";
import { api, rupees } from "../api";
import { useData, useAction, Msg, Pager, Card, Field } from "../components/common";

export default function Admin() {
  const [tab, setTab] = useState<"company" | "users" | "rules" | "audit" | "fy">("company");
  return (
    <>
      <h1>Settings</h1>
      <div className="tabs">
        {(["company", "rules", "users", "fy", "audit"] as const).map((k) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{({ company: "Company & invoice", rules: "Discount & numbering", users: "Users & roles", fy: "Close year", audit: "Audit log" } as any)[k]}</button>)}
      </div>
      {tab === "company" && <CompanySettings />}
      {tab === "rules" && <RuleSettings />}
      {tab === "users" && <Users />}
      {tab === "fy" && <CloseYear />}
      {tab === "audit" && <AuditLog />}
    </>
  );
}

function SettingEditor({ k, label, parse, toText }: { k: string; label: string; parse: (s: string) => any; toText: (v: any) => string }) {
  const s = useData<any>("/settings");
  const act = useAction();
  const [text, setText] = useState<string | null>(null);
  const current = s.data?.[k];
  return (
    <Card title={label}>
      <Msg error={act.error} ok={act.ok} />
      <textarea rows={k === "company" ? 8 : 3} value={text ?? (current !== undefined ? toText(current) : "")} onChange={(e) => setText(e.target.value)} />
      <button className="btn" style={{ marginTop: 10 }} disabled={act.busy || text === null} onClick={async () => {
        const v = parse(text ?? "");
        const r = await act.run(() => api(`/settings/${k}`, { method: "PUT", body: { value: v } }), "Saved");
        if (r) { setText(null); s.reload(); }
      }}>Save</button>
    </Card>
  );
}

function CompanySettings() {
  return <SettingEditor k="company" label="Company details (shown on invoices) — JSON" parse={(t) => JSON.parse(t)} toText={(v) => JSON.stringify(v, null, 2)} />;
}

function RuleSettings() {
  const s = useData<any>("/settings");
  const act = useAction();
  const [f, setF] = useState<any>(null);
  const cur = f ?? { discount_approval_limit_bp: s.data?.discount_approval_limit_bp ?? 1000, invoice_prefix: s.data?.invoice_prefix ?? "INV", default_return_limit_qty: s.data?.default_return_limit_qty ?? 0 };
  const save = async () => {
    for (const k of Object.keys(cur)) {
      const v = k === "invoice_prefix" ? cur[k] : Number(cur[k]);
      await act.run(() => api(`/settings/${k}`, { method: "PUT", body: { value: v } }));
    }
    act.setOk("Rules saved"); setF(null); s.reload();
  };
  return (
    <Card title="Discount limit, invoice series and default returns">
      <Msg error={act.error} ok={act.ok} />
      <div className="row">
        <Field label="Discount needing Super Admin approval above (%)"><input type="number" step="0.01" value={cur.discount_approval_limit_bp / 100} onChange={(e) => setF({ ...cur, discount_approval_limit_bp: Math.round(Number(e.target.value) * 100) })} /></Field>
        <Field label="Invoice number prefix"><input value={cur.invoice_prefix} onChange={(e) => setF({ ...cur, invoice_prefix: e.target.value })} /></Field>
        <Field label="Default return limit (copies/year, 0 = none)"><input type="number" value={cur.default_return_limit_qty} onChange={(e) => setF({ ...cur, default_return_limit_qty: e.target.value })} /></Field>
      </div>
      <button className="btn" style={{ marginTop: 10 }} disabled={act.busy || f === null} onClick={save}>Save rules</button>
    </Card>
  );
}

function Users() {
  const [page, setPage] = useState(1);
  const { data, reload } = useData<any>(`/users?page=${page}`, [page]);
  const act = useAction();
  const [f, setF] = useState({ name: "", email: "", role: "SALES", password: "", referralCode: "" });
  return (
    <>
      <Msg error={act.error} ok={act.ok} />
      <Card title="Add staff user">
        <div className="row">
          <Field label="Name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Email"><input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Role"><select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="SALES">Sales employee</option><option value="ACCOUNTS">Accounts</option><option value="GODOWN">Godown</option><option value="SUPER_ADMIN">Super Admin</option></select></Field>
          <Field label="Initial password (min 8)"><input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
          <Field label="Referral code (sales)"><input value={f.referralCode} onChange={(e) => setF({ ...f, referralCode: e.target.value })} /></Field>
        </div>
        <button className="btn" style={{ marginTop: 10 }} disabled={act.busy} onClick={async () => { const r = await act.run(() => api("/users", { body: { ...f, referralCode: f.referralCode || null } }), "User created"); if (r) { setF({ name: "", email: "", role: "SALES", password: "", referralCode: "" }); reload(); } }}>Create user</button>
      </Card>
      <Card>
        <table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Active</th><th></th></tr></thead>
          <tbody>{(data?.items ?? []).map((u: any) => (
            <tr key={u.id}><td>{u.name}</td><td>{u.email}</td><td>{u.role}</td><td>{u.active ? "yes" : "no"}</td>
              <td>{u.active && <button className="btn danger" style={{ minHeight: 34, padding: "4px 10px" }} onClick={async () => { if (confirm("Deactivate this user?")) { await act.run(() => api(`/users/${u.id}`, { method: "DELETE" }), "Deactivated"); reload(); } }}>Deactivate</button>}</td></tr>
          ))}</tbody></table>
        {data && <Pager page={data.page} pages={data.pages} onChange={setPage} />}
      </Card>
    </>
  );
}

function CloseYear() {
  const act = useAction();
  const [fy, setFy] = useState("");
  return (
    <Card title="Lock a past financial year">
      <p className="muted">Once locked, no invoices, payments or notes can be posted in that year. The current year cannot be locked.</p>
      <Msg error={act.error} ok={act.ok} />
      <div className="row">
        <Field label="Year (e.g. 2025-26)"><input value={fy} onChange={(e) => setFy(e.target.value)} /></Field>
        <button className="btn danger" disabled={act.busy || !/^\d{4}-\d{2}$/.test(fy)} onClick={() => { if (confirm(`Lock FY ${fy}? This cannot be undone from the app.`)) act.run(() => api("/settings/lock-fy", { body: { fy } }), `FY ${fy} locked`); }}>Lock year</button>
      </div>
    </Card>
  );
}

function AuditLog() {
  const [page, setPage] = useState(1);
  const [entity, setEntity] = useState("");
  const { data } = useData<any>(`/audit?page=${page}${entity ? `&entity=${entity}` : ""}`, [page, entity]);
  return (
    <Card>
      <Field label="Filter by entity (Order, Dealer, Book, Terms, Return, Payment, Setting…)"><input value={entity} onChange={(e) => { setPage(1); setEntity(e.target.value); }} /></Field>
      <div className="scroll"><table>
        <thead><tr><th>When</th><th>Who</th><th>Entity</th><th>Action</th><th>Old → New</th></tr></thead>
        <tbody>{(data?.items ?? []).map((a: any) => (
          <tr key={a.id}><td>{new Date(a.at).toLocaleString("en-IN")}</td><td>{a.userName ?? "System"}</td><td>{a.entity} #{a.entityId}</td><td>{a.action}</td>
            <td className="muted" style={{ maxWidth: 380, wordBreak: "break-word" }}>{a.oldValue ? JSON.stringify(a.oldValue).slice(0, 160) : "—"} → {a.newValue ? JSON.stringify(a.newValue).slice(0, 160) : "—"}</td></tr>
        ))}</tbody>
      </table></div>
      {data && <Pager page={data.page} pages={data.pages} onChange={setPage} />}
    </Card>
  );
}
