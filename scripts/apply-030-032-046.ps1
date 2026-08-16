# Apply 030 → 031 → 032 → 046 in order. Stop on first failure.
# Set DATABASE_URL to the SundayMD Postgres URI (Settings → Database), then:
#   powershell -File scripts/apply-030-032-046.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

$files = @(
  "supabase/migrations/20260310000030_document_immutability_audit_coverage.sql",
  "supabase/migrations/20260310000031_atomic_invoice_rpc.sql",
  "supabase/migrations/20260310000032_canonical_fingerprint_atomic_transfers.sql",
  "supabase/migrations/20260310000046_financial_year_periods_guarantee.sql"
)

if (-not $env:DATABASE_URL) {
  Write-Error "Set DATABASE_URL to the SundayMD Postgres connection string first."
}

function Apply-SqlFile([string]$path) {
  Write-Host "`n=== APPLY: $path ===" -ForegroundColor Cyan
  if (-not (Test-Path $path)) { throw "Missing file: $path" }
  & psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -f $path
  if ($LASTEXITCODE -ne 0) { throw "Failed: $path" }
  Write-Host "OK: $path" -ForegroundColor Green
}

foreach ($f in $files) { Apply-SqlFile $f }

Write-Host "`nVerify RPCs and MARTIGROW periods:" -ForegroundColor Green
& psql $env:DATABASE_URL -c "select proname from pg_proc where proname in ('create_business_document','create_intercompany_transfer','create_location_cash_transfer','ensure_financial_year_periods') order by 1;"
& psql $env:DATABASE_URL -c "select c.code as company, fy.code as fy, count(p.id) as periods from companies c join financial_years fy on fy.company_id=c.id left join accounting_periods p on p.financial_year_id=fy.id where c.code='MARTIGROW' group by 1,2;"
