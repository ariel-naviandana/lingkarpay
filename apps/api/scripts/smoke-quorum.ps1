<#
  Smoke test kuorum (usulan tutup periode) di Midtrans sandbox + backend + (opsional) chain.
  Alur: 3 anggota, hanya anggota A yang membayar. Anggota A mengusulkan menutup periode, A dan B
  setuju (kuorum 2 dari 3), periode siap cair, pencairan simulasi memakai dana yang terkumpul.

  Prasyarat: server jalan (npm run dev), Postgres jalan, tunnel + Notification URL aktif.
  Untuk bukti on-chain: jalankan juga worker (npm run chain:worker) dan pakai -WaitChain.
  Jalankan dari folder apps\api:
    powershell -ExecutionPolicy Bypass -File .\scripts\smoke-quorum.ps1
    powershell -ExecutionPolicy Bypass -File .\scripts\smoke-quorum.ps1 -WaitChain

  Hanya data dummy. Skrip tidak membaca atau mencetak key apa pun.
#>
param(
  [string]$Base = "http://localhost:3001",
  [switch]$WaitChain,
  [switch]$NoBrowser,
  [int]$TimeoutMinutes = 20
)
$ErrorActionPreference = "Stop"
$results = New-Object System.Collections.Generic.List[object]
$PaidStatuses = @("SETTLED", "SETTLED_PENDING_CHAIN", "ANCHORED")

function Api([string]$Method, [string]$Path, $Body = $null, [string]$Token = "") {
  $headers = @{}
  if ($Token) { $headers["Authorization"] = "Bearer $Token" }
  $params = @{ Method = $Method; Uri = "$Base$Path"; Headers = $headers; ContentType = "application/json" }
  if ($null -ne $Body) { $params["Body"] = ($Body | ConvertTo-Json -Depth 6) }
  elseif ($Method -eq "POST") { $params["Body"] = "{}" }
  try { return Invoke-RestMethod @params }
  catch {
    $msg = $_.ErrorDetails.Message
    if (-not $msg) { $msg = $_.Exception.Message }
    throw "[$Method $Path] $msg"
  }
}

# Menjalankan panggilan yang HARUS gagal; mengembalikan pesan errornya.
function Expect-Error([scriptblock]$Call) {
  try { & $Call | Out-Null; return $null } catch { return $_.Exception.Message }
}

function Step([string]$Text) { Write-Host ""; Write-Host "== $Text" -ForegroundColor Cyan }

function Check([string]$Name, [bool]$Ok, [string]$Detail = "") {
  $label = if ($Ok) { "PASS" } else { "FAIL" }
  $results.Add([pscustomobject]@{ Check = $Name; Result = $label; Detail = $Detail })
  $color = if ($Ok) { "Green" } else { "Red" }
  Write-Host ("  [{0}] {1} {2}" -f $label, $Name, $Detail) -ForegroundColor $color
}

function Wait-Paid([string]$OrderId, [string]$Token) {
  $deadline = (Get-Date).AddMinutes($TimeoutMinutes)
  while ((Get-Date) -lt $deadline) {
    $o = Api GET "/orders/${OrderId}?sync=true" $null $Token
    if ($PaidStatuses -contains $o.status) { return $o }
    Write-Host ("  menunggu pembayaran... status {0}" -f $o.status) -ForegroundColor DarkGray
    Start-Sleep -Seconds 5
  }
  return $null
}

function Period-Status($Detail, [int]$PeriodId) {
  return (@($Detail.periods | Where-Object { $_.id -eq $PeriodId })[0]).status
}

# ---------------- Persiapan: tiga pengguna, kelompok berjalan ----------------
Step "1. Persiapan data dummy (3 anggota)"
$stamp = Get-Date -Format "yyyyMMddHHmmss"
$a = Api POST "/auth/register" @{ name = "Kuorum A"; email = "kuo-a-$stamp@example.com"; password = "password123" }
$b = Api POST "/auth/register" @{ name = "Kuorum B"; email = "kuo-b-$stamp@example.com"; password = "password123" }
$c = Api POST "/auth/register" @{ name = "Kuorum C"; email = "kuo-c-$stamp@example.com"; password = "password123" }
$outsider = Api POST "/auth/register" @{ name = "Orang Asing"; email = "kuo-x-$stamp@example.com"; password = "password123" }
$circle = Api POST "/circles" @{ name = "Kuorum $stamp"; contributionAmount = 10000; memberCount = 3; periodDays = 7; penaltyPct = 5; adminFee = 1000 } $a.token
$cid = $circle.id
$null = Api POST "/circles/$cid/members" @{ email = "kuo-b-$stamp@example.com" } $a.token
$null = Api POST "/circles/$cid/members" @{ email = "kuo-c-$stamp@example.com" } $a.token
$null = Api POST "/circles/$cid/start" @{} $a.token
$d = Api GET "/circles/$cid" $null $a.token
$pid1 = $d.currentPeriod.id
Check "kelompok 3 anggota dimulai, periode 1 berjalan" (($d.members.Count -eq 3) -and ((Period-Status $d $pid1) -eq "running")) "periodId=$pid1"

