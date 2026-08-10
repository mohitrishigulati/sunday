CREATE OR REPLACE FUNCTION public.run_extended_acceptance()
RETURNS TABLE(check_no integer, title text, passed boolean, detail text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE v_count integer; v_flag boolean;
BEGIN
  SELECT COUNT(*) INTO v_count FROM storage.buckets WHERE id='accounting-attachments' AND NOT public AND file_size_limit=20971520;
  RETURN QUERY SELECT 14,'Private attachment bucket',v_count=1,format('matching buckets=%s',v_count);

  SELECT COUNT(*) INTO v_count FROM pg_trigger WHERE NOT tgisinternal AND tgname='trg_validate_voucher_allocation';
  RETURN QUERY SELECT 15,'Bill allocation DB enforcement',v_count=1,format('trigger count=%s',v_count);

  SELECT COUNT(*) INTO v_count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('match_bank_statement_line','suggest_bank_statement_parties') AND p.prosecdef
      AND COALESCE(array_to_string(p.proconfig,','),'') LIKE '%search_path%';
  RETURN QUERY SELECT 16,'Bank match and alias RPC security',v_count=2,format('secured functions=%s',v_count);

  SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bank_statement_imports' AND column_name='attachment_id') INTO v_flag;
  RETURN QUERY SELECT 17,'Statement attachment link',v_flag,CASE WHEN v_flag THEN 'column present' ELSE 'column missing' END;

  SELECT relrowsecurity AND relforcerowsecurity INTO v_flag FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='salary_register';
  RETURN QUERY SELECT 18,'Payroll RLS forced',COALESCE(v_flag,false),COALESCE(v_flag::text,'table missing');

  SELECT COUNT(*) INTO v_count FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('trg_validate_closing_stock_entry','trg_prevent_approved_closing_stock_delete');
  RETURN QUERY SELECT 19,'Closing stock approval and immutability',v_count=2,format('trigger count=%s',v_count);

  SELECT COUNT(*) INTO v_count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('business_documents','business_document_lines','voucher_allocations','financial_year_closures') AND c.relrowsecurity AND c.relforcerowsecurity;
  RETURN QUERY SELECT 20,'Phase 4/5 tables force RLS',v_count=4,format('forced tables=%s',v_count);

  SELECT COUNT(*) INTO v_count FROM pg_indexes WHERE schemaname='public' AND indexname='uq_attachments_storage_path';
  RETURN QUERY SELECT 21,'Attachment path deduplication',v_count=1,format('unique indexes=%s',v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.run_extended_acceptance() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_extended_acceptance() TO authenticated;
