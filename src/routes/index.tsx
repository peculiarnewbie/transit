import { createFileRoute } from "@tanstack/solid-router";

import PlaceRouteHelper from "../features/passenger/PlaceRouteHelper.js";

export const Route = createFileRoute("/")({
  component: Home,
  head: () => ({
    meta: [
      { title: "Transit — Jakarta bus routes" },
      {
        name: "description",
        content: "Low-bandwidth, bus-first journey planning for Jakarta.",
      },
    ],
  }),
});

function Home() {
  return <PlaceRouteHelper />;
}
