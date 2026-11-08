import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import type { Circle } from "../types";

const rupiah = (n: number) => "Rp" + n.toLocaleString("id-ID");

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [circles, setCircles] = useState<Circle[]>([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", contributionAmount: 100000, memberCount: 3, periodDays: 7, penaltyPct: 5 });

  const load = () => api.circles().then((r) => setCircles(r.circles)).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.createCircle(form);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal");
    }
  }

  return (
    <div className="page">
      <div className="card">
        <h1>Halo, {user?.name}</h1>
        <button className="secondary" onClick={logout}>Keluar</button>
      </div>

      <div className="card">
        <h2>Kelompok saya</h2>
        {circles.length === 0 && <p className="muted">Belum ada kelompok.</p>}
        <table>
          <tbody>
            {circles.map((c) => (
              <tr key={c.id}>
                <td><Link to={`/circles/${c.id}`}>{c.name}</Link></td>
                <td>{rupiah(c.contributionAmount)} / {c.periodDays} hari</td>
                <td>{c.joinedCount}/{c.memberCount} anggota</td>
                <td><span className="badge">{c.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form className="card" onSubmit={create}>
        <h2>Buat kelompok</h2>
        <label>Nama</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <label>Iuran per periode (Rp, minimal 1000)</label>
        <input type="number" min={1000} value={form.contributionAmount} onChange={(e) => setForm({ ...form, contributionAmount: Number(e.target.value) })} />
        <label>Jumlah anggota (2-50)</label>
        <input type="number" min={2} max={50} value={form.memberCount} onChange={(e) => setForm({ ...form, memberCount: Number(e.target.value) })} />
        <label>Periode (hari)</label>
        <input type="number" min={1} value={form.periodDays} onChange={(e) => setForm({ ...form, periodDays: Number(e.target.value) })} />
        <label>Penalti keterlambatan (%)</label>
        <input type="number" min={0} max={100} value={form.penaltyPct} onChange={(e) => setForm({ ...form, penaltyPct: Number(e.target.value) })} />
        {error && <p className="error">{error}</p>}
        <button type="submit">Buat</button>
      </form>
    </div>
  );
}
