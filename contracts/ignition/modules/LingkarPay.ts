import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// Deploy LingkarPay. Akun penanda tangan deploy menjadi `operator` (constructor memakai msg.sender),
// jadi akun yang sama harus dipakai worker chain (OPERATOR_PRIVATE_KEY di apps/api/.env).
export default buildModule("LingkarPayModule", (m) => {
  const lingkarPay = m.contract("LingkarPay");
  return { lingkarPay };
});
