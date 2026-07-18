import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/solid-router";
import { HydrationScript } from "solid-js/web";

import styleCss from "../styles.css?url";

export const rootHead = () => ({
  meta: [
    { name: "viewport", content: "width=device-width, initial-scale=1" },
    { name: "color-scheme", content: "dark" },
    { name: "theme-color", content: "#111827" },
    { name: "description", content: "Transit worker application" },
  ],
  links: [{ rel: "stylesheet", href: styleCss }],
});

export const Route = createRootRoute({
  head: rootHead,
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
