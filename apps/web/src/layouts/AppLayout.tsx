import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Logo } from "../components/ui";
import { useAuth } from "../context/useAuth";
import AppHeader from "../components/layout/AppHeader";

const baseNav = [
  ["/dashboard", "Dashboard"],
  ["/groups/new", "Buat kelompok"],
  ["/history", "Riwayat"],
  ["/verifikasi/1", "Verifikasi publik"],
];

const adminNav = [["/operator", "Operator"]];

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Build nav: include "Operator" only for admin users
  const nav = user?.role === "admin" ? [...baseNav, ...adminNav] : baseNav;

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Mobile Topbar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-sand bg-white px-4 py-3 md:hidden">
        <Logo />
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-sand bg-cream/70 text-ink focus:outline-none"
          aria-label="Buka Menu"
        >
          {mobileMenuOpen ? (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </header>

      {/* Mobile Drawer Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div
            className="fixed inset-0 bg-ink/40 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative flex w-64 max-w-[80vw] flex-1 flex-col bg-white p-4 shadow-xl">
            <div className="flex items-center justify-between px-2 py-2">
              <Logo />
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-lg p-1.5 text-stone-500 hover:bg-cream"
                aria-label="Tutup Menu"
              >
                ✕
              </button>
            </div>
            <nav className="mt-4 flex flex-col gap-1">
              {nav.map(([to, label]) => (
                <NavLink
                  key={to}
                  to={to}
                  end
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                      isActive ? "bg-mint text-brand" : "text-stone-600 hover:bg-cream"
                    }`
                  }
                >
                  {label}
                </NavLink>
              ))}
            </nav>
            <div className="mt-auto flex items-center justify-between gap-2 rounded-xl bg-cream p-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-white">
                  {user?.initials || "?"}
                </span>
                <div className="min-w-0 text-sm">
                  <b className="block truncate">{user?.name || "Pengguna"}</b>
                  <div className="truncate text-xs text-stone-500">
                    {user?.email || ""}
                  </div>
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-stone-500 transition hover:bg-white hover:text-red-700"
                title="Keluar dari akun"
              >
                Keluar
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Desktop Sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-sand bg-white p-4 md:flex">
        <div className="px-3 py-3">
          <Logo />
        </div>
        <nav className="mt-4 flex flex-col gap-1">
          {nav.map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              end
              className={({ isActive }) =>
                `rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                  isActive ? "bg-mint text-brand" : "text-stone-600 hover:bg-cream"
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex items-center justify-between gap-2 rounded-xl bg-cream p-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-white">
              {user?.initials || "?"}
            </span>
            <div className="min-w-0 text-sm">
              <b className="block truncate">{user?.name || "Pengguna"}</b>
              <div className="truncate text-xs text-stone-500">
                {user?.email || ""}
              </div>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-stone-500 transition hover:bg-white hover:text-red-700"
            title="Keluar dari akun"
          >
            Keluar
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
        <AppHeader />
        <Outlet />
      </main>
    </div>
  );
}
