import { useEffect, useState, type ReactNode } from "react";
import { AuthContext, type AuthUser } from "./authContext";
import { api, ApiError, getToken, setToken } from "../api";
import type { User } from "../types";

const STORAGE_KEY = "lingkarpay_user";

function makeInitials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "LP"
  );
}

/** Peran selalu dari server (database). Frontend tidak pernah menebaknya dari email. */
function toAuthUser(u: User): AuthUser {
  return { id: u.id, name: u.name, email: u.email, initials: makeInitials(u.name), role: u.role };
}

function readSavedUser(): AuthUser | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved && getToken() ? (JSON.parse(saved) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(() => Boolean(getToken()));
  const [user, setUser] = useState<AuthUser | null>(readSavedUser);

  const startSession = (token: string, u: User) => {
    setToken(token);
    const authUser = toAuthUser(u);
    setUser(authUser);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(authUser));
    } catch {
      /* penyimpanan lokal tidak tersedia: sesi tetap jalan di memori */
    }
  };

  const clearSession = () => {
    setToken(null);
    setUser(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* abaikan */
    }
  };

  // Saat dibuka ulang: sesuaikan data pengguna (termasuk peran) dengan server.
  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then((res) => {
        const authUser = toAuthUser(res.user);
        setUser(authUser);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(authUser));
        } catch {
          /* abaikan */
        }
      })
      .catch((err) => {
        // Token ditolak server: sesi tidak berlaku lagi. Server mati: biarkan data tersimpan.
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) clearSession();
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const res = await api.login(email, password);
    startSession(res.token, res.user);
  };

  const register = async (name: string, email: string, password: string) => {
    const res = await api.register(name, email, password);
    startSession(res.token, res.user);
  };

  const logout = () => clearSession();

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
