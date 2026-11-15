import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge, Button, Card, Mono, Td, Th, Input, Field } from "../components/ui";
import { formatDate, rupiah, shortenHash } from "../lib/format";
import { mockCircleDetail } from "../lib/mock";
import { api } from "../api";
import type { CircleDetail, Proposal } from "../types";

const CONTRACT_ADDRESS = "0x87eD2019c518e0309BddCB4AA7F2c375F1aE04B2";

export default function GroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const circleId = Number(id);

  const [data, setData] = useState<CircleDetail | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Invite member state (for draft)
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const loadCircle = useCallback(async () => {
    if (!circleId || isNaN(circleId)) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.circle(circleId);
      setData(res);

      const propRes = await api.proposals(circleId).catch(() => null);
      if (propRes) {
        setProposals(propRes.proposals || []);
      }
    } catch {
      // Fallback to mock data for demo / offline resilience
      setData(mockCircleDetail);
    } finally {
      setLoading(false);
    }
  }, [circleId]);

  useEffect(() => {
    void loadCircle();
  }, [loadCircle]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviteLoading(true);
    setActionNotice(null);
    try {
      await api.addMember(circleId, inviteEmail.trim());
      setInviteEmail("");
      setActionNotice("Anggota berhasil ditambahkan!");
      await loadCircle();
    } catch (err) {
      setActionNotice(err instanceof Error ? `Gagal: ${err.message}` : "Gagal menambah anggota");
    } finally {
      setInviteLoading(false);
    }
  };

  const handleStartCircle = async () => {
    setInviteLoading(true);
    setActionNotice(null);
    try {
      await api.startCircle(circleId);
      setActionNotice("Kelompok berhasil dimulai! Periode 1 kini berjalan.");
      await loadCircle();
    } catch (err) {
      setActionNotice(err instanceof Error ? `Gagal: ${err.message}` : "Gagal memulai kelompok");
    } finally {
      setInviteLoading(false);
    }
  };

  const handleVote = async (propId: number, approve: boolean) => {
    try {
      await api.voteProposal(propId, approve);
      setActionNotice("Suara Anda berhasil dicatat!");
      await loadCircle();
    } catch (err) {
      setActionNotice(err instanceof Error ? `Gagal: ${err.message}` : "Gagal memberi suara");
    }
  };

  if (loading && !data) {
    return (
      <div className="w-full p-8 text-center text-stone-500">
        <p>Memuat data kelompok...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="w-full space-y-4">
        <Link to="/dashboard" className="text-xs font-semibold text-stone-500 hover:text-brand">
          ‹ Kembali ke dashboard
        </Link>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800">
          <h2 className="font-bold text-base mb-1">Gagal memuat kelompok</h2>
          <p className="text-sm">{error || "Kelompok tidak ditemukan."}</p>
          <Button variant="outline" onClick={() => void loadCircle()} className="mt-4 text-xs">
            Coba lagi
          </Button>
        </div>
      </div>
    );
  }

  const { circle, members, periods, currentPeriod, isCreator } = data;
  const me = members.find((m) => m.isMe);

  const paidCount = members.filter((m) => m.currentPayment?.paid).length;
  const isMeUnpaid =
    circle.status === "active" &&
    currentPeriod?.status === "running" &&
    me?.currentPayment &&
    !me.currentPayment.paid;

  const currentRecipient = members.find(
    (m) =>
      m.memberId === currentPeriod?.recipientMemberId ||
      (currentPeriod && m.turnOrder === currentPeriod.periodNo)
  );

  let circleBadgeTone: "green" | "amber" | "gray" | "purple" = "gray";
  let circleBadgeText = "Belum dimulai";

  if (circle.status === "active") {
    const hasLate = members.some(
      (m) => m.currentPayment && !m.currentPayment.paid && m.currentPayment.penaltyDue > 0
    );
    if (hasLate) {
      circleBadgeTone = "amber";
      circleBadgeText = "Ada yang terlambat";
    } else {
      circleBadgeTone = "green";
      circleBadgeText = "Berjalan";
    }
  } else if (circle.status === "completed") {
    circleBadgeTone = "purple";
    circleBadgeText = "Selesai";
  }

  const targetVerifyId = circle.chainCircleId || circle.id;

  return (
    <div className="w-full space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="mb-1">
            <Link to="/dashboard" className="text-xs font-semibold text-stone-500 hover:text-brand transition">
              ‹ Kembali ke dashboard
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{circle.name}</h1>
            <Badge tone={circleBadgeTone}>{circleBadgeText}</Badge>
            {circle.chainCircleId && (
              <Badge tone="purple">Sepolia #{circle.chainCircleId}</Badge>
            )}
          </div>
          <p className="mt-1 text-xs sm:text-sm text-stone-500">
            Arisan bergilir · {circle.memberCount} anggota · {rupiah(circle.contributionAmount)} per {circle.periodDays} hari
            {currentPeriod ? ` · Periode ${currentPeriod.periodNo} dari ${circle.memberCount}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/verifikasi/${targetVerifyId}`} className="flex-1 sm:flex-initial">
            <Button variant="outline" className="w-full sm:w-auto">Verifikasi publik</Button>
          </Link>
          {isMeUnpaid && (
            <Link to={`/groups/${circle.id}/pay`} className="flex-1 sm:flex-initial">
              <Button className="w-full sm:w-auto">Bayar iuran saya</Button>
            </Link>
          )}
        </div>
      </div>

      {actionNotice && (
        <div className="rounded-xl border border-sand bg-cream p-4 text-xs sm:text-sm font-semibold text-ink flex items-center justify-between">
          <span>{actionNotice}</span>
          <button onClick={() => setActionNotice(null)} className="text-stone-500 hover:text-ink">✕</button>
        </div>
      )}

      {/* Unpaid Warning Banner */}
      {isMeUnpaid && me?.currentPayment && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-amber-200 bg-amber-soft p-4 sm:p-5">
          <div>
            <b className="text-amber-950 block">
              Iuran Periode {currentPeriod?.periodNo} Anda ({me.name}) menunggu pembayaran
            </b>
            <p className="mt-0.5 text-xs sm:text-sm text-amber-900">
              Total tagihan {rupiah(circle.contributionAmount + me.currentPayment.penaltyDue + circle.adminFee)} (Iuran {rupiah(circle.contributionAmount)}
              {me.currentPayment.penaltyDue > 0 && ` + Penalti ${rupiah(me.currentPayment.penaltyDue)}`}
              {circle.adminFee > 0 && ` + Biaya admin ${rupiah(circle.adminFee)}`}).
            </p>
          </div>
          <Link to={`/groups/${circle.id}/pay`} className="shrink-0">
            <Button className="w-full sm:w-auto">Bayar sekarang</Button>
          </Link>
        </div>
      )}

      {/* Quorum proposal banner if any */}
      {proposals.filter((p) => p.status === "open").map((p) => (
        <div
          key={p.id}
          className="rounded-2xl border border-violet-200 bg-violet-50 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-violet-950"
        >
          <div>
            <div className="flex items-center gap-2">
              <Badge tone="purple">Kuorum Terbuka</Badge>
              <b className="text-sm">Usulan Tutup Periode #{p.periodNo}</b>
            </div>
            <p className="text-xs sm:text-sm mt-1 text-violet-800">
              Persetujuan saat ini: {p.approvals} dari kuorum {p.quorum} anggota (batas waktu: {formatDate(p.deadline)}).
            </p>
          </div>
          {p.myVote === null ? (
            <div className="flex gap-2 shrink-0">
              <Button onClick={() => void handleVote(p.id, true)} className="!px-3 !py-1 text-xs">
                Setuju
              </Button>
              <Button variant="outline" onClick={() => void handleVote(p.id, false)} className="!px-3 !py-1 text-xs">
                Tolak
              </Button>
            </div>
          ) : (
            <Badge tone="green">Suara Anda: {p.myVote ? "Setuju" : "Tolak"}</Badge>
          )}
        </div>
      ))}

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="p-4 sm:p-5">
          <p className="text-xs sm:text-sm text-stone-500">Total dana per periode</p>
          <p className="my-1 text-2xl sm:text-3xl font-extrabold tracking-tight">
            {rupiah(circle.memberCount * circle.contributionAmount)}
          </p>
          <p className="text-xs sm:text-sm text-stone-500">
            {circle.memberCount} anggota × {rupiah(circle.contributionAmount)}
          </p>
        </Card>
        <Card className="p-4 sm:p-5">
          <p className="text-xs sm:text-sm text-stone-500">Penerima periode ini</p>
          <p className="my-1 text-2xl sm:text-3xl font-extrabold tracking-tight">
            {currentRecipient ? currentRecipient.name : "Belum ditentukan"}
          </p>
          <p className="text-xs sm:text-sm text-stone-500">
            {currentPeriod
              ? `Giliran #${currentPeriod.periodNo} · Tenggat ${formatDate(currentPeriod.dueDate)}`
              : "Menunggu kelompok dimulai"}
          </p>
        </Card>
        <Card className="p-4 sm:p-5 sm:col-span-2 lg:col-span-1">
          <p className="text-xs sm:text-sm text-stone-500">
            {circle.status === "active" ? "Progres iuran periode ini" : "Progres anggota"}
          </p>
          <p className="my-1 text-2xl sm:text-3xl font-extrabold tracking-tight">
            {circle.status === "active"
              ? `${paidCount} dari ${members.length}`
              : `${members.length} dari ${circle.memberCount}`}
          </p>
          <div className="mt-2 h-2 rounded-full bg-sand">
            <div
              className="h-2 rounded-full bg-brand"
              style={{
                width: `${
                  circle.status === "active"
                    ? (paidCount / Math.max(members.length, 1)) * 100
                    : (members.length / Math.max(circle.memberCount, 1)) * 100
                }%`,
              }}
            />
          </div>
        </Card>
      </div>

      {/* Main Grid: Members table + Sidebar */}
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr] xl:grid-cols-[1.8fr_1.2fr]">
        <div className="space-y-6">
          <Card className="overflow-x-auto">
            <div className="mb-4">
              <h2 className="text-lg sm:text-xl font-extrabold">Daftar anggota & status iuran</h2>
              <p className="text-xs text-stone-500">
                {currentPeriod
                  ? `Status pembayaran untuk Periode ${currentPeriod.periodNo}`
                  : "Daftar anggota yang sudah bergabung"}
              </p>
            </div>
            <table className="w-full min-w-[540px] text-sm">
              <thead>
                <tr>
                  <Th>Giliran</Th>
                  <Th>Nama</Th>
                  <Th>ID</Th>
                  <Th>Status</Th>
                  <Th>Penalti</Th>
                  <Th>Aksi</Th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.memberId} className={m.isMe ? "bg-amber-50/60" : ""}>
                    <Td>
                      <span className="grid h-6 w-6 place-items-center rounded-full bg-sand text-xs font-bold">
                        {m.turnOrder ?? "–"}
                      </span>
                    </Td>
                    <Td>
                      <span className="font-semibold block">
                        {m.name} {m.isMe && "(Anda)"}
                      </span>
                    </Td>
                    <Td>
                      <Mono>{m.memberRef}</Mono>
                    </Td>
                    <Td>
                      {m.currentPayment === null ? (
                        <Badge tone="gray">Belum ada tagihan</Badge>
                      ) : m.currentPayment.paid ? (
                        <Badge tone="green">Lunas</Badge>
                      ) : m.currentPayment.status === "SETTLED_PENDING_CHAIN" ? (
                        <Badge tone="purple">Menunggu rantai</Badge>
                      ) : (
                        <Badge tone="red">Belum bayar</Badge>
                      )}
                    </Td>
                    <Td>
                      {m.currentPayment?.penaltyDue ? (
                        <span className="font-semibold text-red-700">
                          {rupiah(m.currentPayment.penaltyDue)}
                        </span>
                      ) : (
                        <span className="text-stone-400">–</span>
                      )}
                    </Td>
                    <Td>
                      {m.isMe && m.currentPayment && !m.currentPayment.paid ? (
                        <Link to={`/groups/${circle.id}/pay`}>
                          <Button className="!px-3 !py-1 text-xs">Bayar</Button>
                        </Link>
                      ) : (
                        <span className="text-xs text-stone-400">–</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Draft Invitation Section */}
          {isCreator && circle.status === "draft" && (
            <Card className="space-y-4">
              <div>
                <h2 className="text-lg font-extrabold">Undang anggota baru</h2>
                <p className="text-xs text-stone-500">
                  Masukkan email pengguna yang sudah terdaftar untuk menambahkan ke kelompok ({members.length}/{circle.memberCount}).
                </p>
              </div>
              <form onSubmit={handleInvite} className="flex gap-2">
                <div className="flex-1">
                  <Field label="Email anggota">
                    <Input
                      type="email"
                      required
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="contoh@domain.id"
                    />
                  </Field>
                </div>
                <div className="self-end pb-1">
                  <Button disabled={inviteLoading || members.length >= circle.memberCount}>
                    {inviteLoading ? "Menambahkan..." : "Tambah"}
                  </Button>
                </div>
              </form>

              {members.length >= circle.memberCount && (
                <div className="rounded-xl bg-mint/50 p-4 space-y-2">
                  <b className="text-brand text-sm">Anggota sudah lengkap ({members.length}/{circle.memberCount})</b>
                  <p className="text-xs text-stone-600">
                    Klik tombol di bawah untuk mengunci aturan dan mencatat kelompok ke smart contract Sepolia.
                  </p>
                  <Button onClick={handleStartCircle} disabled={inviteLoading} className="w-full">
                    Mulai kelompok sekarang
                  </Button>
                </div>
              )}
            </Card>
          )}
        </div>

        {/* Sidebar: Periods & Rules */}
        <div className="space-y-6">
          <Card className="space-y-3">
            <h2 className="text-lg sm:text-xl font-extrabold">Jadwal periode arisan</h2>
            <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
              {periods && periods.length > 0 ? (
                periods.map((p) => {
                  const recipient = members.find((m) => m.memberId === p.recipientMemberId);
                  const isRunning = p.status === "running";
                  const isDone = p.status === "done";
                  const isReady = p.status === "ready_payout";

                  return (
                    <div
                      key={p.id}
                      className={`flex items-center justify-between rounded-xl border p-2.5 sm:p-3 text-xs sm:text-sm ${
                        isRunning
                          ? "border-brand bg-mint/40 font-semibold"
                          : "border-sand bg-white"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 sm:gap-3">
                        <span className="grid h-5 w-5 sm:h-6 sm:w-6 shrink-0 place-items-center rounded-full bg-sand text-xs font-bold">
                          {p.periodNo}
                        </span>
                        <div>
                          <div>Periode {p.periodNo} · {formatDate(p.dueDate)}</div>
                          <div className="text-xs text-stone-500">
                            Penerima: {recipient ? recipient.name : "–"}
                          </div>
                        </div>
                      </div>
                      <Badge
                        tone={
                          isDone
                            ? "green"
                            : isReady
                            ? "green"
                            : isRunning
                            ? "amber"
                            : "gray"
                        }
                      >
                        {isDone
                          ? "Selesai"
                          : isReady
                          ? "Siap cair"
                          : isRunning
                          ? "Berjalan"
                          : "Terjadwal"}
                      </Badge>
                    </div>
                  );
                })
              ) : (
                <p className="text-xs text-stone-500">Periode akan dibuat setelah kelompok dimulai.</p>
              )}
            </div>
          </Card>

          <Card className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-base sm:text-lg font-extrabold">Aturan kelompok</h2>
              <Badge tone="purple">Smart Contract</Badge>
            </div>
            {[
              ["Iuran per periode", rupiah(circle.contributionAmount)],
              ["Periode", `${circle.periodDays} hari`],
              ["Penalti keterlambatan", `${circle.penaltyPct}% per hari`],
              ["Biaya admin", rupiah(circle.adminFee)],
              ["Kuorum usulan", `${Math.floor(circle.memberCount / 2) + 1} dari ${circle.memberCount} anggota`],
              ["Alamat contract", shortenHash(CONTRACT_ADDRESS, 6)],
              ["ID On-Chain", circle.chainCircleId ? `#${circle.chainCircleId}` : "Belum tercatat"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between border-t border-sand pt-2.5 text-xs sm:text-sm">
                <span className="text-stone-500">{k}</span>
                {k === "Alamat contract" || k === "ID On-Chain" ? <Mono>{v}</Mono> : <b>{v}</b>}
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}
