import { useState } from "react";
import { useAuth } from "../auth";
import { api } from "../api";
import { useT, LanguageSwitch } from "../i18n";
import { Msg, Field, useAction } from "../components/common";

export default function Login() {
  const { login } = useAuth();
  const { t } = useT();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [form, setForm] = useState({ email: "", password: "" });
  const [reg, setReg] = useState({ firmName: "", type: "SCHOOL", ownerName: "", mobile: "", email: "", password: "", city: "", state: "", pincode: "", referralCode: "" });
  const act = useAction();
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  const setR = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setReg({ ...reg, [k]: e.target.value });

  return (
    <div className="wrap auth">
      <div className="card">
        <div className="row"><h1 style={{ margin: 0, flex: 1 }}>{t("appName")}</h1><LanguageSwitch /></div>
        <div className="tabs">
          <button className={mode === "login" ? "on" : ""} onClick={() => setMode("login")}>{t("login")}</button>
          <button className={mode === "register" ? "on" : ""} onClick={() => setMode("register")}>{t("register")}</button>
        </div>
        {mode === "login" ? (
          <form onSubmit={(e) => { e.preventDefault(); act.run(() => login(form.email, form.password)); }}>
            <Field label={t("email")}><input type="email" value={form.email} onChange={set("email")} required autoComplete="username" /></Field>
            <Field label={t("password")}><input type="password" value={form.password} onChange={set("password")} required autoComplete="current-password" /></Field>
            <Msg error={act.error} />
            <button className="btn" style={{ marginTop: 14, width: "100%" }} disabled={act.busy}>{t("login")}</button>
          </form>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); act.run(async () => {
            const r = await api<{ message: string }>("/auth/register-dealer", { body: { ...reg, email: reg.email, referralCode: reg.referralCode || undefined } });
            act.setOk(r.message);
          }); }}>
            <p className="muted">{t("registerHint")}</p>
            <Field label="Firm / school name"><input value={reg.firmName} onChange={setR("firmName")} required /></Field>
            <Field label="Type"><select value={reg.type} onChange={setR("type")}><option value="SCHOOL">School (orders for itself)</option><option value="BOOKSELLER">Bookseller (orders for many schools)</option></select></Field>
            <Field label="Owner name"><input value={reg.ownerName} onChange={setR("ownerName")} required /></Field>
            <Field label="Mobile"><input value={reg.mobile} onChange={setR("mobile")} required /></Field>
            <Field label="Email (used to log in)"><input type="email" value={reg.email} onChange={setR("email")} required /></Field>
            <Field label="Password (min 8 characters)"><input type="password" value={reg.password} onChange={setR("password")} required minLength={8} /></Field>
            <div className="row"><Field label="City"><input value={reg.city} onChange={setR("city")} /></Field><Field label="State"><input value={reg.state} onChange={setR("state")} /></Field><Field label="Pincode"><input value={reg.pincode} onChange={setR("pincode")} /></Field></div>
            <Field label="Sales employee referral code (optional)"><input value={reg.referralCode} onChange={setR("referralCode")} /></Field>
            <Msg error={act.error} ok={act.ok} />
            <button className="btn" style={{ marginTop: 14, width: "100%" }} disabled={act.busy}>{t("register")}</button>
          </form>
        )}
      </div>
    </div>
  );
}
