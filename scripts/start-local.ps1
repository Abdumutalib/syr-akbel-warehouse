$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js topilmadi. Avval Node.js 20 LTS o'rnating, keyin qayta ishga tushiring."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm topilmadi. Node.js o'rnatilishini tekshiring."
}

if (-not (Test-Path (Join-Path $repoRoot 'node_modules'))) {
  Write-Host "Kutubxonalar o'rnatilmoqda. Birinchi ishga tushirishda internet kerak bo'lishi mumkin..." -ForegroundColor Yellow
  npm ci
  if ($LASTEXITCODE -ne 0) { throw "npm ci muvaffaqiyatsiz tugadi." }
}

$username = (Read-Host "AKBEL lokal admin username").Trim()
if ([string]::IsNullOrWhiteSpace($username)) {
  throw "Username bo'sh bo'lmasligi kerak."
}

$securePassword = Read-Host "AKBEL lokal admin paroli (kamida 8 belgi)" -AsSecureString
if ($securePassword.Length -lt 8) {
  throw "Parol kamida 8 belgidan iborat bo'lishi kerak."
}
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

# Lokal rejim: loopback manziligagina bog'lanadi va loyihadagi .env sozlamalarini yuklamaydi.
$env:WAREHOUSE_LOCAL_MODE = '1'
$env:WAREHOUSE_LOAD_ENV_FILE = 'false'
$env:PORT = '8787'
$env:WAREHOUSE_BIND_HOST = '127.0.0.1'
$env:WAREHOUSE_ALLOWED_ORIGIN = 'http://127.0.0.1:8787,http://localhost:8787'
$env:WAREHOUSE_CANONICAL_ORIGIN = ''
$env:WAREHOUSE_COMPANY_NAME = 'Сыр АКБЕЛ'
$env:WAREHOUSE_ADMIN_USERNAME = $username
$env:WAREHOUSE_ADMIN_PASSWORD = $password
$env:WAREHOUSE_STATE_FILE = (Join-Path $repoRoot 'data\warehouse.json')
$env:WAREHOUSE_DB_URL = ''
$env:DATABASE_URL = ''
$env:TELEGRAM_BOT_TOKEN = ''
$env:TELEGRAM_CHANNEL_ID = ''
$env:TELEGRAM_ADMIN_CHAT_ID = ''
$env:TELEGRAM_WEBHOOK_SECRET = ''
$env:TELEGRAM_ADMIN_USER_ID = ''
$env:WAREHOUSE_BUSINESS_MESSAGE_TOKEN = ''
$env:YANDEX_DISK_LOGIN = ''
$env:YANDEX_DISK_PASSWORD = ''

try {
  Write-Host ""
  Write-Host "AKBEL omborxonasi lokal rejimda ishga tushmoqda." -ForegroundColor Green
  Write-Host "Manzil: http://127.0.0.1:8787/warehouse/admin"
  Write-Host "Ma'lumotlar: $($env:WAREHOUSE_STATE_FILE)"
  Write-Host "Bu server faqat shu kompyuterdan kirish uchun ochiq."
  Write-Host "To'xtatish uchun Ctrl+C bosing."
  Write-Host ""
  node (Join-Path $repoRoot 'server.mjs')
  if ($LASTEXITCODE -ne 0) {
    throw "AKBEL serveri xato bilan yakunlandi (exit code $LASTEXITCODE)."
  }
} finally {
  $env:WAREHOUSE_ADMIN_PASSWORD = ''
  $password = $null
  $securePassword.Dispose()
}
