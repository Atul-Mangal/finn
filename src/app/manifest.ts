import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FINN",
    short_name: "FINN",
    description: "What changed in your portfolio, and whether it matters.",
    start_url: "/",
    display: "standalone",
    background_color: "#f2f3ef",
    theme_color: "#f2f3ef",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
