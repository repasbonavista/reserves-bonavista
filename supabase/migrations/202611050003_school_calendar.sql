-- Calendar closures for the 2026-27 school year.
-- Weekends and dates marked red in the CEIP Bonavista school calendar cannot
-- receive reservations, including requests sent directly to the RPC.
-- The 2026-27 booking period runs from 7 September through 18 June.

begin;

create table if not exists public.school_calendar_closures (
  closure_date date primary key,
  label text not null
);

alter table public.school_calendar_closures enable row level security;
revoke all on table public.school_calendar_closures from PUBLIC, anon, authenticated;

insert into public.school_calendar_closures (closure_date, label) values
  ('2026-09-08', 'Festa local'),
  ('2026-09-09', 'Festa local'),
  ('2026-10-09', 'Dia de la Comunitat Valenciana'),
  ('2026-10-12', 'Festa nacional'),
  ('2026-12-07', 'Pont de desembre'),
  ('2026-12-08', 'Immaculada Concepció'),
  ('2026-12-23', 'Vacances de Nadal'),
  ('2026-12-24', 'Vacances de Nadal'),
  ('2026-12-25', 'Vacances de Nadal'),
  ('2026-12-28', 'Vacances de Nadal'),
  ('2026-12-29', 'Vacances de Nadal'),
  ('2026-12-30', 'Vacances de Nadal'),
  ('2026-12-31', 'Vacances de Nadal'),
  ('2027-01-01', 'Vacances de Nadal'),
  ('2027-01-04', 'Vacances de Nadal'),
  ('2027-01-05', 'Vacances de Nadal'),
  ('2027-01-06', 'Reis'),
  ('2027-03-16', 'Falles'),
  ('2027-03-17', 'Falles'),
  ('2027-03-18', 'Falles'),
  ('2027-03-19', 'Falles'),
  ('2027-03-25', 'Vacances de Pasqua'),
  ('2027-03-26', 'Vacances de Pasqua'),
  ('2027-03-29', 'Vacances de Pasqua'),
  ('2027-03-30', 'Vacances de Pasqua'),
  ('2027-03-31', 'Vacances de Pasqua'),
  ('2027-04-01', 'Vacances de Pasqua'),
  ('2027-04-02', 'Vacances de Pasqua'),
  ('2027-04-05', 'Vacances de Pasqua')
on conflict (closure_date) do update
set label = excluded.label;

create or replace function public.reject_non_lective_reservation_date()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
begin
  if new.booking_date < date '2026-09-07'
     or new.booking_date > date '2027-06-18'
     or extract(isodow from new.booking_date) in (6, 7)
     or exists (
       select 1
       from public.school_calendar_closures as closures
       where closures.closure_date = new.booking_date
     ) then
    raise exception 'Booking date is non-lective';
  end if;

  return new;
end;
$$;

drop trigger if exists reservations_reject_non_lective_date on public.reservations;
create trigger reservations_reject_non_lective_date
before insert or update of booking_date on public.reservations
for each row
execute function public.reject_non_lective_reservation_date();

revoke all on function public.reject_non_lective_reservation_date() from PUBLIC, anon, authenticated;

commit;
