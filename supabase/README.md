# Supabase database

## Applied

`migrations/202611050001_initial_schema.sql`, `migrations/202611050002_public_booking_access.sql`, `migrations/202611050003_school_calendar.sql`, and `migrations/202611050004_fix_reservation_group_returning.sql` were applied manually in the Supabase SQL Editor. The first migration creates the tables, seeds Aula STEM, Aula d'ordinadors, Biblioteca, and Reserva de portàtils, sets the portable capacity to 20, adds six sessions without fixed times, and prevents overbooking.

The second migration enables the no-login QR workflow. Visitors can read active resources and sessions, view availability totals, and create bookings through database functions. Reservation tables have no direct public access; cancellation is handled by functions.

The third migration records the non-lective dates from the 2026-27 CEIP Bonavista calendar and rejects reservations outside the school period (7 September 2026 through 18 June 2027), on weekends, and on those dates. The 18 June 2027 final day with pupils is also marked in the frontend.

The fourth migration fixes the ambiguous `cancellation_token` reference in reservation creation.

## Pending migration

`migrations/202611050005_shared_reservation_management.sql` enables a public list of active reservations, including the teacher name, resource, session, dates, quantity, and a short reference. It also allows any visitor with the web link to cancel any active reservation through the app's confirmation flow. This is intentionally open to the QR audience; the confirmation prevents accidental taps, not deliberate use of the database API. Run this migration in the Supabase SQL Editor before using the shared list.
