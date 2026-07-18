import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { Context, Layer } from "effect";

import * as schema from "../db/schema.js";

export type Database = DrizzleD1Database<typeof schema> & { readonly $client: D1Database };

export class Service extends Context.Service<Service, Database>()("@transit/CurationDatabase") {}

export const layer = (binding: D1Database) => Layer.succeed(Service, drizzle(binding, { schema }));

export * as CurationDatabase from "./database.js";
