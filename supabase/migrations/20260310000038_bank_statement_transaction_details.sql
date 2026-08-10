alter table public.bank_statement_lines
  add column if not exists transaction_type text;

comment on column public.bank_statement_lines.transaction_type is
  'Transaction mode/type supplied by the bank statement, such as NEFT, UPI, cheque, debit or credit.';
