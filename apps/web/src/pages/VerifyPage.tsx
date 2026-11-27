import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Badge, Button, Card, ErrorBox, Input, Loading, Mono } from "../components/ui";
import { useAuth } from "../context/useAuth";
import { useAsync } from "../hooks/useAsync";
import { api } from "../api";
import { formatYmd, rupiah, circleStatus } from "../lib/format";
import type { MemberView } from "../types";

// Contract v2 di Sepolia (publik, terverifikasi). Bisa diganti lewat VITE_CONTRACT_ADDRESS.
const CONTRACT_ADDRESS =
  (import.meta.env.VITE_CONTRACT_ADDRESS as string | undefined) ??
  "0x87eD2019c518e0309BddCB4AA7F2c375F1aE04B2";
const ETHERSCAN = `https://sepolia.etherscan.io/address/${CONTRACT_ADDRESS}`;

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Hitung ulang undian di browser: anggota diurutkan menurut SHA-256(seed:ID anggota), sama seperti server. */
async function recomputeDraw(seed: string, refs: string[]): Promise<string[]> {
  const hashed = await Promise.all(refs.map(async (r) => ({ r, h: await sha256Hex(`${seed}:${r}`) })));
  return hashed.sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0)).map((x) => x.r);
}

function DrawCheck({ seed, members }: { seed: string; members: MemberView[] }) {
  const ordered = [...members].filter((m) => m.turnOrder != null).sort((a, b) => a.turnOrder! - b.turnOrder!);
  const refs = ordered.map((m) => m.memberRef);
  const key = `${seed}|${refs.join(",")}`;
  const { data: expected, error } = useAsync(() => recomputeDraw(seed, [...refs].sort()), [key]);
  const match = !!expected && expected.length === refs.length && expected.every((r, i) => r === refs[i]);
  return (
    <div className="mt-3 space-y-2 border-t border-sand pt-3">
      <div className="flex items-center justify-between gap-2">
        <b className="text-xs sm:text-sm">Undian urutan giliran</b>
        {expected && <Badge tone={match ? "green" : "red"}>{match ? "Cocok" : "Tidak cocok"}</Badge>}
      </div>
      <p className="break-all text-xs text-stone-500">
        Seed: <span className="font-mono text-[11px] text-ink">{seed}</span>
      </p>
      <p className="text-xs text-stone-500">
        Browser Anda menghitung ulang SHA-256(seed:ID anggota) dan mengurutkannya.
        {expected && ` Hasil: ${expected.join(" → ")}.`}
        {error && " Browser tidak mendukung Web Crypto, hitung manual dengan sha256sum."}
      </p>
    </div>
  );
}

type Tone = "green" | "amber" | "gray" | "purple" | "red";

/** Status iuran satu anggota pada periode berjalan, dari data backend. */
function paymentLabel(m: MemberView): [string, Tone] {
  const p = m.currentPayment;
  if (!p || !p.paid) return ["Belum bayar", "red"];
  if (p.status === "ANCHORED") return ["Lunas · tercatat di chain", "green"];
  if (p.status === "SETTLED_PENDING_CHAIN") return ["Lunas · menunggu dicatat ke chain", "amber"];
  return ["Lunas di gateway", "amber"];
}

