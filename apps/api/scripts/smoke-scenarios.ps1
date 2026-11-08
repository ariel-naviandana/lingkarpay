<#
  Skenario pembayaran di Midtrans sandbox sungguhan: kedaluwarsa, dibatalkan, dan e-wallet.
  (Skenario sukses dan pencairan ada di smoke.ps1.)

  Prasyarat: server jalan (npm run dev), Postgres jalan, tunnel + Notification URL aktif.
  Jalankan dari folder apps\api:
    powershell -ExecutionPolicy Bypass -File .\scripts\smoke-scenarios.ps1 -Scenario Expire
    powershell -ExecutionPolicy Bypass -File .\scripts\smoke-scenarios.ps1 -Scenario Cancel
    powershell -ExecutionPolicy Bypass -File .\scripts\smoke-scenarios.ps1 -Scenario Ewallet

  Expire : set ORDER_EXPIRY_MINUTES=5 di .env, restart server, lalu jalankan. Jangan membayar.
  Cancel : buat VA di halaman Snap, lalu batalkan transaksi dari dashboard Midtrans (Transactions > Cancel).
  Ewallet: bayar dengan GoPay atau ShopeePay lewat simulator Midtrans (jangan pakai aplikasi sungguhan).

  Hanya data dummy. Skrip tidak membaca atau mencetak key apa pun.
#>
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("Expire", "Cancel", "Ewallet")]
  [string]$Scenario,
  [string]$Base = "http://localhost:3001",
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

function Wait-Status([string]$OrderId, [string]$Token, [string[]]$Wanted, [int]$PollSeconds) {
  $deadline = (Get-Date).AddMinutes($TimeoutMinutes)
  while ((Get-Date) -lt $deadline) {
    # ?sync=true: tanya Status API Midtrans sebagai cadangan bila webhook belum masuk.
    $o = Api GET "/orders/${OrderId}?sync=true" $null $Token
    if ($Wanted -contains $o.status) { return $o }
    Write-Host ("  menunggu... status {0}" -f $o.status) -ForegroundColor DarkGray
    Start-Sleep -Seconds $PollSeconds
  }
  return $null
}

function Open-Snap($Checkout) {
  $url = "https://app.sandbox.midtrans.com/snap/v4/redirection/" + $Checkout.token
  Write-Host "  URL Snap: $url"
  if (-not $NoBrowser) { Start-Process $url }
}

# ---------------- Persiapan: dua pengguna, kelompok berjalan, satu checkout ----------------
Step "Persiapan data dummy"
$stamp = Get-Date -Format "yyyyMMddHHmmss"
$a = Api POST "/auth/register" @{ name = "Skenario A"; email = "skn-a-$stamp@example.com"; password = "password123" }
$b = Api POST "/auth/register" @{ name = "Skenario B"; email = "skn-b-$stamp@example.com"; password = "password123" }
$circle = Api POST "/circles" @{ name = "Skenario $Scenario $stamp"; contributionAmount = 10000; memberCount = 2; periodDays = 7; penaltyPct = 5; adminFee = 1000 } $a.token
$cid = $circle.id
$null = Api POST "/circles/$cid/members" @{ email = "skn-b-$stamp@example.com" } $a.token
$null = Api POST "/circles/$cid/start" @{} $a.token
$d = Api GET "/circles/$cid" $null $a.token
$body = @{ circleId = $cid; periodId = $d.currentPeriod.id; memberId = $d.myMemberId }
$co = Api POST "/checkout" $body $a.token
Check "kelompok dan checkout dibuat" ($co.status -eq "PENDING") $co.orderId
$minutesLeft = [math]::Round(([datetimeoffset]$co.expiresAt - [datetimeoffset]::UtcNow).TotalMinutes, 1)
Write-Host "  Batas bayar: sekitar $minutesLeft menit dari sekarang."

