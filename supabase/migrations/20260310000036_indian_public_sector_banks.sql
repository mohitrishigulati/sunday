-- Current Public Sector Banks listed by the Department of Financial Services,
-- Ministry of Finance (12 banks; list last updated 03-Feb-2026).
INSERT INTO public.banks (code, name) VALUES
  ('BOB', 'Bank of Baroda'),
  ('BOI', 'Bank of India'),
  ('BOM', 'Bank of Maharashtra'),
  ('CANARA', 'Canara Bank'),
  ('CBI', 'Central Bank of India'),
  ('INDIAN', 'Indian Bank'),
  ('IOB', 'Indian Overseas Bank'),
  ('PNB', 'Punjab National Bank'),
  ('PSB', 'Punjab & Sind Bank'),
  ('SBI', 'State Bank of India'),
  ('UCO', 'UCO Bank'),
  ('UBI', 'Union Bank of India')
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    is_active = true;
