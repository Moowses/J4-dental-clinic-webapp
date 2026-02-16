import "server-only";
import { adminAuth, adminDb } from "../firebase/server";
import { createEmployeeSchema } from "../validations/auth";
import { z } from "zod";
import { DocumentData, Timestamp } from "firebase-admin/firestore";
import { Resend } from "resend";

export async function verifyAdminToken(token: string): Promise<boolean> {
  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    const userDoc = await adminDb
      .collection("users")
      .doc(decodedToken.uid)
      .get();

    if (!userDoc.exists) return false;

    const userData = userDoc.data();
    return userData?.role === "admin";
  } catch (error) {
    console.error("Error verifying admin token:", error);
    return false;
  }
}

export async function verifyStaffToken(token: string): Promise<boolean> {
  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    const userDoc = await adminDb
      .collection("users")
      .doc(decodedToken.uid)
      .get();

    if (!userDoc.exists) return false;

    const userData = userDoc.data();
    const role = String(userData?.role || "");
    return role === "admin" || role === "front-desk" || role === "dentist";
  } catch (error) {
    console.error("Error verifying staff token:", error);
    return false;
  }
}

export async function getUserRoleFromToken(token: string): Promise<string | null> {
  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    const userDoc = await adminDb
      .collection("users")
      .doc(decodedToken.uid)
      .get();

    if (!userDoc.exists) return null;
    const userData = userDoc.data();
    return String(userData?.role || "");
  } catch (error) {
    console.error("Error resolving user role from token:", error);
    return null;
  }
}

export async function createEmployeeUser(
  data: z.infer<typeof createEmployeeSchema>
) {
  try {
    const { email, password, displayName, role } = data;

    // 1. Create Authentication User
    const userRecord = await adminAuth.createUser({
      email,
      password,
      displayName,
    });

    // 2. Create Firestore Document (using Admin SDK)
    await adminDb.collection("users").doc(userRecord.uid).set({
      uid: userRecord.uid,
      email,
      role,
      displayName,
      createdAt: Timestamp.now(),
    });

    // 3. Initialize Dentist Profile (if applicable)
    if (role === "dentist") {
      await adminDb.collection("dentist_profiles").doc(userRecord.uid).set({
        uid: userRecord.uid,
        specialties: [],
        schedule: {},
        updatedAt: Timestamp.now(),
      });
    }

    return { success: true, uid: userRecord.uid };
  } catch (error) {
    console.error("Error creating employee:", error);
    const message = error instanceof Error ? error.message : "Failed to create employee";
    return {
      success: false,
      error: message,
    };
  }
}

function appBaseUrl() {
  const raw = (process.env.NEXT_PUBLIC_APP_URL || "").trim();
  if (!raw) return "http://localhost:3000";

  const withProtocol = /^https?:\/\//i.test(raw)
    ? raw
    : raw.includes("localhost")
    ? `http://${raw}`
    : `https://${raw}`;

  try {
    return new URL(withProtocol).origin;
  } catch {
    return "http://localhost:3000";
  }
}

function continueUrl(path: string) {
  try {
    return new URL(path, appBaseUrl()).toString();
  } catch {
    return `http://localhost:3000${path}`;
  }
}

function clientHomePath() {
  return "/";
}

