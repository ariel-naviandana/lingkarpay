import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Badge, Button } from "../ui";
import { useAuth } from "../../context/useAuth";

/** Breadcrumb config: route prefix → [label, optional status badge] */
const breadcrumbs: Record<string, [string, string?, string?]> = {
  "/dashboard": ["Dashboard"],
  "/groups/new": ["Dashboard", "Buat kelompok"],
  "/groups/": ["Dashboard", "Arisan Kantor DPE"],
  "/history": ["Dashboard", "Riwayat"],
  "/operator": ["Dashboard", "Operator Console"],
};

function getBreadcrumb(pathname: string): { parent: string; current: string; badge?: string } {
  // Check most specific routes first
  for (const [prefix, parts] of Object.entries(breadcrumbs)) {
    if (pathname.startsWith(prefix)) {
      if (parts.length === 1) {
        return { parent: "", current: parts[0] };
      }
      return { parent: parts[0], current: parts[1]! };
    }
  }
  return { parent: "", current: "Dashboard" };
}

function getPageBadge(pathname: string): { label: string; tone: "green" | "amber" | "gray" } | null {
  if (pathname.startsWith("/groups/") && pathname !== "/groups/new") {
    return { label: "Berjalan", tone: "green" };
  }
  if (pathname === "/operator") {
    return { label: "Admin Only", tone: "amber" };
  }
  return null;
}

export default function AppHeader() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const bc = getBreadcrumb(location.pathname);
  const pageBadge = getPageBadge(location.pathname);
  const firstName = user?.name?.split(/\s+/)[0] || "User";

  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sand bg-white px-4 py-2.5 sm:px-5 sm:py-3">
      {/* Left: Breadcrumb */}
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        {bc.parent && (
          <>
            <Link
              to="/dashboard"
              className="text-stone-500 hover:text-brand font-medium transition"
            >
              {bc.parent}
            </Link>
            <span className="text-stone-400">›</span>
          </>
        )}
        <span className="font-extrabold text-ink">{bc.current}</span>
        {pageBadge && <Badge tone={pageBadge.tone}>{pageBadge.label}</Badge>}
      </div>

      {/* Right: badges + actions + user */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        {/* Environment badges */}
        <Badge tone="amber">Sandbox · tanpa uang nyata</Badge>
        <Badge tone="green">Sepolia</Badge>

        {/* Notification bell */}
        <button
          className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-sand bg-white text-stone-600 transition hover:bg-cream"
          title="Notifikasi"
        >
          <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          <span className="absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
            2
          </span>
        </button>

        {/* CTA button – context-aware */}
        {location.pathname.startsWith("/groups/") && location.pathname !== "/groups/new" && (
          <Link to="/groups/1/pay">
            <Button className="!px-3.5 !py-2 text-xs sm:text-sm">Bayar iuran</Button>
          </Link>
        )}
        {location.pathname === "/dashboard" && (
          <Link to="/groups/new">
            <Button className="!px-3.5 !py-2 text-xs sm:text-sm">+ Buat kelompok</Button>
          </Link>
        )}

        {/* User pill */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-2 rounded-full border border-sand bg-white py-1 pl-1 pr-3 transition hover:bg-cream"
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand text-[11px] font-bold text-white">
              {user?.initials || "DP"}
            </span>
            <span className="text-sm font-semibold text-ink">{firstName}</span>
            <svg className="h-3.5 w-3.5 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full z-50 mt-2 w-48 rounded-xl border border-sand bg-white p-1.5 shadow-lg">
                <div className="px-3 py-2 text-xs text-stone-500 truncate">
                  {user?.email || "dimas@contoh.id"}
                </div>
                <hr className="border-sand my-1" />
                <button
                  onClick={() => { setMenuOpen(false); logout(); }}
                  className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-red-700 transition hover:bg-red-50"
                >
                  Keluar
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
