-- Qualify the reservation group columns in RETURNING to avoid a name collision
-- with the cancellation_token output variable declared by RETURNS TABLE.

begin;

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

  insert into public.reservation_groups as rg (teacher_name)
  values (btrim(p_teacher_name))
  returning rg.id, rg.cancellation_token
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

commit;
