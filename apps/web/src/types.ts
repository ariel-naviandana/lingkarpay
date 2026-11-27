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
  status: "draft" | "active" | "completed" | "cancelled";
  chainCircleId: string | null; // null sampai kelompok dicatat di chain
  createdBy: number;
  joinedCount?: number;
  startedAt?: string | null;
  createdAt?: string;
  /** Tanggal mulai rencana (YYYY-MM-DD, WIB). Kelompok baru bisa dikunci pada/sesudah tanggal ini. */
  startDate?: string;
  /** Seed undian urutan giliran; terisi setelah kelompok dimulai. */
  drawSeed?: string | null;
  /** Dana jaminan per anggota (0 = kelompok lama tanpa jaminan). */
  depositAmount?: number;
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

/** Rekening pencairan tersamar (data dummy). Nomor lengkap tidak disimpan server. */
export interface PayoutAccount {
  channel: string;
  channelLabel: string;
  kind: "bank" | "ewallet";
  last4: string;
  accountName: string;
  updatedAt?: string | null;
}

/** Kanal tujuan pencairan; sama dengan daftar di backend (services/payoutAccount.ts). */
export const PAYOUT_CHANNELS: { code: string; label: string; kind: "bank" | "ewallet" }[] = [
  { code: "BCA", label: "BCA", kind: "bank" },
  { code: "BNI", label: "BNI", kind: "bank" },
  { code: "BRI", label: "BRI", kind: "bank" },
  { code: "MANDIRI", label: "Mandiri", kind: "bank" },
  { code: "BSI", label: "BSI", kind: "bank" },
  { code: "CIMB", label: "CIMB Niaga", kind: "bank" },
  { code: "PERMATA", label: "Permata", kind: "bank" },
  { code: "GOPAY", label: "GoPay", kind: "ewallet" },
  { code: "OVO", label: "OVO", kind: "ewallet" },
  { code: "DANA", label: "DANA", kind: "ewallet" },
  { code: "SHOPEEPAY", label: "ShopeePay", kind: "ewallet" },
];

export interface MemberView {
  memberId: number;
  memberRef: string;
  name: string;
  turnOrder: number | null;
  isMe: boolean;
  /** invited = diundang, belum menerima; active = anggota. */
  status?: "invited" | "active";
  /** Sudah mengisi rekening pencairan (terlihat oleh semua anggota). */
  hasPayoutAccount?: boolean;
  /** Rekening tersamar; hanya untuk pemiliknya dan pembuat kelompok, selain itu null. */
  payoutAccount?: PayoutAccount | null;
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
  /** Tunggakan kelompok ini (terbuka untuk semua anggota). */
  arrears?: Arrear[];
  /** Dana jaminan yang sudah disetor anggota. */
  deposits?: Deposit[];
}

/** Dana jaminan satu anggota: disetor sebelum kelompok dikunci, dikembalikan saat selesai/dibatalkan. */
export interface Deposit {
  memberId: number;
  status: "held" | "refunded";
  amount: number;
  /** Bagian jaminan yang dipakai menutup tunggakan anggota ini. */
  usedAmount: number;
  paidAt: string;
  refund: { amount: number; destination: PayoutAccount | null; transferRef: string | null; refundedAt: string | null } | null;
}

/** Iuran yang tidak dibayar saat periode ditutup kuorum, dan pelunasannya. */
export interface Arrear {
  id: number;
  periodNo: number;
  debtorMemberId: number;
  debtorName: string;
  debtorRef: string;
  creditorMemberId: number;
  creditorName: string;
  amount: number;
  penaltyAmount: number;
  totalDue: number;
  status: "open" | "paid" | "deducted" | "covered";
  settledAt: string | null;
  settledPayoutPeriodNo: number | null;
  forward: { amount: number; destination: PayoutAccount | null; transferRef: string | null; forwardedAt: string | null } | null;
}

/** Undangan bergabung ke kelompok. */
export interface Invitation {
  circle: Circle;
  memberId: number;
  creatorName: string;
  invitedAt: string | null;
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
  /** Biaya admin per iuran, ditetapkan aplikasi. */
  adminFee: number;
  /** Alat simulasi sandbox (mis. lewati jatuh tempo) aktif di server. */
  devTools?: boolean;
}

export interface CirclePaymentItem {
  orderId: string;
  /** null untuk setoran dana jaminan. */
  periodNo: number | null;
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
  /** Pelunasan tunggakan periode lalu (diteruskan ke penerima periode itu, tidak dicatat ke contract). */
  isArrearsPayment?: boolean;
  /** Setoran dana jaminan (tidak dicatat ke contract). */
  isDeposit?: boolean;
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
  /** Tujuan transfer (disalin saat pencairan) dan nomor referensi transfernya. */
  destination?: PayoutAccount | null;
  transferRef?: string | null;
  transferredAt?: string | null;
  /** Tunggakan penerima (iuran + penalti) yang dipotong dari jatahnya dan diteruskan ke kreditornya. */
  arrearsDeducted?: number;
  deductedArrears?: {
    periodNo: number;
    creditorName: string;
    amount: number;
    penaltyAmount: number;
    forward: Arrear["forward"];
  }[];
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
