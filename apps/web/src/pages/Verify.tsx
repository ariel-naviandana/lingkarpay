import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { createPublicClient, hexToString, http, parseAbi, type Hex } from "viem";
import { sepolia } from "viem/chains";

// Portal verifikasi PUBLIK: membaca langsung dari contract di Sepolia, bukan dari database LingkarPay.
// Tujuannya membuktikan anggota dapat memeriksa tanpa mempercayai server.
const abi = parseAbi([
  "function getCircle(uint256 circleId) view returns ((uint256 contributionAmount, uint32 memberCount, uint32 periodDays, uint16 penaltyPct, uint64 startTime, uint8 status, bytes32 externalRef))",
  "function getMembers(uint256 circleId) view returns (bytes32[])",
]);
const STATUS = ["None", "Draft", "Active", "Completed"];

const RPC = import.meta.env.VITE_SEPOLIA_RPC_URL as string | undefined;
const CONTRACT = import.meta.env.VITE_CONTRACT_ADDRESS as Hex | undefined;

interface OnChainCircle {
  contributionAmount: bigint;
  memberCount: number;
  periodDays: number;
  penaltyPct: number;
  startTime: bigint;
  status: number;
}

export default function Verify() {
  const { chainCircleId } = useParams();
  const [circle, setCircle] = useState<OnChainCircle | null>(null);
  const [members, setMembers] = useState<string[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!RPC || !CONTRACT || !chainCircleId) {
      setError("Isi VITE_SEPOLIA_RPC_URL dan VITE_CONTRACT_ADDRESS di .env (lihat .env.example).");
      return;
    }
    const client = createPublicClient({ chain: sepolia, transport: http(RPC) });
    const id = BigInt(chainCircleId);
    Promise.all([
      client.readContract({ address: CONTRACT, abi, functionName: "getCircle", args: [id] }),
      client.readContract({ address: CONTRACT, abi, functionName: "getMembers", args: [id] }),
    ])
      .then(([c, m]) => {
        setCircle(c as OnChainCircle);
        setMembers((m as Hex[]).map((h) => hexToString(h, { size: 32 })));
      })
      .catch((e: Error) => setError(e.message));
  }, [chainCircleId]);

  return (
    <div className="page">
      <div className="card">
        <h1>Verifikasi di blockchain</h1>
        <p className="muted">Kelompok #{chainCircleId} di Ethereum Sepolia (data langsung dari contract).</p>
        {error && <p className="error">{error}</p>}
        {circle && (
          <ul>
            <li>Status: {STATUS[circle.status]}</li>
            <li>Iuran: Rp{circle.contributionAmount.toString()} · {circle.memberCount} anggota · {circle.periodDays} hari · penalti {circle.penaltyPct}%</li>
          </ul>
        )}
      </div>
      {members.length > 0 && (
        <div className="card">
          <h2>Urutan giliran (ID samaran)</h2>
          <ol>{members.map((m) => <li key={m}>{m}</li>)}</ol>
        </div>
      )}
      {/* TODO(frontend/smart-contract): status iuran per anggota per periode (getPayment), penerima tiap
          periode (recipientOf), penalti, riwayat pencairan, dan tautan ke transaksi di Etherscan Sepolia
          (hash dari event PaymentRecorded/PayoutMarked). Tambahkan fungsi baca/event ke abi di atas. */}
    </div>
  );
}
