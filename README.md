# transit

Cloudflare Workers app using SolidStart, Vite, Tailwind, Drizzle ORM, and Effect.

## Prerequisites

- Node.js 24+
- npm 11.16+
- A Cloudflare account for deployment

## Development

```sh
npm install
npm run dev
```

The Worker runs at `http://localhost:3000`. Use `npm run check` before committing
and `npm run deploy` to build and deploy.

## Database

Drizzle is configured for Cloudflare D1. Add a D1 binding to `wrangler.jsonc`
before generating and applying migrations:

```sh
npm run db:generate
npm run db:migrate:local
```