function randomPassword(length = 14) {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*?";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

async function sendAccountLifecycleEmail(params: {
  to: string;
  subject: string;
  title: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  note?: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { success: false, error: "RESEND_API_KEY is missing." };
  }

  const resend = new Resend(apiKey);
  const html = `
  <div style="font-family:Arial,sans-serif;line-height:1.5;color:#0f172a">
    <h2 style="margin:0 0 12px 0">${params.title}</h2>
    <p style="margin:0 0 12px 0">${params.body}</p>
    <p style="margin:16px 0">
      <a href="${params.ctaUrl}" style="display:inline-block;background:#0E4B5A;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:700">
        ${params.ctaLabel}
      </a>
    </p>
    ${params.note ? `<p style="margin:12px 0 0 0;color:#475569;font-size:13px">${params.note}</p>` : ""}
  </div>`;

  const res = await resend.emails.send({
    from: "J4 Dental Clinic <no-reply@j4dentalclinic.karlmosses.com>",
    to: [params.to],
    subject: params.subject,
    html,
  });

  if (res.error) {
    return { success: false, error: String(res.error.message || "Failed to send email.") };
  }
  return { success: true };
}

function formatPatientId(year: number, seq: number) {
  return `${year}-${String(seq).padStart(4, "0")}`;
}

async function assignPatientId(uid: string) {
  const nowYear = new Date().getFullYear();
  const patientRef = adminDb.collection("patient_records").doc(uid);
  const counterRef = adminDb.collection("counters").doc("patientId");

  const result = await adminDb.runTransaction(async (tx) => {
    const patientSnap = await tx.get(patientRef);
    if (patientSnap.exists) {
      const existing = patientSnap.data()?.patientId;
      if (existing) return { patientId: String(existing), reused: true };
    }

    const counterSnap = await tx.get(counterRef);
    let year = nowYear;
    let seq = 0;

    if (counterSnap.exists) {
      const data = counterSnap.data() || {};
      const storedYear = Number(data?.year || 0);
      const storedSeq = Number(data?.seq || 0);
      if (storedYear === nowYear) {
        year = storedYear;
        seq = Number.isFinite(storedSeq) ? storedSeq : 0;
      }
    }

    const nextSeq = seq + 1;
    const pid = formatPatientId(year, nextSeq);
    tx.set(counterRef, { year, seq: nextSeq, updatedAt: Timestamp.now() }, { merge: true });
    tx.set(patientRef, { uid, patientId: pid, updatedAt: Timestamp.now() }, { merge: true });
    return { patientId: pid, reused: false };
  });

  return result.patientId;
}

export async function createPatientAccountByStaff(data: {
  idToken: string;
  email: string;
  displayName?: string;
}) {
  try {
    const role = await getUserRoleFromToken(data.idToken);
    if (!role || (role !== "admin" && role !== "front-desk")) {
      return { success: false, error: "Unauthorized: Admin/Front Desk access required." };
    }

    const email = data.email.trim().toLowerCase();
    const parsed = z.email().safeParse(email);
    if (!parsed.success) return { success: false, error: "Please enter a valid email." };

    try {
      const existing = await adminAuth.getUserByEmail(email);
      return {
        success: false,
        code: "EMAIL_TAKEN",
        error: "This email is already taken. Do you want to send reset password?",
        uid: existing.uid,
        email,
        emailVerified: Boolean(existing.emailVerified),
      };
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || "";
      if (!String(code).includes("user-not-found")) throw err;
    }

    const created = await adminAuth.createUser({
      email,
      password: randomPassword(),
      displayName: (data.displayName || "").trim() || undefined,
      emailVerified: false,
    });

    await adminDb.collection("users").doc(created.uid).set({
      uid: created.uid,
      email,
      role: "client",
      displayName: (data.displayName || "").trim(),
      createdAt: Timestamp.now(),
    });

    const patientId = await assignPatientId(created.uid);

    const verificationLink = await adminAuth.generateEmailVerificationLink(email, {
      // After email confirmation, patient should land on homepage when opening the app.
      url: continueUrl(clientHomePath()),
    });

    const sent = await sendAccountLifecycleEmail({
      to: email,
      subject: "Confirm your J4 Dental Clinic account",
      title: "Confirm your email address",
      body: "Your account was created by J4 Dental Clinic staff. Please confirm your email to continue account setup.",
      ctaLabel: "Confirm Email",
      ctaUrl: verificationLink,
      note: "After your email is confirmed, a separate password setup email will be sent.",
    });

    if (!sent.success) {
      return {
        success: false,
        code: "VERIFICATION_EMAIL_FAILED",
        error:
          "Account created but verification email could not be sent. Please retry sending verification.",
        uid: created.uid,
        email,
        patientId,
      };
    }

    return { success: true, uid: created.uid, email, patientId };
  } catch (error) {
    console.error("Error creating patient account by staff:", error);
    const message = error instanceof Error ? error.message : "Failed to create patient account.";
    return { success: false, error: message };
  }
}

export async function sendPatientPasswordSetupEmail(data: {
  idToken: string;
  targetUid: string;
}) {
  try {
    const role = await getUserRoleFromToken(data.idToken);
    if (!role || (role !== "admin" && role !== "front-desk")) {
      return { success: false, error: "Unauthorized: Admin/Front Desk access required." };
    }

    const user = await adminAuth.getUser(data.targetUid);
    if (!user.email) return { success: false, error: "Target user has no email." };

    if (!user.emailVerified) {
      return {
        success: false,
        code: "EMAIL_NOT_VERIFIED",
        error: "Patient has not confirmed email yet. Password setup email cannot be sent yet.",
      };
    }

    const resetLink = await adminAuth.generatePasswordResetLink(user.email, {
      url: continueUrl("/admin"),
    });

    const sent = await sendAccountLifecycleEmail({
      to: user.email,
      subject: "Set your J4 Dental Clinic password",
      title: "Set your password",
      body: "Your email is confirmed. You can now set your password to access your patient dashboard.",
      ctaLabel: "Set Password",
      ctaUrl: resetLink,
      note: "If this was not requested by you, ignore this email.",
    });

    if (!sent.success) return sent;
    await adminDb.collection("users").doc(data.targetUid).set(
      {
        patientOnboarding: {
          passwordSetupEmailSentAt: Timestamp.now(),
        },
      },
      { merge: true }
    );
    return { success: true };
  } catch (error) {
    console.error("Error sending password setup email:", error);
    const message = error instanceof Error ? error.message : "Failed to send password setup email.";
    return { success: false, error: message };
  }
}

export async function autoSendPatientPasswordSetupIfVerified(data: {
  idToken: string;
  targetUid: string;
}) {
  try {
    const role = await getUserRoleFromToken(data.idToken);
    if (!role || (role !== "admin" && role !== "front-desk")) {
      return { success: false, error: "Unauthorized: Admin/Front Desk access required." };
    }

    const user = await adminAuth.getUser(data.targetUid);
    if (!user.email) return { success: false, error: "Target user has no email." };

    if (!user.emailVerified) {
      return { success: true, status: "waiting_verification" as const };
    }

    const profileSnap = await adminDb.collection("users").doc(data.targetUid).get();
    const sentAt = profileSnap.data()?.patientOnboarding?.passwordSetupEmailSentAt;
    if (sentAt) {
      return { success: true, status: "already_sent" as const };
    }

    const resetLink = await adminAuth.generatePasswordResetLink(user.email, {
      url: continueUrl("/admin"),
    });

    const sent = await sendAccountLifecycleEmail({
      to: user.email,
      subject: "Set your J4 Dental Clinic password",
      title: "Set your password",
      body: "Your email is confirmed. You can now set your password to access your patient dashboard.",
      ctaLabel: "Set Password",
      ctaUrl: resetLink,
      note: "If this was not requested by you, ignore this email.",
    });

    if (!sent.success) return sent;

    await adminDb.collection("users").doc(data.targetUid).set(
      {
        patientOnboarding: {
          passwordSetupEmailSentAt: Timestamp.now(),
        },
      },
      { merge: true }
    );

    return { success: true, status: "sent_now" as const };
  } catch (error) {
    console.error("Error auto-sending password setup email:", error);
    const message =
      error instanceof Error ? error.message : "Failed to auto-send password setup email.";
    return { success: false, error: message };
  }
}

export async function sendUserPasswordResetByEmail(data: {
  idToken: string;
  email: string;
}) {
  try {
    const role = await getUserRoleFromToken(data.idToken);
    if (!role || (role !== "admin" && role !== "front-desk")) {
      return { success: false, error: "Unauthorized: Admin/Front Desk access required." };
    }

    const email = data.email.trim().toLowerCase();
    const parsed = z.email().safeParse(email);
    if (!parsed.success) return { success: false, error: "Please enter a valid email." };

    await adminAuth.getUserByEmail(email);
    const resetLink = await adminAuth.generatePasswordResetLink(email, {
      url: continueUrl("/admin"),
    });

    const sent = await sendAccountLifecycleEmail({
      to: email,
      subject: "Reset your J4 Dental Clinic password",
      title: "Password reset requested",
      body: "A clinic administrator initiated a password reset for your account.",
      ctaLabel: "Reset Password",
      ctaUrl: resetLink,
      note: "If you did not request this, you can ignore this email.",
    });

    if (!sent.success) return sent;
    return { success: true };
  } catch (error) {
    console.error("Error sending password reset:", error);
    const message = error instanceof Error ? error.message : "Failed to send reset password email.";
    return { success: false, error: message };
  }
}

export async function searchUsersByTerm(data: { idToken: string; term?: string }) {
  try {
    const role = await getUserRoleFromToken(data.idToken);
    if (!role || role !== "admin") {
      return { success: false, error: "Unauthorized: Admin access required." };
    }

    const usersRef = adminDb.collection("users");
    const term = (data.term || "").trim();

    const docsMap = new Map<string, DocumentData>();

    if (!term) {
      const snap = await usersRef.orderBy("email").limit(25).get();
      snap.docs.forEach((d) => docsMap.set(d.id, { uid: d.id, ...d.data() }));
    } else {
      const emailQuery = usersRef
        .where("email", ">=", term)
        .where("email", "<=", `${term}\uf8ff`)
        .orderBy("email")
        .limit(25)
        .get();

      const nameQuery = usersRef
        .where("displayName", ">=", term)
        .where("displayName", "<=", `${term}\uf8ff`)
        .orderBy("displayName")
        .limit(25)
        .get();

      const [emailSnap, nameSnap] = await Promise.all([emailQuery, nameQuery]);
      emailSnap.docs.forEach((d) => docsMap.set(d.id, { uid: d.id, ...d.data() }));
      nameSnap.docs.forEach((d) => docsMap.set(d.id, { uid: d.id, ...d.data() }));
    }

    const rows = Array.from(docsMap.values()).slice(0, 25);
    const authRes = await adminAuth.getUsers(rows.map((r) => ({ uid: String(r.uid) })));
    const verifiedMap = new Map<string, boolean>();
    authRes.users.forEach((u) => verifiedMap.set(u.uid, Boolean(u.emailVerified)));

    return {
      success: true,
      data: rows.map((r) => ({
        uid: String(r.uid),
        email: String(r.email || ""),
        displayName: String(r.displayName || ""),
        role: String(r.role || ""),
        emailVerified: verifiedMap.get(String(r.uid)) || false,
      })),
    };
  } catch (error) {
    console.error("Error searching users:", error);
    const message = error instanceof Error ? error.message : "Failed to search users.";
    return { success: false, error: message };
  }
}

export async function sendPatientVerificationEmail(data: {
  idToken: string;
  targetUid: string;
}) {
  try {
    const role = await getUserRoleFromToken(data.idToken);
    if (!role || (role !== "admin" && role !== "front-desk")) {
      return { success: false, error: "Unauthorized: Admin/Front Desk access required." };
    }

    const user = await adminAuth.getUser(data.targetUid);
    if (!user.email) return { success: false, error: "Target user has no email." };

    const verificationLink = await adminAuth.generateEmailVerificationLink(user.email, {
      // After email confirmation, patient should land on homepage when opening the app.
      url: continueUrl(clientHomePath()),
    });

    const sent = await sendAccountLifecycleEmail({
      to: user.email,
      subject: "Confirm your J4 Dental Clinic account",
      title: "Confirm your email address",
      body: "Please confirm your email address to continue patient account setup.",
      ctaLabel: "Confirm Email",
      ctaUrl: verificationLink,
      note: "After confirmation, send a password setup email.",
    });

    if (!sent.success) return sent;
    return { success: true };
  } catch (error) {
    console.error("Error sending verification email:", error);
    const message = error instanceof Error ? error.message : "Failed to send verification email.";
    return { success: false, error: message };
  }
}
