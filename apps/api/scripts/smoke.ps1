<#
  Smoke test alur penuh LingkarPay (jalur payment gateway), lewat API sungguhan.

  Prasyarat: server jalan (npm run dev), Postgres jalan, tunnel + Notification URL aktif.
  Jalankan dari folder apps\api:
    powershell -ExecutionPolicy Bypass -File .\scripts\smoke.ps1
    powershell -ExecutionPolicy Bypass -File .\scripts\smoke.ps1 -Both     # dua anggota bayar + pencairan

  Satu-satunya langkah manual: membayar di simulator Midtrans (VA, bukan QRIS).
  Hanya data dummy. Skrip tidak membaca atau mencetak key apa pun.
#>
param(
  [string]$Base = "http://localhost:3001",
  [switch]$Both,
  [switch]$NoBrowser,
  [int]$TimeoutMinutes = 10
)
$ErrorActionPreference = "Stop"
$results = New-Object System.Collections.Generic.List[object]
$PaidStatuses = @("SETTLED", "SETTLED_PENDING_CHAIN", "ANCHORED")

function Api([string]$Method, [string]$Path, $Body = $null, [string]$Token = "") {
  $headers = @{}
  if ($Token) { $headers["Authorization"] = "Bearer $Token" }
  $params = @{ Method = $Method; Uri = "$Base$Path"; Headers = $headers; ContentType = "application/json" }
  if ($null -ne $Body) { $params["Body"] = ($Body | ConvertTo-Json -Depth 6) }
  try { return Invoke-RestMethod @params }
  catch {
    $msg = $_.ErrorDetails.Message
    if (-not $msg) { $msg = $_.Exception.Message }
    throw "[$Method $Path] $msg"
  }
}

function Step([string]$Text) { Write-Host ""; Write-Host "== $Text" -ForegroundColor Cyan }

function Check([string]$Name, [bool]$Ok, [string]$Detail = "") {
  $label = if ($Ok) { "PASS" } else { "FAIL" }
  $results.Add([pscustomobject]@{ Check = $Name; Result = $label; Detail = $Detail })
  $color = if ($Ok) { "Green" } else { "Red" }
  Write-Host ("  [{0}] {1} {2}" -f $label, $Name, $Detail) -ForegroundColor $color
}

function Expect-ApiError([string]$Name, [string]$Code, [scriptblock]$Action) {
  try {
    & $Action | Out-Null
    Check $Name $false "tidak error, padahal diharapkan $Code"
  } catch {
    $m = $_.Exception.Message
    Check $Name ($m -like "*$Code*") $m
  }
}

function Wait-Order([string]$OrderId, [string]$Token) {
  $deadline = (Get-Date).AddMinutes($TimeoutMinutes)
  $tries = 0
  while ((Get-Date) -lt $deadline) {
    $tries++
    # Setelah sekitar 30 detik tanpa webhook, tanya Status API Midtrans sebagai cadangan.
    $q = ""
    if ($tries -gt 6) { $q = "?sync=true" }
    $o = Api GET "/orders/$OrderId$q" $null $Token
    if (($PaidStatuses -contains $o.status) -or ($o.status -eq "FAILED") -or ($o.status -eq "EXPIRED")) { return $o }
    Write-Host ("  menunggu pembayaran... status {0}" -f $o.status) -ForegroundColor DarkGray
    Start-Sleep -Seconds 5
  }
  return $null
}

function Pay([string]$Label, $Checkout, [string]$Token) {
  $url = "https://app.sandbox.midtrans.com/snap/v4/redirection/" + $Checkout.token
  Write-Host ""
  Write-Host "  >>> BAYAR SEKARANG ($Label) <<<" -ForegroundColor Yellow
  Write-Host "  1. Halaman Snap: pilih Bank Transfer > BCA, catat nomor VA."
  Write-Host "  2. Buka https://simulator.sandbox.midtrans.com/ > Virtual Account > BCA, isi nomor VA, Pay."
  Write-Host "  URL Snap: $url"
  if (-not $NoBrowser) { Start-Process $url }
  return Wait-Order $Checkout.orderId $Token
}

# ---------------------------------------------------------------
Step "1. Server hidup"
$h = Api GET "/health"
Check "health" ($h.ok -eq $true)

Step "2. Daftar dua pengguna dummy"
$stamp = Get-Date -Format "yyyyMMddHHmmss"
$userA = Api POST "/auth/register" @{ name = "Smoke A"; email = "smoke-a-$stamp@example.com"; password = "password123" }
$userB = Api POST "/auth/register" @{ name = "Smoke B"; email = "smoke-b-$stamp@example.com"; password = "password123" }
$tokA = $userA.token
$tokB = $userB.token
Check "register A dan B" (($tokA.Length -gt 10) -and ($tokB.Length -gt 10))
$me = Api GET "/auth/me" $null $tokA
Check "auth/me" ($me.user.email -eq "smoke-a-$stamp@example.com")

Step "3. Buat kelompok, tambah anggota, mulai"
$circle = Api POST "/circles" @{ name = "Smoke $stamp"; contributionAmount = 10000; memberCount = 2; periodDays = 7; penaltyPct = 5; adminFee = 1000 } $tokA
$cid = $circle.id
Check "buat kelompok" ($circle.status -eq "draft") "id=$cid"
Expect-ApiError "mulai sebelum lengkap ditolak" "CIRCLE_NOT_FULL" { Api POST "/circles/$cid/start" @{} $tokA }
$null = Api POST "/circles/$cid/members" @{ email = "smoke-b-$stamp@example.com" } $tokA
$started = Api POST "/circles/$cid/start" @{} $tokA
Check "kelompok dimulai, 2 periode" (($started.circle.status -eq "active") -and (@($started.periods).Count -eq 2))

