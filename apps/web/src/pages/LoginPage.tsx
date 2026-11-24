import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Field, Input, Logo } from "../components/ui";
import { useAuth } from "../context/useAuth";

export default function LoginPage() {
  const [tab, setTab] = useState<"login" | "register">("login");
  const [name, setName] = useState("Dimas Prakoso");
  const [email, setEmail] = useState("dimas@contoh.id");
  const [password, setPassword] = useState("rahasia1234");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { user, login, register } = useAuth();
  const nav = useNavigate();

  useEffect(() => {
    if (user) {
      nav("/dashboard", { replace: true });
    }
  }, [user, nav]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (tab === "register") {
        await register(name, email, password);
      } else {
        await login(email, password);
      }
      nav("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal masuk");
    } finally {
      setLoading(false);
    }
  };

  const legend = [
    ["bg-emerald-300", "Status iuran terlihat oleh seluruh anggota"],
    ["bg-amber-400", "Penerima giliran dikunci sejak kelompok dimulai"],
    ["border-2 border-amber-400", "Penalti keterlambatan sama untuk semua"],
  ];

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col justify-between bg-forest p-6 sm:p-10 lg:p-14 text-white">
        <div>
          <Logo light />
          <h1 className="sm:mt-37 max-w-md lg:text-6xl font-extrabold leading-tight tracking-tight">
            Arisan yang aturannya bisa dicek semua orang.
          </h1>
          <p className="mt-4 sm:mt-5 max-w-md text-sm sm:text-base lg:text-lg text-white/80">
            Bayar iuran lewat VA atau e-wallet. Giliran, penalti, dan status pembayaran dicatat di smart contract, jadi tidak bergantung pada satu pengelola.
          </p>  
        </div>
        <ul className="mt-8 sm:mt-10 space-y-3 text-xs sm:text-sm">
          {legend.map(([c, t]) => (
            <li key={t} className="flex items-center gap-3">
              <i className={`h-3 w-3 shrink-0 rounded-full ${c}`} />
              {t}
            </li>
          ))}
        </ul>
      </div>

      <div className="grid place-items-center p-4 sm:p-8">
        <div className="w-full max-w-md space-y-9">
          <p className="rounded-xl bg-amber-soft p-3 text-xs sm:text-sm text-amber-900">
            Mode prototipe: sandbox payment gateway, Ethereum Sepolia, data dummy. Tidak ada uang nyata.
          </p>
          <div className="grid grid-cols-2 rounded-xl bg-sand p-1 text-sm font-semibold">
            {(["login", "register"] as const).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTab(t);
                  setError(null);
                }}
                className={`rounded-lg py-2.5 transition ${tab === t ? "bg-white" : "text-stone-500 hover:text-ink"}`}
              >
                {t === "login" ? "Masuk" : "Daftar"}
              </button>
            ))}
          </div>

          <div>
            <h2 className="text-xl sm:text-4xl font-extrabold tracking-tight">
              {tab === "login" ? "Selamat datang kembali" : "Buat akun baru"}
            </h2>
            <p className="text-xs sm:text-sm text-stone-500">
              {tab === "login"
                ? "Masuk untuk melihat kelompok arisan Anda."
                : "Daftar untuk bergabung dengan kelompok arisan."}
            </p>
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs sm:text-sm text-red-700">
              {error}
            </div>
          )}

          <form className="space-y-4" onSubmit={handleSubmit}>
            {tab === "register" && (
              <Field label="Nama lengkap">
                <Input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nama lengkap Anda"
                />
              </Field>
            )}
            <Field label="Email">
              <Input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field
              label="Kata sandi"
              hint={tab === "register" ? "Minimal 8 karakter" : undefined}
            >
              <Input
                type="password"
                required
                minLength={tab === "register" ? 8 : 1}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Button className="w-full" disabled={loading}>
              {loading
                ? "Memproses..."
                : tab === "login"
                ? "Masuk ke Dashboard"
                : "Daftar dan Masuk"}
            </Button>
          </form>

          <p className="text-center text-xs sm:text-sm text-stone-500">
            Lupa kata sandi? <a className="font-semibold text-brand underline" href="#">Atur ulang</a>
          </p>
          <p className="text-center text-xs sm:text-sm text-stone-500">
            Hanya ingin memeriksa sebuah kelompok?{" "}
            <Link className="font-semibold text-brand underline" to="/verifikasi/1">
              Buka portal verifikasi publik
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
