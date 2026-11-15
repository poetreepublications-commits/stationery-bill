import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, setAccess, setRefresh, getRefresh } from "./api";

export type Role = "SUPER_ADMIN" | "ACCOUNTS" | "SALES" | "GODOWN" | "DEALER";
export interface Me { id: number; name: string; email: string; role: Role; dealerId: number | null; dealerType?: "SCHOOL" | "BOOKSELLER" | null; referralCode?: string | null }
interface Ctx { me: Me | null; ready: boolean; login(email: string, password: string): Promise<void>; logout(): Promise<void> }
const AuthCtx = createContext<Ctx>(null as any);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      if (getRefresh()) {
        try {
          const r = await fetch("/api/auth/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken: getRefresh() }) });
          if (r.ok) { const j = await r.json(); setAccess(j.accessToken); setRefresh(j.refreshToken); setMe(await api<Me>("/auth/me")); }
        } catch { /* offline: stay logged out */ }
      }
      setReady(true);
    })();
  }, []);
  const login = async (email: string, password: string) => {
    const j = await api<{ accessToken: string; refreshToken: string; user: Me }>("/auth/login", { body: { email, password } });
    setAccess(j.accessToken); setRefresh(j.refreshToken); setMe(j.user);
  };
  const logout = async () => {
    const rt = getRefresh();
    if (rt) await api("/auth/logout", { body: { refreshToken: rt } }).catch(() => {});
    setAccess(null); setRefresh(null); setMe(null);
  };
  return <AuthCtx.Provider value={{ me, ready, login, logout }}>{children}</AuthCtx.Provider>;
}
export const useAuth = () => useContext(AuthCtx);
