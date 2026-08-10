-- Additional private-sector, small-finance and payment banks requested for
-- operational bank-account selection. Existing seeded banks are updated, not
-- duplicated.
INSERT INTO public.banks (code, name) VALUES
  ('HDFC', 'HDFC Bank'),
  ('ICICI', 'ICICI Bank'),
  ('AXIS', 'Axis Bank'),
  ('KOTAK', 'Kotak Mahindra Bank'),
  ('INDUSIND', 'IndusInd Bank'),
  ('YES', 'Yes Bank'),
  ('IDBI', 'IDBI Bank'),
  ('IDFCFIRST', 'IDFC FIRST Bank'),
  ('FEDERAL', 'Federal Bank'),
  ('RBL', 'RBL Bank'),
  ('CUB', 'City Union Bank'),
  ('KVB', 'Karur Vysya Bank'),
  ('SIB', 'South Indian Bank'),
  ('JKB', 'Jammu & Kashmir Bank'),
  ('BANDHAN', 'Bandhan Bank'),
  ('DHANLAXMI', 'Dhanlaxmi Bank'),
  ('TMB', 'Tamilnad Mercantile Bank'),
  ('DCB', 'DCB Bank'),
  ('CSB', 'CSB Bank'),
  ('AUSFB', 'AU Small Finance Bank'),
  ('EQUITAS', 'Equitas Small Finance Bank'),
  ('UJJIVAN', 'Ujjivan Small Finance Bank'),
  ('SURYODAY', 'Suryoday Small Finance Bank'),
  ('UTKARSH', 'Utkarsh Small Finance Bank'),
  ('ESAF', 'ESAF Small Finance Bank'),
  ('FINO', 'Fino Payments Bank')
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    is_active = true;
