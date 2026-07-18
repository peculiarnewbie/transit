import { createFileRoute } from "@tanstack/solid-router";

import PassengerExplorer from "../features/passenger/PassengerExplorer.js";

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
  return <PassengerExplorer />;
}
