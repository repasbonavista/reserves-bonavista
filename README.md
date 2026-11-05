# Reserves CEIP Bonavista

Aplicació web en valencià per a reservar espais i recursos escolars del CEIP Bonavista.

## Estat del projecte

El frontend carrega les categories i les sessions de Supabase, consulta la disponibilitat i permet crear, repetir i cancel·lar reserves sense iniciar sessió. Les categories confirmades són Aula STEM, Aula d'ordinadors, Biblioteca i Reserva de portàtils; aquesta última té 20 unitats. Les sis sessions es mostren sense hores fixes perquè l'horari varia al llarg del curs. Les dues migracions de Supabase ja estan aplicades. GitHub Pages ja està configurat per publicar amb GitHub Actions; abans del primer desplegament cal afegir la clau publicable de Supabase als secrets del repositori. El QR queda pendent.

## Desenvolupament local

```bash
npm install
npm run dev
```

Per generar els fitxers estàtics:

```bash
npm run build
```

El frontend està preparat per a publicar-se en GitHub Pages sota la ruta `/reserves-bonavista/`. El projecte local utilitza `.env.local`, que no s'ha de pujar al repositori. Per al desplegament, afegeix `VITE_SUPABASE_PUBLISHABLE_KEY` com a secret del repositori en **Settings → Secrets and variables → Actions**. L'URL del projecte ja està configurada en el flux de publicació.

## Seguretat

- No afegisques claus, contrasenyes ni dades reals de reserves a aquest repositori.
- La clau pública de Supabase només s'utilitza amb polítiques de Row Level Security i funcions restringides.
- La clau `service_role` de Supabase no s'ha d'incloure mai en el frontend.

## Connexió amb Supabase

`.env.local` està exclòs de Git. Utilitza únicament la clau publicable al frontend; no hi poses mai la clau secreta, `service_role` ni la contrasenya de la base de dades.
