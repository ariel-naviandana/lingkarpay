import type {
  AdminCircle,
  AuthResult,
  Circle,
  CircleDetail,
  CirclePaymentsResult,
  CheckoutResult,
  Invitation,
  OrderView,
  PayoutAccount,
  Proposal,
  PublicConfig,
  ReconciliationReport,
  User,
  Period,
} from "./types";

/** Rekening pencairan yang dikirim ke server (data dummy). */
export interface PayoutAccountInput {
  channel: string;
  accountNumber: string;
  accountName: string;
}

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
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // Network error (server unreachable, CORS pre-flight failed, etc.)
    throw new ApiError("NETWORK_ERROR", "Tidak dapat terhubung ke server. Pastikan backend berjalan di port 3001.", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Gunakan pesan error dari backend jika ada (misal dari Midtrans, validasi, dll.)
    // Hanya fallback ke pesan server down jika tidak ada pesan dari server (misal 502 dari proxy Vite)
    const serverMsg =
      data?.error?.message ??
      (res.status === 502 || res.status === 503 || res.status === 504
        ? "Server tidak dapat dihubungi saat ini. Pastikan backend API sudah berjalan di port 3001."
        : res.statusText || "Terjadi kesalahan pada server");
    throw new ApiError(
      data?.error?.code ?? "ERROR",
      serverMsg,
      res.status,
    );
  }
  return data as T;
}

/** Returns true for gateway / server-down errors (5xx or network) */
export function isServerError(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 0 || e.status >= 500);
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
  adminCircles: () => request<{ circles: AdminCircle[] }>("GET", "/admin/circles"),
  circle: (id: number) => request<CircleDetail>("GET", `/circles/${id}`),
  publicCircle: (id: number) => request<CircleDetail>("GET", `/public/circles/${id}`),
  createCircle: (body: {
    name: string;
    contributionAmount: number;
    memberCount: number;
    periodDays: number;
    penaltyPct: number;
    /** Tanggal mulai rencana (YYYY-MM-DD, WIB), tidak boleh sebelum hari ini. */
    startDate: string;
    /** Rekening pencairan pembuat (wajib). Biaya admin tidak dikirim: ditetapkan aplikasi. */
    payoutAccount: PayoutAccountInput;
  }) => request<Circle>("POST", "/circles", body),
  addMember: (id: number, email: string) =>
    request<{ memberId: number; memberRef: string; name: string; status: "invited" }>(
      "POST",
      `/circles/${id}/members`,
      { email },
    ),
  // Undangan
  invitations: () => request<{ invitations: Invitation[] }>("GET", "/invitations"),
  acceptInvitation: (circleId: number, payoutAccount: PayoutAccountInput) =>
    request<{ circleId: number; memberId: number; status: "active" }>(
      "POST",
      `/circles/${circleId}/invitation/accept`,
      { payoutAccount },
    ),
  declineInvitation: (circleId: number) =>
    request<{ circleId: number; declined: true }>("POST", `/circles/${circleId}/invitation/decline`),
  cancelInvitation: (circleId: number, memberId: number) =>
    request<{ cancelled: true }>("DELETE", `/circles/${circleId}/invitations/${memberId}`),
  // Dana jaminan, pembatalan kelompok draft, dan mengeluarkan anggota draft
  depositCheckout: (circleId: number) => request<CheckoutResult>("POST", `/circles/${circleId}/deposit/checkout`),
  cancelCircle: (circleId: number) =>
    request<{ circleId: number; status: "cancelled"; depositsRefunded: number }>("POST", `/circles/${circleId}/cancel`),
  removeMember: (circleId: number, memberId: number) =>
    request<{ removed: true }>("DELETE", `/circles/${circleId}/members/${memberId}`),
  // Pelunasan tunggakan oleh penunggaknya sendiri
  arrearsCheckout: (arrearId: number) => request<CheckoutResult>("POST", `/arrears/${arrearId}/checkout`),
  // Urutan giliran diundi server saat kelompok dikunci.
  startCircle: (id: number) =>
    request<{ circle: Circle; periods: Period[] }>("POST", `/circles/${id}/start`, {}),
  // Sandbox saja: tandai periode berjalan sudah lewat jatuh tempo (untuk demo kuorum).
  devMakeOverdue: (periodId: number) =>
    request<{ periodId: number; overdue: true; simulated: true }>("POST", `/dev/periods/${periodId}/make-overdue`),
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
  vote: (proposalId: number, approve: boolean) =>
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
    request<{
      id: number;
      status: string;
      mode: string;
      amount: number;
      payoutRefHash: string;
      destination: PayoutAccount | null;
      transferRef: string | null;
      transferredAt: string | null;
    }>("POST", "/payouts/simulate", { periodId }),
  setPayoutAccount: (circleId: number, body: PayoutAccountInput) =>
    request<{ payoutAccount: PayoutAccount }>("PUT", `/circles/${circleId}/payout-account`, body),
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
