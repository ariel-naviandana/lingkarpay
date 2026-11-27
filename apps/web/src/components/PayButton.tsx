import { useRef, useState } from "react";
import { api, ApiError } from "../api";
import { PAID_STATUSES, type CheckoutResult, type OrderStatus } from "../types";
import { Button } from "./ui";

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
  circleId?: number;
  periodId?: number;
  memberId?: number;
  onPaid?: () => void;
  /** Checkout lain (mis. pelunasan tunggakan). Bawaan: iuran periode berjalan. */
  startCheckout?: () => Promise<CheckoutResult>;
  label?: string;
  /** Pesan saat lunas, untuk pembayaran yang tidak dicatat ke blockchain (jaminan, tunggakan). */
  paidMessage?: string;
}

export default function PayButton({ circleId, periodId, memberId, onPaid, startCheckout, label, paidMessage }: Props) {
  const [state, setState] = useState<"idle" | "loading" | "waiting" | "paid" | "failed" | "error">("idle");
  const [message, setMessage] = useState("");
  const cancelled = useRef(false);

  async function poll(orderId: string) {
    const deadline = Date.now() + 10 * 60_000;
    while (!cancelled.current && Date.now() < deadline) {
      const o = await api.order(orderId, true);
      const status: OrderStatus = o.status;
      if (PAID_STATUSES.includes(status)) {
        setState("paid");
        setMessage(
          paidMessage ?? (status === "ANCHORED" ? "Lunas dan tercatat di blockchain." : "Lunas. Menunggu pencatatan di blockchain."),
        );
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
      const cfg = await api.publicConfig().catch(() => null);
      if (cfg?.snapJsUrl && cfg?.midtransClientKey) {
        await loadSnap(cfg.snapJsUrl, cfg.midtransClientKey);
      }
      const co = startCheckout
        ? await startCheckout()
        : await api.checkout({ circleId: circleId!, periodId: periodId!, memberId: memberId! });
      if (!co.token) {
        throw new Error("Token pembayaran belum tersedia, coba lagi");
      }
      setMessage(`Tagihan Rp${co.grossAmount.toLocaleString("id-ID")}`);
      if (window.snap) {
        window.snap.pay(co.token, {
          onSuccess: () => {
            setState("waiting");
            void poll(co.orderId);
          },
          onPending: () => {
            setState("waiting");
            void poll(co.orderId);
          },
          onError: () => {
            setState("failed");
            setMessage("Pembayaran gagal di gateway.");
          },
          onClose: () => {
            void poll(co.orderId);
          },
        });
      }
      setState("waiting");
      await poll(co.orderId);
    } catch (err: unknown) {
      setState("error");
      const isNetworkDown =
        err instanceof ApiError &&
        (err.status === 0 ||
          ((err.status === 502 || err.status === 503 || err.status === 504) &&
            (!err.message ||
              err.message === "Bad Gateway" ||
              err.message.includes("Server tidak dapat dihubungi"))));

      setMessage(
        isNetworkDown
          ? "Server tidak dapat dihubungi. Pastikan backend API sudah berjalan di port 3001."
          : err instanceof Error
          ? err.message
          : "Gagal memproses pembayaran",
      );
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button
        onClick={() => void pay()}
        disabled={state === "loading" || state === "waiting" || state === "paid"}
        className="w-full sm:w-auto"
      >
        {state === "loading"
          ? "Menyiapkan..."
          : state === "waiting"
          ? "Menunggu pembayaran..."
          : state === "paid"
          ? "Lunas"
          : label ?? "Bayar iuran sekarang"}
      </Button>
      {message && (
        <p className={`text-xs ${state === "paid" ? "text-brand font-semibold" : state === "error" || state === "failed" ? "text-red-700" : "text-stone-500"}`}>
          {message}
        </p>
      )}
    </div>
  );
}
