# Reserves CEIP Bonavista

Aplicació web en valencià per a reservar espais i recursos escolars del CEIP Bonavista.

## Estat del projecte

El frontend carrega les categories i les sessions de Supabase, consulta la disponibilitat i permet crear, repetir i cancel·lar reserves sense iniciar sessió. La interfície és prioritàriament per a mòbil i segueix la referència visual del centre amb el logotip oficial. Les categories són Aula STEM, Aula d'ordinadors, Biblioteca i Reserva de portàtils; aquesta última té 20 unitats. Les sis sessions es mostren sense hores fixes perquè l'horari varia al llarg del curs. El calendari escolar 2026-27 està incorporat: només es pot reservar entre el 7 de setembre de 2026 i el 18 de juny de 2027; els caps de setmana i les dates no lectives marcades al PDF tampoc no admeten reserves. El 18 de juny apareix com a últim dia de classes amb alumnat. Les tres migracions de Supabase ja estan aplicades. GitHub Pages està configurat amb GitHub Actions i el secret de la clau publicable ja està afegit. La publicació es fa automàticament amb GitHub Actions i el QR de la web està en `public/reserves-bonavista-qr.png`.

## Desenvolupament local

```bash
npm install
npm run dev
```

Per generar els fitxers estàtics:

```bash
npm run build
```

El frontend està preparat per a publicar-se en GitHub Pages sota la ruta `/reserves-bonavista/`. El projecte local utilitza `.env.local`, que no s'ha de pujar al repositori. Per al desplegament, `VITE_SUPABASE_PUBLISHABLE_KEY` ja està guardada com a secret del repositori en **Settings → Secrets and variables → Actions**. L'URL del projecte està configurada en el flux de publicació.

## Seguretat

- No afegisques claus, contrasenyes ni dades reals de reserves a aquest repositori.
- La clau pública de Supabase només s'utilitza amb polítiques de Row Level Security i funcions restringides.
- La clau `service_role` de Supabase no s'ha d'incloure mai en el frontend.

## Connexió amb Supabase

`.env.local` està exclòs de Git. Utilitza únicament la clau publicable al frontend; no hi poses mai la clau secreta, `service_role` ni la contrasenya de la base de dades.
