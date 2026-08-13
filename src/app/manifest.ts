import type { MetadataRoute } from "next";

/**
 * Guest-side PWA manifest — Vaise is the installable ordering platform.
 * (Dzūkų Ainiai is the demo restaurant served through it; its identity lives
 * in the storefront UI and menu data, not in the platform manifest.)
 *
 * The staff app has its own manifest at /app/manifest.webmanifest with a
 * distinct `id`, so the two install as separate home-screen entries.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Vaišė",
    short_name: "Vaišė",
    description: "Vaise — smart in-restaurant ordering platform.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a1a",
    theme_color: "#0a0a1a",
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png" },
      {
        src: "/pwa-icon/512?maskable=1",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
