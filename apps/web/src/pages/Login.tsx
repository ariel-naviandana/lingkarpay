import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";

export default function Login() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      if (mode === "login") await login(email, password);
      else await register(name, email, password);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal");
    }
  }

  return (
    <div className="page">
      <form className="card" onSubmit={submit}>
        <h1>LingkarPay</h1>
        <p className="muted">Hanya data dummy (sandbox).</p>
        {mode === "register" && (
          <>
            <label>Nama</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </>
        )}
        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label>Kata sandi (min. 8 karakter)</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p className="error">{error}</p>}
        <button type="submit">{mode === "login" ? "Masuk" : "Daftar"}</button>{" "}
        <button type="button" className="secondary" onClick={() => setMode(mode === "login" ? "register" : "login")}>
          {mode === "login" ? "Belum punya akun" : "Sudah punya akun"}
        </button>
      </form>
    </div>
  );
}
