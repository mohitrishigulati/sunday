# SundayMD — Multi-Company Accounting

Accounting and bank/cash management for a group of 25+ companies. Each company keeps independent books; shared parties and consolidation provide group-level reporting without double-counting inter-company transfers.

## Current status (2026-08-10)

| Phase | Status | Main coverage |
| --- | --- | --- |
| 1. Foundation | Complete and verified | Companies, locations, banks, COA, parties/aliases, FY/periods, opening balances, roles/RLS/audit |
| 2. Daily entries | Complete | Cash Book, location transfers, physical verification, Bank Book, multi-line JV, approval/post/reversal |
| 3. Bank import | Complete for supported parsers | CSV, XLS/XLSX and text-PDF intake, private source files, dedupe, alias suggestions, matching and BRS |
| 4. Sales/purchase | Complete | GST/TDS invoice lines, HSN/SAC, round-off, bill allocations, on-account, ageing, commission, expenses and payroll |
| 5. Consolidation | Complete | Inter-company paired vouchers, pending/matched view, elimination mapping, consolidation, statutory summaries and FY close |

Production build passes. Remote Supabase verification currently reports:

```text
run_full_acceptance():      0 failed (31 result rows; controls 1–13)
run_extended_acceptance():  0 failed (checks 14–21)
npm audit --omit=dev:       0 vulnerabilities
```

## Stack

- Next.js 16 App Router, TypeScript strict and Tailwind CSS
- Supabase Postgres, Auth, Storage and Row Level Security
- Server Actions with authentication, permission and company/location re-checks
- `numeric(18,4)` for accounting amounts

## Accounting controls

- Deferred database balance enforcement applies when a voucher is posted; drafts may be incomplete.
- Voucher numbers are allocated inside the posting transaction from locked per-company/location/type/FY counters. Failed posts do not consume a number.
- Posted vouchers/postings and approved closing stock are immutable; corrections use current-open-period reversals.
- Period locks block create, approve and post operations.
- Opening balances and FY carry-forward are posted vouchers, so Trial Balance remains tied.
- Maker/checker is enforced, with configured admin override.
- Raw bank statement fields and source-row sequence are immutable. Every imported row is checked with fixed 4-decimal arithmetic so previous balance + credit - debit must equal the bank's running balance; any mismatch blocks import.
- Bill allocation triggers prevent invoice and receipt/payment over-allocation under concurrency.
- Bank matching verifies company, account ledger, direction, amount, posted status and date tolerance.
- Audit rows are trigger-generated and cannot be forged by authenticated clients.
- RLS scopes users by company and restricted cashiers by location.

## Main workflows

- **Cash:** company → location → date → receipt/payment → ledger → amount; approval/post produces the unique voucher. Cash registers are separated by location with running balances, physical-cash differences and print/PDF support.
- **Bank:** manual receipts/payments or uploaded statements. Statement files stay in the private `accounting-attachments` bucket; raw lines keep the bank file's original row order, every running balance is recalculated, and valid rows are deduplicated and matched to posted bank legs.
- **Journal:** multi-line Dr/Cr with party, location, cost-centre and salesman dimensions, draft/approve/post and document support.
- **Business:** sales/purchase invoice with GST/TDS/HSN/SAC, item dimensions, round-off, supporting file and bill-wise settlement. Unallocated receipts/payments remain visible as on-account.
- **Inter-company:** one transfer ID links both companies' draft vouchers; each company approves/posts its own leg and the reconciler marks the pair matched.
- **Year end:** lock every period, enter/approve closing stock, then close the FY. Balance-sheet balances and current-year result carry forward through a posted opening voucher.

## Reports

Cash Book, Bank Book, Day Book, Ledger, Party Ledger/balances, Trial Balance, Trading Account, P&L, Balance Sheet, Cash Flow, Fund Flow/Working Capital, Sales/Purchase registers, salesman/broker commission, expense heads, salary, customer/supplier ageing, GST/TDS/e-way bill, bank reconciliation, unmatched bank lines, aliases, audit, inter-company pending and consolidated reports. Core report tables support date filters, CSV export and Print/Save PDF.

## Setup

1. Copy `.env.example` to `.env.local` and set the target Supabase URL and anon key.
2. Apply migrations in filename order, currently `20260310000001` through `20260310000044`.
3. Create the first Auth user in Supabase Dashboard and run `supabase/seed_bootstrap_admin.sql` with that email. Set the server-only `SUPABASE_SERVICE_ROLE_KEY` in the deployment environment, disable public Auth sign-up in Supabase, and thereafter use **Masters → Users & access**. Never prefix the service-role key with `NEXT_PUBLIC_` or expose it to browser code.
4. Run:

```bash
npm install
npm run dev
```

Verify the database:

```sql
select * from public.run_full_acceptance();
select * from public.run_extended_acceptance();
```

Every row must have `passed = true`.

If SQL Editor was used instead of the CLI, reconcile Supabase migration history before a future `db push`:

```bash
npx supabase login
npx supabase link --project-ref pwjphwvmxmbrvmygxhlj
npx supabase migration repair --status applied <version>
```

## Deliberate scope boundaries

- Currency is INR only in this release.
- Inventory quantity/valuation is not a module. Trading Account uses an approved manual closing-stock value, as specified in the original brief.
- PDF import reads text-based statements through the generic parser. Image-only/scanned statements require a bank-specific OCR/parser adapter; no system can safely infer every bank's scanned layout without configuration and review.
- Before production cut-over, enable the required Supabase backup/PITR plan, configure email delivery/confirmation, rotate the shared test password, and replace demo data with approved opening vouchers.
