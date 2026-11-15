import { Navigate, NavLink, Route, Routes, Link } from "react-router-dom";
import { useAuth, type Role } from "./auth";
import { useT, LanguageSwitch } from "./i18n";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Orders from "./pages/Orders";
import OrderNew from "./pages/OrderNew";
import OrderDetail from "./pages/OrderDetail";
import Godown from "./pages/Godown";
import GodownPick from "./pages/GodownPick";
import Dealers from "./pages/Dealers";
import DealerDetail from "./pages/DealerDetail";
import Books from "./pages/Books";
import Finance from "./pages/Finance";
import Returns from "./pages/Returns";
import Reports from "./pages/Reports";
import Admin from "./pages/Admin";
import Notifications from "./pages/Notifications";
import Terms from "./pages/Terms";
import Shipments from "./pages/Shipments";

const FIN: Role[] = ["SUPER_ADMIN", "ACCOUNTS"];
const STAFF: Role[] = ["SUPER_ADMIN", "ACCOUNTS", "SALES"];

const NAV_DEF = (t: (k: string) => string): { to: string; label: string; roles: Role[] }[] => [
  { to: "/", label: t("dashboard"), roles: ["SUPER_ADMIN", "ACCOUNTS", "SALES", "GODOWN", "DEALER"] },
  { to: "/orders", label: t("orders"), roles: ["SUPER_ADMIN", "ACCOUNTS", "SALES", "GODOWN", "DEALER"] },
  { to: "/new-order", label: t("newOrder"), roles: ["SUPER_ADMIN", "ACCOUNTS", "SALES", "DEALER"] },
  { to: "/godown", label: t("godown"), roles: ["SUPER_ADMIN", "GODOWN"] },
  { to: "/dealers", label: t("dealers"), roles: STAFF },
  { to: "/books", label: t("books"), roles: [...FIN, "GODOWN"] },
  { to: "/finance", label: t("payments"), roles: [...FIN, "DEALER"] },
  { to: "/returns", label: t("returns"), roles: ["SUPER_ADMIN", "ACCOUNTS", "SALES", "GODOWN", "DEALER"] },
  { to: "/shipments", label: t("dispatches"), roles: ["SUPER_ADMIN", "ACCOUNTS", "SALES", "GODOWN", "DEALER"] },
  { to: "/reports", label: t("reports"), roles: [...FIN, "SALES"] },
  { to: "/admin", label: t("settings"), roles: ["SUPER_ADMIN"] },
];

export default function App() {
  const { me, ready, logout } = useAuth();
  const { t } = useT();
  if (!ready) return <div className="wrap">{t("loading")}</div>;
  if (!me) return <Login />;
  const links = NAV_DEF(t).filter((n) => n.roles.includes(me.role));
  return (
    <>
      <header className="topbar">
        <div className="brand">{t("appName")}</div>
        {links.map((l) => <NavLink key={l.to} to={l.to} end={l.to === "/"}>{l.label}</NavLink>)}
        <Link to="/notifications">{t("notifications")}</Link>
        <LanguageSwitch />
        <span style={{ opacity: .85, fontSize: 13 }}>{me.name}</span>
        <button className="btn secondary" style={{ color: "#fff", borderColor: "#fff", minHeight: 36 }} onClick={logout}>{t("logout")}</button>
      </header>
      <main className="wrap">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/orders/:id" element={<OrderDetail />} />
          <Route path="/new-order" element={<OrderNew />} />
          <Route path="/godown" element={<Godown />} />
          <Route path="/godown/orders/:id" element={<GodownPick />} />
          <Route path="/dealers" element={<Dealers />} />
          <Route path="/dealers/:id" element={<DealerDetail />} />
          <Route path="/books" element={<Books />} />
          <Route path="/finance" element={<Finance />} />
          <Route path="/returns" element={<Returns />} />
          <Route path="/shipments" element={<Shipments />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </>
  );
}
