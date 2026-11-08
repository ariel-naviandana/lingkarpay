import { useRef, useState } from "react";
import { api } from "../api";
import { PAID_STATUSES, type OrderStatus } from "../types";

// Tipe minimal untuk snap.js (dimuat dinamis dari URL di /public-config).
declare global {
  interface Window {
    snap?: { pay: (token: string, options?: Record<string, unknown>) => void };
  }
}

function loadSnap(src: string, clientKey: string): Promise<void> {
  if (window.snap) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.setAttribute("data-client-key", clientKey);
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Gagal memuat Snap"));
    document.body.appendChild(s);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Props {
  circleId: number;
  periodId: number;
  memberId: number;
  onPaid?: () => void;
}

/**
 * Alur bayar: POST /checkout -> snap.pay(token) -> polling GET /orders/:orderId.
 * Status bayar hanya dari backend (sumber kebenaran: webhook), bukan dari callback Snap.
 */
export default function PayButton({ circleId, periodId, memberId, onPaid }: Props) {
  const [state, setState] = useState<"idle" | "loading" | "waiting" | "paid" | "failed" | "error">("idle");
  const [message, setMessage] = useState("");
  const cancelled = useRef(false);

  async function poll(orderId: string) {
    const deadline = Date.now() + 10 * 60_000;
    while (!cancelled.current && Date.now() < deadline) {
      const o = await api.order(orderId);
      const status: OrderStatus = o.status;
      if (PAID_STATUSES.includes(status)) {
        setState("paid");
        setMessage(status === "ANCHORED" ? "Lunas dan tercatat di blockchain." : "Lunas. Menunggu pencatatan di blockchain.");
        onPaid?.();
        return;
      }
      if (status === "FAILED" || status === "EXPIRED") {
        setState("failed");
        setMessage(`Pembayaran ${status === "FAILED" ? "gagal" : "kedaluwarsa"}. Coba lagi.`);
        return;
      }
      await sleep(3000);
    }
  }

  async function pay() {
    setState("loading");
    setMessage("");
    try {
      const cfg = await api.publicConfig();
      await loadSnap(cfg.snapJsUrl, cfg.midtransClientKey);
      const co = await api.checkout({ circleId, periodId, memberId });
      if (!co.token) throw new Error("Token pembayaran belum tersedia, coba lagi");
      setMessage(`Tagihan Rp${co.grossAmount.toLocaleString("id-ID")} (iuran + penalti + biaya layanan)`);
      window.snap?.pay(co.token); // TODO(frontend): tangani callback onClose/onError bila perlu
      setState("waiting");
      await poll(co.orderId);
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "Gagal");
    }
  }

  return (
    <div>
      <button onClick={pay} disabled={state === "loading" || state === "waiting" || state === "paid"}>
        {state === "waiting" ? "Menunggu pembayaran..." : "Bayar iuran"}
      </button>
      {message && <p className={state === "paid" ? "ok" : state === "error" || state === "failed" ? "error" : "muted"}>{message}</p>}
    </div>
  );
}
