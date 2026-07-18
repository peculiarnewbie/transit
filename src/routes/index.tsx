import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import * as stylex from "@stylexjs/stylex";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const greeting = Effect.runSync(Effect.succeed("Transit Worker is ready."));

  return (
    <main {...stylex.props(styles.main)}>
      <p {...stylex.props(styles.eyebrow)}>Cloudflare Workers · SolidStart · Drizzle · Effect</p>
      <h1 {...stylex.props(styles.title)}>{greeting}</h1>
      <p {...stylex.props(styles.description)}>
        Start building in <code>src/routes</code>. Configure a D1 binding before running database
        migrations.
      </p>
    </main>
  );
}

const styles = stylex.create({
  main: {
    marginBlock: "0",
    marginInline: "auto",
    maxWidth: "48rem",
    paddingBlock: "6rem",
    paddingInline: "1.5rem",
  },
  eyebrow: {
    color: "#67e8f9",
    fontSize: "0.875rem",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  title: {
    fontSize: "clamp(2.5rem, 8vw, 5rem)",
    letterSpacing: "-0.05em",
    marginBlock: "1rem",
    marginInline: "0",
  },
  description: {
    color: "#cbd5e1",
    fontSize: "1.125rem",
    lineHeight: "1.6",
  },
});
