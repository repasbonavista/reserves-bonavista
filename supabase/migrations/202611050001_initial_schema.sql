-- Initial schema for Reserves CEIP Bonavista.
-- RLS is enabled below without direct table policies. Public booking access is
-- intentionally added separately through narrowly scoped policies/functions.

begin;

create table public.resource_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) between 1 and 120),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.resource_categories(id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 120),
  capacity integer not null default 1 check (capacity > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (category_id, name)
);

create table public.school_sessions (
  id uuid primary key default gen_random_uuid(),
  session_number smallint not null unique check (session_number between 1 and 6),
  label text not null check (length(btrim(label)) between 1 and 80),
  starts_at time,
  ends_at time,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (
    (starts_at is null and ends_at is null)
    or (starts_at is not null and ends_at is not null and starts_at < ends_at)
  )
);

create table public.reservation_groups (
  id uuid primary key default gen_random_uuid(),
  teacher_name text not null check (length(btrim(teacher_name)) between 1 and 120),
  created_by uuid references auth.users(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  check (
    (status = 'active' and cancelled_at is null)
    or (status = 'cancelled' and cancelled_at is not null)
  )
);

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.reservation_groups(id) on delete cascade,
  resource_id uuid not null references public.resources(id) on delete restrict,
  session_id uuid not null references public.school_sessions(id) on delete restrict,
  booking_date date not null,
  quantity integer not null default 1 check (quantity > 0),
  created_at timestamptz not null default now(),
  unique (group_id, resource_id, session_id, booking_date)
);

create index reservations_by_resource_slot
  on public.reservations (resource_id, booking_date, session_id);

create index reservations_by_group
  on public.reservations (group_id);

-- Serialize bookings for the same resource/date/session and prevent capacity
-- from being exceeded when requests arrive at the same time.
create or replace function public.check_reservation_capacity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  available_capacity integer;
  already_reserved integer;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(
      new.resource_id::text || ':' || new.booking_date::text || ':' || new.session_id::text,
      0
    )
  );

  if not exists (
    select 1
    from public.reservation_groups as rg
    where rg.id = new.group_id
      and rg.status = 'active'
  ) then
    raise exception 'Reservation group is not active';
  end if;

  select r.capacity
    into available_capacity
  from public.resources as r
  where r.id = new.resource_id
    and r.is_active;

  if not found then
    raise exception 'Resource is unavailable';
  end if;

  select coalesce(sum(res.quantity), 0)::integer
    into already_reserved
  from public.reservations as res
  join public.reservation_groups as rg on rg.id = res.group_id
  where res.resource_id = new.resource_id
    and res.booking_date = new.booking_date
    and res.session_id = new.session_id
    and rg.status = 'active';

  if already_reserved + new.quantity > available_capacity then
    raise exception 'Requested quantity exceeds remaining availability'
      using errcode = '23P01';
  end if;

  return new;
end;
$$;

revoke all on function public.check_reservation_capacity() from public, anon, authenticated;

create trigger check_reservation_capacity_before_insert
before insert on public.reservations
for each row execute function public.check_reservation_capacity();

-- Deny direct API access to reservation records; controlled public access will
-- be added separately after the reservation RPCs are prepared.
alter table public.resource_categories enable row level security;
alter table public.resources enable row level security;
alter table public.school_sessions enable row level security;
alter table public.reservation_groups enable row level security;
alter table public.reservations enable row level security;

-- Initial centre catalogue supplied by the school.
insert into public.resource_categories (name, sort_order)
values
  ('Aula STEM', 1),
  ('Aula d''ordinadors', 2),
  ('Biblioteca', 3),
  ('Reserva de portàtils', 4)
on conflict (name) do update
set sort_order = excluded.sort_order,
    is_active = true;

insert into public.resources (category_id, name, capacity)
select categories.id, initial_resources.resource_name, initial_resources.capacity
from (
  values
    ('Aula STEM', 'Aula STEM', 1),
    ('Aula d''ordinadors', 'Aula d''ordinadors', 1),
    ('Biblioteca', 'Biblioteca', 1),
    ('Reserva de portàtils', 'Reserva de portàtils', 20)
) as initial_resources(category_name, resource_name, capacity)
join public.resource_categories as categories
  on categories.name = initial_resources.category_name
on conflict (category_id, name) do update
set capacity = excluded.capacity,
    is_active = true;

insert into public.school_sessions (session_number, label, starts_at, ends_at)
values
  (1, 'Primera', null, null),
  (2, 'Segona', null, null),
  (3, 'Tercera', null, null),
  (4, 'Quarta', null, null),
  (5, 'Cinquena', null, null),
  (6, 'Sisena', null, null)
on conflict (session_number) do update
set label = excluded.label,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    is_active = true;

commit;
