import { createServer } from "node:http";

import { POST as sessionPost } from "../../../app/api/ai/session/route.ts";
import { POST as turnPost } from "../../../app/api/ai/turn/route.ts";
import { resetDevelopmentRuntime } from "../server/runtime.ts";

await resetDevelopmentRuntime();

const server = createServer(async (incoming, outgoing) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (value === undefined) continue;
      headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
    headers.set("x-forwarded-for", "203.0.113.231");
    const method = incoming.method ?? "GET";
    const request = new Request(
      new URL(incoming.url ?? "/", "http://127.0.0.1"),
      {
        method,
        headers,
        ...(method === "GET" || method === "HEAD"
          ? {}
          : { body: Buffer.concat(chunks) }),
      }
    );
    const pathname = new URL(request.url).pathname;
    const response =
      pathname === "/api/ai/session"
        ? await sessionPost(request)
        : pathname === "/api/ai/turn"
          ? await turnPost(request)
          : Response.json(
              {
                ok: false,
                error: { code: "not_found", message: "Not found." },
              },
              { status: 404 }
            );
    outgoing.statusCode = response.status;
    response.headers.forEach((value, name) => outgoing.setHeader(name, value));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.statusCode = 500;
    outgoing.end(
      JSON.stringify({
        ok: false,
        error: { code: "internal_error", message: "Route host failed." },
      })
    );
  }
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") {
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${JSON.stringify({ port: address.port })}\n`);
});

function close(): void {
  server.close(() => process.exit(0));
}

process.once("SIGTERM", close);
process.once("SIGINT", close);
