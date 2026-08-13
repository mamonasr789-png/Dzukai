import { ImageResponse } from "next/og";

export const runtime = "nodejs";

/**
 * PWA icons rendered from code — no binary assets to maintain.
 * /pwa-icon/192, /pwa-icon/512, /pwa-icon/512?maskable=1 (extra safe padding
 * so Android's circular masks don't clip the mark).
 */

const SIZES = new Set([192, 512]);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ size: string }> }
): Promise<Response> {
  const { size: sizeParam } = await params;
  const size = Number(sizeParam);
  if (!SIZES.has(size)) {
    return new Response("Not found", { status: 404 });
  }
  const maskable = new URL(request.url).searchParams.has("maskable");
  // Five glyphs, so the word mark is scaled well below a single-letter mark;
  // maskable shrinks further to survive Android's circular crop.
  const glyphScale = maskable ? 0.16 : 0.215;

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
          borderRadius: maskable ? 0 : size * 0.22,
        }}
      >
        <div
          style={{
            display: "flex",
            color: "#ffffff",
            fontSize: size * glyphScale,
            fontWeight: 800,
            fontFamily: "sans-serif",
            letterSpacing: "-0.05em",
          }}
        >
          Vaišė
        </div>
      </div>
    ),
    {
      width: size,
      height: size,
      headers: {
        "content-type": "image/png",
        "cache-control": "public, max-age=86400, immutable",
      },
    }
  );
}
