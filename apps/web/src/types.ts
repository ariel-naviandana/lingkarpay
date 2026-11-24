// Bentuk data dari API backend. Sumber lengkap: docs/openapi.yaml dan docs/API.md.
export interface User {
  id: number;
  name: string;
  email: string;
  role: "user" | "admin"; // dari server; admin diberikan lewat npm run admin:grant
}

export interface AuthResult {
  user: User;
  token: string;
}

export type OrderStatus =
  | "PENDING"
  | "SETTLED"
  | "SETTLED_PENDING_CHAIN"
  | "ANCHORED"
  | "FAILED"
  | "EXPIRED";

export const PAID_STATUSES: OrderStatus[] = [
  "SETTLED",
  "SETTLED_PENDING_CHAIN",
  "ANCHORED",
];

export type MemberStatus = "paid" | "unpaid" | "pending_chain";

export interface Member {
  rank: number;
  name: string;
  id: string;
  status: MemberStatus;
  paidAt?: string;
  penalty?: number;
}

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
  startedAt?: string | null;
  createdAt?: string;
}

/** Kelompok pada daftar admin: ditambah nama pembuat (tanpa email). */
export interface AdminCircle extends Circle {
  creatorName: string;
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
  currentPayment: {
    status: OrderStatus | null;
    paid: boolean;
    penaltyDue: number;
  } | null;
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

export interface OrderView {
  orderId: string;
  status: OrderStatus;
  grossAmount: number;
  paymentType: string | null;
  chainStatus: string | null;
}

export interface PublicConfig {
  environment: string;
  midtransClientKey: string;
  snapJsUrl: string;
}

export interface CirclePaymentItem {
  orderId: string;
  periodNo: number;
  memberRef: string;
  memberName: string;
  status: OrderStatus;
  amount: number;
  penaltyAmount: number;
  adminFee: number;
  grossAmount: number;
  paymentType: string | null;
  paidAt: string | null;
  createdAt: string;
  chainStatus: string | null;
  txHash: string | null;
}

export interface CirclePayoutItem {
  id: number;
  periodNo: number;
  amount: number;
  mode: string;
  status: string;
  recipientMemberRef: string;
  payoutRefHash: string;
  createdAt: string;
  chainStatus?: string | null; // status job markPayout (confirmed = sudah di chain)
  txHash?: string | null;
  chainConfirmedAt?: string | null;
  // Rincian pencairan: siapa penerimanya dan dari mana dananya.
  recipientName?: string;
  recipientAccountHash?: string | null; // hash rekening (nomor asli tidak disimpan)
  irisReferenceNo?: string | null;
  updatedAt?: string;
  contributionTotal?: number;
  penaltyTotal?: number;
  adminFeeTotal?: number; // pendapatan platform, tidak ikut dicairkan
  paidCount?: number;
  memberCount?: number;
  contributors?: { memberRef: string; name: string; amount: number; penaltyAmount: number; paidAt: string | null }[];
  lastPaidAt?: string | null;
  closedBy?: "quorum" | "all_paid";
  closedAt?: string | null;
  approveVotes?: number | null;
  quorumNeeded?: number | null;
}

export interface CirclePaymentsResult {
  payments: CirclePaymentItem[];
  payouts: CirclePayoutItem[];
}

export interface Proposal {
  id: number;
  circleId: number;
  periodId: number;
  periodNo: number;
  kind: "close_period";
  status: "open" | "rejected" | "expired" | "executed";
  deadline: string;
  approvals: number;
  rejections: number;
  quorum: number;
  myVote: boolean | null;
  chainProposalId: string | null;
}

export interface ReconciliationReport {
  circleId: number;
  circleName: string;
  generatedAt: string;
  live: boolean;
  summary: {
    ordersByStatus: Record<string, number>;
    grossPaid: number;
    adminFeeRevenue: number;
    collectedForPayout: number;
    payoutTotal: number;
    webhookEventsByOutcome: Record<string, number>;
    issues: number;
    liveChecked: number;
  };
  chain: {
    chainCircleId: string | null;
    createCircleJob: {
      status: string;
      attempts: number;
      lastError: string | null;
    } | null;
  };
  periods: Array<{
    periodNo: number;
    collected: number;
    payoutAmount: number | null;
    payoutStatus: string | null;
    difference: number | null;
  }>;
  orders: Array<{
    orderId: string;
    periodNo: number;
    memberRef: string;
    status: OrderStatus;
    grossAmount: number;
    gatewayRef: string | null;
    paidAt: string | null;
    chainJob: { status: string; attempts: number } | null;
    txHash: string | null;
    gatewayStatus?: string | null;
    flags: string[];
  }>;
}
