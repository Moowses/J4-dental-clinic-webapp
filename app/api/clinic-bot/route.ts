import { NextResponse } from "next/server";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { STATIC_KNOWLEDGE } from "@/lib/clinic/static-knowledge";
import { getAvailabilityAction, bookAppointmentAction } from "@/app/actions/appointment-actions";

type RateWindow = { count: number; resetAt: number };
type ReplyLanguage = "english" | "bisaya" | "tagalog";

const RATE_LIMIT_MAX = Number(process.env.BOT_RATE_LIMIT_MAX || 12);
const RATE_LIMIT_WINDOW_MS = Number(process.env.BOT_RATE_LIMIT_WINDOW_MS || 60_000);
const rateBuckets = new Map<string, RateWindow>();

if (!getApps().length) {
  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON!)),
  });
}

async function verifyUser(idToken?: string) {
  if (!idToken) return null;
  try {
    return await getAuth().verifyIdToken(idToken);
  } catch {
    return null;
  }
}

async function listProcedures() {
  const db = getFirestore();
  const snap = await db.collection("procedures").where("active", "==", true).get().catch(() => null);
  if (!snap) return [];
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
}

function normalize(s: string) {
  const lowered = s.toLowerCase();
  const replacements: Array<[RegExp, string]> = [
    [/\bngipon\b/g, "tooth"],
    [/\bngilo\b/g, "tooth sensitivity"],
    [/\bsakit\b/g, "pain"],
    [/\bmasakit\b/g, "painful"],
    [/\bgilagid\b/g, "gums"],
    [/\bdumudugo\b/g, "bleeding"],
    [/\bbook\b/g, "book"],
    [/\bpa[- ]?book\b/g, "book"],
    [/\bpa[- ]?schedule\b/g, "schedule"],
    [/\biskedyul\b/g, "schedule"],
    [/\bappointment\b/g, "appointment"],
    [/\btipanan\b/g, "appointment"],
    [/\bcancel\b/g, "cancel"],
    [/\bkansel\b/g, "cancel"],
    [/\bresched\b/g, "reschedule"],
    [/\bmove\b/g, "reschedule"],
    [/\bserbisyo\b/g, "service"],
    [/\bservices\b/g, "service"],
    [/\bpila\b/g, "how much"],
    [/\bmagkano\b/g, "how much"],
    [/\bbayad\b/g, "payment"],
    [/\bpresyo\b/g, "price"],
    [/\blugar\b/g, "location"],
    [/\basan\b/g, "where"],
    [/\basa\b/g, "where"],
    [/\boras\b/g, "hours"],
    [/\babli\b/g, "open"],
    [/\bsarado\b/g, "close"],
    [/\bemergency\b/g, "emergency"],
    [/\bkalit\b/g, "urgent"],
    [/\bkonsulta\b/g, "consultation"],
    [/\bbata\b/g, "children"],
    [/\btigulang\b/g, "senior"],
  ];
  const mapped = replacements.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), lowered);

  return mapped
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseFaq(text: string) {
  return text
    .split("\n\n")
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const match = block.match(/^Q:\s*([\s\S]+?)\nA:\s*([\s\S]+)$/);
      if (!match) return null;
      return { q: match[1].trim(), a: match[2].trim() };
    })
    .filter(Boolean) as Array<{ q: string; a: string }>;
}

function findFaqAnswer(message: string, faqs: Array<{ q: string; a: string }>) {
  if (!message) return null;
  const messageTokens = message.split(" ").filter(Boolean);

  for (const faq of faqs) {
    const q = normalize(faq.q);
    if (message === q) return faq.a;
    if (message.includes(q)) return faq.a;

    // Guard against tiny inputs (e.g. "hi") incorrectly matching words like "whitening".
    if (message.length < 8 || messageTokens.length < 2) continue;

    if (q.includes(message)) return faq.a;

    const qTokens = q.split(" ").filter(Boolean);
    const overlap = messageTokens.filter((t) => qTokens.includes(t)).length;
    if (overlap >= Math.max(2, Math.ceil(messageTokens.length * 0.7))) return faq.a;
  }
  return null;
}

