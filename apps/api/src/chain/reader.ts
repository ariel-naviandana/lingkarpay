/**
 * Pembaca contract (hanya baca, tanpa private key) untuk backend API.
 * Dipakai sebelum pencairan agar contract, bukan hanya database, yang menyatakan periode siap cair.
 */
import { createPublicClient, http, parseAbi, type Hex } from "viem";
import { hardhat, sepolia } from "viem/chains";
import { config } from "../config.js";

const readAbi = parseAbi([
  "function getCircle(uint256 circleId) view returns ((uint256 contributionAmount, uint32 memberCount, uint32 periodDays, uint16 penaltyPct, uint64 startTime, uint8 status, bytes32 externalRef))",
  "function getPeriod(uint256 circleId, uint32 periodNo) view returns ((uint8 status, uint32 paidCount, bytes32 payoutRefHash))",
  "function recipientOf(uint256 circleId, uint32 periodNo) view returns (bytes32)",
]);

/** Status di contract: CircleStatus None=0 Draft=1 Active=2 Completed=3. */
export const CHAIN_CIRCLE_ACTIVE = 2;
/** Status di contract: PeriodStatus Scheduled=0 Running=1 ReadyPayout=2 Done=3. */
export const CHAIN_PERIOD = { Scheduled: 0, Running: 1, ReadyPayout: 2, Done: 3 } as const;

export interface ChainPeriodView {
  circleStatus: number;
  memberCount: number;
  periodStatus: number;
  paidCount: number;
  recipient: Hex;
}

export interface ChainReader {
  readPeriod(chainCircleId: bigint, periodNo: number): Promise<ChainPeriodView>;
}

/** Pembaca berbasis viem bila CHAIN_RPC_URL dan LINGKARPAY_ADDRESS diisi; null bila tidak. */
export function createChainReader(): ChainReader | null {
  const rpc = config.CHAIN_RPC_URL;
  const address = config.LINGKARPAY_ADDRESS as Hex | undefined;
  if (!rpc || !address) return null;
  const chain = config.CHAIN_NAME === "hardhat" ? hardhat : sepolia;
  const client = createPublicClient({ chain, transport: http(rpc, { timeout: 10_000, retryCount: 1 }) });

  return {
    async readPeriod(chainCircleId, periodNo) {
      const [circle, period, recipient] = await Promise.all([
        client.readContract({ address, abi: readAbi, functionName: "getCircle", args: [chainCircleId] }),
        client.readContract({ address, abi: readAbi, functionName: "getPeriod", args: [chainCircleId, periodNo] }),
        client.readContract({ address, abi: readAbi, functionName: "recipientOf", args: [chainCircleId, periodNo] }),
      ]);
      return {
        circleStatus: Number(circle.status),
        memberCount: Number(circle.memberCount),
        periodStatus: Number(period.status),
        paidCount: Number(period.paidCount),
        recipient,
      };
    },
  };
}
