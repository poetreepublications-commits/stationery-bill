import { api } from "../api";
import { useData, Card, Pager, useAction } from "../components/common";
import { useState } from "react";

export default function Notifications() {
  const [page, setPage] = useState(1);
  const { data, reload } = useData<any>(`/notifications?page=${page}`, [page]);
  const act = useAction();
  return (
    <>
      <div className="row"><h1 style={{ margin: 0, flex: 1 }}>Notifications</h1>
        <button className="btn secondary" onClick={async () => { await act.run(() => api("/notifications/read-all", { body: {} })); reload(); }}>Mark all read</button>
      </div>
      <Card>
        {(data?.items ?? []).length === 0 && <p className="muted">No notifications yet.</p>}
        {(data?.items ?? []).map((n: any) => (
          <div key={n.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--line)", opacity: n.read ? .6 : 1 }} onClick={async () => { if (!n.read) { await api(`/notifications/${n.id}/read`, { body: {} }); reload(); } }}>
            <strong>{n.title}</strong> {!n.read && <span className="pill warn">new</span>}
            <div>{n.body}</div>
            <div className="muted">{new Date(n.createdAt).toLocaleString("en-IN")}</div>
          </div>
        ))}
        {data && <Pager page={data.page} pages={data.pages} onChange={setPage} />}
      </Card>
    </>
  );
}
