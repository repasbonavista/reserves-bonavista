-- Anonymous access for the QR-linked reservation app.
-- Reservation records and teacher names stay private; the browser receives
-- only catalogue data, availability totals, and its own cancellation token.

begin;

alter table public.reservation_groups
  add column cancellation_token uuid not null default gen_random_uuid() unique;

grant usage on schema public to anon;
revoke all on table public.resource_categories, public.resources, public.school_sessions
  from PUBLIC, anon, authenticated;
grant select on table public.resource_categories, public.resources, public.school_sessions
  to anon;
revoke all on table public.reservation_groups, public.reservations
  from PUBLIC, anon, authenticated;

create policy active_categories_are_public
  on public.resource_categories for select to anon
  using (is_active);

create policy active_resources_are_public
  on public.resources for select to anon
  using (
    is_active
    and exists (
      select 1
      from public.resource_categories as categories
      where categories.id = category_id
        and categories.is_active
    )
  );

create policy active_sessions_are_public
  on public.school_sessions for select to anon
  using (is_active);

create or replace function public.get_reservation_availability(
  p_resource_id uuid,
  p_booking_dates date[]
)
returns table (
  booking_date date,
  session_id uuid,
  session_number smallint,
  session_label text,
  capacity integer,
  reserved_quantity integer,
  available_quantity integer
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare
  school_today date := (now() at time zone 'Europe/Madrid')::date;
begin
  if p_booking_dates is null or cardinality(p_booking_dates) not between 1 and 60 then
    raise exception 'Choose between 1 and 60 booking dates';
  end if;

  if exists (
    select 1
    from unnest(p_booking_dates) as requested(requested_date)
    where requested.requested_date is null
       or requested.requested_date < school_today
  ) then
    raise exception 'Booking dates must be today or later';
  end if;

  if cardinality(p_booking_dates) <> (
    select count(distinct requested_date)::integer
    from unnest(p_booking_dates) as requested(requested_date)
  ) then
    raise exception 'Booking dates must not contain duplicates';
  end if;

  if not exists (
    select 1
    from public.resources as r
    join public.resource_categories as c on c.id = r.category_id
    where r.id = p_resource_id
      and r.is_active
      and c.is_active
  ) then
    raise exception 'Resource is unavailable';
  end if;

  return query
  select requested.requested_date,
         s.id,
         s.session_number,
         s.label,
         r.capacity,
         coalesce(sum(case when rg.id is not null then res.quantity else 0 end), 0)::integer,
         (r.capacity - coalesce(sum(case when rg.id is not null then res.quantity else 0 end), 0))::integer
  from unnest(p_booking_dates) as requested(requested_date)
  cross join public.resources as r
  cross join public.school_sessions as s
  left join public.reservations as res
    on res.resource_id = r.id
   and res.booking_date = requested.requested_date
   and res.session_id = s.id
  left join public.reservation_groups as rg
    on rg.id = res.group_id
   and rg.status = 'active'
  where r.id = p_resource_id
    and r.is_active
    and s.is_active
  group by requested.requested_date, s.id, s.session_number, s.label, r.capacity
  order by requested.requested_date, s.session_number;
end;
$$;

create or replace function public.create_reservation_group(
  p_teacher_name text,
  p_resource_id uuid,
  p_session_id uuid,
  p_booking_dates date[],
  p_quantity integer default 1
)
returns table (group_id uuid, cancellation_token uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare
  school_today date := (now() at time zone 'Europe/Madrid')::date;
  resource_capacity integer;
  new_group_id uuid;
  new_cancellation_token uuid;
  requested_date date;
begin
  if p_teacher_name is null or length(btrim(p_teacher_name)) not between 1 and 120 then
    raise exception 'Teacher name is required';
  end if;

  if p_booking_dates is null or cardinality(p_booking_dates) not between 1 and 60 then
    raise exception 'Choose between 1 and 60 booking dates';
  end if;

  if exists (
    select 1
    from unnest(p_booking_dates) as requested(value)
    where requested.value is null
       or requested.value < school_today
  ) then
    raise exception 'Booking dates must be today or later';
  end if;

  if cardinality(p_booking_dates) <> (
    select count(distinct value)::integer
    from unnest(p_booking_dates) as requested(value)
  ) then
    raise exception 'Booking dates must not contain duplicates';
  end if;

  if p_quantity is null or p_quantity < 1 then
    raise exception 'Quantity must be at least 1';
  end if;

  select r.capacity
    into resource_capacity
  from public.resources as r
  join public.resource_categories as c on c.id = r.category_id
  where r.id = p_resource_id
    and r.is_active
    and c.is_active;

  if not found then
    raise exception 'Resource is unavailable';
  end if;

  if p_quantity > resource_capacity then
    raise exception 'Requested quantity exceeds resource capacity';
  end if;

  if not exists (
    select 1 from public.school_sessions as s
    where s.id = p_session_id and s.is_active
  ) then
    raise exception 'Session is unavailable';
  end if;

  insert into public.reservation_groups (teacher_name)
  values (btrim(p_teacher_name))
  returning id, cancellation_token
    into new_group_id, new_cancellation_token;

  for requested_date in
    select value
    from unnest(p_booking_dates) as requested(value)
    order by value
  loop
    insert into public.reservations (
      group_id,
      resource_id,
      session_id,
      booking_date,
      quantity
    ) values (
      new_group_id,
      p_resource_id,
      p_session_id,
      requested_date,
      p_quantity
    );
  end loop;

  return query select new_group_id, new_cancellation_token;
end;
$$;

create or replace function public.cancel_reservation_group(
  p_group_id uuid,
  p_cancellation_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare
  affected_rows integer;
begin
  if p_group_id is null or p_cancellation_token is null then
    return false;
  end if;

  update public.reservation_groups
     set status = 'cancelled',
         cancelled_at = now()
   where id = p_group_id
     and cancellation_token = p_cancellation_token
     and status = 'active';

  get diagnostics affected_rows = row_count;
  return affected_rows = 1;
end;
$$;

revoke all on function public.get_reservation_availability(uuid, date[]) from PUBLIC, anon, authenticated;
revoke all on function public.create_reservation_group(text, uuid, uuid, date[], integer) from PUBLIC, anon, authenticated;
revoke all on function public.cancel_reservation_group(uuid, uuid) from PUBLIC, anon, authenticated;
grant execute on function public.get_reservation_availability(uuid, date[]) to anon;
grant execute on function public.create_reservation_group(text, uuid, uuid, date[], integer) to anon;
grant execute on function public.cancel_reservation_group(uuid, uuid) to anon;

commit;
