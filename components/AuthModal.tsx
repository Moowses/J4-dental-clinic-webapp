"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { Eye, EyeOff } from "lucide-react";

import {
  signInAction,
  signUpAction,
  resendVerificationEmailAction,
} from "@/app/actions/auth-actions";
import { performPasswordReset } from "@/lib/services/auth-service";

import { auth } from "@/lib/firebase/firebase";

type Tab = "login" | "signup";

type ActionState = {
  success: boolean;
  error?: string;
};

type AuthModalProps = {
  open: boolean;
  onClose: () => void;
  redirectTo?: string;
  title?: string;
  subtitle?: string;
  defaultTab?: Tab;
};

const initialActionState: ActionState = { success: false, error: undefined };

function LoadingOverlay({ message }: { message: string }) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-white/80 backdrop-blur">
      <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-800" />
          <div className="text-sm font-semibold text-slate-800">{message}</div>
        </div>
      </div>
    </div>
  );
}

function SuccessOverlay() {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center rounded-2xl bg-white/80 backdrop-blur">
      <div className="rounded-2xl border border-emerald-200 bg-white px-6 py-5 shadow-lg">
        <div className="text-sm font-extrabold text-emerald-700">Success!</div>
        <div className="mt-1 text-sm text-slate-700">
          Redirecting to your dashboard…
        </div>
      </div>
    </div>
  );
}

function VerifyPanel({
  email,
  onBackToLogin,
}: {
  email?: string;
  onBackToLogin: () => void;
}) {
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const resend = async () => {
    setSending(true);
    setNote(null);
    const res = await resendVerificationEmailAction();
    if (res.success) {
      setNote("Verification email sent. Please check your inbox and spam folder.");
    } else {
      setNote(res.error || "Failed to send verification email.");
    }
    setSending(false);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <div className="font-extrabold">Verify your email to continue</div>
        <div className="mt-1 text-amber-800">
          We sent a verification link to{" "}
          <span className="font-semibold">{email || "your email"}</span>.
          <br />
          Click the link, then come back and log in again.
        </div>
      </div>

      <button
        type="button"
        onClick={resend}
        disabled={sending}
        className="w-full rounded-xl bg-[#0E4B5A] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
      >
        {sending ? "Sending..." : "Resend verification email"}
      </button>

      {note ? (
        <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-700">
          {note}
        </div>
      ) : null}

      <button
        type="button"
        onClick={onBackToLogin}
        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-50"
      >
        Back to Log in
      </button>
    </div>
  );
}

