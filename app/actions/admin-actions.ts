"use server";

import {
  autoSendPatientPasswordSetupIfVerified,
  createEmployeeUser,
  createPatientAccountByStaff,
  searchUsersByTerm,
  sendPatientVerificationEmail,
  sendPatientPasswordSetupEmail,
  sendUserPasswordResetByEmail,
  verifyAdminToken,
} from "@/lib/services/admin-service";
import { createEmployeeSchema } from "@/lib/validations/auth";
import { ActionState } from "@/lib/utils";

export async function createEmployeeAction(prevState: ActionState, data: FormData): Promise<ActionState> {
  // 1. Extract Token (Security Check)
  const token = data.get("idToken") as string;
  if (!token) {
    return { success: false, error: "Unauthorized: No token provided" };
  }

  // 2. Verify Admin Status
  const isAdmin = await verifyAdminToken(token);
  if (!isAdmin) {
    return { success: false, error: "Unauthorized: Admin access required" };
  }

  // 3. Validate Form Data
  const formData = Object.fromEntries(data);
  const parsed = createEmployeeSchema.safeParse(formData);

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0].message,
    };
  }

  // 4. Execute Service
  return await createEmployeeUser(parsed.data);
}

export async function createPatientAccountByStaffAction(input: {
  idToken: string;
  email: string;
  displayName?: string;
}) {
  return await createPatientAccountByStaff(input);
}

export async function sendPatientPasswordSetupEmailAction(input: {
  idToken: string;
  targetUid: string;
}) {
  return await sendPatientPasswordSetupEmail(input);
}

export async function autoSendPatientPasswordSetupIfVerifiedAction(input: {
  idToken: string;
  targetUid: string;
}) {
  return await autoSendPatientPasswordSetupIfVerified(input);
}

export async function sendPatientVerificationEmailAction(input: {
  idToken: string;
  targetUid: string;
}) {
  return await sendPatientVerificationEmail(input);
}

export async function sendUserPasswordResetByEmailAction(input: {
  idToken: string;
  email: string;
}) {
  return await sendUserPasswordResetByEmail(input);
}

export async function searchUsersByTermAction(input: {
  idToken: string;
  term?: string;
}) {
  return await searchUsersByTerm(input);
}
