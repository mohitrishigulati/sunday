/**
 * Applies migration files to Postgres over a connection URI, without needing
 * psql, Docker, or the Supabase CLI.
 *
 *   npm i -D pg
 *   # Supabase → Project Settings → Database → Connection string → URI
 *   # (session pooler works; include the password in the URI)
 *   DATABASE_URL="postgresql://..." node scripts/apply-migrations.mjs
 *
 * Each file runs inside its own transaction: a file either applies completely
 * or not at all, and the run stops at the first failure so later migrations
 * never land on a half-applied earlier one.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const FILES = [
  "supabase/migrations/20260310000030_document_immutability_audit_coverage.sql",
  "supabase/migrations/20260310000031_atomic_invoice_rpc.sql",
  "supabase/migrations/20260310000032_canonical_fingerprint_atomic_transfers.sql",
  "supabase/migrations/20260310000046_financial_year_periods_guarantee.sql",
];

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL is not set.\n" +
      "Supabase → Project Settings → Database → Connection string → URI",
  );
  process.exit(1);
}

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});

const repoRoot = path.resolve(import.meta.dirname, "..");

try {
  await client.connect();
  const { rows } = await client.query("select current_database() as db");
  console.log(`Connected to ${rows[0].db}\n`);

  for (const file of FILES) {
    process.stdout.write(`APPLY  ${file} ... `);
    const sql = await readFile(path.join(repoRoot, file), "utf8");
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("commit");
      console.log("ok");
    } catch (error) {
      await client.query("rollback");
      console.log("FAILED");
      console.error(`\n${error.message}\n`);
      console.error(`Nothing from ${file} was applied. Later files were skipped.`);
      process.exitCode = 1;
      break;
    }
  }

  if (process.exitCode !== 1) {
    console.log("\nVerifying:");
    const checks = await client.query(
      `select proname from pg_proc
        where proname in ('create_business_document','create_intercompany_transfer',
                          'create_location_cash_transfer','ensure_financial_year_periods')
        order by 1`,
    );
    console.log(`  RPCs present: ${checks.rows.map((r) => r.proname).join(", ") || "none"}`);

    const periods = await client.query(
      `select c.code as company, fy.code as fy, count(p.id)::int as periods
         from companies c
         join financial_years fy on fy.company_id = c.id
         left join accounting_periods p on p.financial_year_id = fy.id
        group by 1,2 order by 1,2`,
    );
    for (const row of periods.rows) {
      const flag = row.periods === 0 ? "  <-- STILL EMPTY" : "";
      console.log(`  ${row.company} ${row.fy}: ${row.periods} periods${flag}`);
    }
  }
} finally {
  await client.end();
}
