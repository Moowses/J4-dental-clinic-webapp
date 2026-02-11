"use client";

import { Suspense, useActionState, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { resetPasswordAction } from "@/app/actions/auth-actions";
import { verifyPasswordResetCode } from "firebase/auth";
import { auth } from "@/lib/firebase/firebase";

type ActionState = {
  success: boolean;
  error?: string;
};

const initialState: ActionState = { success: false, error: undefined };

function SetupPasswordPageContent() {
  const params = useSearchParams();
  const emailFromQuery = useMemo(() => (params.get("email") || "").trim(), [params]);
  const [email, setEmail] = useState(emailFromQuery);
  const [cooldown, setCooldown] = useState(0);
  const [checkingLink, setCheckingLink] = useState(false);
  const [resetLinkStatus, setResetLinkStatus] = useState<"idle" | "valid" | "expired">("idle");
  const [state, action, pending] = useActionState<ActionState, FormData>(
    resetPasswordAction,
    initialState
  );

  useEffect(() => {
    setEmail(emailFromQuery);
  }, [emailFromQuery]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/account/setup-password/cooldown", {
          method: "POST",
        });
        const body = await res.json().catch(() => ({}));
        if (!active) return;
        setCooldown(Number(body?.remaining || 0));
      } catch {
        if (!active) return;
        setCooldown(120);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!state.success) return;
    fetch("/api/account/setup-password/cooldown", { method: "POST" }).catch(() => null);
    setCooldown(120);
  }, [state.success]);

  useEffect(() => {
    const mode = (params.get("mode") || "").trim();
    const oobCode = (params.get("oobCode") || "").trim();
    if (mode !== "resetPassword" || !oobCode) return;
    let active = true;
    setCheckingLink(true);
    verifyPasswordResetCode(auth, oobCode)
      .then(() => {
        if (!active) return;
        setResetLinkStatus("valid");
      })
      .catch(() => {
        if (!active) return;
        setResetLinkStatus("expired");
      })
      .finally(() => {
        if (!active) return;
        setCheckingLink(false);
      });
    return () => {
      active = false;
    };
  }, [params]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => {
      setCooldown((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const mm = String(Math.floor(cooldown / 60)).padStart(2, "0");
  const ss = String(cooldown % 60).padStart(2, "0");
  const buttonText =
    cooldown > 0
      ? `Resend Password in ${mm}:${ss}`
      : state.success
      ? "Resend Password Email"
      : "Send Password Setup Email";

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
          Account Setup
        </p>
        <h1 className="mt-1 text-lg font-extrabold text-slate-900">
          Email confirmed
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          To access your patient dashboard, set your password first.
        </p>

        <form action={action} className="mt-5 space-y-3">
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-600">
              Email
            </span>
            <input
              name="email"
              type="email"
              required
              value={email}
              readOnly
              className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-300"
              placeholder="you@example.com"
            />
          </label>

          <button
            type="submit"
            disabled={pending || !email || cooldown > 0}
            className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-extrabold text-white hover:bg-black disabled:opacity-60"
          >
            {pending ? "Sending..." : buttonText}
          </button>
        </form>

        {checkingLink ? (
          <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-700">
            Checking reset link...
          </p>
        ) : null}
        {resetLinkStatus === "expired" ? (
          <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
            Your reset password link is expired. Use the button above to resend.
          </p>
        ) : null}
        {resetLinkStatus === "valid" ? (
          <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">
            Reset link is valid. You can continue password setup.
          </p>
        ) : null}

        {state.success ? (
          <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">
            Password setup email sent. Check your inbox and spam folder.
          </p>
        ) : null}

        {state.error ? (
          <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
            {state.error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default function SetupPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 px-4 py-10">
          <div className="mx-auto w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-semibold text-slate-700">Loading...</p>
          </div>
        </div>
      }
    >
      <SetupPasswordPageContent />
    </Suspense>
  );
}
