import type { Metadata } from "next";

/**
 * Staff section. Carries its own manifest so "Add to Home Screen" from /app
 * installs the staff app (opens at the role hub), while the root manifest
 * keeps serving the guest-facing side untouched.
 */
export const metadata: Metadata = {
  title: "Vaišė",
  manifest: "/app/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Vaišė",
  },
};

export default function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
