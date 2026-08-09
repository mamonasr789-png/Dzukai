import type {
  SupportedLanguage,
  WaiterTurnData,
} from "../schemas.ts";
import type { ClientApiErrorCode } from "./liveWaiterClient.ts";

const COPY = {
  lt: {
    greeting:
      "Sveiki! Ko norėtumėte šiandien — ko nors sočaus, lengvo, gal aštraus?",
    suggestions: [
      "Ką rekomenduojate?",
      "Noriu sočiai pavalgyti",
      "Ką valgyti prie alaus?",
      "Esu vegetaras",
      "Turiu €25 biudžetą",
      "Tik užkandžiams",
    ],
    waiter: "Padavėjas",
    demoMode: "Demonstracinis režimas",
    tableMode: "Stalo režimas",
    developmentProvider: "Kūrimo AI teikėjo režimas",
    developmentOnly: "Tik kūrimo aplinkoje",
    providerDeterministic: "Deterministinis",
    providerAnthropic: "Anthropic",
    providerAuto: "Automatinis",
    providerSelectedDeterministic:
      "Pasirinktas deterministinis režimas; mokama API nebus naudojama.",
    providerSelectedAnthropic:
      "Pasirinktas Anthropic režimas; serveris privalo turėti sukonfigūruotą API raktą.",
    providerSelectedAuto:
      "Automatinis režimas naudos Anthropic, jei jis sukonfigūruotas, kitu atveju — deterministinį režimą.",
    providerUsedDeterministic:
      "Šiam atsakymui naudotas deterministinis teikėjas.",
    providerUsedAnthropic: "Šiam atsakymui naudotas Anthropic teikėjas.",
    providerNotUsed:
      "Šiam atsakymui išorinio AI teikėjo neprireikė.",
    providerNotConfigured:
      "Anthropic šiame kūrimo serveryje nesukonfigūruotas. Užklausa nebuvo perduota teikėjui.",
    demoNotice:
      "Padavėjo ir sąskaitos užklausos šiame demonstraciniame režime nepasiekiamos.",
    nonPersistentNotice:
      "Demonstracinė versija — sesija gali būti atstatyta iš naujo.",
    initializing: "Ruošiamas saugus pokalbis…",
    unavailable:
      "AI padavėjo paslauga šiuo metu nepasiekiama. Krepšelis nepakeistas.",
    placeholder: "Parašykite, ko norėtumėte…",
    cart: "Krepšelis",
    cartEmpty: "Krepšelis tuščias.",
    total: "Iš viso",
    note: "Pastaba",
    staffConfirmation: "Reikia darbuotojo patvirtinimo",
    add: "Pridėti",
    retry: "Bandyti dar kartą",
    fallback: "Atsakymą saugiai parengė atsarginis režimas.",
    partial:
      "Veiksmas atliktas, tačiau pokalbio būsena nebuvo visiškai atnaujinta.",
    clarification: "Prieš tęsiant reikia patikslinimo.",
    rejected: "Veiksmas neatliktas, nes nebuvo aiškiai patvirtintas.",
    noSideEffect:
      "Užklausa nepavyko, tačiau krepšelis ir darbuotojų užklausos nepakeistos.",
    replayed: "Parodytas ankstesnis saugiai išsaugotas rezultatas.",
    expired:
      "Ankstesnė sesija baigėsi. Sukurta nauja sesija; žinutę galite siųsti dar kartą.",
    invalidTable:
      "Stalo nuorodos patvirtinti nepavyko. Įjungtas demonstracinis režimas.",
    rateLimited: "Per daug užklausų. Truputį palaukite ir bandykite dar kartą.",
    storageUnavailable:
      "AI padavėjo saugykla šioje aplinkoje nesukonfigūruota.",
    conflict:
      "Šis pakartojimo numeris jau priklauso kitai žinutei. Išsiųskite naują žinutę.",
    sessionMissing:
      "Pokalbio sesija baigėsi. Sukurta nauja sesija, todėl žinutę siųskite dar kartą.",
    genericError:
      "Užklausos saugiai užbaigti nepavyko. Krepšelis nepakeistas.",
    clearDisplay: "Išvalyti rodomą pokalbį",
    unknownOutcome:
      "Ankstesnės užklausos rezultatas nežinomas. Saugiai pakartokite tą pačią žinutę.",
    resolveUnknownFirst:
      "Prieš siųsdami naują užklausą užbaikite arba pakartokite ankstesnę.",
    retryProtectionUnavailable:
      "Užklausa neišsiųsta, nes nepavyko saugiai išsaugoti pakartojimo apsaugos. Patikrinkite naršyklės saugyklą ir bandykite dar kartą.",
    cartRefreshFailed:
      "Krepšelio nepavyko saugiai atnaujinti. Atkurkite jį iš serverio prieš tęsdami.",
    preferencesReset:
      "Pradėta nauja sesija. Ankstesnės alergijos ir pasirinkimai nebegalioja — nurodykite juos dar kartą.",
    send: "Siųsti žinutę",
    back: "Grįžti į meniu",
    closeCart: "Uždaryti krepšelį",
    preparing: "Padavėjas ruošia atsakymą",
  },
  en: {
    greeting:
      "Welcome! What are you in the mood for — something hearty, light, or a little spicy?",
    suggestions: [
      "What do you recommend?",
      "I want something filling",
      "What goes with beer?",
      "I'm vegetarian",
      "Budget is €25",
      "Just a snack",
    ],
    waiter: "Waiter",
    demoMode: "Demo mode",
    tableMode: "Table mode",
    developmentProvider: "Development AI provider mode",
    developmentOnly: "Development only",
    providerDeterministic: "Deterministic",
    providerAnthropic: "Anthropic",
    providerAuto: "Auto",
    providerSelectedDeterministic:
      "Deterministic mode is selected; no paid API will be used.",
    providerSelectedAnthropic:
      "Anthropic mode is selected; the server must have an API key configured.",
    providerSelectedAuto:
      "Auto mode will use Anthropic when configured and deterministic mode otherwise.",
    providerUsedDeterministic:
      "The deterministic provider handled this response.",
    providerUsedAnthropic: "The Anthropic provider handled this response.",
    providerNotUsed:
      "This response did not require an external AI provider.",
    providerNotConfigured:
      "Anthropic is not configured on this development server. The request was not sent to a provider.",
    demoNotice:
      "Waiter and bill requests are unavailable in this demo session.",
    nonPersistentNotice:
      "Demo version — the session may reset and start again.",
    initializing: "Preparing a safe conversation…",
    unavailable:
      "The AI waiter is currently unavailable. Your cart was not changed.",
    placeholder: "Tell us what you would like…",
    cart: "Cart",
    cartEmpty: "Your cart is empty.",
    total: "Total",
    note: "Note",
    staffConfirmation: "Requires staff confirmation",
    add: "Add",
    retry: "Try again",
    fallback: "A safe fallback prepared this response.",
    partial:
      "The action succeeded, but conversation state was not fully updated.",
    clarification: "A clarification is needed before continuing.",
    rejected: "No action was taken because the request was not explicit.",
    noSideEffect:
      "The request failed without changing the cart or creating a staff request.",
    replayed: "The previously stored safe result was replayed.",
    expired:
      "The previous session expired. A new session was created; you can resend the message.",
    invalidTable:
      "The table link could not be verified. Demo mode is active.",
    rateLimited: "Too many requests. Please wait briefly and try again.",
    storageUnavailable:
      "AI waiter storage is not configured in this environment.",
    conflict:
      "This retry identifier belongs to another message. Send a new message instead.",
    sessionMissing:
      "The conversation session expired. A new session was created; resend the message.",
    genericError:
      "The request could not be completed safely. Your cart was not changed.",
    clearDisplay: "Clear displayed conversation",
    unknownOutcome:
      "The previous request outcome is unknown. Safely retry the exact same message.",
    resolveUnknownFirst:
      "Resolve or retry the previous request before starting a new one.",
    retryProtectionUnavailable:
      "The request was not sent because secure retry protection could not be saved. Check browser storage and try again.",
    cartRefreshFailed:
      "The cart could not be refreshed safely. Restore it from the server before continuing.",
    preferencesReset:
      "A new session started. Previous allergies and preferences are no longer active; please state them again.",
    send: "Send message",
    back: "Back to menu",
    closeCart: "Close cart",
    preparing: "Waiter is preparing a response",
  },
  ru: {
    greeting:
      "Добро пожаловать! Что вам по настроению — сытное, лёгкое или острое?",
    suggestions: [
      "Что порекомендуете?",
      "Хочу что-то сытное",
      "Что идёт с пивом?",
      "Я вегетарианец",
      "Бюджет €25",
      "Только закуску",
    ],
    waiter: "Официант",
    demoMode: "Демо-режим",
    tableMode: "Режим стола",
    developmentProvider: "Режим AI-провайдера для разработки",
    developmentOnly: "Только для разработки",
    providerDeterministic: "Детерминированный",
    providerAnthropic: "Anthropic",
    providerAuto: "Автоматический",
    providerSelectedDeterministic:
      "Выбран детерминированный режим; платный API использоваться не будет.",
    providerSelectedAnthropic:
      "Выбран режим Anthropic; на сервере должен быть настроен API-ключ.",
    providerSelectedAuto:
      "Автоматический режим использует Anthropic, если он настроен, иначе — детерминированный режим.",
    providerUsedDeterministic:
      "Для этого ответа использован детерминированный провайдер.",
    providerUsedAnthropic:
      "Для этого ответа использован провайдер Anthropic.",
    providerNotUsed:
      "Для этого ответа внешний AI-провайдер не потребовался.",
    providerNotConfigured:
      "Anthropic не настроен на этом сервере разработки. Запрос не был отправлен провайдеру.",
    demoNotice:
      "В демо-режиме вызов официанта и запрос счёта недоступны.",
    nonPersistentNotice:
      "Демонстрационная версия — сессия может сброситься и начаться заново.",
    initializing: "Подготавливаем безопасный диалог…",
    unavailable:
      "AI-официант сейчас недоступен. Корзина не изменена.",
    placeholder: "Напишите, что вы хотели бы заказать…",
    cart: "Корзина",
    cartEmpty: "Корзина пуста.",
    total: "Итого",
    note: "Примечание",
    staffConfirmation: "Требуется подтверждение сотрудника",
    add: "Добавить",
    retry: "Повторить",
    fallback: "Ответ подготовлен безопасным резервным режимом.",
    partial:
      "Действие выполнено, но состояние диалога обновлено не полностью.",
    clarification: "Перед продолжением требуется уточнение.",
    rejected: "Действие не выполнено: запрос не был однозначно подтверждён.",
    noSideEffect:
      "Запрос завершился ошибкой без изменения корзины или вызова сотрудника.",
    replayed: "Показан ранее сохранённый безопасный результат.",
    expired:
      "Предыдущая сессия завершилась. Создана новая сессия; сообщение можно отправить снова.",
    invalidTable:
      "Не удалось подтвердить ссылку стола. Включён демо-режим.",
    rateLimited: "Слишком много запросов. Подождите и повторите.",
    storageUnavailable:
      "Хранилище AI-официанта не настроено в этой среде.",
    conflict:
      "Этот идентификатор повтора уже относится к другому сообщению. Отправьте новое сообщение.",
    sessionMissing:
      "Сессия завершилась. Создана новая; отправьте сообщение ещё раз.",
    genericError:
      "Не удалось безопасно завершить запрос. Корзина не изменена.",
    clearDisplay: "Очистить отображаемый диалог",
    unknownOutcome:
      "Результат предыдущего запроса неизвестен. Безопасно повторите то же сообщение.",
    resolveUnknownFirst:
      "Завершите или повторите предыдущий запрос, прежде чем отправлять новый.",
    retryProtectionUnavailable:
      "Запрос не отправлен: не удалось сохранить защиту безопасного повтора. Проверьте хранилище браузера и повторите попытку.",
    cartRefreshFailed:
      "Не удалось безопасно обновить корзину. Восстановите её с сервера перед продолжением.",
    preferencesReset:
      "Начата новая сессия. Прежние аллергии и предпочтения больше не действуют — укажите их снова.",
    send: "Отправить сообщение",
    back: "Вернуться в меню",
    closeCart: "Закрыть корзину",
    preparing: "Официант готовит ответ",
  },
} as const;

