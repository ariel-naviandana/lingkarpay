import type { AuthResult, Circle, CircleDetail, CheckoutResult, OrderView, PublicConfig, User } from "./types";

// Lewat proxy Vite ("/api" -> backend). Ganti dengan VITE_API_URL bila perlu.
const BASE: string = import.meta.env.VITE_API_URL ?? "/api";

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

let token: string | null = localStorage.getItem("token");
export const getToken = () => token;
export function setToken(t: string | null) {
  token = t;
  if (t) localStorage.setItem("token", t);
  else localStorage.removeItem("token");
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(data?.error?.code ?? "ERROR", data?.error?.message ?? res.statusText, res.status);
  }
  return data as T;
}

export const api = {
  register: (name: string, email: string, password: string) =>
    request<AuthResult>("POST", "/auth/register", { name, email, password }),
  login: (email: string, password: string) => request<AuthResult>("POST", "/auth/login", { email, password }),
  me: () => request<{ user: User }>("GET", "/auth/me"),

  circles: () => request<{ circles: Circle[] }>("GET", "/circles"),
  circle: (id: number) => request<CircleDetail>("GET", `/circles/${id}`),
  createCircle: (body: { name: string; contributionAmount: number; memberCount: number; periodDays: number; penaltyPct: number }) =>
    request<Circle>("POST", "/circles", body),
  addMember: (id: number, email: string) => request<unknown>("POST", `/circles/${id}/members`, { email }),
  startCircle: (id: number) => request<unknown>("POST", `/circles/${id}/start`, {}),

  publicConfig: () => request<PublicConfig>("GET", "/public-config"),
  checkout: (body: { circleId: number; periodId: number; memberId: number }) =>
    request<CheckoutResult>("POST", "/checkout", body),
  order: (orderId: string) => request<OrderView>("GET", `/orders/${encodeURIComponent(orderId)}`),

  // TODO(frontend): riwayat pembayaran, pencairan operator, laporan rekonsiliasi
  payments: (id: number) => request<unknown>("GET", `/circles/${id}/payments`),
  simulatePayout: (periodId: number) => request<unknown>("POST", "/payouts/simulate", { periodId }),
  reconciliation: (circleId: number) => request<unknown>("GET", `/reports/reconciliation?circleId=${circleId}`),
};
