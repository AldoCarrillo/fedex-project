# FedEx Tools

A React and Vite application with a FedEx-inspired tools home page. Tool 03 checks U.S. address format in the browser and can verify an address with Smarty; the other tool pages are placeholders.

Vercel rewrites the tool page URLs to the React app so they also work when opened directly or refreshed.

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