export default function VerifyPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [inputVal, setInputVal] = useState(id || "");
  const targetId = Number(id);
  const validId = Number.isInteger(targetId) && targetId > 0;

  const { data: raw, loading, error, reload } = useAsync(
    () => (validId ? api.publicCircle(targetId) : Promise.resolve(null)),
    [targetId, validId],
  );

  const data = error || !validId ? null : raw;
  const circle = data?.circle ?? null;
  const members = data?.members ?? [];
  const periods = data?.periods ?? [];
  const currentPeriod = data?.currentPeriod ?? null;
  const memberById = new Map(members.map((m) => [m.memberId, m]));
  const paidCount = members.filter((m) => m.currentPayment?.paid).length;
  const anchoredCount = members.filter((m) => m.currentPayment?.status === "ANCHORED").length;

  const handleIdSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = inputVal.trim();
    if (!v) return;
    if (v === id) void reload();
    else navigate(`/verifikasi/${v}`);
  };

  const [syncTime, setSyncTime] = useState(() => new Date());
  const refresh = () => {
    setSyncTime(new Date());
    void reload();
  };
  const syncLabel = syncTime.toLocaleString("id-ID", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  return (
    <div className="min-h-screen bg-cream">
      <header className="border-b border-sand bg-white px-4 py-3 sm:px-6 sm:py-4">
        <div className="mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xl font-extrabold tracking-tight text-brand">LingkarPay</span>
            <span className="text-sm text-stone-500 font-medium">· Portal verifikasi</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <Badge tone="purple">Contract di Sepolia (testnet)</Badge>
            <Link to={user ? "/dashboard" : "/"}>
              <Button variant="outline" className="text-xs sm:text-sm !py-1.5 sm:!py-2">
                {user ? "Buka Dashboard" : "Masuk"}
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="w-full p-4 sm:p-6 lg:p-8 space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              {circle?.name ?? (validId ? `Kelompok #${targetId}` : "Verifikasi kelompok")}
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-stone-500 max-w-3xl">
              Halaman publik tanpa akun. Status iuran di bawah dibaca dari server LingkarPay, dengan anggota
              ditampilkan sebagai ID samaran. Pencatatan yang sama ada di smart contract Sepolia; cocokkan
              lewat tautan Etherscan di bawah.
            </p>
          </div>
          <form onSubmit={handleIdSubmit} className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs sm:text-sm">
            <span className="text-stone-600 font-medium">ID kelompok</span>
            <div className="w-24">
              <Input value={inputVal} onChange={(e) => setInputVal(e.target.value)} placeholder="ID" />
            </div>
            <Button type="submit" variant="purple" className="text-xs sm:text-sm !py-2">
              Cari / Muat Ulang
            </Button>
          </form>
        </div>

        {!validId && (
          <Card className="text-sm text-stone-600">Masukkan ID kelompok untuk melihat status iurannya.</Card>
        )}
        {validId && loading && <Loading />}
        {validId && !loading && error && (
          <ErrorBox message="Kelompok tidak ditemukan atau server tidak dapat dihubungi." onRetry={refresh} />
        )}

        {/* Info chain */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 rounded-2xl bg-violet-100 p-4 sm:p-5 text-xs sm:text-sm text-violet-900">
          <div>
            <b>Alamat contract</b>
            <div className="font-mono text-xs break-all">{CONTRACT_ADDRESS}</div>
          </div>
          <div>
            <b>Chain Circle ID</b>
            <div><Mono>{circle ? (circle.chainCircleId ?? "belum dicatat") : "—"}</Mono></div>
          </div>
          <div>
            <b>Data dimuat</b>
            <div>{syncLabel} WIB</div>
          </div>
          <div className="sm:self-center">
            <a href={ETHERSCAN} target="_blank" rel="noreferrer" className="font-semibold underline hover:text-violet-950">
              Buka contract di Sepolia Etherscan →
            </a>
          </div>
        </div>

        {circle && (
          <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
            <Card className="h-fit space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-base sm:text-lg font-extrabold">Parameter kelompok</h2>
                <Badge tone="purple">Terkunci saat mulai</Badge>
              </div>
              {[
                ["Iuran", rupiah(circle.contributionAmount)],
                ["Anggota", String(circle.memberCount)],
                ["Periode", `${circle.periodDays} hari`],
                ["Penalti", circle.penaltyPct > 0 ? `${circle.penaltyPct}% sekali bila terlambat` : "Tidak ada"],
                ["Status", circleStatus[circle.status]?.[0] ?? circle.status],
                ["Tanggal mulai", formatYmd(circle.startDate)],
              ].map(([a, b]) => (
                <div key={a} className="flex justify-between text-xs sm:text-sm">
                  <span className="text-stone-500">{a}</span>
                  <b>{b}</b>
                </div>
              ))}
              {currentPeriod && (
                <p className="mt-2 rounded-xl bg-amber-soft p-3 text-xs text-amber-900">
                  Periode {currentPeriod.periodNo} berjalan: {paidCount} dari {members.length} iuran lunas,
                  {" "}{anchoredCount} sudah tercatat di chain.
                </p>
              )}
              {circle.drawSeed && members.length > 0 && <DrawCheck seed={circle.drawSeed} members={members} />}
            </Card>

            <Card className="overflow-x-auto">
              <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-lg sm:text-xl font-extrabold">
                  Status iuran{currentPeriod ? ` periode ${currentPeriod.periodNo}` : ""}
                </h2>
                <span className="text-xs text-stone-500">Anggota ditampilkan dengan ID samaran</span>
              </div>
              {members.length === 0 ? (
                <p className="text-sm text-stone-500">Belum ada anggota.</p>
              ) : (
                <table className="w-full min-w-[420px] text-sm">
                  <thead>
                    <tr className="text-xs text-stone-500">
                      <th className="p-2 text-left">Giliran</th>
                      <th className="p-2 text-left">ID anggota</th>
                      <th className="p-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m, i) => {
                      const [label, tone] = paymentLabel(m);
                      return (
                        <tr key={m.memberId} className="border-t border-sand">
                          <td className="p-2">
                            <span className="grid h-6 w-6 sm:h-7 sm:w-7 place-items-center rounded-full bg-ink text-xs font-bold text-white">
                              {m.turnOrder ?? i + 1}
                            </span>
                          </td>
                          <td className="p-2"><Mono>{m.memberRef}</Mono></td>
                          <td className="p-2">
                            {currentPeriod ? <Badge tone={tone}>{label}</Badge> : <Badge tone="gray">Belum berjalan</Badge>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
        )}

        {circle && (
          <Card className="space-y-3 text-sm">
            <h2 className="text-lg sm:text-xl font-extrabold">Riwayat periode dan pencairan</h2>
            {periods.length === 0 && <p className="text-xs text-stone-500">Belum ada periode.</p>}
            {periods.map((p) => {
              const recipient = p.recipientMemberId ? memberById.get(p.recipientMemberId) : undefined;
              return (
                <div key={p.id} className="flex items-start justify-between border-t border-sand pt-3 text-xs sm:text-sm">
                  <div>
                    <b>Periode {p.periodNo}</b>
                    <div className="mt-0.5 text-stone-500">
                      Jatuh tempo {new Date(p.dueDate).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
                      {recipient && <> · penerima <Mono>{recipient.memberRef}</Mono></>}
                    </div>
                  </div>
                  <Badge tone={p.status === "done" ? "green" : p.status === "ready_payout" ? "amber" : p.status === "running" ? "purple" : "gray"}>
                    {p.status === "done" ? "Pencairan dicatat" : p.status === "ready_payout" ? "Siap cair" : p.status === "running" ? "Berjalan" : "Mendatang"}
                  </Badge>
                </div>
              );
            })}
          </Card>
        )}

        <Card className="space-y-2 text-sm">
          <h2 className="text-lg sm:text-xl font-extrabold">Periksa sendiri tanpa mempercayai kami</h2>
          <ol className="list-decimal space-y-1.5 pl-5 text-xs sm:text-sm">
            <li>Buka tautan contract di atas pada block explorer Sepolia (tab Events atau Transactions).</li>
            <li>Cocokkan Chain Circle ID dan event <Mono>PaymentRecorded</Mono> / <Mono>PayoutMarked</Mono> dengan status di halaman ini.</li>
            <li>
              Minta bukti pembayaran dari anggota, lalu bandingkan hash referensinya dengan{" "}
              <Mono>refHash</Mono> pada event PaymentRecorded.
            </li>
          </ol>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="text-xs !py-2" onClick={refresh}>
              Muat ulang data
            </Button>
          </div>
          <p className="text-xs text-stone-500 pt-1">
            Batasan: halaman ini membaca database server, bukan langsung dari node blockchain. Pencatatan ke contract
            dilakukan backend sebagai operator tepercaya; hash referensi memungkinkan audit silang dengan catatan gateway.
            Dana tidak disimpan di contract.
          </p>
        </Card>
      </main>
    </div>
  );
}
