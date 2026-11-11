# Bukti end to end di Ethereum Sepolia

Alur yang diminta tugas: **bayar fiat sukses → webhook gateway → server memanggil smart contract → tercatat di testnet.** Dokumen ini merangkum buktinya (11 November 2026). Semua data di bawah publik; tidak ada key atau rahasia.

## Contract
| | |
|---|---|
| Jaringan | Ethereum Sepolia (chain 11155111) |
| Alamat contract | `0xF3Fde971c32960224395ceB9F0b5712dcFFc06A0` |
| Etherscan | https://sepolia.etherscan.io/address/0xF3Fde971c32960224395ceB9F0b5712dcFFc06A0 |
| Operator (akun testnet khusus) | `0xA21603A66BD42EE94C705c55da58c64497377193` |
| Alamat dan ABI | `contracts/deployments/sepolia.json`, `contracts/deployments/LingkarPay.abi.json` |

## Transaksi dari satu kelompok (2 anggota, 1 periode dicairkan)
Urutan di Etherscan (tab Transactions). Kolom Method di Etherscan menampilkan kode heks karena contract belum diverifikasi di sana.

| Block | Kejadian | Hash |
|---|---|---|
| 12110304 | `createCircle` | (lihat Etherscan) |
| 12110305 | `addMember` anggota 1 | (lihat Etherscan) |
| 12110306 | `addMember` anggota 2 | (lihat Etherscan) |
| 12110307 | `startCircle` | `0x2ecbf3a0f54734f61e45e67d37854f7f38095ba225c5475a71e2a6d3c536d7b5` |
| 12110309 | `recordPayment` anggota 1 | `0x9ecae8c5c890f9ae30d9a64920d46656ea72aa51b78681cee32facdbb82de82f` |
| 12110311 | `recordPayment` anggota 2 | `0x493f48a1e9ae3bf5c5f5c363ff0844c1854397d4f1f1352afc485ecd7b1fd72f` |
| 12110312 | `markPayout` periode 1 | `0xee2a611c41378fe93ef1218ea85c1f7c2cc096a5e6a728bae223543cacdf470f` |

Buka satu transaksi dengan `https://sepolia.etherscan.io/tx/<hash>`.

## Rantai bukti
1. **Pembayaran Midtrans sandbox** (VA BCA lewat simulator): order `LP-1-1-1-mwbt0n48` dan `LP-1-1-2-mwbt1shc`, masing-masing Rp11.000 (iuran Rp10.000 + biaya admin Rp1.000).
2. **Webhook** bertanda tangan diterima backend, order menjadi `SETTLED`, dan satu job `recordPayment` masuk outbox per order.
3. **Worker chain** mengambil job dan mengirim transaksi ke Sepolia; hash dicatat di tabel `chain_transactions`.
4. **Order `ANCHORED`**, semua job `confirmed`:
   ```
   createCircle   confirmed  1
   recordPayment  confirmed  2
   markPayout     confirmed  1
   ```
5. **Hash di database cocok dengan Etherscan** (`startCircle` di block 12110307, `recordPayment` di 12110309 dan 12110311, `markPayout` di 12110312).

## State yang dibaca langsung dari contract
Dari `npm run inspect` (membaca contract di Sepolia, bukan database backend):
```
Kelompok #1 di 0xF3Fde971c32960224395ceB9F0b5712dcFFc06A0
  status Active | iuran 10000 | 2 anggota | 7 hari | penalti 5%
  urutan giliran: m_054a4d76 > m_ecaa3fd7

Periode 1: Done | lunas 2/2 | penerima m_054a4d76
  hash pencairan: 0xce7b1ffeffdccc78c4eb08b7894749708f906ddb4ace8fc4745c07b49d82d49a
  m_054a4d76: lunas, refHash 0xeb1843409e39d57317015e808ebf21b42a9e2fb845b1dfee7c305c150795f370
  m_ecaa3fd7: lunas, refHash 0x064a8c73663903a8576d7fece844b35a9cee1a58fb877e3c48bb1cf20efe3679

Periode 2: Running | lunas 0/2 | penerima m_ecaa3fd7
```
Yang terlihat: urutan giliran terkunci, penerima periode 1 sesuai giliran, `refHash` per pembayaran (bukti silang ke catatan gateway), hash pencairan, dan periode 2 terbuka otomatis. Di chain hanya ID samaran (`m_xxxxxxxx`); tidak ada nama, email, atau nomor rekening.

## Cara mengulang
```powershell
# backend dan worker menunjuk ke Sepolia (apps\api\.env: CHAIN_NAME=sepolia, CHAIN_RPC_URL, OPERATOR_PRIVATE_KEY, LINGKARPAY_ADDRESS)
cd C:\coding\lingkarpay\apps\api
npm run dev                       # terminal 1
npm run chain:worker              # terminal 2
powershell -ExecutionPolicy Bypass -File .\scripts\smoke.ps1 -Both   # bayar dua kali di simulator

# periksa
docker exec lingkarpay-db psql -U lingkarpay -d lingkarpay -c "select kind, status, count(*) from chain_jobs group by 1,2 order by 1,2;"
docker exec lingkarpay-db psql -U lingkarpay -d lingkarpay -c "select j.kind, t.tx_hash from chain_transactions t join chain_jobs j on j.id=t.job_id where t.status='confirmed' order by t.id;"

# state langsung dari contract
cd C:\coding\lingkarpay\contracts
$env:SEPOLIA_PRIVATE_KEY = (Get-Content .\.secrets\operator.key).Trim()
$env:HARDHAT_NETWORK = "sepolia"; $env:LINGKARPAY_ADDRESS = "0xF3Fde971c32960224395ceB9F0b5712dcFFc06A0"; $env:CIRCLE_ID = "1"
npm run inspect
```
