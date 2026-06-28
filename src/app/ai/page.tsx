"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { Send, Bot, Sparkles, RotateCcw, ArrowLeft } from "lucide-react";
import { useCartStore } from "@/lib/store";
import { useT } from "@/lib/i18n";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  time: string;
}

function now() {
  return new Date().toLocaleTimeString("lt-LT", { hour: "2-digit", minute: "2-digit" });
}

function getReply(input: string, lang: "lt" | "en" | "ru"): string {
  const q = input.toLowerCase();

  if (lang === "en") {
    if (q.includes("recommend") || q.includes("popular") || q.includes("best"))
      return "We recommend: Beef entrecote (29.90 €) — the chef's pride! Salmon steak with asparagus (20.90 €) and BBQ glazed ribs (21.90 €). Pair them with our house-brewed Čystas beer. 🍽️";
    if (q.includes("vegan") || q.includes("vegetar") || q.includes("plant"))
      return "Vegan-friendly options: Greek salad (10.90 €), Vegetarian Bianca pizza (10.90 €), Cold beet soup (4.90 €), Wok rice with vegetables. Please check each dish's ingredients. 🌱";
    if (q.includes("dessert") || q.includes("sweet"))
      return "Desserts: Napoleon (5.90 €), Pavlova with strawberries (8.90 €), Chocolate brownie with ice cream (7.50 €), Ricotta cheesecake (5.90 €). We recommend the Pavlova! 🍰";
    if (q.includes("beer") || q.includes("brew"))
      return "We have 6 house-brewed beers: Čystas 5% (from 3.90 €), Šposas 5.5% (dark lager), Kviecinis 4.5% (wheat), Razumnas 6.3% (sweet stout), Spakainas 5.4% (IPA), Slyvinis Porteris 7.2% (plum porter). Tasting set — 14.00 €. 🍺";
    if (q.includes("pizza") || q.includes("pica"))
      return "We have 23 pizzas baked in a wood-fired oven! Margherita (9.00 €), Pepperoni (12.00 €), Beef entrecote pizza (13.00 €), Tuna fillet (13.50 €), Four cheese (9.90 €). Dough fermented for 24h. 🍕";
    if (q.includes("fish") || q.includes("seafood") || q.includes("salmon"))
      return "Fish dishes: Salmon steak (20.90 €), Tuna steak (23.90 €), Sea bass (19.90 €), Octopus with pineapple (27.90 €), Grilled shrimp (18.50 €). 🐟";
    if (q.includes("order") || q.includes("table") || q.includes("how"))
      return "Your order is automatically linked to your table. Choose dishes, add them to the cart, and press 'Place order' — it goes straight to the kitchen and waiter. 📋";
    if (q.includes("allergen") || q.includes("allerg") || q.includes("gluten"))
      return "Allergen information is shown on each dish's detail page. Common allergens in our kitchen: gluten, dairy, eggs, fish, nuts. Please ask the waiter if you have specific dietary needs. ⚠️";
    return "I'm here to help! Ask me about dishes, allergens, beer or cocktails. What would you like today? 😊";
  }

  if (lang === "ru") {
    if (q.includes("рекоменд") || q.includes("популяр") || q.includes("лучш"))
      return "Рекомендуем: Говяжий антрекот (29,90 €) — гордость шеф-повара! Стейк из лосося со спаржей (20,90 €) и рёбрышки в BBQ глазури (21,90 €). Отлично сочетаются с нашим домашним пивом Čystas. 🍽️";
    if (q.includes("веган") || q.includes("вегетар") || q.includes("растит"))
      return "Подходящие блюда: Греческий салат (10,90 €), Вегетарианская пицца Bianca (10,90 €), Холодный свекольный суп (4,90 €), Вок с рисом и овощами. Уточняйте состав каждого блюда. 🌱";
    if (q.includes("десерт") || q.includes("сладк"))
      return "Десерты: Наполеон (5,90 €), Павлова с клубникой (8,90 €), Шоколадный брауни с мороженым (7,50 €), Чизкейк из рикотты (5,90 €). Рекомендуем Павлову! 🍰";
    if (q.includes("пив") || q.includes("beer") || q.includes("крафт"))
      return "У нас 6 видов крафтового пива собственного производства: Čystas 5% (от 3,90 €), Šposas 5,5% (тёмный лагер), Kviecinis 4,5% (пшеничное), Razumnas 6,3% (сладкий стаут), Spakainas 5,4% (IPA), Slyvinis Porteris 7,2% (сливовый портер). Дегустационный набор — 14,00 €. 🍺";
    if (q.includes("пицц"))
      return "У нас 23 вида пиццы, выпекаемой в дровяной печи! Маргарита (9,00 €), Пепперони (12,00 €), Пицца с говяжьим антрекотом (13,00 €), Тунец (13,50 €), Четыре сыра (9,90 €). Тесто ферментируется 24 ч. 🍕";
    if (q.includes("рыб") || q.includes("морепродукт") || q.includes("лосос"))
      return "Рыбные блюда: Стейк из лосося (20,90 €), Стейк из тунца (23,90 €), Морской окунь (19,90 €), Осьминог с ананасом (27,90 €), Креветки на гриле (18,50 €). 🐟";
    if (q.includes("заказ") || q.includes("стол") || q.includes("как"))
      return "Ваш заказ автоматически привязан к вашему столику. Выберите блюда, добавьте в корзину и нажмите «Оформить заказ» — заказ сразу передаётся на кухню и официанту. 📋";
    if (q.includes("аллерген") || q.includes("глютен"))
      return "Информация об аллергенах указана на странице каждого блюда. Основные аллергены в нашей кухне: глютен, молоко, яйца, рыба, орехи. При необходимости уточните у официанта. ⚠️";
    return "Я здесь, чтобы помочь! Спрашивайте о блюдах, аллергенах, пиве или коктейлях. Что желаете сегодня? 😊";
  }

  // Lithuanian (default)
  if (q.includes("rekomend") || q.includes("populiar") || q.includes("geriausias"))
    return "Rekomenduojame: Jautienos antrekotas (29,90 €) — šefų pasididžiavimas! Lašišos kepsnys su šparagais (20,90 €) ir BBQ glazūruoti šonkauliai (21,90 €). Prie jų puikiai tinka mūsų namų daryklos Čystas alus. 🍽️";
  if (q.includes("vegan") || q.includes("augal") || q.includes("vegetar"))
    return "Veganiškų pasirinkimų: Graikiškos salotos (10,90 €), Vegetariška pica Bianca (10,90 €), Šaltibarščiai (4,90 €), Wok ryžiai su daržovėmis. Patikrinkite kiekvieno patiekalo sudėtį. 🌱";
  if (q.includes("desert") || q.includes("saldus"))
    return "Desertai: Napoleonas (5,90 €), Pavlova su braškėmis (8,90 €), Šokoladinis braunis su ledais (7,50 €), Rikotos sūrio pyragas (5,90 €). Rekomenduojame Pavlovą! 🍰";
  if (q.includes("alus") || q.includes("beer"))
    return "Turime 6 savo daryklos alų: Čystas 5% (nuo 3,90 €), Šposas 5,5% (tamsus), Kviecinis 4,5% (kvietinis), Razumnas 6,3% (stautas), Spakainas 5,4% (IPA), Slyvinis Porteris 7,2%. Degustacija — 14,00 €. 🍺";
  if (q.includes("pizza") || q.includes("pica"))
    return "Turime 23 picas keptas malkinėje krosnyje! Margarita (9,00 €), Pepperoni (12,00 €), Jautienos antrekoto pica (13,00 €), Tuno filė (13,50 €), Keturių sūrių (9,90 €). Tešla rauginama 24 val. 🍕";
  if (q.includes("žuv") || q.includes("jūros") || q.includes("lašiš"))
    return "Žuvies patiekalai: Lašišos kepsnys (20,90 €), Tuno kepsnys (23,90 €), Jūros ešerys (19,90 €), Aštuonkojis su ananasu (27,90 €), Krevetės ant grotelių (18,50 €). 🐟";
  if (q.includes("uzsakym") || q.includes("kaip") || q.includes("stala"))
    return "Jūsų užsakymas automatiškai susietas su jūsų stalu. Pasirinkite patiekalus, sudėkite į krepšelį ir paspauskite 'Pateikti užsakymą' — užsakymas iš karto perduodamas virtuvei ir padavėjui. 📋";
  if (q.includes("alergen") || q.includes("glitim"))
    return "Alergenų informacija rodoma kiekvieno patiekalo puslapyje. Dažni alergenai: glitimas, pienas, kiaušiniai, žuvis, riešutai. Jei turite specifinių poreikių — kreipkitės į padavėją. ⚠️";
  return "Esu čia padėti! Klauskite apie patiekalus, alergenus, alų ar kokteilius. Ko norėtumėte šiandien? 😊";
}