export default function AuthModal({
  open,
  onClose,
  redirectTo = "/client-dashboard",
  title,
  subtitle,
  defaultTab = "login",
}: AuthModalProps) {
  const router = useRouter();

  const [tab, setTab] = useState<Tab>(defaultTab);

  const [busy, setBusy] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  // verify screen
  const [showVerify, setShowVerify] = useState(false);
  const [emailInput, setEmailInput] = useState<string>("");
  const [forgotSending, setForgotSending] = useState(false);
  const [forgotMessage, setForgotMessage] = useState<string | null>(null);
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
   const [showPassword1, setShowPassword1] = useState(false);

  const [loginState, loginAction, loginPending] = useActionState<ActionState, FormData>(
    signInAction,
    initialActionState
  );
  const [signupState, signupAction, signupPending] = useActionState<ActionState, FormData>(
    signUpAction,
    initialActionState
  );

  const pending = loginPending || signupPending;

  useEffect(() => {
    setBusy(pending);
  }, [pending]);

  useEffect(() => {
    if (!open) return;
    setTab(defaultTab);
    setBusy(false);
    setShowSuccess(false);
    setShowVerify(false);
    setForgotSending(false);
    setForgotMessage(null);
    setForgotError(null);
    setEmailInput("");
  }, [open, defaultTab]);

  // SIGNUP success -> show verify panel (no redirect)
  useEffect(() => {
    if (!signupState.success) return;
    setShowVerify(true);
    setTab("login");
  }, [signupState.success]);

  // LOGIN success -> reload user and redirect if verified
  useEffect(() => {
    if (!loginState.success) return;

    (async () => {
      const u = auth.currentUser;
      if (u) {
        await u.reload(); // IMPORTANT: refresh emailVerified
        const email = u.email || emailInput;
        if (!u.emailVerified) {
          setShowVerify(true);
          setEmailInput(email || "");
          return; // stay on modal
        }
      }

      // If currentUser is null (edge), still proceed (server/session style)
      setShowSuccess(true);
      setTimeout(() => {
        onClose();
        router.push(redirectTo);
        router.refresh();
      }, 450);
    })();
  }, [loginState.success, emailInput, onClose, redirectTo, router]);

  const heading = useMemo(() => {
    if (showVerify) return "Check your email";
    return tab === "login" ? "Welcome back" : "Create your account";
  }, [showVerify, tab]);

  const sub = useMemo(() => {
    if (showVerify) return "";
    return tab === "login"
      ? "Log in to continue."
      : "Sign up to book and manage appointments.";
  }, [showVerify, tab]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl">
        {busy && <LoadingOverlay message="Processing..." />}
        {showSuccess && <SuccessOverlay />}

        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="text-sm font-extrabold text-slate-900">{heading}</div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy || showSuccess}
            className="text-slate-500 hover:text-slate-700 disabled:opacity-60"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="px-6 py-6">
          {(title || subtitle) ? (
            <div className="mb-5">
              {title ? <h2 className="text-base font-extrabold text-slate-900">{title}</h2> : null}
              {subtitle ? <p className="mt-1 text-sm leading-relaxed text-slate-600">{subtitle}</p> : null}
            </div>
          ) : !showVerify ? (
            <p className="mb-5 text-sm leading-relaxed text-slate-600">{sub}</p>
          ) : null}

          {showVerify ? (
            <VerifyPanel
              email={auth.currentUser?.email || emailInput}
              onBackToLogin={() => {
                setShowVerify(false);
                setTab("login");
              }}
            />
          ) : tab === "login" ? (
            <>
              <form action={loginAction} className="space-y-4">
                <input
                  name="email"
                  type="email"
                  placeholder="Email"
                  required
                  disabled={pending}
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  className="w-full rounded-xl border px-4 py-3 text-sm disabled:opacity-60"
                />
              <div className="relative">
                <input
                  name="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Password"
                  required
                  disabled={pending}
                  className="w-full rounded-xl border px-4 py-3 pr-11 text-sm disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={pending || forgotSending}
                    onClick={async () => {
                      setForgotError(null);
                      setForgotMessage(null);
                      if (!emailInput.trim()) {
                        setForgotError("Please enter your email first.");
                        return;
                      }
                      setForgotSending(true);
                      const res = await performPasswordReset({ email: emailInput.trim() });
                      if (!res?.success) {
                        setForgotError(res?.error || "Failed to send reset password email.");
                      } else {
                        setForgotMessage("Reset password email sent. Please check your inbox.");
                      }
                      setForgotSending(false);
                    }}
                    className="text-xs font-semibold text-[#0E4B5A] hover:underline disabled:opacity-60"
                  >
                    {forgotSending ? "Sending..." : "Forgot password?"}
                  </button>
                </div>

                {forgotError ? (
                  <div className="rounded-xl bg-red-50 p-3 text-sm text-red-600">
                    {forgotError}
                  </div>
                ) : null}

                {forgotMessage ? (
                  <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">
                    {forgotMessage}
                  </div>
                ) : null}


                {loginState.error ? (
                  <div className="rounded-xl bg-red-50 p-3 text-sm text-red-600">
                    {loginState.error}
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={pending}
                  className="w-full rounded-xl bg-[#0E4B5A] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {pending ? "Logging in..." : "Log in"}
                </button>
              </form>

              <div className="mt-4 text-center text-sm text-slate-600">
                Don’t have an account?{" "}
                <button
                  type="button"
                  onClick={() => setTab("signup")}
                  disabled={pending}
                  className="font-semibold text-[#0E4B5A] hover:underline disabled:opacity-60"
                >
                  Sign up
                </button>
              </div>
            </>
          ) : (
            <>
              <form action={signupAction} className="space-y-4">
                <input
                  name="email"
                  type="email"
                  placeholder="Email"
                  required
                  disabled={pending}
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  className="w-full rounded-xl border px-4 py-3 text-sm disabled:opacity-60"
                />
                  <div className="relative">
                <input
                  name="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Password"
                  required
                  disabled={pending}
                  className="w-full rounded-xl border px-4 py-3 pr-11 text-sm disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div> 
                <div className="relative">
                <input
                  name="confirmPassword"
                  type={showPassword ? "text" : "password"}
                  placeholder="Confirm Password"
                  required
                  disabled={pending}
                  className="w-full rounded-xl border px-4 py-3 pr-11 text-sm disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword1((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  aria-label={showPassword1 ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>

                {signupState.error ? (
                  <div className="rounded-xl bg-red-50 p-3 text-sm text-red-600">
                    {signupState.error}
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={pending}
                  className="w-full rounded-xl bg-[#0E4B5A] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {pending ? "Creating account..." : "Create account"}
                </button>
              </form>

              <div className="mt-4 text-center text-sm text-slate-600">
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => setTab("login")}
                  disabled={pending}
                  className="font-semibold text-[#0E4B5A] hover:underline disabled:opacity-60"
                >
                  Log in
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
