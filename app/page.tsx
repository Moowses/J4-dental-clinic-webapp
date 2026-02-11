"use client";

import Image from "next/image";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/hooks/useAuth";

import { getAllServicesAction } from "@/app/actions/service-actions";
import type { DentalService } from "@/lib/types/service";

const AuthModal = dynamic(() => import("@/components/AuthModal"), {
  ssr: false,
});

const BRAND = "#0E4B5A";

type Service = {
  title: string;
  desc: string;
  price: string;
  image?: string;
};

function formatPeso(amount?: number | null) {
  if (typeof amount !== "number" || Number.isNaN(amount)) return "Price varies";
  return `₱ ${amount.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function ServiceCard({ title, desc, price, image }: Service) {
  const optimizedImage = image 
    ? image.replace('/upload/', '/upload/w_600,h_400,c_fill,g_auto,q_auto,f_auto/')
    : null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col h-full">
      <div className="h-48 w-full bg-slate-100 flex items-center justify-center text-slate-400 text-xs relative">
        {optimizedImage ? (
          <img src={optimizedImage} alt={title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-2">
            <span className="text-3xl">🦷</span>
            <p className="font-bold uppercase tracking-widest opacity-40">J4 Clinic</p>
          </div>
        )}
      </div>

      <div className="p-6 flex flex-col flex-1">
        <h3 className="text-base font-bold text-slate-900 line-clamp-1">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-600 line-clamp-3 flex-1">{desc}</p>

        <div className="mt-5 flex items-center justify-between">
          <span className="text-sm font-black text-[#0E4B5A]">{price}</span>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Starting at</span>
        </div>
      </div>
    </div>
  );
}

function AutoScrollServicesSlider({ items }: { items: Service[] }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [paused, setPaused] = useState(false);

  const scrollByOne = (dir: "left" | "right") => {
    const el = wrapRef.current;
    if (!el) return;

    const card = el.querySelector<HTMLElement>("[data-slide-card='1']");
    const cardW = card?.offsetWidth ?? 320;
    const gap = 24; // matches gap-6

    el.scrollBy({
      left: dir === "left" ? -(cardW + gap) : cardW + gap,
      behavior: "smooth",
    });
  };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || paused || items.length === 0) return;

    const id = window.setInterval(() => {
      const nearEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 10;
      if (nearEnd) {
        el.scrollTo({ left: 0, behavior: "smooth" });
        return;
      }
      scrollByOne("right");
    }, 6000); // ✅ 6 seconds

    return () => window.clearInterval(id);
  }, [paused, items.length]);

  if (!items.length) return null;

  return (
    <div
      className="relative mt-10"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={() => setPaused(true)}
      onTouchEnd={() => setPaused(false)}
    >
      <button
        type="button"
        onClick={() => scrollByOne("left")}
        className="absolute left-0 top-1/2 z-10 hidden -translate-y-1/2 rounded-full border border-slate-200 bg-white/95 px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-white md:inline-flex"
        aria-label="Previous"
      >
        ‹
      </button>

      <button
        type="button"
        onClick={() => scrollByOne("right")}
        className="absolute right-0 top-1/2 z-10 hidden -translate-y-1/2 rounded-full border border-slate-200 bg-white/95 px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-white md:inline-flex"
        aria-label="Next"
      >
        ›
      </button>

      <div
        ref={wrapRef}
        className="flex gap-6 overflow-x-auto scroll-smooth pb-4 [-ms-overflow-style:none] [scrollbar-width:none]"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        <style jsx>{`
          div::-webkit-scrollbar {
            display: none;
          }
        `}</style>

        {items.map((s, idx) => (
          <div
            key={`${s.title}-${idx}`}
            className="min-w-[280px] max-w-[280px] sm:min-w-[320px] sm:max-w-[320px]"
          >
            <div data-slide-card="1">
              <ServiceCard {...s} />
            </div>
          </div>
        ))}
      </div>

      <p className="mt-3 text-center text-xs text-slate-500 md:hidden">
        Swipe to browse →
      </p>
    </div>
  );
}


function InfoPill({
  title,
  text,
  align = "left",
}: {
  title: string;
  text: string;
  align?: "left" | "right";
}) {
  return (
    <div className={`max-w-sm ${align === "right" ? "ml-auto" : ""}`}>
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">{text}</p>
    </div>
  );
}

export default function HomePage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [showAuth, setShowAuth] = useState(false);

  const [services, setServices] = useState<Service[]>([]);
  const [svcLoading, setSvcLoading] = useState(false);
  const [svcError, setSvcError] = useState<string | null>(null);

  useEffect(() => {
    router.refresh();
  }, [router]);

  useEffect(() => {
    if (!showAuth) router.refresh();
  }, [showAuth, router]);

  useEffect(() => {
    const load = async () => {
      setSvcLoading(true);
      setSvcError(null);

      const res = await getAllServicesAction(true);
      if (!res.success || !res.data) {
        setSvcError(res.error || "Failed to load services");
        setServices([]);
        setSvcLoading(false);
        return;
      }

      const catalog: DentalService[] = res.data;

      const mapped: Service[] = catalog.map((s) => ({
        title: s.name || "Service",
        desc: s.description || "Professional dental care with proper assessment and personalized treatment.",
        price: formatPeso(s.price ?? null),
        image: s.imageUrl,
      }));

      setServices(mapped);
      setSvcLoading(false);
    };

    load();
  }, []);

  const handleBook = () => {
    if (loading) return;
    if (user) {
      router.push("/client-dashboard");
      return;
    }
    setShowAuth(true);
  };

  const bookBtnBase =
    "inline-flex w-fit items-center justify-center rounded-full px-6 py-3 text-sm font-semibold text-white shadow-sm hover:opacity-95 disabled:opacity-60";

  const servicesContent = useMemo(() => {
    if (svcLoading) {
      return (
        <div className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          Loading services…
        </div>
      );
    }

    if (svcError) {
      return (
        <div className="mt-10 rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          {svcError}
        </div>
      );
    }

    if (!services.length) {
      return (
        <div className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          No services available right now.
        </div>
      );
    }

    return <AutoScrollServicesSlider items={services} />;
  }, [svcLoading, svcError, services]);

  return (
    <>
      <main className="bg-white">
        <section className="relative">
          <div className="relative h-[420px] md:h-[520px] w-full">
            <Image
              src="/clinic1.jpg"
              alt="Dental clinic"
              fill
              priority
              className="object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-black/65 via-black/35 to-black/10" />

            <div className="absolute inset-0">
              <div className="mx-auto flex h-full max-w-6xl items-center px-4">
                <div className="max-w-2xl text-white">
                  <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide backdrop-blur">
                    Gentle care • Modern clinic • Trusted team
                  </p>

                  <h1 className="mt-4 text-3xl font-extrabold leading-tight md:text-5xl">
                    Professional Dental Care Solutions
                  </h1>

                  <p className="mt-4 max-w-xl text-sm leading-relaxed text-white/90 md:text-base">
                    Experience quality dental care tailored to your needs. From
                    routine checkups to restorative services, we help you feel
                    comfortable, confident, and cared for.
                  </p>

                  <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
                    <button
                      type="button"
                      onClick={handleBook}
                      disabled={loading}
                      className={bookBtnBase}
                      style={{ backgroundColor: BRAND }}
                    >
                      Book an Appointment
                    </button>

                    <a
                      href="#services"
                      className="inline-flex w-fit items-center justify-center rounded-full border border-white/30 bg-white/10 px-6 py-3 text-sm font-semibold text-white backdrop-blur hover:bg-white/15"
                    >
                      View Services
                    </a>
                  </div>
                </div>
              </div>
            </div>

            <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-white to-transparent" />
          </div>
        </section>

        <section id="about" className="scroll-mt-24 py-14 md:py-20">
          <div className="mx-auto max-w-6xl px-4">
            <div className="grid grid-cols-1 items-center gap-10 md:grid-cols-2">
              <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-sm">
                <div className="relative h-[280px] w-full md:h-[360px]">
                  <Image
                    src="/clinic6.jpg"
                    alt="Welcome to J4 Dental Clinic"
                    fill
                    className="object-cover"
                  />
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold tracking-wide text-sky-700">
                  Welcome
                </p>
                <h2 className="mt-2 text-2xl font-bold text-slate-900 md:text-3xl">
                  Welcome to J4 Dental Clinic
                </h2>
                <p className="mt-4 text-sm leading-relaxed text-slate-600 md:text-base">
                  We provide trusted, affordable, and gentle dental care in a
                  clean, modern clinic. Whether it’s your first visit or a
                  regular check-up, our friendly team is here to make your
                  experience safe and comfortable.
                </p>

                <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                  <a
                    href="#offer"
                    className="inline-flex w-fit items-center justify-center rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-sm hover:opacity-95"
                    style={{ backgroundColor: BRAND }}
                  >
                    Learn About Us
                  </a>

                  <a
                    href="#clinic"
                    className="inline-flex w-fit items-center justify-center rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                  >
                    Contact Us
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section
          id="services"
          className="scroll-mt-24 py-14 md:py-20 bg-slate-50/60"
        >
          <div className="mx-auto max-w-6xl px-4">
            <div className="text-center">
              <p className="text-sm font-semibold tracking-wide text-sky-700">
                Services
              </p>
              <h2 className="mt-2 text-2xl font-bold text-slate-900 md:text-3xl">
                Our Dental Services
              </h2>
              <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-600 md:text-base">
                Quality dental care with transparent pricing and a comfortable
                experience — designed for every smile.
              </p>
            </div>

            {servicesContent}
          </div>
        </section>

        <section id="offer" className="relative scroll-mt-24">
          <div className="relative h-[360px] md:h-[320px] w-full">
            <Image
              src="/banner1.jpg"
              alt="Free consultation banner"
              fill
              className="object-cover"
            />
            <div className="absolute inset-0 bg-black/55" />

            <div className="absolute inset-0">
              <div className="mx-auto flex h-full max-w-6xl items-center px-4">
                <div className="w-full">
                  <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between">
                    <div className="max-w-xl text-white">
                      <p className="text-sm font-semibold tracking-wide text-white/90">
                        Limited Offer
                      </p>
                      <h3 className="mt-2 text-2xl font-extrabold md:text-3xl">
                        Free Consultation
                      </h3>
                      <p className="mt-3 text-sm leading-relaxed text-white/85 md:text-base">
                        Get expert guidance on the best dental care options for
                        you. Message us to schedule your visit.
                      </p>

                      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                        <button
                          type="button"
                          onClick={handleBook}
                          disabled={loading}
                          className={bookBtnBase}
                          style={{ backgroundColor: BRAND }}
                        >
                          Book Now
                        </button>

                        <a
                          href="#clinic"
                          className="inline-flex w-fit items-center justify-center rounded-full border border-white/25 bg-white/10 px-6 py-3 text-sm font-semibold text-white backdrop-blur hover:bg-white/15"
                        >
                          Contact Us
                        </a>
                      </div>
                    </div>

                    <div className="grid w-full grid-cols-1 gap-6 sm:grid-cols-2 md:max-w-xl md:grid-cols-2">
                      <div className="rounded-2xl bg-white/10 p-5 backdrop-blur border border-white/15">
                        <p className="text-sm font-semibold text-white">
                          Included Services
                        </p>
                        <ul className="mt-3 space-y-2 text-sm text-white/85">
                          <li>• Oral Prophylaxis</li>
                          <li>• Tooth Restoration</li>
                          <li>• Tooth Extraction</li>
                          <li>• Fluoride</li>
                        </ul>
                      </div>

                      <div className="rounded-2xl bg-white/10 p-5 backdrop-blur border border-white/15">
                        <p className="text-sm font-semibold text-white">
                          Also Available
                        </p>
                        <ul className="mt-3 space-y-2 text-sm text-white/85">
                          <li>• Dentures</li>
                          <li>• Veneers</li>
                          <li>• Crowns</li>
                          <li>• Root Canal Treatment</li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  <p className="mt-6 text-xs text-white/70">
                    *Terms and availability may vary. Please contact the clinic
                    for details.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="clinic" className="scroll-mt-24 py-14 md:py-20">
          <div className="mx-auto max-w-6xl px-4">
            <div className="text-center">
              <p className="text-sm font-semibold tracking-wide text-sky-700">
                Our Clinic
              </p>
              <h2 className="mt-2 text-2xl font-bold text-slate-900 md:text-3xl">
                Why Choose J4 Dental Clinic
              </h2>
              <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-600 md:text-base">
                A comfortable environment, transparent pricing, and a team that
                prioritizes your safety and satisfaction.
              </p>
            </div>

            <div className="mt-12 grid grid-cols-1 items-center gap-10 md:grid-cols-3">
              <div className="space-y-8 text-center md:text-right">
                <InfoPill
                  title="Trusted & Friendly Care"
                  text="We treat every patient with respect and care, helping you feel confident at every visit."
                  align="right"
                />
                <InfoPill
                  title="Clean & Comfortable Clinic"
                  text="We maintain a clean, modern environment with quality tools and comfortable treatment rooms."
                  align="right"
                />
              </div>

              <div className="flex justify-center">
                <div className="relative h-28 w-28 rounded-full bg-white shadow-sm ring-1 ring-slate-200">
                  <Image
                    src="/dclogo.png"
                    alt="J4 Dental Clinic logo"
                    fill
                    className="object-contain p-4"
                  />
                </div>
              </div>

              <div className="space-y-8 text-center md:text-left">
                <InfoPill
                  title="Affordable & Transparent Pricing"
                  text="Clear pricing and honest recommendations — we help you choose what’s best for you."
                />
                <InfoPill
                  title="Skilled Dental Team"
                  text="Our team focuses on safe procedures and consistent results for long-term oral health."
                />
              </div>
            </div>
          </div>
        </section>

        <section className="pb-16">
          <div className="mx-auto max-w-6xl px-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    Ready to book your visit?
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    Schedule an appointment and let’s take care of your smile.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleBook}
                  disabled={loading}
                  className={bookBtnBase}
                  style={{ backgroundColor: BRAND }}
                >
                  Book an Appointment
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <AuthModal
        open={showAuth}
        onClose={() => setShowAuth(false)}
        redirectTo="/client-dashboard"
        title="Continue booking your appointment"
        subtitle="Please log in or create an account to proceed."
      />
    </>
  );
}
