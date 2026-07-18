import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/solid-router";
import { HydrationScript } from "solid-js/web";

import styleCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { name: "color-scheme", content: "dark" },
      { name: "theme-color", content: "#111827" },
      { name: "description", content: "Transit worker application" },
    ],
    links: [{ rel: "stylesheet", href: styleCss }],
  }),
  shellComponent: RootComponent,
});

function RootComponent() {
  return (
    <html lang="en">
      <head>
        <HydrationScript />
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}
