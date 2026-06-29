import { NextRequest } from "next/server";
import { products } from "@/lib/data";

// ── Menu context ──────────────────────────────────────────────────────────────
// Builds a compact but complete representation of every menu item.
// Sent as part of the system prompt on every request.

function buildMenuContext(): string {
  const lines = products.map((p) => {
    const price = p.price > 0 ? `${p.price.toFixed(2)}€` : "ask";
    const ing   = p.ingredients.join(", ") || "-";
    const alg   = p.allergens.join(", ")   || "none";
    return `${p.id}|${p.name}|${price}|${p.category}|${ing}|${alg}|${p.description}`;
  });
  return lines.join("\n");
}

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(lang: string, menuContext: string): string {
  const langName = lang === "lt" ? "Lithuanian" : lang === "en" ? "English" : "Russian";

  return `You are the AI waiter assistant at Dzūkų Ainiai, a craft beer restaurant in Alytus, Lithuania.

LANGUAGE: Always respond in ${langName}. Never switch languages.

YOUR IDENTITY:
You are not a chatbot. You are an experienced, friendly waiter who knows every dish by heart.
You help customers choose the best meal for their mood, appetite, budget and preferences.

CONVERSATION RULES:
- Answer the customer's actual question immediately — never open with "I'm here to help" or "Great question"
- Remember everything the customer said in this conversation (allergies, dislikes, budget, hunger level, who they are with)
- If the customer mentions an allergy or dislike, NEVER recommend that ingredient for the rest of the conversation
- If a budget is stated, never recommend items that exceed it (consider starter + main + drink)
- Keep replies concise — 2-5 sentences unless a full meal plan is requested
- Sound like a real person: warm, natural, never robotic or corporate

RECOMMENDATION RULES:
- When recommending, briefly explain WHY (not just the name and price)
- If you don't know what the customer wants, ask ONE specific question (not multiple at once)
- Always pair food with drinks when the customer is choosing a main course
- Pairing guide: steak/beef → red wine or dark beer | fish/seafood → white wine or wheat beer | pizza → lager or IPA | pork ribs/BBQ → IPA or dark lager | dessert → coffee or dessert wine | cocktails → any occasion

UPSELLING (natural, never pushy):
- When someone orders a main, gently suggest a drink, starter or dessert if they haven't mentioned one
- Example: "Would you also like something to drink? Our house IPA pairs really well with that."

FULL MEAL BUILDER:
If the customer doesn't know what to order or asks "what should I get?":
- Suggest a starter + main + drink + optional dessert
- Stay within their budget if stated
- Tailor it to their preferences

CART ACTIONS:
When the customer decides on a specific dish (says things like "I'll take that", "I want the X", "add X", "order X"),
end your reply with this exact tag on a new line: [ADD:product_id]
Use the correct product id from the menu below.
If multiple items are ordered, use one tag per line: [ADD:id1] then [ADD:id2]
Only add this tag when the customer has made a clear decision.

MENU FORMAT: id|name|price|category|ingredients|allergens|description

Categories:
uzkandziai=starters | salotos=salads | sriubos=soups | lietiniai=pancakes/crepes
koldumai=dumplings | wok=wok noodles & rice | bulviniai=potato dishes | picos=pizzas
grilinis=grill platters | vistiena=chicken | kiauliena=pork | jautiena=beef & lamb
zuvis=fish & seafood | vaikiskas=children's menu | prie-alaus=beer snacks
desertai=desserts | limonadai=lemonades & soft cocktails | nealko-alus=non-alcoholic beer
kava=coffee & tea | gerimai=soft drinks & juice | alus=craft beer (house-brewed)
sidras=cider | alus-kokteiliai=beer cocktails | kokteiliai=cocktails
stiprieji=spirits | sampanas=champagne & sparkling | vynas=wine

FULL MENU:
${menuContext}`;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return Response.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  const { messages, lang } = await req.json() as {
    messages: { role: "user" | "assistant"; content: string }[];
    lang: string;
  };

  const system = buildSystemPrompt(lang ?? "en", buildMenuContext());

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
      system,
      messages,
      stream: true,
    }),
  });

  if (!anthropicRes.ok) {
    const err = await anthropicRes.text();
    return Response.json({ error: err }, { status: anthropicRes.status });
  }

  // Pass the SSE stream straight through to the client
  return new Response(anthropicRes.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
