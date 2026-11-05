# Supabase database

## Applied

`migrations/202611050001_initial_schema.sql` and `migrations/202611050002_public_booking_access.sql` were applied manually in the Supabase SQL Editor. The first migration creates the tables, seeds Aula STEM, Aula d'ordinadors, Biblioteca, and Reserva de portàtils, sets the portable capacity to 20, adds six sessions without fixed times, and prevents overbooking.

The second migration enables the agreed no-login QR workflow. Visitors can read active resources and sessions, view availability totals without teacher names, create bookings through a database function, and cancel bookings with a private token stored in that browser. Reservation records and teacher names have no direct public table access.
