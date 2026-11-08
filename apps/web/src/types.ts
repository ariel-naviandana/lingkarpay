// Bentuk data dari API backend (subset). Sumber lengkap: docs/openapi.yaml dan docs/API.md.
export interface User { id: number; name: string; email: string }
export interface AuthResult { user: User; token: string }

export type OrderStatus = "PENDING" | "SETTLED" | "SETTLED_PENDING_CHAIN" | "ANCHORED" | "FAILED" | "EXPIRED";
export const PAID_STATUSES: OrderStatus[] = ["SETTLED", "SETTLED_PENDING_CHAIN", "ANCHORED"];

export interface Circle {
  id: number;
  name: string;
  contributionAmount: number;
  memberCount: number;
  periodDays: number;
  penaltyPct: number;
  adminFee: number;
  status: "draft" | "active" | "completed";
  chainCircleId: string | null; // null sampai kelompok dicatat di chain
  createdBy: number;
  joinedCount?: number;
}

export interface Period {
  id: number;
  periodNo: number;
  dueDate: string;
  status: "scheduled" | "running" | "ready_payout" | "done";
  recipientMemberId: number | null;
}

export interface MemberView {
  memberId: number;
  memberRef: string;
  name: string;
  turnOrder: number | null;
  isMe: boolean;
  currentPayment: { status: OrderStatus | null; paid: boolean; penaltyDue: number } | null;
}

export interface CircleDetail {
  circle: Circle;
  myMemberId: number;
  isCreator: boolean;
  members: MemberView[];
  periods: Period[];
  currentPeriod: Period | null;
}

export interface CheckoutResult {
  orderId: string;
  status: OrderStatus;
  token: string | null;
  amount: number;
  penaltyAmount: number;
  adminFee: number;
  grossAmount: number;
  expiresAt: string;
  reused: boolean;
}

export interface OrderView { orderId: string; status: OrderStatus; grossAmount: number; paymentType: string | null; chainStatus: string | null }
export interface PublicConfig { environment: string; midtransClientKey: string; snapJsUrl: string }
