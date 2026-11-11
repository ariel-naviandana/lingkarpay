# Bukti end to end di Ethereum Sepolia

Alur yang diminta tugas: **bayar fiat sukses → webhook gateway → server memanggil smart contract → tercatat di testnet.** Dokumen ini merangkum buktinya. Semua data di bawah publik; tidak ada key atau rahasia. Tanggal uji: 11 November 2026.

## Contract
| | v2 (final, dengan `externalRef` dan kuorum) | v1 (awal, riwayat) |
|---|---|---|
| Jaringan | Ethereum Sepolia (chain 11155111) | sama |
| Alamat | `0x87eD2019c518e0309BddCB4AA7F2c375F1aE04B2` | `0xF3Fde971c32960224395ceB9F0b5712dcFFc06A0` |
| Etherscan | https://sepolia.etherscan.io/address/0x87eD2019c518e0309BddCB4AA7F2c375F1aE04B2 | https://sepolia.etherscan.io/address/0xF3Fde971c32960224395ceB9F0b5712dcFFc06A0 |
| Operator (akun testnet khusus) | `0xA21603A66BD42EE94C705c55da58c64497377193` | sama |
| Berkas | `contracts/deployments/sepolia.json`, `LingkarPay.abi.json` | `sepolia-v1.json`, `LingkarPay.v1.abi.json` |

v2 menambah `createCircle` idempoten (`externalRef`), usulan kuorum, dan pencegahan usulan ganda. Semua kejadian di bagian "Bukti v2" memakai contract v2.

## Bukti v2: pembayaran, kuorum, dan pencairan di Sepolia
Skenario (`apps/api/scripts/smoke-quorum.ps1 -WaitChain`): kelompok 3 anggota, hanya anggota A yang membayar (Midtrans sandbox, VA BCA lewat simulator), lalu anggota A mengusulkan menutup periode, A dan B setuju (kuorum 2 dari 3), periode siap cair, dan pencairan simulasi memakai dana yang terkumpul. Sisi backend: 15 pemeriksaan lolos.

### Semua job outbox terkonfirmasi
```
createCircle        confirmed  1
recordPayment       confirmed  1
proposeClosePeriod  confirmed  1
castVote            confirmed  2
executeProposal     confirmed  1
markPayout          confirmed  1
```

### State yang dibaca langsung dari contract
Dari `npm run inspect` (membaca contract di Sepolia, bukan database backend):
```
Kelompok #1 di 0x87eD2019c518e0309BddCB4AA7F2c375F1aE04B2
  status Active | iuran 10000 | 3 anggota | 7 hari | penalti 5%
  urutan giliran: m_37058eb1 > m_5cedd173 > m_99c97b5f

Periode 1: Done | lunas 1/3 | penerima m_37058eb1
  hash pencairan: 0xa175f2a7171d14e1e9d095b701ff6416113d1f90274e8d96f276bea444dbf657
  m_37058eb1: lunas, refHash 0xcf4f4338ee5fc536439fe2319ebdc08fdb0c674980334dd1d176d5c622814412
  usulan #1 (ClosePeriod): Executed | setuju 2, tolak 0, kuorum 2
    suara tercatat: m_37058eb1
    suara tercatat: m_5cedd173

Periode 2: Running | lunas 0/3 | penerima m_5cedd173

Periode 3: Scheduled | lunas 0/3 | penerima m_99c97b5f
```
Yang terlihat:
- Urutan giliran terkunci dan penerima periode 1 sesuai giliran.
- Periode 1 `Done` walau hanya 1 dari 3 anggota yang lunas: bisa dicairkan karena **usulan kuorum disetujui (2 dari 3)** dan dieksekusi, bukan karena operator memaksa.
- Pembayaran tercatat dengan `refHash` (bukti silang ke catatan gateway), dan pencairan dengan hash.
- Periode 2 terbuka otomatis setelah pencairan periode 1.
- Di chain hanya ID samaran (`m_xxxxxxxx`); tidak ada nama, email, atau nomor rekening.

### Hash transaksi tiap langkah (v2)
Dari tabel `chain_transactions` di database; buka dengan `https://sepolia.etherscan.io/tx/<hash>`.