function inferMessageLanguage(m: string): ReplyLanguage {
  const bisayaSignals = [
    "akong",
    "unsa",
    "dili",
    "kasabot",
    "ngipon",
    "pwede ka",
    "kaayo",
    "nimo",
    "karon",
  ];
  const tagalogSignals = [
    "ako",
    "ano",
    "pwede",
    "po",
    "magkano",
    "ngayon",
    "ngipin",
    "masakit",
  ];

  const hasBisaya = bisayaSignals.some((t) => m.includes(t));
  const hasTagalog = tagalogSignals.some((t) => m.includes(t));

  if (hasBisaya) return "bisaya";
  if (hasTagalog) return "tagalog";
  return "english";
}

function normalizeRequestedLanguage(raw: string): ReplyLanguage | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (v === "english" || v === "en") return "english";
  if (v === "bisaya" || v === "cebuano" || v === "ceb") return "bisaya";
  if (v === "tagalog" || v === "filipino" || v === "tl") return "tagalog";
  return null;
}

async function callGemini(prompt: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) return null;
    const data: any = await res.json().catch(() => null);
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return typeof text === "string" && text.trim() ? text.trim() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function translateReplyIfNeeded(text: string, replyLanguage: ReplyLanguage) {
  if (!text || replyLanguage === "english") return text;

  const prompt = [
    "Translate this clinic chatbot reply faithfully.",
    "Do not add new details. Keep it short and patient-friendly.",
    `Target language: ${replyLanguage === "bisaya" ? "Bisaya/Cebuano" : "Tagalog"}.`,
    "",
    `Text: ${text}`,
  ].join("\n");

  const translated = await callGemini(prompt);
  if (translated) return translated;

  // Deterministic fallback when translation API is unavailable.
  const normalized = text.trim().toLowerCase();
  if (replyLanguage === "bisaya") {
    if (normalized === "tooth pain may require urgent care. please book an appointment soon.") {
      return "Ang sakit sa ngipon mahimong kinahanglan ug urgent care. Palihug pag-book ug appointment sa labing dali.";
    }
  }
  if (replyLanguage === "tagalog") {
    if (normalized === "tooth pain may require urgent care. please book an appointment soon.") {
      return "Ang pananakit ng ngipin ay maaaring mangailangan ng agarang gamutan. Pakisuyong mag-book ng appointment sa lalong madaling panahon.";
    }
  }
  return text;
}

async function askGeminiFallback(
  message: string,
  faqText: string,
  procedureNames: string[],
  replyLanguage: ReplyLanguage
) {
  const prompt = [
    "You are a dental clinic chatbot assistant.",
    "User may ask in English, Tagalog, or Bisaya/Cebuano.",
    `Reply language: ${replyLanguage === "bisaya" ? "Bisaya/Cebuano" : replyLanguage === "tagalog" ? "Tagalog" : "English"}.`,
    "If user explicitly asks to switch language, follow that request.",
    "Translate user wording internally, then match against clinic FAQ and policies.",
    "Use ONLY the clinic FAQ and policy context below.",
    "If the exact answer is not in the context, say: Please contact the clinic for confirmation.",
    "Keep replies short, clear, and patient-friendly.",
    "",
    "Available services:",
    procedureNames.length ? `- ${procedureNames.join("\n- ")}` : "- (not available)",
    "",
    "FAQ knowledge:",
    faqText,
    "",
    `User question: ${message}`,
  ].join("\n");

  return callGemini(prompt);
}

function getClientIp(req: Request) {
  const xff = req.headers.get("x-forwarded-for") || "";
  const firstForwarded = xff.split(",")[0]?.trim();
  const realIp = req.headers.get("x-real-ip")?.trim();
  return firstForwarded || realIp || "unknown";
}

function checkRateLimit(ip: string) {
  const now = Date.now();
  const existing = rateBuckets.get(ip);

  if (!existing || now >= existing.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1, retryAfterSec: 0 };
  }

  if (existing.count >= RATE_LIMIT_MAX) {
    const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    return { allowed: false, remaining: 0, retryAfterSec };
  }

  existing.count += 1;
  rateBuckets.set(ip, existing);
  return { allowed: true, remaining: Math.max(0, RATE_LIMIT_MAX - existing.count), retryAfterSec: 0 };
}

