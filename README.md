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

Drizzle is configured for the local `DB` D1 binding named `transit-db`:

```sh
npm run db:generate
npm run db:migrate:local
```

Before deployment, an operator must create the production database and add the
returned `database_id` to the deployed Wrangler configuration:

```sh
npx wrangler d1 create transit-db
```

No production database identifier or credential is committed.
