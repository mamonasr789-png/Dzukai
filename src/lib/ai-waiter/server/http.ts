import "server-only";

export type LimitedJsonResult =
  | { ok: true; value: unknown }
  | {
      ok: false;
      status: 400 | 413 | 415;
      code: "invalid_json" | "payload_too_large" | "unsupported_media_type";
      message: string;
    };

function payloadTooLarge(): LimitedJsonResult {
  return {
    ok: false,
    status: 413,
    code: "payload_too_large",
    message: "Request body exceeds the allowed size.",
  };
}

export async function readLimitedJson(
  request: Request,
  maximumBytes: number
): Promise<LimitedJsonResult> {
  const contentType = request.headers.get("content-type") ?? "";
  const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    return {
      ok: false,
      status: 415,
      code: "unsupported_media_type",
      message: "Content-Type must be application/json.",
    };
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    const length = Number(declaredLength);
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > maximumBytes
    ) {
      return payloadTooLarge();
    }
  }

  if (!request.body) {
    return {
      ok: false,
      status: 400,
      code: "invalid_json",
      message: "Request body is not valid JSON.",
    };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    byteLength += result.value.byteLength;
    if (byteLength > maximumBytes) {
      await reader.cancel("payload_too_large");
      return payloadTooLarge();
    }
    chunks.push(result.value);
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.trim().length === 0) throw new SyntaxError("Empty JSON body");
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return {
      ok: false,
      status: 400,
      code: "invalid_json",
      message: "Request body is not valid JSON.",
    };
  }
}

export function safeJsonResponse(body: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("X-Content-Type-Options", "nosniff");
  return Response.json(body, { ...init, headers });
}

export function methodNotAllowedResponse(allowedMethods: string[]): Response {
  return safeJsonResponse(
    {
      ok: false,
      error: {
        code: "method_not_allowed",
        message: "HTTP method is not allowed for this endpoint.",
      },
    },
    {
      status: 405,
      headers: { Allow: allowedMethods.join(", ") },
    }
  );
}

export function optionsResponse(allowedMethods: string[]): Response {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: allowedMethods.join(", "),
      "Cache-Control": "no-store",
    },
  });
}
