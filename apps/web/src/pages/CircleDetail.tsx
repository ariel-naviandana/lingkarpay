import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import PayButton from "../components/PayButton";
import type { CircleDetail } from "../types";

export default function CircleDetailPage() {
  const id = Number(useParams().id);
  const [data, setData] = useState<CircleDetail | null>(null);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");

  const load = useCallback(() => {
    api.circle(id).then(setData).catch((e: Error) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  async function invite(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.addMember(id, email);
      setEmail("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal");
    }
  }

  async function start() {
    setError("");
    try {
      await api.startCircle(id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal");
    }
  }

  if (!data) return <div className="page">{error ? <p className="error">{error}</p> : "Memuat..."}</div>;
  const { circle, members, currentPeriod, isCreator, myMemberId } = data;
  const me = members.find((m) => m.isMe);
  const canPay = circle.status === "active" && currentPeriod?.status === "running" && me?.currentPayment && !me.currentPayment.paid;

  return (
    <div className="page">
      <p><Link to="/">&larr; Kembali</Link></p>
      <div className="card">
        <h1>{circle.name}</h1>
        <p className="muted">
          Rp{circle.contributionAmount.toLocaleString("id-ID")} per {circle.periodDays} hari, penalti {circle.penaltyPct}% ·
          status <span className="badge">{circle.status}</span>
        </p>
        {/* Portal verifikasi publik tersedia setelah kelompok tercatat di chain. */}
        {circle.chainCircleId ? (
          <p><Link to={`/verify/${circle.chainCircleId}`}>Verifikasi di blockchain</Link></p>
        ) : (
          <p className="muted">Belum tercatat di blockchain.</p>
        )}
        {error && <p className="error">{error}</p>}
      </div>

      <div className="card">
        <h2>Anggota {currentPeriod && `· periode ${currentPeriod.periodNo}`}</h2>
        <table>
          <thead><tr><th>Giliran</th><th>Nama</th><th>Iuran periode ini</th></tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.memberId}>
                <td>{m.turnOrder ?? "-"}</td>
                <td>{m.name}{m.isMe && " (saya)"}</td>
                <td>
                  {m.currentPayment === null ? "-" : m.currentPayment.paid ? <span className="ok">Lunas</span> : (m.currentPayment.status ?? "Belum bayar")}
                  {m.currentPayment && m.currentPayment.penaltyDue > 0 && <span className="error"> · denda Rp{m.currentPayment.penaltyDue.toLocaleString("id-ID")}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canPay && currentPeriod && (
        <div className="card">
          <h2>Bayar iuran</h2>
          <PayButton circleId={circle.id} periodId={currentPeriod.id} memberId={myMemberId} onPaid={load} />
        </div>
      )}

      {isCreator && circle.status === "draft" && (
        <div className="card">
          <h2>Undang anggota</h2>
          <form onSubmit={invite}>
            <label>Email pengguna terdaftar</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <button type="submit">Tambah</button>
          </form>
          <button onClick={start} disabled={members.length < circle.memberCount}>
            Mulai kelompok ({members.length}/{circle.memberCount})
          </button>
          <p className="muted">Setelah dimulai, urutan giliran dan parameter terkunci.</p>
        </div>
      )}

      {/* TODO(frontend): (1) tabel semua periode dan penerimanya (data.periods)
                          (2) riwayat pembayaran + status pencairan (api.payments)
                          (3) tombol pencairan untuk operator saat periode "ready_payout" (api.simulatePayout)
                          (4) halaman operator: log webhook dan rekonsiliasi (api.reconciliation) */}
    </div>
  );
}
