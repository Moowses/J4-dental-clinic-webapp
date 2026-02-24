"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AuthModal from "@/components/AuthModal";
import { useAuth } from "@/lib/hooks/useAuth";

const BRAND = "#0E4B5A";

export default function SiteHeader() {
  const router = useRouter();
  const { user, loading, logout } = useAuth();

  const [authOpen, setAuthOpen] = useState(false);
  const [authTab, setAuthTab] = useState<"login" | "signup">("login");
  const [mobileOpen, setMobileOpen] = useState(false);
  const runtimeSearch =
    typeof window !== "undefined" ? window.location.search : "";
  const runtimeParams = new URLSearchParams(runtimeSearch);
  const authParam = (runtimeParams.get("auth") || "").trim();
  const verifiedParam = (runtimeParams.get("verified") || "").trim();
  const autoOpenLogin = authParam === "login";
  const verifiedReturn = autoOpenLogin && verifiedParam === "1";

  // When modal closes, re-check auth state (covers successful login via modal)
  useEffect(() => {
    if (!authOpen) router.refresh();
  }, [authOpen, router]);

  useEffect(() => {
    setMobileOpen(false);
  }, [user]);

  const handleLogout = async () => {
    try {
      await logout?.();
    } finally {
      router.refresh();
      router.push("/");
    }
  };

  return (
    <>
      <header className="sticky top-0 z-50 w-full">
        <div className="border-b border-black/5 bg-white/90 backdrop-blur">
          <div className="mx-auto max-w-6xl px-4">
            <div className="flex h-[72px] items-center justify-between gap-4">
              <Link href="/" className="flex items-center gap-3">
                <div className="relative h-10 w-10">
                  <Image
                    src="/dclogo.png"
                    alt="J4 Dental Clinic"
                    fill
                    className="object-contain"
                    priority
                  />
                </div>
                <div className="leading-tight">
                  <div className="text-sm font-extrabold tracking-wide text-slate-900">
                    J4 Dental Clinic
                  </div>
                  <div className="text-[11px] font-medium text-slate-500">
                    Gentle care • Modern clinic
                  </div>
                </div>
              </Link>

              <nav className="hidden items-center gap-8 text-sm font-semibold text-slate-700 md:flex">
                <Link href="/about" className="hover:text-slate-900">
                  About Us
                </Link>
                <Link href="/services" className="hover:text-slate-900">
                  Services
                </Link>
                <Link href="/contact" className="hover:text-slate-900">
                  Contact Us
                </Link>
              </nav>

              <div className="flex items-center gap-3">
                {!loading && user && (
                  <>
                    <Link
                      href="/client-dashboard"
                      className="hidden rounded-full px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-95 md:inline-flex"
                      style={{ backgroundColor: BRAND }}
                    >
                      Account
                    </Link>

                    <button
                      onClick={handleLogout}
                      className="hidden rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-50 md:inline-flex"
                    >
                      Logout
                    </button>
                  </>
                )}

                {!loading && !user && (
                  <>
                    <button
                      onClick={() => {
                        setAuthTab("login");
                        setAuthOpen(true);
                      }}
                      className="hidden rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-50 md:inline-flex"
                    >
                      Log in
                    </button>

                    <button
                      onClick={() => {
                        setAuthTab("signup");
                        setAuthOpen(true);
                      }}
                      className="hidden rounded-full px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-95 md:inline-flex"
                      style={{ backgroundColor: BRAND }}
                    >
                      Sign up
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => setMobileOpen((prev) => !prev)}
                  aria-label={mobileOpen ? "Close menu" : "Open menu"}
                  className="inline-flex rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 md:hidden"
                >
                  {mobileOpen ? "Close" : "Menu"}
                </button>
              </div>
            </div>

            {mobileOpen && (
              <div className="border-t border-slate-100 py-3 md:hidden">
                <div className="grid gap-2">
                  <Link
                    href="/about"
                    onClick={() => setMobileOpen(false)}
                    className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    About Us
                  </Link>
                  <Link
                    href="/services"
                    onClick={() => setMobileOpen(false)}
                    className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Services
                  </Link>
                  <Link
                    href="/contact"
                    onClick={() => setMobileOpen(false)}
                    className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Contact Us
                  </Link>

                  <div className="my-1 border-t border-slate-100" />

                  {!loading && user && (
                    <>
                      <Link
                        href="/client-dashboard"
                        onClick={() => setMobileOpen(false)}
                        className="rounded-xl px-3 py-2 text-sm font-semibold text-white"
                        style={{ backgroundColor: BRAND }}
                      >
                        Account
                      </Link>
                      <button
                        type="button"
                        onClick={() => {
                          setMobileOpen(false);
                          handleLogout();
                        }}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm font-semibold text-slate-900 hover:bg-slate-50"
                      >
                        Logout
                      </button>
                    </>
                  )}

                  {!loading && !user && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setMobileOpen(false);
                          setAuthTab("login");
                          setAuthOpen(true);
                        }}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm font-semibold text-slate-900 hover:bg-slate-50"
                      >
                        Log in
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setMobileOpen(false);
                          setAuthTab("signup");
                          setAuthOpen(true);
                        }}
                        className="rounded-xl px-3 py-2 text-left text-sm font-semibold text-white"
                        style={{ backgroundColor: BRAND }}
                      >
                        Sign up
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <AuthModal
        open={authOpen || autoOpenLogin}
        onClose={() => {
          setAuthOpen(false);
          if (autoOpenLogin) router.replace("/");
        }}
        defaultTab={authTab}
        title={verifiedReturn ? "Email verified" : undefined}
        subtitle={verifiedReturn ? "Your email is verified. Please log in to continue." : undefined}
      />
    </>
  );
}
