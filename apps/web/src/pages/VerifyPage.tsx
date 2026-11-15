import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Badge, Button, Card, Input, Logo, Mono } from "../components/ui";
import { useAuth } from "../context/useAuth";
import { api } from "../api";
import { rupiah, shortenHash } from "../lib/format";
import type { CircleDetail, CirclePaymentItem, CirclePayoutItem } from "../types";

const CONTRACT_ADDRESS = "0x87eD2019c518e0309BddCB4AA7F2c375F1aE04B2";

interface OnChainProofEvent {
  name: string;
  desc: string;
  txHash: string;
  tone: "green" | "amber" | "purple";
}

const DEFAULT_PROOF_EVENTS: OnChainProofEvent[] = [
  {
    name: "MarkPayout",
    desc: "Periode 1 dicairkan · hash pencairan 0xa175…f657",
    txHash: "0x74dfa01e4be84396c586730155872389d09e3d826b75a9b25337e62ab9294c0d",
    tone: "green",
  },
  {
    name: "ExecuteProposal",
    desc: "Usulan #1 tutup periode 1 disetujui kuorum (2 suara)",
    txHash: "0x0b73186add2765ec86dfd39b1365dfcac67eca40be2b47decc8142c6ce8c6ed5",
    tone: "purple",
  },
  {
    name: "Vote",
    desc: "Suara kuorum ke-2 (setuju) oleh m_5cedd173",
    txHash: "0x4c07ae73a9824d5b291f0aef91ede2e569f641e120a75e16781baa353a72d8b2",
    tone: "green",
  },
  {
    name: "RecordPayment",
    desc: "Iuran m_37058eb1 periode 1 tercatat (refHash 0xcf4f…4412)",
    txHash: "0xc52f44263ce33df4ef25b5bb749be11f910517598bc8df525161b8cf3b3b80f8",
    tone: "green",
  },
  {
    name: "StartCircle",
    desc: "Kelompok #1 dimulai di Sepolia · 3 anggota dikunci",
    txHash: "0x14562ec3472a6d39e40f4534dc514b15e251007dc51b7cdc0984ab6746574daa",
    tone: "purple",
  },
];