export async function POST(req: Request) {
  try {
    const clientIp = getClientIp(req);
    const rl = checkRateLimit(clientIp);
    if (!rl.allowed) {
      return NextResponse.json(
        {
          error: "Too many messages. Please wait and try again.",
          retryAfterSec: rl.retryAfterSec,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(rl.retryAfterSec),
            "X-RateLimit-Limit": String(RATE_LIMIT_MAX),
            "X-RateLimit-Remaining": String(rl.remaining),
          },
        }
      );
    }

    const body = await req.json();
    const message = String(body?.message || "").trim();
    const idToken = body?.idToken as string | undefined;
    const displayName = String(body?.displayName || "").trim();
    const requestedLanguage = normalizeRequestedLanguage(String(body?.languagePreference || ""));

    if (!message) return NextResponse.json({ error: "Missing message" }, { status: 400 });

    const decoded = await verifyUser(idToken);
    const isAuthed = !!decoded;

    const lower = normalize(message);
    const inferredLanguage = inferMessageLanguage(lower);

    const procedures = await listProcedures();
    const procedureNames = procedures.map((p: any) => p.name || p.title).filter(Boolean);
    const faqPairs = STATIC_KNOWLEDGE.flatMap((k) => parseFaq(k.text));

    const explicitServices =
      lower.includes("show services") || lower.includes("list services") || lower.includes("services list");

    const wantsServices =
      explicitServices ||
      lower.includes("services") ||
      lower.includes("service") ||
      lower.includes("procedure") ||
      lower.includes("price");

    const wantsBooking =
      lower.includes("book") || lower.includes("appointment") || lower.includes("schedule") || lower.includes("reserve");
    const wantsEnglish =
      lower.includes("english") ||
      lower.includes("i mean english") ||
      lower.includes("dili ko kasabot og bisaya") ||
      lower.includes("dili ko kasabot ug bisaya");
    const wantsBisaya =
      lower.includes("bisaya") ||
      lower.includes("cebuano") ||
      lower.includes("can you talk bisaya") ||
      lower.includes("mag bisaya") ||
      lower.includes("pag bisaya bi") ||
      lower.includes("bisaya bi") ||
      lower.includes("bisaya lang");
    const wantsTagalog = lower.includes("tagalog") || lower.includes("filipino") || lower.includes("mag tagalog");
    const replyLanguage: ReplyLanguage =
      requestedLanguage || (wantsBisaya ? "bisaya" : wantsTagalog ? "tagalog" : wantsEnglish ? "english" : inferredLanguage);
    const isGreeting =
      lower === "hi" ||
      lower === "hello" ||
      lower === "hey" ||
      lower.startsWith("hi ") ||
      lower.startsWith("hello ") ||
      lower.startsWith("hey ") ||
      lower.includes("good morning") ||
      lower.includes("good afternoon") ||
      lower.includes("good evening");

    if (isGreeting) {
      return NextResponse.json({
        reply: `${displayName ? `Hi ${displayName}! ` : "Hi! "}How can I help you today?`,
        rateLimit: { remaining: rl.remaining, limit: RATE_LIMIT_MAX },
      });
    }

    if (wantsEnglish) {
      return NextResponse.json({
        reply: `${displayName ? `Hi ${displayName}! ` : ""}Sure, I will use English. How can I help you today?`,
        languagePreference: "english",
        rateLimit: { remaining: rl.remaining, limit: RATE_LIMIT_MAX },
      });
    }

    if (wantsBisaya) {
      return NextResponse.json({
        reply: `${displayName ? `Hi ${displayName}! ` : ""}Sige, mag-Bisaya ko. Unsay akong ikatabang nimo karon?`,
        languagePreference: "bisaya",
        rateLimit: { remaining: rl.remaining, limit: RATE_LIMIT_MAX },
      });
    }

    if (wantsTagalog) {
      return NextResponse.json({
        reply: `${displayName ? `Hi ${displayName}! ` : ""}Sige, mag-Tagalog ako. Paano kita matutulungan ngayon?`,
        languagePreference: "tagalog",
        rateLimit: { remaining: rl.remaining, limit: RATE_LIMIT_MAX },
      });
    }

    const faqAnswer = findFaqAnswer(lower, faqPairs);
    if (faqAnswer && !explicitServices) {
      const localizedFaqAnswer = await translateReplyIfNeeded(faqAnswer, replyLanguage);
      return NextResponse.json({
        reply: `${displayName ? `Hi ${displayName}! ` : ""}${localizedFaqAnswer}`,
        languagePreference: replyLanguage,
        rateLimit: { remaining: rl.remaining, limit: RATE_LIMIT_MAX },
      });
    }

    if (wantsServices) {
      const list = procedureNames.length
        ? `Here are our available services:\n- ${procedureNames.join("\n- ")}`
        : "I could not load the services list right now.";

      return NextResponse.json({
        reply: `${displayName ? `Hi ${displayName}! ` : ""}${list}`,
        services: procedureNames,
        rateLimit: { remaining: rl.remaining, limit: RATE_LIMIT_MAX },
      });
    }

    if (wantsBooking) {
      if (!isAuthed) {
        return NextResponse.json({
          reply:
            "To book an appointment, please log in first. After login, tell me the date, time, and service (example: \"Book Cleaning on 2026-02-20 at 09:00\").",
          requiresLogin: true,
          rateLimit: { remaining: rl.remaining, limit: RATE_LIMIT_MAX },
        });
      }

      const dateMatch = message.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
      const timeMatch = message.match(/\b([01]\d|2[0-3]):([0-5]\d)\b/);

      if (!dateMatch || !timeMatch) {
        return NextResponse.json({
          reply: `Sure${displayName ? `, ${displayName}` : ""}. What date and time do you prefer? (Example: 2026-02-20 at 09:00)`,
          rateLimit: { remaining: rl.remaining, limit: RATE_LIMIT_MAX },
        });
      }

      const date = dateMatch[1];
      const time = `${timeMatch[1]}:${timeMatch[2]}`;

      const foundService = procedureNames.find((n) => lower.includes(normalize(n))) || null;

      if (!foundService) {
        return NextResponse.json({
          reply: `Great. I can book ${date} at ${time}. Which service would you like?\n- ${procedureNames.join("\n- ")}`,
          rateLimit: { remaining: rl.remaining, limit: RATE_LIMIT_MAX },
        });
      }

      const availability: any = await getAvailabilityAction(date);

      if (availability?.isHoliday) {
        return NextResponse.json({
          reply: `The clinic is closed on ${date}${availability?.holidayReason ? ` (${availability.holidayReason})` : ""}. Please choose another date.`,
          rateLimit: { remaining: rl.remaining, limit: RATE_LIMIT_MAX },
        });
      }

      if (availability?.takenSlots?.includes(time)) {
        return NextResponse.json({
          reply: `That slot (${date} at ${time}) is already booked. Please choose another time.`,
          availability,
          rateLimit: { remaining: rl.remaining, limit: RATE_LIMIT_MAX },
        });
      }

      const fd = new FormData();
      fd.set("date", date);
      fd.set("time", time);
      fd.set("serviceType", foundService);
      fd.set("displayName", displayName || decoded?.name || "Client");
      fd.set("notes", "");

      const bookRes: any = await bookAppointmentAction({ success: false, error: "" } as any, fd);

      if (bookRes?.success) {
        return NextResponse.json({
          reply: `Booked ${foundService} on ${date} at ${time}. See you then!`,
          booked: { date, time, serviceType: foundService },
          rateLimit: { remaining: rl.remaining, limit: RATE_LIMIT_MAX },
        });
      }

      return NextResponse.json({
        reply: `Sorry, I could not complete the booking. ${bookRes?.error || ""}`.trim(),
        rateLimit: { remaining: rl.remaining, limit: RATE_LIMIT_MAX },
      });
    }

    const faqText = STATIC_KNOWLEDGE.map((k) => k.text).join("\n\n");
    const aiReply = await askGeminiFallback(message, faqText, procedureNames, replyLanguage);
    if (aiReply) {
      return NextResponse.json({
        reply: `${displayName ? `Hi ${displayName}! ` : ""}${aiReply}`,
        languagePreference: replyLanguage,
        rateLimit: { remaining: rl.remaining, limit: RATE_LIMIT_MAX },
      });
    }

    return NextResponse.json({
      reply:
        `${displayName ? `Hi ${displayName}! ` : ""}` +
        "I can help with booking, services, clinic hours, and appointment concerns. How can I help you today?",
      rateLimit: { remaining: rl.remaining, limit: RATE_LIMIT_MAX },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Bot failed" }, { status: 500 });
  }
}