# ---------------- Anggota A membayar ----------------
Step "2. Anggota A membayar (B dan C tidak)"
$co = Api POST "/checkout" @{ circleId = $cid; periodId = $pid1; memberId = $d.myMemberId } $a.token
$url = "https://app.sandbox.midtrans.com/snap/v4/redirection/" + $co.token
Write-Host ""
Write-Host "  >>> BAYAR SEKARANG (anggota A, Rp11.000) <<<" -ForegroundColor Yellow
Write-Host "  1. Halaman Snap: pilih Bank Transfer > BCA, catat nomor VA."
Write-Host "  2. Buka https://simulator.sandbox.midtrans.com/ > Virtual Account > BCA, isi nomor VA, Pay."
Write-Host "  URL Snap: $url"
if (-not $NoBrowser) { Start-Process $url }
$paid = Wait-Paid $co.orderId $a.token
Check "pembayaran A terdeteksi" (($null -ne $paid) -and ($PaidStatuses -contains $paid.status)) ("status=" + $paid.status)

# ---------------- Usulan dan suara ----------------
Step "3. Usulan tutup periode"
$pr = Api POST "/periods/$pid1/close-proposals" $null $a.token
Check "usulan dibuat: open, kuorum 2" (($pr.status -eq "open") -and ($pr.quorum -eq 2)) "id=$($pr.id)"
$err = Expect-Error { Api POST "/periods/$pid1/close-proposals" $null $b.token }
Check "usulan ganda ditolak" (($null -ne $err) -and ($err -like "*PROPOSAL_EXISTS*")) ""
$err = Expect-Error { Api POST "/periods/$pid1/close-proposals" $null $outsider.token }
Check "bukan anggota tidak boleh mengusulkan" (($null -ne $err) -and ($err -like "*FORBIDDEN*")) ""

Step "4. Voting"
$v1 = Api POST "/proposals/$($pr.id)/votes" @{ approve = $true } $a.token
Check "suara A tercatat, belum kuorum" (($v1.approvals -eq 1) -and ($v1.status -eq "open")) "setuju=$($v1.approvals)"
$err = Expect-Error { Api POST "/proposals/$($pr.id)/votes" @{ approve = $true } $a.token }
Check "satu anggota satu suara" (($null -ne $err) -and ($err -like "*ALREADY_VOTED*")) ""
$err = Expect-Error { Api POST "/proposals/$($pr.id)/votes" @{ approve = $true } $outsider.token }
Check "bukan anggota tidak boleh memilih" (($null -ne $err) -and ($err -like "*FORBIDDEN*")) ""
$v2 = Api POST "/proposals/$($pr.id)/votes" @{ approve = $true } $b.token
Check "kuorum tercapai: usulan dieksekusi" ($v2.status -eq "executed") "status=$($v2.status) setuju=$($v2.approvals)"

$d = Api GET "/circles/$cid" $null $a.token
Check "periode 1 siap cair" ((Period-Status $d $pid1) -eq "ready_payout") ""
$err = Expect-Error { Api POST "/checkout" @{ circleId = $cid; periodId = $pid1; memberId = ($d.members | Where-Object { $_.name -eq "Kuorum C" }).memberId } $c.token }
Check "anggota C tidak bisa membayar lagi (periode ditutup)" (($null -ne $err) -and ($err -like "*PERIOD_NOT_OPEN*")) ""

# ---------------- Pencairan ----------------
Step "5. Pencairan memakai dana yang terkumpul"
$p = Api POST "/payouts/simulate" @{ periodId = $pid1 } $a.token
Check "dana pencairan = iuran A tanpa biaya admin" ($p.amount -eq 10000) "amount=$($p.amount)"
$d = Api GET "/circles/$cid" $null $a.token
Check "periode 1 selesai" ((Period-Status $d $pid1) -eq "done") ""
$rec = Api GET "/reports/reconciliation?circleId=$cid" $null $a.token
Check "rekonsiliasi tanpa masalah" ($rec.summary.issues -eq 0) ("issues=" + $rec.summary.issues)

# ---------------- Chain (opsional) ----------------
if ($WaitChain) {
  Step "6. Menunggu worker mencatat usulan ke chain"
  $deadline = (Get-Date).AddMinutes(5)
  $cp = $null
  while ((Get-Date) -lt $deadline) {
    $cp = (Api GET "/proposals/$($pr.id)" $null $a.token).chainProposalId
    if ($cp) { break }
    Write-Host "  menunggu worker (proposeClosePeriod)..." -ForegroundColor DarkGray
    Start-Sleep -Seconds 5
  }
  Check "usulan tercatat di chain" ([bool]$cp) ("chainProposalId=" + $cp)
  Write-Host "  Periksa seluruh job (propose, vote, execute, markPayout) di database:" -ForegroundColor Yellow
  Write-Host '  docker exec lingkarpay-db psql -U lingkarpay -d lingkarpay -c "select kind, status, count(*) from chain_jobs group by 1,2 order by 1,2;"'
}

# ---------------- Ringkasan ----------------
Write-Host ""
Write-Host "================ RINGKASAN ================" -ForegroundColor Cyan
$results | Format-Table -AutoSize | Out-String -Width 200 | Write-Host
$failed = @($results | Where-Object { $_.Result -eq "FAIL" })
if ($failed.Count -eq 0) { Write-Host "Semua pemeriksaan lolos." -ForegroundColor Green }
else { Write-Host ("{0} pemeriksaan gagal." -f $failed.Count) -ForegroundColor Red; exit 1 }