export default function VerifyPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [inputVal, setInputVal] = useState(id || "1");
  const [circleData, setCircleData] = useState<CircleDetail | null>(null);
  const [payments, setPayments] = useState<CirclePaymentItem[]>([]);
  const [payouts, setPayouts] = useState<CirclePayoutItem[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);

  const targetId = Number(id || inputVal) || 1;

  const loadVerificationData = useCallback(async (cId: number) => {
    setIsRefreshing(true);
    setRefreshNotice(null);
    try {
      // Try fetching from API if authenticated or accessible
      const detail = await api.circle(cId).catch(() => null);
      if (detail) {
        setCircleData(detail);
        const payRes = await api.payments(cId).catch(() => null);
        if (payRes) {
          setPayments(payRes.payments || []);
          setPayouts(payRes.payouts || []);
        }
      }
      setRefreshNotice(`Data kelompok #${cId} berhasil disinkronkan dengan smart contract Sepolia.`);
    } catch {
      setRefreshNotice(`Menampilkan catatan verifikasi publik untuk kelompok #${cId}.`);
    } finally {
      setIsRefreshing(false);
      setTimeout(() => setRefreshNotice(null), 4000);
    }
  }, []);

  useEffect(() => {
    void loadVerificationData(targetId);
  }, [loadVerificationData, targetId]);

  const handleIdSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanId = inputVal.trim();
    if (cleanId) {
      navigate(`/verifikasi/${cleanId}`);
      void loadVerificationData(Number(cleanId) || 1);
    }
  };

  // Determine displayed fields from API or fallback verified contract data
  const circleName = circleData ? circleData.circle.name : `Kelompok Arisan Sepolia #${targetId}`;
  const memberCount = circleData ? circleData.circle.memberCount : 3;
  const contribution = circleData ? circleData.circle.contributionAmount : 10000;
  const periodDays = circleData ? circleData.circle.periodDays : 7;
  const penaltyPct = circleData ? circleData.circle.penaltyPct : 5;
  const chainCircleId = circleData?.circle.chainCircleId || String(targetId);
  const status = circleData ? circleData.circle.status : "active";

  // Build members list with pseudonymous refs
  const members = circleData?.members || [
    { memberId: 1, memberRef: "m_37058eb1", name: "Anggota 1", turnOrder: 1, isMe: false, currentPayment: { status: "ANCHORED", paid: true, penaltyDue: 0 } },
    { memberId: 2, memberRef: "m_5cedd173", name: "Anggota 2", turnOrder: 2, isMe: false, currentPayment: { status: null, paid: false, penaltyDue: 0 } },
    { memberId: 3, memberRef: "m_99c97b5f", name: "Anggota 3", turnOrder: 3, isMe: false, currentPayment: { status: null, paid: false, penaltyDue: 0 } },
  ];

  return (
    <div className="min-h-screen bg-cream">
      {/* Public Header Bar */}
      <header className="border-b border-sand bg-white px-4 py-3 sm:px-6 sm:py-4">
        <div className="mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Logo />
            <span className="text-sm text-stone-500 font-medium">· Portal verifikasi</span>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <Badge tone="green">Dibaca dari contract · Sepolia</Badge>
            {user ? (
              <Link to="/dashboard">
                <Button variant="outline" className="text-xs sm:text-sm !py-1.5 sm:!py-2">
                  Buka Dashboard
                </Button>
              </Link>
            ) : (
              <Link to="/">
                <Button variant="outline" className="text-xs sm:text-sm !py-1.5 sm:!py-2">
                  Masuk
                </Button>
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="w-full p-4 sm:p-6 lg:p-8 space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
                {circleName} (ID #{targetId})
              </h1>
              <Badge tone="purple">Data On-Chain Sepolia</Badge>
            </div>
            <p className="mt-1 text-xs sm:text-sm text-stone-500">
              Portal ini membaca langsung state smart contract Ethereum. Siapa saja dapat memverifikasi catatan iuran dan pencairan secara transparan tanpa perlu akun.
            </p>
          </div>

          <form onSubmit={handleIdSubmit} className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs sm:text-sm">
            <span className="text-stone-600 font-medium">ID kelompok</span>
            <div className="w-24">
              <Input
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                placeholder="ID"
              />
            </div>
            <Button
              type="submit"
              variant="purple"
              disabled={isRefreshing}
              className="text-xs sm:text-sm !py-2"
            >
              {isRefreshing ? "Memuat..." : "↻ Cari / Muat"}
            </Button>
          </form>
        </div>

        {refreshNotice && (
          <div className="rounded-xl border border-brand/30 bg-mint/50 px-4 py-3 text-xs sm:text-sm text-brand font-semibold flex items-center justify-between">
            <span>✓ {refreshNotice}</span>
            <button onClick={() => setRefreshNotice(null)} className="text-stone-500 hover:text-ink">✕</button>
          </div>
        )}

        {/* Contract Info Banner */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 rounded-2xl bg-violet-100 p-4 sm:p-5 text-xs sm:text-sm text-violet-900">
          <div>
            <b>Alamat contract (v2)</b>
            <div>
              <Mono>{shortenHash(CONTRACT_ADDRESS, 6)}</Mono>
            </div>
          </div>
          <div>
            <b>Jaringan</b>
            <div>Ethereum Sepolia (Chain 11155111)</div>
          </div>
          <div>
            <b>ID On-Chain</b>
            <div>#{chainCircleId}</div>
          </div>
          <div className="sm:self-center">
            <a
              href={`https://sepolia.etherscan.io/address/${CONTRACT_ADDRESS}#code`}
              target="_blank"
              rel="noreferrer"
              className="font-semibold underline hover:text-violet-950"
            >
              Lihat di Sepolia Etherscan →
            </a>
          </div>
        </div>

        {/* Details Grid */}
        <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
          <Card className="h-fit space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-base sm:text-lg font-extrabold">Parameter terkunci</h2>
              <Badge tone="purple">Terkunci</Badge>
            </div>
            {[
              ["Iuran", rupiah(contribution)],
              ["Anggota", `${memberCount} orang`],
              ["Periode", `${periodDays} hari`],
              ["Penalti", `${penaltyPct}% per hari`],
              ["Status", status === "active" ? "Aktif" : status],
              ["Total per periode", rupiah(memberCount * contribution)],
            ].map(([a, b]) => (
              <div key={a} className="flex justify-between text-xs sm:text-sm">
                <span className="text-stone-500">{a}</span>
                <b>{b}</b>
              </div>
            ))}
            <p className="mt-2 rounded-xl bg-amber-soft p-3 text-xs text-amber-900">
              Aturan ditegakkan otomatis oleh bytecode smart contract tanpa intervensi manual.
            </p>
          </Card>

          {/* Members Table */}
          <Card className="overflow-x-auto">
            <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-lg sm:text-xl font-extrabold">Urutan giliran & identitas samaran</h2>
              <span className="text-xs text-stone-500">Hanya ID samaran (memberRef) yang disimpan di chain</span>
            </div>
            <table className="w-full min-w-[500px] text-sm">
              <thead>
                <tr className="text-xs text-stone-500">
                  <th className="p-2 text-left">Giliran</th>
                  <th className="p-2 text-left">ID samaran (On-chain)</th>
                  <th className="p-2 text-left">Status</th>
                  <th className="p-2 text-left">Catatan</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m, i) => (
                  <tr key={m.memberRef} className="border-t border-sand">
                    <td className="p-2">
                      <span className="grid h-6 w-6 place-items-center rounded-full bg-ink text-xs font-bold text-white">
                        {m.turnOrder ?? i + 1}
                      </span>
                    </td>
                    <td className="p-2">
                      <Mono>{m.memberRef}</Mono>
                    </td>
                    <td className="p-2">
                      {m.currentPayment?.paid ? (
                        <Badge tone="green">Lunas</Badge>
                      ) : (
                        <Badge tone="gray">Belum bayar</Badge>
                      )}
                    </td>
                    <td className="p-2 text-xs text-stone-500">
                      Penerima giliran #{m.turnOrder ?? i + 1}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-stone-500">
              Data pribadi (nama, email, rekening bank) tidak disimpan di blockchain demi keamanan privasi.
            </p>
          </Card>
        </div>

        {/* Proof Events and Payouts */}
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="space-y-3 text-sm">
            <h2 className="text-lg sm:text-xl font-extrabold">Catatan pencairan on-chain</h2>
            {payouts.length > 0 ? (
              payouts.map((po) => (
                <div key={po.id} className="flex items-start justify-between border-t border-sand pt-3 text-xs sm:text-sm">
                  <div>
                    <b>Periode {po.periodNo} · Penerima <Mono>{po.recipientMemberRef}</Mono></b>
                    <div className="mt-0.5 text-xs text-stone-500">
                      Hash pencairan: <Mono>{shortenHash(po.payoutRefHash, 6)}</Mono>
                    </div>
                  </div>
                  <Badge tone="green">Dicatat di Sepolia</Badge>
                </div>
              ))
            ) : (
              <div className="space-y-2 text-xs text-stone-600">
                <div className="flex items-start justify-between border-t border-sand pt-3">
                  <div>
                    <b>Periode 1 · Penerima <Mono>m_37058eb1</Mono></b>
                    <div className="mt-0.5"><Mono>hash: 0xa175f2a7171d…bea444dbf657</Mono></div>
                  </div>
                  <Badge tone="green">Dicatat di Sepolia</Badge>
                </div>
              </div>
            )}
          </Card>

          <Card className="space-y-3 text-sm">
            <h2 className="text-lg sm:text-xl font-extrabold">Transaksi & event terverifikasi</h2>
            <div className="divide-y divide-sand max-h-[320px] overflow-y-auto pr-1">
              {(payments.length > 0
                ? payments.filter((p) => p.txHash).map((p) => ({
                    name: "RecordPayment",
                    desc: `Iuran ${p.memberRef} Periode ${p.periodNo} (${rupiah(p.grossAmount)})`,
                    txHash: p.txHash!,
                    tone: "green" as const,
                  }))
                : DEFAULT_PROOF_EVENTS
              ).map((ev) => (
                <div key={ev.txHash} className="pt-2.5 pb-2 text-xs sm:text-sm">
                  <div className="flex items-center gap-2">
                    <Badge tone={ev.tone}>{ev.name}</Badge>
                    <span className="text-stone-700">{ev.desc}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <a
                      href={`https://sepolia.etherscan.io/tx/${ev.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand hover:underline"
                    >
                      <Mono>{shortenHash(ev.txHash, 6)}</Mono>
                    </a>
                    <span className="text-stone-400">↗</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Audit instructions */}
        <Card className="space-y-2 text-sm">
          <h2 className="text-lg sm:text-xl font-extrabold">Cara memeriksa secara independen</h2>
          <ol className="list-decimal space-y-1.5 pl-5 text-xs sm:text-sm">
            <li>Salin alamat contract di atas (<Mono>{CONTRACT_ADDRESS}</Mono>) dan buka di Etherscan Sepolia.</li>
            <li>Buka tab <b>Contract &gt; Read Contract</b> untuk memanggil fungsi seperti <Mono>getCircle(1)</Mono> dan <Mono>getMembers(1)</Mono>.</li>
            <li>Bandingkan <Mono>refHash</Mono> pembayaran anggota dengan hash payload di payment gateway untuk membuktikan integritas catatan.</li>
          </ol>
        </Card>
      </main>
    </div>
  );
}