$detailA = Api GET "/circles/$cid" $null $tokA
$detailB = Api GET "/circles/$cid" $null $tokB
$periodId = $detailA.currentPeriod.id
$memberA = $detailA.myMemberId
$memberB = $detailB.myMemberId
Check "periode 1 berjalan" ($detailA.currentPeriod.status -eq "running") "periodId=$periodId"

Step "4. Checkout (idempotensi dan otorisasi)"
$bodyA = @{ circleId = $cid; periodId = $periodId; memberId = $memberA }
$co1 = Api POST "/checkout" $bodyA $tokA
Check "checkout menghasilkan token" (($co1.status -eq "PENDING") -and ($co1.token.Length -gt 10)) $co1.orderId
Check "tagihan = iuran + biaya admin" ($co1.grossAmount -eq 11000) "gross=$($co1.grossAmount)"
$co2 = Api POST "/checkout" $bodyA $tokA
Check "checkout ulang memakai order yang sama" (($co2.orderId -eq $co1.orderId) -and ($co2.reused -eq $true))
Expect-ApiError "anggota lain tidak boleh membayar iuran A" "FORBIDDEN" { Api POST "/checkout" $bodyA $tokB }

Step "5. Anggota A membayar"
$oA = Pay "anggota A, Rp11.000" $co1 $tokA
if ($null -eq $oA) {
  Check "pembayaran A terdeteksi" $false "timeout $TimeoutMinutes menit. Cek log server dan notification history."
} else {
  Check "pembayaran A terdeteksi" ($PaidStatuses -contains $oA.status) "status=$($oA.status)"
  $toSettled = @($oA.history | Where-Object { $_.to -eq "SETTLED" })
  Check "riwayat status mencatat SETTLED" ($toSettled.Count -ge 1)
  Expect-ApiError "bayar dua kali ditolak" "ALREADY_PAID" { Api POST "/checkout" $bodyA $tokA }
  $pay = Api GET "/circles/$cid/payments" $null $tokA
  $row = @($pay.payments) | Where-Object { $_.orderId -eq $co1.orderId } | Select-Object -First 1
  Check "muncul di riwayat pembayaran kelompok" ($null -ne $row) "chainStatus=$($row.chainStatus)"
  Check "job chain tercatat (outbox)" ($null -ne $row.chainStatus) "chainStatus=$($row.chainStatus)"
}

Step "6. Rekonsiliasi"
$rec = Api GET "/reports/reconciliation?circleId=$cid" $null $tokA
Check "rekonsiliasi tanpa masalah" ($rec.summary.issues -eq 0) ("issues=" + $rec.summary.issues + " grossPaid=" + $rec.summary.grossPaid)
Expect-ApiError "rekonsiliasi hanya untuk pembuat kelompok" "FORBIDDEN" { Api GET "/reports/reconciliation?circleId=$cid" $null $tokB }

if ($Both -and ($null -ne $oA) -and ($PaidStatuses -contains $oA.status)) {
  Step "7. Anggota B membayar, periode siap cair, pencairan simulasi"
  $coB = Api POST "/checkout" @{ circleId = $cid; periodId = $periodId; memberId = $memberB } $tokB
  Expect-ApiError "pencairan sebelum semua lunas ditolak" "PERIOD_NOT_READY" { Api POST "/payouts/simulate" @{ periodId = $periodId } $tokA }
  $oB = Pay "anggota B, Rp11.000" $coB $tokB
  if ($null -eq $oB) {
    Check "pembayaran B terdeteksi" $false "timeout"
  } else {
    Check "pembayaran B terdeteksi" ($PaidStatuses -contains $oB.status) "status=$($oB.status)"
    $d = Api GET "/circles/$cid" $null $tokA
    Check "periode 1 siap cair" ($d.currentPeriod.status -eq "ready_payout")
    $po = Api POST "/payouts/simulate" @{ periodId = $periodId } $tokA
    Check "payout simulasi dibuat" ($po.status -eq "SIMULATED") "id=$($po.id)"
    Check "dana pencairan = iuran tanpa biaya admin" ($po.amount -eq 20000) "amount=$($po.amount)"
    Expect-ApiError "payout dua kali ditolak" "PAYOUT_EXISTS" { Api POST "/payouts/simulate" @{ periodId = $periodId } $tokA }
    $d2 = Api GET "/circles/$cid" $null $tokA
    Check "periode 2 dibuka" (($d2.currentPeriod.periodNo -eq 2) -and ($d2.currentPeriod.status -eq "running"))
    $rec2 = Api GET "/reports/reconciliation?circleId=$cid" $null $tokA
    $p1 = @($rec2.periods) | Where-Object { $_.periodNo -eq 1 } | Select-Object -First 1
    Check "terkumpul sama dengan dicairkan" ($p1.difference -eq 0) "difference=$($p1.difference)"
    Check "rekonsiliasi akhir tanpa masalah" ($rec2.summary.issues -eq 0) ("issues=" + $rec2.summary.issues)
  }
}

Write-Host ""
Write-Host "================ RINGKASAN ================" -ForegroundColor Cyan
$results | Format-Table -AutoSize -Wrap
$fail = @($results | Where-Object { $_.Result -eq "FAIL" }).Count
if ($fail -eq 0) { Write-Host "Semua pemeriksaan lolos." -ForegroundColor Green; exit 0 }
Write-Host "$fail pemeriksaan gagal. Kirim ringkasan ini dan log server ke Claude." -ForegroundColor Red
exit 1
