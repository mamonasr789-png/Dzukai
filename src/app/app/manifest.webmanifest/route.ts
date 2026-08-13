/**
 * Staff PWA manifest. A separate manifest (distinct `id`) makes the staff app
 * its own installable entry: opens at /app, scoped to "/" so /waiter, /kitchen
 * and /admin stay inside the standalone window instead of popping browser UI.
 */
export function GET(): Response {
  return Response.json(
    {
      id: "/app",
      name: "Vaišė",
      short_name: "Vaišė",
      description: "Vaišė personalo programa: padavėjas, virtuvė, administratorius.",
      start_url: "/app",
      scope: "/",
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
    },
    {
      headers: {
        "content-type": "application/manifest+json",
        "cache-control": "public, max-age=3600",
      },
    }
  );
}