# ---------------- Skenario ----------------
if ($Scenario -eq "Expire") {
  Step "Skenario KEDALUWARSA: jangan bayar, tunggu order habis waktu"
  if ($minutesLeft -gt 15) {
    Write-Host "  PERINGATAN: batas bayar $minutesLeft menit. Set ORDER_EXPIRY_MINUTES=5 di .env, restart server, ulangi." -ForegroundColor Yellow
  }
  Write-Host "  (Opsional) buka halaman Snap dan buat VA, lalu biarkan tidak dibayar."
  Open-Snap $co
  $o = Wait-Status $co.orderId $a.token @("EXPIRED", "SETTLED", "SETTLED_PENDING_CHAIN", "ANCHORED", "FAILED") 15
  if ($null -eq $o) {
    Check "order menjadi EXPIRED" $false "timeout $TimeoutMinutes menit"
  } else {
    Check "order menjadi EXPIRED" ($o.status -eq "EXPIRED") "status=$($o.status)"
    $hist = @($o.history | Where-Object { $_.to -eq "EXPIRED" })
    Check "riwayat mencatat EXPIRED" ($hist.Count -ge 1) ("alasan=" + $hist[0].reason)
    $co2 = Api POST "/checkout" $body $a.token
    Check "anggota bisa membayar lagi (order baru)" (($co2.orderId -ne $co.orderId) -and ($co2.status -eq "PENDING")) $co2.orderId
  }
}

if ($Scenario -eq "Cancel") {
  Step "Skenario DIBATALKAN"
  Write-Host ""
  Write-Host "  >>> LAKUKAN SEKARANG <<<" -ForegroundColor Yellow
  Write-Host "  1. Halaman Snap: pilih Bank Transfer > BCA supaya transaksi tercatat di Midtrans (jangan dibayar)."
  Write-Host "  2. Dashboard Midtrans (sandbox) > Transactions > cari order ini > Cancel."
  Write-Host "     Order ID: $($co.orderId)"
  Open-Snap $co
  $o = Wait-Status $co.orderId $a.token @("FAILED", "EXPIRED", "SETTLED", "SETTLED_PENDING_CHAIN", "ANCHORED") 10
  if ($null -eq $o) {
    Check "order menjadi FAILED" $false "timeout $TimeoutMinutes menit"
  } else {
    Check "order menjadi FAILED" ($o.status -eq "FAILED") "status=$($o.status)"
    $co2 = Api POST "/checkout" $body $a.token
    Check "anggota bisa membayar lagi (order baru)" (($co2.orderId -ne $co.orderId) -and ($co2.status -eq "PENDING")) $co2.orderId
  }
}

if ($Scenario -eq "Ewallet") {
  Step "Skenario E-WALLET"
  Write-Host ""
  Write-Host "  >>> BAYAR SEKARANG <<<" -ForegroundColor Yellow
  Write-Host "  1. Halaman Snap: pilih GoPay atau ShopeePay."
  Write-Host "  2. Selesaikan HANYA lewat simulator Midtrans yang ditunjukkan halaman Snap."
  Write-Host "     Jangan memindai kode dengan aplikasi sungguhan."
  Open-Snap $co
  $o = Wait-Status $co.orderId $a.token $PaidStatuses 5
  if ($null -eq $o) {
    Check "pembayaran e-wallet terdeteksi" $false "timeout $TimeoutMinutes menit"
  } else {
    Check "pembayaran e-wallet terdeteksi" ($PaidStatuses -contains $o.status) "status=$($o.status)"
    # GoPay lewat kode QR dilaporkan Midtrans sebagai payment_type "qris" (bukan "gopay").
    Check "jenis pembayaran e-wallet (gopay/shopeepay/qris dari GoPay)" (@("gopay", "shopeepay", "qris") -contains $o.paymentType) "paymentType=$($o.paymentType)"
  }
}

$rec = Api GET "/reports/reconciliation?circleId=$cid" $null $a.token
Check "rekonsiliasi tanpa masalah" ($rec.summary.issues -eq 0) ("issues=" + $rec.summary.issues)

Write-Host ""
Write-Host "================ RINGKASAN ================" -ForegroundColor Cyan
$results | Format-Table -AutoSize -Wrap
$fail = @($results | Where-Object { $_.Result -eq "FAIL" }).Count
if ($fail -eq 0) { Write-Host "Semua pemeriksaan lolos." -ForegroundColor Green; exit 0 }
Write-Host "$fail pemeriksaan gagal. Kirim ringkasan ini dan log server ke Claude." -ForegroundColor Red
exit 1