export default function AIPage() {
  const lang = useCartStore((s) => s.lang);
  const tr = useT(lang);

  const INITIAL: Message[] = [
    { id: "1", role: "assistant", content: tr.ai_greeting, time: now() },
  ];

  const [messages, setMessages] = useState<Message[]>(INITIAL);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Reset greeting when language changes
  useEffect(() => {
    setMessages([{ id: "1", role: "assistant", content: tr.ai_greeting, time: now() }]);
  }, [lang]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing]);

  const sendMessage = (text: string) => {
    if (!text.trim()) return;
    const userMsg: Message = { id: Date.now().toString(), role: "user", content: text.trim(), time: now() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setTyping(true);
    setTimeout(() => {
      const reply: Message = { id: (Date.now() + 1).toString(), role: "assistant", content: getReply(text, lang), time: now() };
      setTyping(false);
      setMessages((prev) => [...prev, reply]);
    }, 1200);
  };

  const suggestions = tr.ai_suggestions as string[];

  return (
    <div className="flex flex-col h-screen">
      <header className="px-4 pt-12 pb-3 border-b border-border/50 bg-background sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Link href="/menu">
            <button className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center shrink-0">
              <ArrowLeft size={16} className="text-foreground" />
            </button>
          </Link>
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-md shrink-0">
            <Bot size={20} className="text-primary-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-base leading-tight">{tr.nav_ai}</h1>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
              <span className="text-xs text-muted-foreground">{tr.ai_online}</span>
            </div>
          </div>
          <button
            onClick={() => setMessages(INITIAL)}
            className="p-2 rounded-full hover:bg-secondary transition-colors"
          >
            <RotateCcw size={16} className="text-muted-foreground" />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-2.5 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
            {msg.role === "assistant" && (
              <div className="w-8 h-8 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0 mt-1">
                <Sparkles size={14} className="text-primary" />
              </div>
            )}
            <div
              className={`max-w-[78%] px-4 py-3 rounded-3xl text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground rounded-tr-lg"
                  : "bg-card border border-border/50 text-foreground rounded-tl-lg shadow-sm"
              }`}
            >
              {msg.content}
              <p className={`text-[10px] mt-1.5 ${msg.role === "user" ? "text-primary-foreground/60 text-right" : "text-muted-foreground"}`}>
                {msg.time}
              </p>
            </div>
          </div>
        ))}
        {typing && (
          <div className="flex gap-2.5">
            <div className="w-8 h-8 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
              <Sparkles size={14} className="text-primary" />
            </div>
            <div className="bg-card border border-border/50 rounded-3xl rounded-tl-lg px-4 py-3 shadow-sm">
              <div className="flex gap-1 items-center h-5">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {messages.length <= 2 && (
        <div className="px-4 pb-2 flex gap-2 overflow-x-auto no-scrollbar">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => sendMessage(s)}
              className="px-3 py-2 bg-secondary rounded-full text-xs font-medium whitespace-nowrap border border-border/50 active:bg-secondary/70 transition-colors shrink-0"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="px-4 pb-6 pt-2 border-t border-border/30">
        <div className="flex gap-2 items-center">
          <div className="flex-1 bg-secondary rounded-2xl px-4 py-3 flex items-center gap-2 min-h-12">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage(input)}
              placeholder={tr.ai_placeholder}
              className="bg-transparent text-sm flex-1 outline-none placeholder:text-muted-foreground"
            />
          </div>
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || typing}
            className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            <Send size={17} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  );
}
