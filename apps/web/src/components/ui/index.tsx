import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

export const Card = ({ className = "", children }: { className?: string; children: ReactNode }) => (
  <section className={`rounded-2xl border border-sand bg-white p-4 sm:p-6 ${className}`}>{children}</section>
);

const tones = {
  green: "bg-mint text-brand",
  amber: "bg-amber-soft text-amber-900",
  red: "bg-red-100 text-red-800",
  purple: "bg-violet-100 text-violet-800",
  gray: "bg-sand text-stone-600",
};

export const Badge = ({ tone = "gray", children }: { tone?: keyof typeof tones; children: ReactNode }) => (
  <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>
    {children}
  </span>
);

export const Button = ({
  variant = "primary",
  className = "",
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "outline" | "purple" }) => (
  <button
    {...p}
    className={`inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-40 cursor-pointer ${
      variant === "primary"
        ? "bg-brand text-white hover:bg-forest"
        : variant === "purple"
        ? "bg-violet-800 text-white hover:bg-violet-900"
        : "border border-sand bg-white hover:bg-cream text-ink"
    } ${className}`}
  />
);

const inputCls =
  "w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm focus:outline-2 focus:outline-brand";

export const Field = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => (
  <label className="block text-sm">
    <span className="mb-1 block font-medium text-stone-700">{label}</span>
    {children}
    {hint && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
  </label>
);

export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={inputCls} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={inputCls} />;

export const Logo = ({ light = false }: { light?: boolean }) => (
  <div className={`flex items-center gap-2 text-xl font-extrabold ${light ? "text-white" : "text-ink"}`}>
    <span className="grid h-7 w-7 place-items-center rounded-full border-[3px] border-mint">
      <i className="h-2 w-2 rounded-full bg-amber-400" />
    </span>
    LingkarPay
  </div>
);

export const Th = ({ children }: { children?: ReactNode }) => (
  <th className="px-2.5 py-2.5 sm:px-3 sm:py-3 text-left text-xs font-semibold text-stone-500 whitespace-nowrap">
    {children}
  </th>
);

export const Td = ({ children, className = "" }: { children?: ReactNode; className?: string }) => (
  <td className={`border-t border-sand px-2.5 py-2.5 sm:px-3 sm:py-3 ${className}`}>{children}</td>
);

export const Mono = ({ children }: { children: ReactNode }) => (
  <span className="font-mono text-xs break-all sm:break-normal">{children}</span>
);
