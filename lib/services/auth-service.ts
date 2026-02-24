import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  sendPasswordResetEmail,
  updateProfile as firebaseUpdateProfile,
  sendEmailVerification,
  ActionCodeSettings,
  GoogleAuthProvider,
  signInWithPopup,
  User,
} from "firebase/auth";
import { auth } from "../firebase/firebase";
import {
  signInSchema,
  signUpSchema,
  resetPasswordSchema,
  updateProfileSchema,
} from "../validations/auth";
import { z } from "zod";
import { createUserDocument } from "./user-service";

function getEmailVerificationActionCodeSettings(): ActionCodeSettings {
  const appUrl =
    (process.env.NEXT_PUBLIC_APP_URL || "").trim() ||
    (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");

  const continueUrl = new URL("/", appUrl);
  continueUrl.searchParams.set("auth", "login");
  continueUrl.searchParams.set("verified", "1");

  return {
    url: continueUrl.toString(),
  };
}

export async function signIn(credentials: z.infer<typeof signInSchema>) {
  try {
    const { email, password } = signInSchema.parse(credentials);
    await signInWithEmailAndPassword(auth, email, password);
    return { success: true };
  } catch (error) {
    if (error instanceof Error) {
      return { success: false, error: error.message };
    }
    return { success: false, error: "An unknown error occurred" };
  }
}

export async function signUp(credentials: z.infer<typeof signUpSchema>) {
  try {
    const { email, password } = signUpSchema.parse(credentials);
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    
    // Create Firestore Document
    await createUserDocument(userCredential.user.uid, email, "client");
    const idToken = await userCredential.user.getIdToken();
    const res = await fetch("/api/patient-id/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.success) {
      throw new Error(body?.error || "Failed to assign patient ID");
    }

    // Send verification email immediately after signup
    if (userCredential.user) {
      await sendEmailVerification(
        userCredential.user,
        getEmailVerificationActionCodeSettings()
      );
    }
    
    return { success: true };
  } catch (error) {
    if (error instanceof Error) {
      return { success: false, error: error.message };
    }
    return { success: false, error: "An unknown error occurred" };
  }
}

export async function logout() {
  try {
    await firebaseSignOut(auth);
    return { success: true };
  } catch (error) {
    if (error instanceof Error) {
      return { success: false, error: error.message };
    }
    return { success: false, error: "An unknown error occurred" };
  }
}

export async function performPasswordReset(data: z.infer<typeof resetPasswordSchema>) {
  try {
    const { email } = resetPasswordSchema.parse(data);
    await sendPasswordResetEmail(auth, email);
    return { success: true };
  } catch (error) {
    if (error instanceof Error) {
      return { success: false, error: error.message };
    }
    return { success: false, error: "An unknown error occurred" };
  }
}

export async function updateUserProfile(user: User, data: z.infer<typeof updateProfileSchema>) {
  try {
    const parsed = updateProfileSchema.parse(data);
    await firebaseUpdateProfile(user, {
      displayName: parsed.displayName,
      photoURL: parsed.photoURL,
    });
    return { success: true };
  } catch (error) {
    if (error instanceof Error) {
      return { success: false, error: error.message };
    }
    return { success: false, error: "An unknown error occurred" };
  }
}

export async function sendVerificationEmail(user: User) {
  try {
    await sendEmailVerification(user, getEmailVerificationActionCodeSettings());
    return { success: true };
  } catch (error) {
    if (error instanceof Error) {
      return { success: false, error: error.message };
    }
    return { success: false, error: "An unknown error occurred" };
  }
}

export async function loginWithGoogle() {
  try {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
    return { success: true };
  } catch (error) {
    if (error instanceof Error) {
      return { success: false, error: error.message };
    }
    return { success: false, error: "An unknown error occurred" };
  }
}
