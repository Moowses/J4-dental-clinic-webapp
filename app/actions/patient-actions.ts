import { ActionState } from "@/lib/utils";
import { getAllPatients, updateUserDocument } from "@/lib/services/user-service";
import { getUserProfile } from "@/lib/services/user-service";
import { updateUserProfile } from "@/lib/services/auth-service";
import { updatePatientRegistration } from "@/lib/services/patient-service";
import { PatientRegistrationData } from "@/lib/validations/patient-registration";

// Staff/Client Action: Submit full registration
export async function submitPatientRegistrationAction(uid: string, data: PatientRegistrationData): Promise<{ success: boolean; error?: string }> {
  const { auth } = await import("@/lib/firebase/firebase");
  if (!auth.currentUser) return { success: false, error: "Not authenticated" };

  // Permission check: Either the patient themselves or staff can update
  const currentUserProfile = await getUserProfile(auth.currentUser.uid);
  const isStaff = currentUserProfile.data?.role && currentUserProfile.data.role !== 'client';
  
  if (auth.currentUser.uid !== uid && !isStaff) {
    return { success: false, error: "Unauthorized" };
  }

  // 1. Sync Display Name (First + Last)
  const personalInfo = data.personal_information;
  if (personalInfo?.name) {
    const newDisplayName = `${personalInfo.name.first_name} ${personalInfo.name.last_name}`.trim();
    
    if (newDisplayName) {
      // Update Firestore Profile
      await updateUserDocument(uid, { displayName: newDisplayName });
      
      // Update Auth Profile (Only if editing self)
      if (auth.currentUser.uid === uid) {
        await updateUserProfile(auth.currentUser, { displayName: newDisplayName });
      }
    }
  }

  // 2. Save Full Registration
  return await updatePatientRegistration(uid, data);
}

// Staff Action: Fetch all patients for the directory
export async function getPatientListAction(): Promise<{
  success: boolean;
  data?: any[];
  error?: string;
}> {
  const { auth } = await import("@/lib/firebase/firebase");
  if (!auth.currentUser) return { success: false, error: "Not authenticated" };

  // Verify Role
  const profile = await getUserProfile(auth.currentUser.uid);
  if (!profile.success || !profile.data || profile.data.role === "client") {
    return { success: false, error: "Unauthorized: Staff access required" };
  }

  return await getAllPatients(100); // Fetch top 100 for directory
}

export async function deletePatientAction(
  uid: string
): Promise<{ success: boolean; error?: string; summary?: any }> {
  const { auth } = await import("@/lib/firebase/firebase");
  if (!auth.currentUser) return { success: false, error: "Not authenticated" };

  const profile = await getUserProfile(auth.currentUser.uid);
  if (!profile.success || !profile.data || profile.data.role !== "admin") {
    return { success: false, error: "Unauthorized: Admin access required" };
  }

  try {
    const idToken = await auth.currentUser.getIdToken();
    const res = await fetch("/api/admin/delete-patient", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, patientUid: uid }),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      return {
        success: false,
        error: String(data?.error || "Failed to delete patient"),
      };
    }

    return { success: true, summary: data.summary };
  } catch (error) {
    console.error("deletePatientAction error:", error);
    return { success: false, error: "Failed to delete patient" };
  }
}
