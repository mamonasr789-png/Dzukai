import { ImageResponse } from "next/og";

// iOS home-screen icon ("Add to Home Screen" uses this, not the manifest).
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(145deg, #b5352e 0%, #8f231d 100%)",
        }}
      >
        <div
          style={{
            display: "flex",
            color: "#ffffff",
            fontSize: 39,
            fontWeight: 800,
            fontFamily: "sans-serif",
            letterSpacing: "-0.05em",
          }}
        >
          Vaišė
        </div>
      </div>
    ),
    size
  );
}
