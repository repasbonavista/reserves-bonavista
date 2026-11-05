-- Allow the no-login school app to show active reservations across devices
-- and cancel a selected reservation after explicit frontend confirmation.
-- Names are included because the school requested visible ownership.

begin;

create or replace function public.get_public_active_reservations()
returns table (
  group_id uuid,
  reference_code text,
  teacher_name text,
  resource_name text,
  session_label text,
  session_number smallint,
  booking_dates date[],
  quantity integer
)
language sql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
  select rg.id,
         upper(right(replace(rg.id::text, '-', ''), 6)),
         rg.teacher_name,
         r.name,
         s.label,
         s.session_number,
         array_agg(res.booking_date order by res.booking_date)::date[],
         max(res.quantity)::integer
  from public.reservation_groups as rg
  join public.reservations as res on res.group_id = rg.id
  join public.resources as r on r.id = res.resource_id
  join public.school_sessions as s on s.id = res.session_id
  where rg.status = 'active'
    and res.booking_date >= (now() at time zone 'Europe/Madrid')::date
  group by rg.id, rg.teacher_name, r.name, s.label, s.session_number
  order by min(res.booking_date), s.session_number, r.name, rg.id;
$$;

create or replace function public.cancel_reservation_group_public(
  p_group_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare
  school_today date := (now() at time zone 'Europe/Madrid')::date;
  affected_rows integer;
begin
  if p_group_id is null then
    return false;
  end if;

  update public.reservation_groups as rg
     set status = 'cancelled',
         cancelled_at = now()
   where rg.id = p_group_id
     and rg.status = 'active'
     and exists (
       select 1
       from public.reservations as res
       where res.group_id = rg.id
         and res.booking_date >= school_today
     );

  get diagnostics affected_rows = row_count;
  return affected_rows = 1;
end;
$$;

revoke all on function public.get_public_active_reservations() from PUBLIC, anon, authenticated;
revoke all on function public.cancel_reservation_group_public(uuid) from PUBLIC, anon, authenticated;
grant execute on function public.get_public_active_reservations() to anon;
grant execute on function public.cancel_reservation_group_public(uuid) to anon;

commit;
