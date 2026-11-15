import { useAuth } from "../auth";
import { useData, Card } from "../components/common";
import { rupees } from "../api";
import { Link } from "react-router-dom";
import { STATUS_LABEL } from "../api";

export default function Dashboard() {
  const { me } = useAuth();
  const { data, error } = useData<any>("/dashboard", [me?.id]);
  if (error) return <div className="err">{error}</div>;
  if (!data) return <p>Loading…</p>;
  const stat = (label: string, value: string | number, to?: string) => (
    <div className="card stat" key={label}>
      <div className="n">{value}</div><div className="l">{to ? <Link to={to}>{label}</Link> : label}</div>
    </div>
  );
  if (me?.role === "DEALER") return (
    <>
      <h1>Welcome, {me.name}</h1>
      {data.termsPendingAcceptance && <div className="err">Please accept the latest terms & conditions before ordering. <Link to="/terms">Review now</Link></div>}
      <div className="grid">{stat("Open orders", data.openOrders, "/orders")}{stat("New order", "+", "/new-order")}</div>
    </>
  );
  if (me?.role === "GODOWN") return (
    <>
      <h1>Godown</h1>
      <div className="grid">
        {(data.queue as any[]).map((q) => stat(STATUS_LABEL[q.status] ?? q.status, q._count, "/godown"))}
        {stat("Low-stock books", data.lowStockBooks, "/books")}
      </div>
    </>
  );
  if (me?.role === "SALES") return (
    <>
      <h1>Hello, {me.name}</h1>
      <div className="grid">{stat("My dealers", data.dealers, "/dealers")}{stat("Orders to accept", data.ordersToAccept, "/orders")}</div>
    </>
  );
  return (
    <>
      <h1>Overview · FY {data.fy}</h1>
      <div className="grid">
        {stat("Dealers awaiting approval", data.dealersPending, "/dealers")}
        {stat("Orders to verify", data.ordersToVerify, "/orders")}
        {stat("Active dealers", data.activeDealers, "/dealers")}
        {stat("Sales this FY", rupees(data.salesThisFyPaise))}
      </div>
    </>
  );
}
