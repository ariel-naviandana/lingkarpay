import type {
  AuthResult,
  Circle,
  CircleDetail,
  CirclePaymentsResult,
  CheckoutResult,
  OrderView,
  Proposal,
  PublicConfig,
  ReconciliationReport,
  User,
  Period,
} from "./types";

// Lewat proxy Vite ("/api" -> backend). Ganti dengan VITE_API_URL bila perlu.
const BASE: string = import.meta.env.VITE_API_URL ?? "/api";

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
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
    throw new ApiError(
      data?.error?.code ?? "ERROR",
      data?.error?.message ?? res.statusText,
      res.status,
    );
  }
  return data as T;
}

export const api = {
  // Auth
  register: (name: string, email: string, password: string) =>
    request<AuthResult>("POST", "/auth/register", { name, email, password }),
  login: (email: string, password: string) =>
    request<AuthResult>("POST", "/auth/login", { email, password }),
  me: () => request<{ user: User }>("GET", "/auth/me"),

  // Circles
  circles: () => request<{ circles: Circle[] }>("GET", "/circles"),
  circle: (id: number) => request<CircleDetail>("GET", `/circles/${id}`),
  createCircle: (body: {
    name: string;
    contributionAmount: number;
    memberCount: number;
    periodDays: number;
    penaltyPct: number;
    adminFee?: number;
  }) => request<Circle>("POST", "/circles", body),
  addMember: (id: number, email: string) =>
    request<{ memberId: number; memberRef: string; name: string }>(
      "POST",
      `/circles/${id}/members`,
      { email },
    ),
  startCircle: (id: number, order?: number[]) =>
    request<{ circle: Circle; periods: Period[] }>("POST", `/circles/${id}/start`, { order }),
  periods: (id: number) =>
    request<{ periods: Period[] }>("GET", `/circles/${id}/periods`),
  payments: (id: number) =>
    request<CirclePaymentsResult>("GET", `/circles/${id}/payments`),

  // Quorum / Proposals
  proposals: (id: number) =>
    request<{ proposals: Proposal[] }>("GET", `/circles/${id}/proposals`),
  proposal: (id: number) => request<Proposal>("GET", `/proposals/${id}`),
  createCloseProposal: (periodId: number) =>
    request<Proposal>("POST", `/periods/${periodId}/close-proposals`),
  voteProposal: (proposalId: number, approve: boolean) =>
    request<Proposal>("POST", `/proposals/${proposalId}/votes`, { approve }),

  // Checkout & Orders
  publicConfig: () => request<PublicConfig>("GET", "/public-config"),
  checkout: (body: { circleId: number; periodId: number; memberId: number }) =>
    request<CheckoutResult>("POST", "/checkout", body),
  order: (orderId: string, sync = false) =>
    request<OrderView>("GET", `/orders/${encodeURIComponent(orderId)}${sync ? "?sync=true" : ""}`),
  cancelOrder: (orderId: string) =>
    request<unknown>("POST", `/orders/${encodeURIComponent(orderId)}/cancel`),
  expireOrder: (orderId: string) =>
    request<unknown>("POST", `/orders/${encodeURIComponent(orderId)}/expire`),

  // Payouts & Operator
  simulatePayout: (periodId: number) =>
    request<{ id: number; status: string; mode: string; amount: number; payoutRefHash: string }>(
      "POST",
      "/payouts/simulate",
      { periodId },
    ),
  reconciliation: (circleId: number, live = false) =>
    request<ReconciliationReport>(
      "GET",
      `/reports/reconciliation?circleId=${circleId}&live=${live}`,
    ),
  status: (orderId: string) =>
    request<{ found: boolean; data?: unknown; signatureValid?: boolean }>(
      "GET",
      `/status/${encodeURIComponent(orderId)}`,
    ),
  health: () => request<{ ok: boolean }>("GET", "/health"),
};
