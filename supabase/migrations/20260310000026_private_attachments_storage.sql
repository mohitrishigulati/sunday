CREATE OR REPLACE FUNCTION public.try_uuid(p_value text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
BEGIN RETURN p_value::uuid; EXCEPTION WHEN invalid_text_representation THEN RETURN NULL; END;
$$;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('accounting-attachments','accounting-attachments',false,20971520,ARRAY['application/pdf','text/csv','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/jpeg','image/png'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=EXCLUDED.file_size_limit,allowed_mime_types=EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS accounting_attachments_select ON storage.objects;
CREATE POLICY accounting_attachments_select ON storage.objects FOR SELECT TO authenticated
USING(bucket_id='accounting-attachments' AND (public.try_uuid((storage.foldername(name))[1]) IN (SELECT public.user_company_ids('read')) OR public.user_has_role(ARRAY['admin'])));
DROP POLICY IF EXISTS accounting_attachments_insert ON storage.objects;
CREATE POLICY accounting_attachments_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK(bucket_id='accounting-attachments' AND (public.try_uuid((storage.foldername(name))[1]) IN (SELECT public.user_company_ids('write')) OR public.user_has_role(ARRAY['admin'])));
DROP POLICY IF EXISTS accounting_attachments_update ON storage.objects;
CREATE POLICY accounting_attachments_update ON storage.objects FOR UPDATE TO authenticated
USING(bucket_id='accounting-attachments' AND (public.try_uuid((storage.foldername(name))[1]) IN (SELECT public.user_company_ids('write')) OR public.user_has_role(ARRAY['admin'])))
WITH CHECK(bucket_id='accounting-attachments' AND (public.try_uuid((storage.foldername(name))[1]) IN (SELECT public.user_company_ids('write')) OR public.user_has_role(ARRAY['admin'])));
DROP POLICY IF EXISTS accounting_attachments_delete ON storage.objects;
CREATE POLICY accounting_attachments_delete ON storage.objects FOR DELETE TO authenticated
USING(bucket_id='accounting-attachments' AND (public.try_uuid((storage.foldername(name))[1]) IN (SELECT public.user_company_ids('manage')) OR public.user_has_role(ARRAY['admin'])));

ALTER TABLE public.bank_statement_imports ADD COLUMN IF NOT EXISTS attachment_id uuid REFERENCES public.attachments(id);
REVOKE ALL ON FUNCTION public.try_uuid(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.try_uuid(text) TO authenticated;