export type LiveWaiterCopy = (typeof COPY)[SupportedLanguage];

export function liveWaiterCopy(
  language: SupportedLanguage
): LiveWaiterCopy {
  return COPY[language];
}

export type TurnNoticeTone = "success" | "info" | "warning" | "error";

export interface TurnPresentation {
  notice: string | null;
  tone: TurnNoticeTone;
  retryable: boolean;
  preservesSuccessfulAction: boolean;
}

export const AI_WAITER_OPEN_CART_EVENT = "vaise:ai-waiter-open-cart";

export interface TurnPresentationOptions {
  showFallbackNotice?: boolean;
}

export function turnPresentation(
  data: WaiterTurnData,
  language: SupportedLanguage,
  options: TurnPresentationOptions = {}
): TurnPresentation {
  const copy = liveWaiterCopy(language);
  const replaySuffix = data.replayed ? ` ${copy.replayed}` : "";
  const showFallbackNotice = options.showFallbackNotice ?? true;
  switch (data.status) {
    case "success_with_response_fallback":
      return {
        notice: showFallbackNotice
          ? `${copy.fallback}${replaySuffix}`
          : data.replayed
            ? copy.replayed
            : null,
        tone: "success",
        retryable: false,
        preservesSuccessfulAction: true,
      };
    case "partial_success_state_update_failed":
      return {
        notice: `${copy.partial}${replaySuffix}`,
        tone: "warning",
        retryable: false,
        preservesSuccessfulAction: true,
      };
    case "clarification_required":
      return {
        notice: `${copy.clarification}${replaySuffix}`,
        tone: "info",
        retryable: false,
        preservesSuccessfulAction: false,
      };
    case "rejected_action":
      if (
        data.actionLedger.some(
          (entry) => entry.result?.code === "table_context_required"
        )
      ) {
        return {
          notice: `${copy.demoNotice}${replaySuffix}`,
          tone: "info",
          retryable: false,
          preservesSuccessfulAction: false,
        };
      }
      return {
        notice: `${copy.rejected}${replaySuffix}`,
        tone: "warning",
        retryable: false,
        preservesSuccessfulAction: false,
      };
    case "provider_failed_without_side_effect":
    case "internal_failure_without_side_effect":
      return {
        notice: `${copy.noSideEffect}${replaySuffix}`,
        tone: "error",
        retryable: true,
        preservesSuccessfulAction: false,
      };
    case "success":
      return {
        notice: data.replayed
          ? copy.replayed
          : data.fallbackUsed && showFallbackNotice
            ? copy.fallback
            : null,
        tone: data.fallbackUsed ? "info" : "success",
        retryable: false,
        preservesSuccessfulAction: data.actions.some(
          (action) =>
            action.type === "cart_updated" ||
            action.type === "staff_requested"
        ),
      };
  }
}

export function friendlyClientError(
  code: ClientApiErrorCode,
  language: SupportedLanguage
): string {
  const copy = liveWaiterCopy(language);
  switch (code) {
    case "rate_limited":
      return copy.rateLimited;
    case "storage_not_configured":
    case "storage_capacity_exceeded":
      return copy.storageUnavailable;
    case "provider_not_configured":
      return copy.providerNotConfigured;
    case "turn_id_conflict":
      return copy.conflict;
    case "session_not_found":
      return copy.sessionMissing;
    default:
      return copy.genericError;
  }
}
