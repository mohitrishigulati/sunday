# Apply migrations 011-017 individually (stop on first failure).
# Prerequisites: Docker Desktop running + `npx supabase start`
# OR set $env:DATABASE_URL to your Postgres connection string.

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

$files = @(
  "supabase/migrations/20260310000011_force_rls.sql",
  "supabase/migrations/20260310000012_acceptance_harness.sql",
  "supabase/migrations/20260310000013_approval_authz_blockers.sql",
  "supabase/migrations/20260310000014_acceptance_harness_v2.sql",
  "supabase/migrations/20260310000015_cash_book_location_ledger.sql",
  "supabase/migrations/20260310000016_default_privileges_search_path.sql",
  "supabase/migrations/20260310000017_cashier_scope_least_privilege.sql"
)

function Apply-SqlFile([string]$path) {
  Write-Host "`n=== APPLY: $path ===" -ForegroundColor Cyan
  if ($env:DATABASE_URL) {
    & psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -f $path
    if ($LASTEXITCODE -ne 0) { throw "Failed: $path" }
  } else {
    npx supabase db query --file $path
    if ($LASTEXITCODE -ne 0) { throw "Failed: $path" }
  }
  Write-Host "OK: $path" -ForegroundColor Green
}

foreach ($f in $files) {
  if (-not (Test-Path $f)) { throw "Missing file: $f" }
  Apply-SqlFile $f
}

Write-Host "`nAll 011-017 applied. Next:" -ForegroundColor Green
Write-Host '  select * from public.run_full_acceptance();'
