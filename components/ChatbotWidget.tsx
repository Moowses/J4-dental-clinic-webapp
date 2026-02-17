"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import BookAppointmentModal from "@/components/BookAppointmentModal";
import AuthModal from "@/components/AuthModal";
import { useAuth } from "@/lib/hooks/useAuth";
import { getAllProcedures } from "@/lib/services/clinic-service";
import { getUserAppointments } from "@/lib/services/appointment-service";
import { cancelAppointmentAction } from "@/app/actions/appointment-actions";
import type { DentalProcedure } from "@/lib/types/clinic";
import { STATIC_KNOWLEDGE } from "@/lib/clinic/static-knowledge";

type UserAppointment = {
  id: string;
  serviceType?: string;
  date?: string; // yyyy-mm-dd
  time?: string;
  status?: string;
};

type QuickAction =
  | "showServices"
  | "openBooking"
  | "openLogin"
  | "openSignup"
  | "askQuestion"
  | "viewUpcoming"
  | "cancelStart"
  | "cancelConfirm"
  | "cancelAbort"
  | "hours"
  | "location"
  | "help"
  | "reset"
  | "retryServices";

type Quick = { label: string; action: QuickAction; question?: string };

type Msg = {
  id: string;
  role: "user" | "assistant";
  text?: string;
  render?: "services" | "servicesPrices";
  quick?: Quick[];
};

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function normalize(text: string) {
  const lowered = text.toLowerCase();
  const replacements: Array<[RegExp, string]> = [
    [/\bngipon\b/g, "tooth"],
    [/\bngilo\b/g, "tooth sensitivity"],
    [/\bsakit\b/g, "pain"],
    [/\bmasakit\b/g, "painful"],
    [/\bgilagid\b/g, "gums"],
    [/\bdumudugo\b/g, "bleeding"],
    [/\bpa[- ]?book\b/g, "book"],
    [/\bpa[- ]?schedule\b/g, "schedule"],
    [/\biskedyul\b/g, "schedule"],
    [/\btipanan\b/g, "appointment"],
    [/\bkansel\b/g, "cancel"],
    [/\bresched\b/g, "reschedule"],
    [/\bserbisyo\b/g, "service"],
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

const FAQ_PAIRS = STATIC_KNOWLEDGE.flatMap((k) => parseFaq(k.text));

function findFaqAnswer(message: string) {
  if (!message) return null;
  const normalized = normalize(message);
  const messageTokens = normalized.split(" ").filter(Boolean);

  for (const faq of FAQ_PAIRS) {
    const q = normalize(faq.q);
    if (normalized === q) return faq.a;
    if (normalized.includes(q)) return faq.a;

    if (normalized.length < 8 || messageTokens.length < 2) continue;

    if (q.includes(normalized)) return faq.a;

    const qTokens = q.split(" ").filter(Boolean);
    const overlap = messageTokens.filter((t) => qTokens.includes(t)).length;
    if (overlap >= Math.max(2, Math.ceil(messageTokens.length * 0.7))) return faq.a;
  }
  return null;
}

function formatPeso(amount?: number | null) {
  if (typeof amount !== "number" || Number.isNaN(amount)) return "Price varies";
  return `Php ${amount.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function normalizeTokens(text: string) {
  return normalize(text).split(" ").filter(Boolean);
}

function findMentionedProcedure(query: string, procedures: DentalProcedure[]) {
  const queryNorm = normalize(query);
  if (!queryNorm || !procedures.length) return null;

  const queryTokens = normalizeTokens(query);
  let best: { proc: DentalProcedure; score: number } | null = null;

  for (const proc of procedures) {
    const name = String(proc.name || "").trim();
    if (!name) continue;
    const nameNorm = normalize(name);
    if (!nameNorm) continue;

    if (queryNorm.includes(nameNorm)) {
      return proc;
    }

    const nameTokens = normalizeTokens(name);
    const overlap = queryTokens.filter((t) => nameTokens.includes(t)).length;
    if (overlap === 0) continue;

    const score = overlap / Math.max(1, nameTokens.length);
    if (!best || score > best.score) {
      best = { proc, score };
    }
  }

  // Guardrail to avoid accidental weak matches.
  if (!best || best.score < 0.5) return null;
  return best.proc;
}

export default function ChatbotWidget() {
  const REPLY_DELAY_MS = 900;
  const { user } = useAuth();
  const displayName = user?.displayName?.trim() || "";
  const isLoggedIn = !!user;

  const [open, setOpen] = useState(false);
  const [bookOpen, setBookOpen] = useState(false);

  const [authOpen, setAuthOpen] = useState(false);
  const [authTab, setAuthTab] = useState<"login" | "signup">("signup");

  const openAuth = (tab: "login" | "signup") => {
    setAuthTab(tab);
    setAuthOpen(true);
  };

  const [upcoming, setUpcoming] = useState<UserAppointment[]>([]);
  const [loadingUpcoming, setLoadingUpcoming] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<UserAppointment | null>(null);

  const todayISO = () => new Date().toISOString().slice(0, 10);

  const normalizeStatus = (s?: string) => (s || "").toLowerCase();
  const isUpcoming = (a: UserAppointment) => {
    const d = (a.date || "").slice(0, 10);
    const st = normalizeStatus(a.status);
    if (!d) return false;
    if (d < todayISO()) return false;
    if (st === "cancelled" || st === "canceled" || st === "completed") return false;
    return true;
  };

  const loadUpcoming = async (): Promise<UserAppointment[]> => {
    if (!isLoggedIn || loadingUpcoming) return [];
    setLoadingUpcoming(true);
    try {
      const res: any = await getUserAppointments(user!.uid);
      const list: UserAppointment[] = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
      const filtered = list.filter(isUpcoming).sort((a, b) => String(a.date).localeCompare(String(b.date)));
      setUpcoming(filtered);
      return filtered;
    } catch {
      setUpcoming([]);
      return [];
    } finally {
      setLoadingUpcoming(false);
    }
  };

  // ✅ Procedures == Services (same terms used in your modal) :contentReference[oaicite:2]{index=2}
  const [procedures, setProcedures] = useState<DentalProcedure[]>([]);
  const proceduresRef = useRef<DentalProcedure[]>([]);
  const [procLoading, setProcLoading] = useState(false);
  const [procError, setProcError] = useState("");

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [assistantTyping, setAssistantTyping] = useState(false);
  const [languagePreference, setLanguagePreference] = useState<"english" | "bisaya" | "tagalog" | "">("");

  const endRef = useRef<HTMLDivElement | null>(null);
  const replyQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingRepliesRef = useRef(0);

  const [topQuestionQuick, setTopQuestionQuick] = useState<Quick[]>([]);
  const [topQuestionsLoaded, setTopQuestionsLoaded] = useState(false);

  const [msgs, setMsgs] = useState<Msg[]>([
    {
      id: uid(),
      role: "assistant",
      text: "Hi! I’m Tooth Fairy 🦷 Ask me anything about appointments and services.",
      quick: topQuestionQuick,
    },
  ]);

  // Greeting refresh on login
  useEffect(() => {
    if (!displayName) return;
    setMsgs([
      {
        id: uid(),
        role: "assistant",
        text: `Hi ${displayName}! I’m Tooth Fairy 🦷 Ask me anything about appointments and services.`,
        quick: topQuestionQuick,
      },
    ]);
  }, [displayName, topQuestionQuick]);

  // Auto-scroll
  useEffect(() => {
    if (!open) return;
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, open]);

  useEffect(() => {
    proceduresRef.current = procedures;
  }, [procedures]);

  useEffect(() => {
    if (topQuestionsLoaded) return;
    let cancelled = false;

    const loadTopQuestions = async () => {
      try {
        const res = await fetch("/api/clinic-bot?limit=5");
        if (!res.ok) return;
        const data: any = await res.json().catch(() => null);
        const list = Array.isArray(data?.topQuestions) ? data.topQuestions : [];
        const labels = list
          .map((row: any) => String(row?.label || "").trim())
          .filter(Boolean)
          .slice(0, 5);
        if (!labels.length || cancelled) return;

        const nextQuick = labels.map((q: string) => ({ label: q, action: "askQuestion" as const, question: q }));
        setTopQuestionQuick(nextQuick);
        setMsgs((prev) => {
          if (!prev.length) return prev;
          const first = prev[0];
          if (first.role !== "assistant") return prev;
          if (!String(first.text || "").toLowerCase().includes("top 5")) return prev;
          return [{ ...first, quick: nextQuick }, ...prev.slice(1)];
        });
      } finally {
        if (!cancelled) setTopQuestionsLoaded(true);
      }
    };

    loadTopQuestions();
    return () => {
      cancelled = true;
    };
  }, [topQuestionsLoaded]);

  function pushUser(text: string) {
    setMsgs((m) => [...m, { id: uid(), role: "user", text }]);
  }

  function pushAssistant(text: string, opts?: { quick?: Quick[]; render?: Msg["render"] }) {
    pendingRepliesRef.current += 1;
    setAssistantTyping(true);

    replyQueueRef.current = replyQueueRef.current
      .then(
        () =>
          new Promise<void>((resolve) => {
            setTimeout(() => {
              setMsgs((m) => [
                ...m,
                { id: uid(), role: "assistant", text, quick: opts?.quick, render: opts?.render },
              ]);
              resolve();
            }, REPLY_DELAY_MS);
          })
      )
      .finally(() => {
        pendingRepliesRef.current -= 1;
        if (pendingRepliesRef.current <= 0) {
          setAssistantTyping(false);
        }
      });
  }

  /**
   * ✅ Load procedures exactly like BookAppointmentModal:
   * - guarded by loading + existing data
   * - sets procLoading/procError
   * - cancel-safe
   * Reference logic: BookAppointmentModal loads procedures when open and procedures empty :contentReference[oaicite:3]{index=3}
   */
  async function ensureProceduresLoaded(force = false): Promise<DentalProcedure[]> {
    if (procLoading) return proceduresRef.current;
    if (!force && proceduresRef.current.length > 0) return proceduresRef.current;

    setProcLoading(true);
    setProcError("");

    // timeout guard so it never looks "stuck"
    const timeout = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error("Services are taking too long to load. Please try again.")), 12000)
    );

    try {
      const res: any = await Promise.race([getAllProcedures(true), timeout]);

      if (res?.success && Array.isArray(res?.data)) {
        const loaded = res.data as DentalProcedure[];
        setProcedures(loaded);
        proceduresRef.current = loaded;
        return loaded;
      } else {
        setProcError(res?.error || "Failed to load services");
      }
    } catch (e: any) {
      setProcError(e?.message || "Failed to load services");
    } finally {
      setProcLoading(false);
    }

    return proceduresRef.current;
  }

  const servicesContent = useMemo(() => {
    if (procLoading) {
      return (
        <div className="mt-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          Loading services…
        </div>
      );
    }

    if (procError) {
      return (
        <div className="mt-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <div className="font-bold">Couldn’t load services</div>
          <div className="mt-1">{procError}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handleQuick("retryServices")}
              className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:opacity-95"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => handleQuick("openBooking")}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
            >
              Book appointment
            </button>
          </div>
        </div>
      );
    }

    if (!procedures.length) {
      return (
        <div className="mt-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          No services available right now.
        </div>
      );
    }

    return (
      <div className="mt-2 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-extrabold text-slate-900">Services (Procedures)</div>
        <div className="mt-3 flex flex-wrap gap-2">
          {procedures.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-disabled={!isLoggedIn}
              className={
                "rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 " +
                (isLoggedIn ? "hover:bg-slate-50" : "opacity-50")
              }
              onClick={() => {
                if (!isLoggedIn) {
                  pushAssistant(
                    "Please log in first to book an appointment. If you don’t have an account yet, create one — it only takes a moment."
                  );
                  openAuth("signup");
                  return;
                }

                // Messenger-style: click a service and go straight to booking modal
                pushAssistant(`Perfect! let’s book ${p.name}. Please choose a date & time.`);
                setBookOpen(true);
              }}
            >
              {p.name || "Service"}
            </button>
          ))}
        </div>
        <div className="mt-3 text-[11px] text-slate-500">
          Tip: Tap a service to book instantly (no typing needed).
        </div>
      </div>
    );
  }, [procLoading, procError, procedures]);

  const servicesPriceContent = useMemo(() => {
    if (procLoading) {
      return (
        <div className="mt-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          Loading servicesâ€¦
        </div>
      );
    }

    if (procError) {
      return (
        <div className="mt-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <div className="font-bold">Couldnâ€™t load services</div>
          <div className="mt-1">{procError}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handleQuick("retryServices")}
              className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:opacity-95"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => handleQuick("openBooking")}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
            >
              Book appointment
            </button>
          </div>
        </div>
      );
    }

    if (!procedures.length) {
      return (
        <div className="mt-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          No services available right now.
        </div>
      );
    }

    return (
      <div className="mt-2 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-extrabold text-slate-900">Services & Base Prices</div>
        <div className="mt-3 space-y-2">
          {procedures.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="font-semibold text-slate-900">{p.name || "Service"}</span>
              <span className="text-slate-700">{formatPeso((p as any)?.basePrice ?? null)}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 text-[11px] text-slate-500">
          Note: Prices vary depending on the service. I can help estimate after consultation.
        </div>
      </div>
    );
  }, [procLoading, procError, procedures]);

  async function handleQuick(action: QuickAction, question?: string) {
    switch (action) {
      case "askQuestion": {
        const q = String(question || "").trim();
        if (!q) return;
        await sendFreeText(q);
        return;
      }

      case "showServices": {
        pushUser("show services");

        // ✅ Force load when user asks (this is the big fix)
        await ensureProceduresLoaded(false);

        pushAssistant("Here are our available services:", { render: "services" });
        return;
      }

      case "retryServices": {
        pushUser("retry services");
        await ensureProceduresLoaded(true);
        pushAssistant("Here are our available services:", { render: "services" });
        return;
      }

      case "openBooking": {
        pushUser("book appointment");
        if (!isLoggedIn) {
          pushAssistant(
            "To book an appointment, please log in first. If you don’t have an account yet, create an account.",
            {
              quick: [
                { label: "Log in", action: "openLogin" },
                { label: "Create account", action: "openSignup" },
                { label: "Show services", action: "showServices" },
              ],
            }
          );
          openAuth("signup");
          return;
        }
        pushAssistant("Sure. Please choose your service, date, and time.", {
          quick: [{ label: "Choose a service", action: "showServices" }],
        });
        setBookOpen(true);
        return;
      }

      case "openLogin": {
        pushUser("log in");
        if (isLoggedIn) {
          pushAssistant("You’re already logged in. 😊");
          return;
        }
        pushAssistant("No problem — please log in to continue.");
        openAuth("login");
        return;
      }

      case "openSignup": {
        pushUser("create account");
        if (isLoggedIn) {
          pushAssistant("You’re already logged in. 😊");
          return;
        }
        pushAssistant("Sure — let’s create your account so you can book appointments.");
        openAuth("signup");
        return;
      }

      case "viewUpcoming": {
        pushUser("view upcoming appointments");
        if (!isLoggedIn) {
          pushAssistant(
            "To view your bookings, please log in first. If you don’t have an account yet, create one.",
            { quick: [{ label: "Log in", action: "openLogin" }, { label: "Create account", action: "openSignup" }] }
          );
          openAuth("login");
          return;
        }

        pushAssistant("Checking your upcoming bookings…");
        const list = await loadUpcoming();

        if (!list.length) {
          pushAssistant("You have no upcoming appointments right now.");
          return;
        }

        const lines = list
          .slice(0, 5)
          .map((a, i) => `${i + 1}. ${a.serviceType || "Service"} — ${a.date || ""} ${a.time || ""} (${a.status || "pending"})`)
          .join("\n");

        pushAssistant(`Here are your upcoming appointments:\n${lines}\n\nWould you like to cancel one?`, {
          quick: [{ label: "Cancel an appointment", action: "cancelStart" }, { label: "Book appointment", action: "openBooking" }],
        });
        return;
      }

      case "cancelStart": {
        pushUser("cancel appointment");
        if (!isLoggedIn) {
          pushAssistant("Please log in first so I can cancel your appointment.", {
            quick: [{ label: "Log in", action: "openLogin" }, { label: "Create account", action: "openSignup" }],
          });
          openAuth("login");
          return;
        }

        const list = upcoming.length ? upcoming : await loadUpcoming();
        if (!list.length) {
          pushAssistant("You have no upcoming appointments to cancel.");
          return;
        }

        // Default to the soonest appointment (simple + safe)
        const target = list[0];
        setCancelTarget(target);
        pushAssistant(
          `Cancel this appointment?\n• ${target.serviceType || "Service"} — ${target.date || ""} ${target.time || ""}`,
          { quick: [{ label: "Yes, cancel", action: "cancelConfirm" }, { label: "No", action: "cancelAbort" }] }
        );
        return;
      }

      case "cancelConfirm": {
        pushUser("yes, cancel");
        if (!isLoggedIn || !cancelTarget?.id) {
          pushAssistant("I can’t cancel that right now. Please log in and try again.", {
            quick: [{ label: "Log in", action: "openLogin" }, { label: "Create account", action: "openSignup" }],
          });
          openAuth("login");
          return;
        }

        const id = cancelTarget.id;
        setCancelTarget(null);

        try {
          const res = await cancelAppointmentAction(id);
          if (!res?.success) throw new Error(res?.error || "Failed to cancel");

          pushAssistant("Cancelled ✅ I’ve cancelled your appointment. Anything else?");
          await loadUpcoming();
        } catch {
          pushAssistant("Sorry, I couldn’t cancel that appointment. Please try again or contact the clinic.");
        }

        return;
      }

      case "cancelAbort": {
        pushUser("no");
        setCancelTarget(null);
        pushAssistant("No worries. What would you like to do next?");
        return;
      }

      case "hours": {
        pushUser("clinic hours");
        pushAssistant(
          "Clinic hours:\n• Monday to Sunday from 8:00 AM to 6:00 PM\n\nIf you’d like, you can book an appointment now.",
          { quick: [{ label: "Book appointment", action: "openBooking" }, { label: "Show services", action: "showServices" }] }
        );
        return;
      }

      case "location": {
        pushUser("location");
        pushAssistant(
          "Location:\n• Pereyras compound, 2nd Floor, beside 7/11, brgy. Magugpo West, Tagum City, Philippines\n\nWant me to help you book an appointment?",
          { quick: [{ label: "Book appointment", action: "openBooking" }, { label: "Show services", action: "showServices" }] }
        );
        return;
      }
     
      case "help": {
        pushUser("help");
        if (!isLoggedIn) {
          pushAssistant(
            "I can help with clinic info (services, hours, and location). To book or manage appointments, please log in or create an account.",
            {
              quick: [
                { label: "Log in", action: "openLogin" },
                { label: "Create account", action: "openSignup" },
              ],
            }
          );
          return;
        }
        pushAssistant(
          "You can:\n• View services\n• Book an appointment\n• Ask about clinic hours/location\n\nUse the buttons to avoid typing errors."
        );
        return;
      }

      case "reset": {
        setMsgs([
          {
            id: uid(),
            role: "assistant",
            text: displayName
              ? `Hi ${displayName}! I’m Tooth Fairy 🦷 Ask me anything about appointments and services.`
              : "Hi! I’m Tooth Fairy 🦷 Ask me anything about appointments and services.",
            quick: topQuestionQuick,
          },
        ]);
        return;
      }
    }
  }

  async function sendFreeText(overrideText?: string) {
    const q = String(overrideText ?? input).trim();
    if (!q || sending) return;

    pushUser(q);
    setInput("");
    setSending(true);

    try {
      const lower = normalize(q);
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
        lower.includes("dili ko kasabot og english") ||
        lower.includes("dili ko kasabot ug english");
      const wantsTagalog = lower.includes("tagalog") || lower.includes("filipino") || lower.includes("mag tagalog");
      const effectiveLanguage: "english" | "bisaya" | "tagalog" | "" = wantsEnglish
        ? "english"
        : wantsBisaya
          ? "bisaya"
          : wantsTagalog
            ? "tagalog"
            : languagePreference;

      if (wantsEnglish) setLanguagePreference("english");
      if (wantsBisaya) setLanguagePreference("bisaya");
      if (wantsTagalog) setLanguagePreference("tagalog");

      // Local routing to avoid human error
      if (
        lower.includes("price") ||
        lower.includes("cost") ||
        lower.includes("fee") ||
        lower.includes("how much") ||
        lower.includes("hm")
      ) {
        const loaded = await ensureProceduresLoaded(false);
        const mentioned = findMentionedProcedure(q, loaded);
        if (mentioned) {
          const serviceName = mentioned.name || "this service";
          const amount = (mentioned as any)?.basePrice;
          const basePrice =
            typeof amount === "number" && !Number.isNaN(amount) ? formatPeso(amount) : "currently not listed";

          pushAssistant(
            `The base price for ${serviceName} is ${basePrice}. Final cost may vary after dental assessment. It is best to consult the dentist so we can recommend the package that suits you.`
          );
          return;
        }

        pushAssistant(
          "Here are our services with base prices. Prices vary depending on the service. I can help estimate after consultation.",
          { render: "servicesPrices" }
        );
        return;
      }

      const faqAnswer = findFaqAnswer(q);
      if (faqAnswer) {
        if (!effectiveLanguage || effectiveLanguage === "english") {
          pushAssistant(faqAnswer);
          return;
        }
      }

      if (lower.includes("service") || lower.includes("services") || lower.includes("procedure")) {
        await handleQuick("showServices");
        return;
      }

      if (lower.includes("where") && (lower.includes("locat") || lower.includes("address") || lower.includes("map") || lower.includes("direction"))) {
        await handleQuick("location");
        return;
      }

      if (lower.includes("hour") || lower.includes("open") || lower.includes("close")) {
        await handleQuick("hours");
        return;
      }

      if (lower.includes("book") || lower.includes("appointment") || lower.includes("schedule")) {
        await handleQuick("openBooking");
        return;
      }

      if (
        lower.includes("upcoming") ||
        lower.includes("future") ||
        lower.includes("next appointment") ||
        (lower.includes("view") && lower.includes("appointment")) ||
        lower.includes("my appointments")
      ) {
        await handleQuick("viewUpcoming");
        return;
      }

      if (lower.includes("cancel") || lower.includes("cancell") || lower.includes("canceled") || lower.includes("cancelled")) {
        await handleQuick("cancelStart");
        return;
      }

      if (!isLoggedIn && (lower.includes("sign up") || lower.includes("signup") || lower.includes("register") || lower.includes("create account"))) {
        await handleQuick("openSignup");
        return;
      }

      if (!isLoggedIn && (lower.includes("log in") || lower.includes("login") || lower.includes("sign in"))) {
        await handleQuick("openLogin");
        return;
      }

      // Try server bot (FAQ + Gemini fallback) before local unknown fallback.
      try {
        const idToken = isLoggedIn ? await user?.getIdToken() : undefined;
        const res = await fetch("/api/clinic-bot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: q,
            idToken,
            displayName,
            languagePreference: effectiveLanguage || languagePreference,
          }),
        });

        if (res.ok) {
          const data: any = await res.json().catch(() => null);
          const nextLanguage = typeof data?.languagePreference === "string" ? data.languagePreference : "";
          if (nextLanguage === "english" || nextLanguage === "bisaya" || nextLanguage === "tagalog") {
            setLanguagePreference(nextLanguage);
          }
          const reply = typeof data?.reply === "string" ? data.reply.trim() : "";
          if (reply) {
            pushAssistant(reply);
            return;
          }
        }
      } catch {
        // Fall through to local fallback.
      }

      pushAssistant("I’m still learning, but I’ll keep getting better. 🦷");
      pushAssistant("For now, here’s what I can do:\n• Book appointments\n• View upcoming bookings\n• Cancel appointments");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <AuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        defaultTab={authTab}
        title="Please log in to continue"
        subtitle="To book, view, or cancel appointments, please log in. If you don’t have an account yet, create one."
      />

      {/* ✅ Re-use your existing booking UI + validations (tomorrow onward, time slots, procedures dropdown) :contentReference[oaicite:4]{index=4} */}
      <BookAppointmentModal
        open={bookOpen}
        onClose={() => setBookOpen(false)}
        onBooked={() => {
          setBookOpen(false);
          pushAssistant("Booked ✅ Your appointment request has been submitted. Anything else?");
        }}
      />

      <div className="fixed bottom-5 right-5 z-50">
        {open && (
          <div className="w-[440px] max-w-[92vw] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Tooth Fairy 🦷</div>
                <div className="text-xs text-slate-500">{displayName ? `Signed in as ${displayName}` : "Not logged in"}</div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>

            <div className="h-[420px] overflow-y-auto px-4 py-3">
              <div className="space-y-3">
                {msgs.map((m) => (
                  <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                    <div className="max-w-[88%]">
                      {m.text ? (
                        <div
                          className={
                            "whitespace-pre-line rounded-2xl px-3 py-2 text-sm leading-relaxed " +
                            (m.role === "user" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-900")
                          }
                        >
                          {m.text}
                        </div>
                      ) : null}

                      {m.render === "services" ? servicesContent : null}
                      {m.render === "servicesPrices" ? servicesPriceContent : null}

                      {m.quick?.length ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {m.quick.map((q) => (
                            <button
                              key={q.label}
                              type="button"
                              onClick={() => handleQuick(q.action, q.question)}
                              className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:opacity-95"
                            >
                              {q.label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
                {assistantTyping ? (
                  <div className="flex justify-start">
                    <div className="max-w-[88%]">
                      <div className="rounded-2xl bg-slate-100 px-3 py-2 text-sm leading-relaxed text-slate-700">
                        Tooth Fairy is typing...
                      </div>
                    </div>
                  </div>
                ) : null}

                <div ref={endRef} />
              </div>
            </div>

            <div className="border-t border-slate-100 p-3">
              <div className="flex gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => (e.key === "Enter" ? sendFreeText() : null)}
                  placeholder='Try: "Show services" or "Book appointment"'
                  className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                />
                <button
                  type="button"
                  onClick={() => sendFreeText()}
                  disabled={sending}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                >
                  Send
                </button>
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleQuick("showServices")}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                >
                  Show services
                </button>
                <button
                  type="button"
                  onClick={() => handleQuick("openBooking")}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                >
                  Book appointment
                </button>
                <button
                  type="button"
                  onClick={() => handleQuick("reset")}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                >
                  Reset
                </button>
              </div>

              <div className="mt-2 text-[11px] text-slate-500">
                General info only. For urgent dental concerns, contact the clinic directly.
              </div>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-full bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-lg hover:opacity-95"
        >
          {open ? "Close" : "Chat"}
        </button>
      </div>
    </>
  );
}
