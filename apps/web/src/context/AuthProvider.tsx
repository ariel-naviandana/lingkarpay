import { useEffect, useState, type ReactNode } from "react";
import { AuthContext, type AuthUser } from "./authContext";
import { api, ApiError, getToken, setToken } from "../api";

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

function isOfflineOrNetworkError(err: unknown): boolean {
  if (err instanceof ApiError) {
    return err.status >= 500 || err.status === 0;
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes("fetch") ||
      msg.includes("network") ||
      msg.includes("gateway") ||
      msg.includes("timeout") ||
      msg.includes("refused") ||
      msg.includes("connect")
    );
  }
  return false;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(() => Boolean(getToken()));
  const [user, setUser] = useState<AuthUser | null>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const savedToken = getToken();
    if (!savedToken) {
      setLoading(false);
      return;
    }

    api
      .me()
      .then((res) => {
        const u = res.user;
        const role: "admin" | "user" =
          u.email.toLowerCase().startsWith("admin") ? "admin" : "user";
        const authUser: AuthUser = {
          id: u.id,
          name: u.name,
          email: u.email,
          initials: makeInitials(u.name),
          role,
        };
        setUser(authUser);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(authUser));
      })
      .catch((err) => {
        // If it's a 401/403 unauthorized, the token is truly invalid -> clear it
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          setToken(null);
          setUser(null);
          localStorage.removeItem(STORAGE_KEY);
        }
        // If offline/network, preserve the locally saved user so offline demo continues to work
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const login = async (
    email: string,
    password = "password123",
    name = "Dimas Prakoso",
    role?: "admin" | "user",
  ) => {
    const calculatedRole =
      role ?? (email.toLowerCase().startsWith("admin") ? "admin" : "user");

    try {
      const res = await api.login(email, password);
      setToken(res.token);
      const authUser: AuthUser = {
        id: res.user.id,
        name: res.user.name,
        email: res.user.email,
        initials: makeInitials(res.user.name),
        role: calculatedRole,
      };
      setUser(authUser);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(authUser));
    } catch (err) {
      // 1. If backend is offline or network/gateway error: smoothly fall back to local session
      if (isOfflineOrNetworkError(err)) {
        const authUser: AuthUser = {
          name: name || "Dimas Prakoso",
          email,
          initials: makeInitials(name || "Dimas Prakoso"),
          role: calculatedRole,
        };
        setUser(authUser);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(authUser));
        return;
      }

      // 2. If 401 INVALID_CREDENTIALS: user does not exist in DB yet, try registering!
      if (
        err instanceof ApiError &&
        (err.status === 401 || err.code === "INVALID_CREDENTIALS")
      ) {
        try {
          const regRes = await api.register(name || "Dimas Prakoso", email, password);
          setToken(regRes.token);
          const authUser: AuthUser = {
            id: regRes.user.id,
            name: regRes.user.name,
            email: regRes.user.email,
            initials: makeInitials(regRes.user.name),
            role: calculatedRole,
          };
          setUser(authUser);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(authUser));
          return;
        } catch (regErr) {
          if (isOfflineOrNetworkError(regErr)) {
            const authUser: AuthUser = {
              name: name || "Dimas Prakoso",
              email,
              initials: makeInitials(name || "Dimas Prakoso"),
              role: calculatedRole,
            };
            setUser(authUser);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(authUser));
            return;
          }
        }
      }

      throw err;
    }
  };

  const register = async (name: string, email: string, password = "password123") => {
    const role: "admin" | "user" =
      email.toLowerCase().startsWith("admin") ? "admin" : "user";

    try {
      const res = await api.register(name, email, password);
      setToken(res.token);
      const authUser: AuthUser = {
        id: res.user.id,
        name: res.user.name,
        email: res.user.email,
        initials: makeInitials(res.user.name),
        role,
      };
      setUser(authUser);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(authUser));
    } catch (err) {
      // 1. If backend is offline or network/gateway error: smoothly fall back to local session
      if (isOfflineOrNetworkError(err)) {
        const authUser: AuthUser = {
          name: name || "Pengguna",
          email,
          initials: makeInitials(name || "Pengguna"),
          role,
        };
        setUser(authUser);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(authUser));
        return;
      }

      // 2. If 409 EMAIL_TAKEN: user already exists, try logging in!
      if (
        err instanceof ApiError &&
        (err.status === 409 || err.code === "EMAIL_TAKEN")
      ) {
        try {
          const logRes = await api.login(email, password);
          setToken(logRes.token);
          const authUser: AuthUser = {
            id: logRes.user.id,
            name: logRes.user.name,
            email: logRes.user.email,
            initials: makeInitials(logRes.user.name),
            role,
          };
          setUser(authUser);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(authUser));
          return;
        } catch (logErr) {
          if (isOfflineOrNetworkError(logErr)) {
            const authUser: AuthUser = {
              name: name || "Pengguna",
              email,
              initials: makeInitials(name || "Pengguna"),
              role,
            };
            setUser(authUser);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(authUser));
            return;
          }
        }
      }

      throw err;
    }
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem(STORAGE_KEY);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
