# Supabase database

## Applied

`migrations/202611050001_initial_schema.sql`, `migrations/202611050002_public_booking_access.sql`, and `migrations/202611050003_school_calendar.sql` were applied manually in the Supabase SQL Editor. The first migration creates the tables, seeds Aula STEM, Aula d'ordinadors, Biblioteca, and Reserva de portàtils, sets the portable capacity to 20, adds six sessions without fixed times, and prevents overbooking.

The second migration enables the agreed no-login QR workflow. Visitors can read active resources and sessions, view availability totals without teacher names, create bookings through a database function, and cancel bookings with a private token stored in that browser. Reservation records and teacher names have no direct public table access.

The third migration records the non-lective dates from the 2026-27 CEIP Bonavista calendar and rejects reservations on weekends and those dates. The 18 June 2027 final day with pupils is marked in the frontend; the last-day marker is informational.
