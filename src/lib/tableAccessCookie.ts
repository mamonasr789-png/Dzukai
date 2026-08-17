/**
 * Client-safe half of the table-access gate. No signature verification here
 * (that needs the secret, which never reaches the browser) — by the time a
 * page can read this cookie at all, src/proxy.ts has already verified it
 * server-side and would have redirected an invalid/missing one away. This
 * just decodes the payload so client components can read the table number
 * without trusting a plain ?table= URL param again.
 */

export const TABLE_ACCESS_COOKIE = "vaise_table_access";

/** atob-based, not Buffer — this file runs in the actual browser, where
 *  Buffer isn't a global (unlike Node/SSR). */
function base64UrlDecode(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const withPadding = padded + "=".repeat((4 - (padded.length % 4)) % 4);
  const binary = atob(withPadding);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder("utf8").decode(bytes);
}

export function decodeTableAccessCookiePayload(
  raw: string
): { tableNumber: string } | null {
  const [encodedPayload] = raw.split(".");
  if (!encodedPayload) return null;
  try {
    const json = JSON.parse(base64UrlDecode(encodedPayload)) as unknown;
    if (
      typeof json === "object" &&
      json !== null &&
      "tableNumber" in json &&
      typeof (json as { tableNumber: unknown }).tableNumber === "string"
    ) {
      return { tableNumber: (json as { tableNumber: string }).tableNumber };
    }
    return null;
  } catch {
    return null;
  }
}

export function readTableAccessCookie(): { tableNumber: string } | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${TABLE_ACCESS_COOKIE}=`));
  if (!match) return null;
  const raw = decodeURIComponent(match.slice(TABLE_ACCESS_COOKIE.length + 1));
  return decodeTableAccessCookiePayload(raw);
}
