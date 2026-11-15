import { useParams, Link } from "react-router-dom";
import { useState } from "react";
import { api, download } from "../api";
import { useData, useAction, Msg, Card, Field } from "../components/common";

export default function GodownPick() {
  const { id } = useParams();
  const { data, error, reload, setData } = useData<any>(`/godown/orders/${id}`, [id]);
  const act = useAction();
  const [code, setCode] = useState("");
  const [boxes, setBoxes] = useState("1");
  const [weight, setWeight] = useState("");
  const [freight, setFreight] = useState("");
  const [picked, setPicked] = useState<Record<number, number>>({});
  const [packed, setPacked] = useState<any>(null);

  if (error) return <div className="err">{error}</div>;
  if (!data) return <p>Loading…</p>;

  const scan = async () => {
    if (!code.trim()) return;
    const r = await act.run(() => api(`/godown/orders/${id}/scan`, { body: { code: code.trim() } }), "Scanned");
    setCode("");
    if (r) await reload();
  };
  const savePicks = async () => {
    const lines = data.lines.map((l: any) => ({ lineId: l.lineId, qtyPicked: picked[l.lineId] ?? l.qtyPicked }));
    const r = await act.run(() => api(`/godown/orders/${id}/pick`, { body: { lines } }), "Picks saved");
    if (r) await reload();
  };
  const pack = async () => {
    const r = await act.run(() => api(`/godown/orders/${id}/pack`, { body: { boxes: Number(boxes), weightKg: Number(weight || 0), freightPaise: Math.round(Number(freight || 0) * 100) } }), "Packed and invoice generated");
    if (r) { setPacked(r); await reload(); }
  };
  const upload = async (shipmentId: number, file: File) => {
    const fd = new FormData(); fd.append("file", file);
    await act.run(() => api(`/shipments/${shipmentId}/bilty`, { form: fd }), "Bilty uploaded");
    await reload();
  };
  const dispatch = async (shipmentId: number) => {
    const transporter = prompt("Transporter name?"); if (!transporter) return;
    const vehicleNo = prompt("Vehicle no. (optional)") ?? undefined;
    const lrNo = prompt("LR / bilty number (optional)") ?? undefined;
    const eWayBill = prompt("E-way bill number (optional)") ?? undefined;
    const r = await act.run(() => api(`/shipments/${shipmentId}/dispatch`, { body: { transporter, vehicleNo, lrNo, eWayBill } }), "Dispatched");
    if (r) await reload();
  };

  const toPackCount = data.lines.reduce((s: number, l: any) => s + Math.max(0, l.qtyPicked - l.qtyDispatched), 0);
  return (
    <>
      <div className="row"><h1 style={{ margin: 0, flex: 1 }}>Pick {data.number}</h1><span className="pill">{data.status.replace(/_/g, " ").toLowerCase()}</span></div>
      <p className="muted">{data.dealer}</p>
      <Msg error={act.error} ok={act.ok} />

      {["SENT_TO_GODOWN", "PICKING", "DISPATCHED", "BILTY_UPLOADED"].includes(data.status) && (
        <Card title="Scan books">
          <div className="row">
            <Field label="ISBN or book code (scanner or type)">
              <input autoFocus value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && scan()} placeholder="Scan barcode…" />
            </Field>
            <button className="btn" onClick={scan} disabled={act.busy}>Add 1</button>
          </div>
          <p className="muted">Camera scanning can be added in the Android app; this screen accepts any barcode scanner or typed ISBN.</p>
        </Card>
      )}

      <Card title="Lines">
        <div className="scroll">
          <table>
            <thead><tr><th>School</th><th>Book</th><th className="right">Ordered</th><th className="right">Shipped</th><th className="right">Picked</th><th className="right">In stock</th><th>Pick qty</th></tr></thead>
            <tbody>
              {data.lines.map((l: any) => {
                const short = (l.toPick ?? 0) > l.inStock;
                return (
                  <tr key={l.lineId}>
                    <td>{l.school}</td>
                    <td>{l.code} · {l.title}</td>
                    <td className="right">{l.qtyOrdered}</td>
                    <td className="right">{l.qtyDispatched}</td>
                    <td className="right">{l.qtyPicked}</td>
                    <td className="right">{l.inStock}{short && <div className="pill bad">short</div>}</td>
                    <td style={{ width: 110 }}>
                      <input type="number" min={l.qtyDispatched} max={l.qtyOrdered} value={picked[l.lineId] ?? l.qtyPicked}
                        onChange={(e) => setPicked({ ...picked, [l.lineId]: Number(e.target.value) })} disabled={!["SENT_TO_GODOWN", "PICKING", "DISPATCHED", "BILTY_UPLOADED"].includes(data.status)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn secondary" onClick={savePicks} disabled={act.busy}>Save picks</button>
        </div>
      </Card>

      {data.status === "PICKING" && (
        <Card title="Pack">
          <div className="row">
            <Field label="Boxes"><input type="number" min={1} value={boxes} onChange={(e) => setBoxes(e.target.value)} /></Field>
            <Field label="Weight (kg)"><input type="number" step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} /></Field>
            <Field label="Freight ₹ (optional)"><input type="number" step="0.01" value={freight} onChange={(e) => setFreight(e.target.value)} /></Field>
          </div>
          <p className="muted">{toPackCount} books picked and not yet shipped. Packing creates the shipment and invoice, and reduces stock.</p>
          <button className="btn" onClick={pack} disabled={act.busy || toPackCount === 0}>Pack &amp; generate invoice</button>
          {packed && <p className="ok-msg">Invoice {packed.invoice.number} created.</p>}
        </Card>
      )}

      {data.shipments?.length > 0 && (
        <Card title="Shipments">
          {data.shipments.map((s: any) => (
            <div key={s.id} style={{ borderBottom: "1px solid var(--line)", padding: "10px 0" }}>
              <strong>{s.number}</strong> · {s.invoice?.number} · {s.boxes ?? "-"} boxes · {s.weightKg ?? "-"} kg
              <div className="muted">{s.dispatchedAt ? `Dispatched via ${s.transporter}${s.lrNo ? ` · LR ${s.lrNo}` : ""}` : "Packed, waiting to dispatch"}</div>
              <div className="row" style={{ marginTop: 6 }}>
                {!s.dispatchedAt && <button className="btn" onClick={() => dispatch(s.id)} disabled={act.busy}>Dispatch</button>}
                {s.dispatchedAt && <label className="btn secondary" style={{ textAlign: "center" }}>
                  {s.biltyPath ? "Replace bilty photo" : "Upload bilty photo"}
                  <input type="file" accept="image/*,application/pdf" capture="environment" style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && upload(s.id, e.target.files[0])} />
                </label>}
                {!!s.invoice && <button className="btn secondary" onClick={() => download(`/invoices/${s.invoice.id}/pdf`, `${s.invoice.number.replace(/\//g, "-")}.pdf`)}>Invoice PDF</button>}
              </div>
            </div>
          ))}
        </Card>
      )}
      <p><Link to="/godown">← Back to queue</Link></p>
    </>
  );
}