| Job | Hash transaksi |
|---|---|
| `createCircle` (hash yang dicatat adalah transaksi `startCircle`, langkah terakhir pembuatan kelompok) | `0x14562ec3472a6d39e40f4534dc514b15e251007dc51b7cdc0984ab6746574daa` |
| `recordPayment` (iuran anggota A) | `0xc52f44263ce33df4ef25b5bb749be11f910517598bc8df525161b8cf3b3b80f8` |
| `proposeClosePeriod` (usulan tutup periode) | `0x5c37ae52659acf04d815369f634d9fd5a228f13aaa9923c85d90cdaa9bd4ce39` |
| `castVote` (suara pertama, setuju) | `0x3c37e5920999103b28a7f2f802bec278e1f487c04167774f23cc71fbc9ce656c` |
| `castVote` (suara kedua, setuju: kuorum tercapai) | `0x4c07ae73a9824d5b291f0aef91ede2e569f641e120a75e16781baa353a72d8b2` |
| `executeProposal` | `0x0b73186add2765ec86dfd39b1365dfcac67eca40be2b47decc8142c6ce8c6ed5` |
| `markPayout` (pencairan periode 1) | `0x74dfa01e4be84396c586730155872389d09e3d826b75a9b25337e62ab9294c0d` |

Urutan di Etherscan mengikuti urutan job: usulan dibuat, dua suara, eksekusi, baru pencairan. Pencairan tidak bisa mendahului eksekusi karena `markPayout` ditahan sampai semua job kuorum terkonfirmasi (dan contract menolak pencairan periode yang belum lengkap dan belum ditutup kuorum). Transaksi `addMember` (tiga anggota) ada di tab Transactions contract (link di atas) tetapi tidak dicatat per job.

## Bukti v1: alur pembayaran tanpa kuorum (riwayat)
Kelompok 2 anggota, kedua anggota membayar (Midtrans sandbox), periode 1 dicairkan. Tujuh transaksi dari operator ke contract v1:

| Block | Kejadian | Hash |
|---|---|---|
| 12110304 | `createCircle` | (lihat Etherscan) |
| 12110305 | `addMember` anggota 1 | (lihat Etherscan) |
| 12110306 | `addMember` anggota 2 | (lihat Etherscan) |
| 12110307 | `startCircle` | `0x2ecbf3a0f54734f61e45e67d37854f7f38095ba225c5475a71e2a6d3c536d7b5` |
| 12110309 | `recordPayment` anggota 1 | `0x9ecae8c5c890f9ae30d9a64920d46656ea72aa51b78681cee32facdbb82de82f` |
| 12110311 | `recordPayment` anggota 2 | `0x493f48a1e9ae3bf5c5f5c363ff0844c1854397d4f1f1352afc485ecd7b1fd72f` |
| 12110312 | `markPayout` periode 1 | `0xee2a611c41378fe93ef1218ea85c1f7c2cc096a5e6a728bae223543cacdf470f` |

Hash di database cocok dengan Etherscan. State dari contract v1: periode 1 `Done`, lunas 2/2, dua `refHash`, hash pencairan, dan periode 2 `Running`.

## Rantai bukti
1. Pembayaran Midtrans sandbox (VA BCA lewat simulator), iuran Rp10.000 + biaya admin Rp1.000.
2. Webhook bertanda tangan diterima backend; order `SETTLED`; satu job `recordPayment` masuk outbox per order.
3. Worker chain mengambil job dan mengirim transaksi ke Sepolia; hash dicatat di `chain_transactions`; order `ANCHORED`.
4. Hash di database dapat dibuka di Etherscan, dan state yang sama terbaca langsung dari contract.

## Cara mengulang
```powershell
# apps\api\.env: CHAIN_NAME=sepolia, CHAIN_RPC_URL, OPERATOR_PRIVATE_KEY, LINGKARPAY_ADDRESS (satu set aktif)
cd C:\coding\lingkarpay\apps\api
npm run dev                       # terminal 1
npm run chain:worker              # terminal 2
powershell -ExecutionPolicy Bypass -File .\scripts\smoke-quorum.ps1 -WaitChain   # bayar satu kali di simulator
# atau alur pembayaran biasa: scripts\smoke.ps1 -Both

# periksa
docker exec lingkarpay-db psql -U lingkarpay -d lingkarpay -c "select kind, status, count(*) from chain_jobs group by 1,2 order by 1,2;"
docker exec lingkarpay-db psql -U lingkarpay -d lingkarpay -c "select j.kind, t.tx_hash from chain_transactions t join chain_jobs j on j.id=t.job_id where t.status='confirmed' order by t.id;"

# state langsung dari contract
cd C:\coding\lingkarpay\contracts
$env:SEPOLIA_PRIVATE_KEY = (Get-Content .\.secrets\operator.key).Trim()
$env:HARDHAT_NETWORK = "sepolia"; $env:LINGKARPAY_ADDRESS = "0x87eD2019c518e0309BddCB4AA7F2c375F1aE04B2"; $env:CIRCLE_ID = "1"
npm run inspect
Remove-Item Env:HARDHAT_NETWORK, Env:SEPOLIA_PRIVATE_KEY, Env:LINGKARPAY_ADDRESS, Env:CIRCLE_ID
```
