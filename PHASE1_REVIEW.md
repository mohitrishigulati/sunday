# Phase 1 and final integration review

## Verified environment (2026-08-10)

| Item | Result |
| --- | --- |
| Target | Supabase project `pwjphwvmxmbrvmygxhlj` |
| Migrations | `001`–`044` applied through SQL Editor |
| Foundation acceptance | `run_full_acceptance()` → **0 failed** |
| Extended acceptance | `run_extended_acceptance()` → **0 failed** |
| Admin login | Working (`admin@testaccount.com`) |
| Runtime smoke test | All operational routes loaded without application/runtime error |
| End-to-end posting | Test sale `TEST-SALE-20260810-01` posted as `DEMO-A-SALE-2026-27-000001` |
| Production build | `npm run build` passed |
| Static checks | TypeScript and ESLint passed |
| Dependency audit | `npm audit --omit=dev` → 0 vulnerabilities |

## Foundation controls retained

1. Unbalanced draft saves; post rejects until balanced and approved.
2. Parallel posts use the locked series without duplicate numbers.
3. Failed post leaves no numbering gap.
4. Locked periods reject create, approve and post.
5. Posted vouchers, lines and postings reject update/delete.
6. Company RLS isolation.
7. Restricted cashier location isolation.
8. Opening-balance voucher leaves Trial Balance tied.
9. Trigger audit on create/approve/post; clients cannot forge audit rows.
10. Direct draft post rejected.
11. Maker self-approval rejected except configured admin override.
12. Opening-balance helper requires manage capability.
13. Seed/setup helpers require manage capability.

## Later-phase hardening

- Private attachment bucket and company-path storage RLS.
- Bank raw-row immutability, file/line dedupe, alias suggestion and validated matching RPC.
- Immutable source-row sequence plus fixed 4-decimal running-balance verification for every bank statement transaction.
- Bill-wise allocations with database locking and invoice/settlement-line caps.
- Approved closing-stock immutability and maker/checker approval.
- Payroll status progression `draft → approved → paid`, same-company posted payment voucher and paid-row immutability.
- FY close/carry-forward RPC and consolidation/inter-company reporting.
- Public Auth sign-up is disabled. Admin-created users use the server-only service-role Admin API; the key is never sent to browser code.

## Migration history note

SQL Editor application does not populate the CLI migration-history table. Before using `supabase db push`, sign in/link the CLI and mark versions `001`–`044` applied with `supabase migration repair`, or rebase with an approved `db pull` workflow.

## Release boundaries

The supported PDF parser handles text PDFs. Scanned/image-only statements need a reviewed bank-specific OCR adapter. Inventory is intentionally outside this release; approved manual closing stock feeds the Trading Account.
