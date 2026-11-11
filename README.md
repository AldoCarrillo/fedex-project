# FedEx Tools

A React and Vite application with a FedEx-inspired tools home page. Tool 03 is a browser-only U.S. address format checker; the other tool pages are placeholders.

Vercel rewrites the tool page URLs to the React app so they also work when opened directly or refreshed.

The address checker checks required fields and U.S. ZIP code format in the browser. It offers local suggestions for common cities after a state is selected; suggestions are not exhaustive, and any city can still be entered. The camera/photo control uses Tesseract.js to read text on-device; the image is not uploaded, but the OCR engine and English language data are downloaded on the first scan. It does not call an address API, send or store addresses, or verify that an address exists or is deliverable.

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
