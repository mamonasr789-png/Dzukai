import "server-only";

/** Shared direct Gemini text-generation call for the admin AI analytics routes. */
export async function callGemini(prompt: string, maxOutputTokens = 1024): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("provider_unavailable");
  const model = process.env.AI_WAITER_GEMINI_MODEL ?? "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens, thinkingConfig: { thinkingBudget: 0 } },
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error("provider_request_failed");
  const json = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text.trim()) throw new Error("provider_empty_response");
  return text.trim();
}
