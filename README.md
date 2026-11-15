# FedEx Tools

A React and Vite application with a FedEx-inspired tools home page. Tool 01 filters a three-column Excel workbook into eight numeric groups; Tool 03 checks U.S. address format in the browser and can verify an address with Smarty. The other tool pages are placeholders.

Vercel rewrites the tool page URLs to the React app so they also work when opened directly or refreshed.

The Missing Packages Filter reads `.xlsx` files locally in the browser. It locates the ID column by its header or by matching ID values, then groups three-column workbook rows by the ID's first three digits (`XXX-XXXX`) into ranges 100–199 through 800–899. When a `1st scan` column is present, rows in each group are sorted oldest-first by that timestamp; unreadable timestamps appear last. Up to 100 rows are initially shown per section, with a button to reveal more. Clear data removes the current workbook and sections without affecting posted history. After filtering, download all eight sections together as one PNG image or post a dated results snapshot to cloud history. Posting uploads package results to the signed-in Supabase account. Sign in to view history across devices; selecting a history entry loads its groups into the main results sections.

## Cloud history setup

1. Create a Supabase project and enable email/password sign-in in **Authentication → Providers → Email**. Set the project **Site URL** to the deployed app URL and allow the local development URL in the redirect settings.
2. Apply [`supabase/migrations/20261115000000_create_package_posts.sql`](./supabase/migrations/20261115000000_create_package_posts.sql) in the Supabase SQL Editor. Row-level security restricts history records to their owner.
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` using the Supabase project URL and publishable (or legacy anon) key. Set them in local `.env` and in Vercel's project environment variables, then redeploy.
4. Create an account on the page (confirm it by email if requested) and sign in with that same account on each device.

Only the publishable/anon key belongs in `VITE_` variables. Never put a Supabase service-role key in the browser or Vercel frontend environment. Results posted before cloud history is configured remain in the browser where they were originally saved and are not automatically migrated.

The address checker validates required fields and ZIP code format in the browser. It offers local suggestions for common cities after a state is selected; suggestions are not exhaustive, and any city can still be entered. The **Check Smarty** and **Check FedEx** actions send the submitted address to their respective providers from server-side endpoints; credentials are not sent to the browser. Each provider's response is shown separately and does not guarantee delivery. FedEx uses the sandbox by default. Photo scanning is available after holding its button for two seconds, then tapping it to choose a photo for on-device OCR.

## Address API setup

Set the provider credentials as server environment variables. For local development, copy `.env.example` to `.env` and add your Smarty and/or FedEx credentials. In Vercel, add the variables in the project's Environment Variables settings for each environment where verification should work. Never use `VITE_` prefixes for API credentials.

- Smarty: `SMARTY_AUTH_ID` and `SMARTY_AUTH_TOKEN`
- FedEx: `FEDEX_CLIENT_ID` and `FEDEX_CLIENT_SECRET`
- FedEx environment: `FEDEX_ENVIRONMENT=sandbox` (default) or `production`

Create FedEx API credentials in the FedEx Developer Portal and enable the Address Validation API for the project. Use sandbox credentials for local development; set production credentials and `FEDEX_ENVIRONMENT=production` only when ready. FedEx sandbox may return sample test data instead of resolving the submitted address. The app labels sandbox responses and does not display sample addresses as verified results.

## Getting started

```sh
npm install
npm run dev
```

## Available scripts

- `npm run dev` — start the local development server
- `npm run build` — create a production build in `dist`
- `npm run preview` — preview the production build
- `npm run lint` — run Oxlint
