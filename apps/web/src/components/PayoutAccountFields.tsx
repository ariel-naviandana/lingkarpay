import type { PayoutAccountInput } from "../api";
import { PAYOUT_CHANNELS } from "../types";
import { Field, Input, Select } from "./ui";

/** Isian rekening pencairan (bank atau e-wallet), dipakai saat membuat kelompok, menerima undangan, dan mengganti rekening. */
export function PayoutAccountFields({
  value,
  onChange,
  disabled,
}: {
  value: PayoutAccountInput;
  onChange: (v: PayoutAccountInput) => void;
  disabled?: boolean;
}) {
  const kind = PAYOUT_CHANNELS.find((c) => c.code === value.channel)?.kind ?? "bank";
  return (
    <div className="space-y-3">
      <Field label="Bank atau e-wallet">
        <Select value={value.channel} disabled={disabled} onChange={(e) => onChange({ ...value, channel: e.target.value })}>
          <optgroup label="Bank">
            {PAYOUT_CHANNELS.filter((c) => c.kind === "bank").map((c) => (
              <option key={c.code} value={c.code}>{c.label}</option>
            ))}
          </optgroup>
          <optgroup label="E-wallet">
            {PAYOUT_CHANNELS.filter((c) => c.kind === "ewallet").map((c) => (
              <option key={c.code} value={c.code}>{c.label}</option>
            ))}
          </optgroup>
        </Select>
      </Field>
      <Field
        label={kind === "bank" ? "Nomor rekening" : "Nomor ponsel e-wallet"}
        hint="Data dummy (sandbox). Server hanya menyimpan 4 digit terakhir dan hash-nya."
      >
        <Input
          inputMode="numeric"
          required
          disabled={disabled}
          value={value.accountNumber}
          onChange={(e) => onChange({ ...value, accountNumber: e.target.value })}
          placeholder={kind === "bank" ? "mis. 1234567890" : "mis. 081234567890"}
        />
      </Field>
      <Field label="Nama pemilik rekening">
        <Input
          required
          disabled={disabled}
          value={value.accountName}
          onChange={(e) => onChange({ ...value, accountName: e.target.value })}
        />
      </Field>
    </div>
  );
}
