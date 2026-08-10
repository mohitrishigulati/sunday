-- After first sign-up, promote yourself to admin (replace email).
-- Run in Supabase SQL editor.

insert into public.user_roles (user_id, role_id)
select p.id, r.id
from public.profiles p
cross join public.roles r
where p.email = 'you@example.com'
  and r.code = 'admin'
on conflict do nothing;
