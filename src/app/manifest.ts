import type { MetadataRoute } from "next";

/**
 * PWA manifest — Vaise is the installable ordering platform.
 * (Dzūkų Ainiai is the demo restaurant served through it; its identity lives
 * in the storefront UI and menu data, not in the platform manifest.)
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Vaise",
    short_name: "Vaise",
    description: "Vaise — smart in-restaurant ordering platform.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a1a",
    theme_color: "#0a0a1a",
  };
}
