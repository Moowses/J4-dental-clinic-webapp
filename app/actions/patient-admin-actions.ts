"use server";

import { adminDb } from "@/lib/firebase/server";
import { deleteCloudinaryAssetByUrl } from "@/lib/services/cloudinary-admin";
import { verifyAdminToken } from "@/lib/services/admin-service";
import { adminAuth } from "@/lib/firebase/server";
import { Timestamp } from "firebase-admin/firestore";

type ResetCounterInput = {
  idToken: string;
  year?: number;
};

export async function resetPatientIdCounterAction(input: ResetCounterInput) {
  try {
    const token = input?.idToken;
    if (!token) {
      return { success: false, error: "Unauthorized: No token provided" };
    }

    const ok = await verifyAdminToken(token);
    if (!ok) {
      return { success: false, error: "Unauthorized: Admin access required" };
    }

    const year = Number(input?.year) || new Date().getFullYear();
    await adminDb
      .collection("counters")
      .doc("patientId")
      .set({ year, seq: 0, updatedAt: Timestamp.now() }, { merge: true });

    return { success: true };
  } catch (error) {
    console.error("Error resetting patient ID counter:", error);
    return { success: false, error: "Failed to reset counter" };
  }
}

type SyncCounterInput = {
  idToken: string;
};

function parsePatientId(pid: string) {
  const match = String(pid).trim().match(/^(\d{4})-(\d{4})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const seq = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(seq)) return null;
  return { year, seq };
}

export async function syncPatientIdCounterAction(input: SyncCounterInput) {
  try {
    const token = input?.idToken;
    if (!token) {
      return { success: false, error: "Unauthorized: No token provided" };
    }

    const ok = await verifyAdminToken(token);
    if (!ok) {
      return { success: false, error: "Unauthorized: Admin access required" };
    }

    const snap = await adminDb
      .collection("patient_records")
      .orderBy("patientId", "desc")
      .limit(1)
      .get();

    let year = new Date().getFullYear();
    let seq = 0;
    if (!snap.empty) {
      const pid = String(snap.docs[0]?.data()?.patientId || "");
      const parsed = parsePatientId(pid);
      if (parsed) {
        year = parsed.year;
        seq = parsed.seq;
      }
    }

    await adminDb
      .collection("counters")
      .doc("patientId")
      .set({ year, seq, updatedAt: Timestamp.now() }, { merge: true });

    return { success: true, year, seq };
  } catch (error) {
    console.error("Error syncing patient ID counter:", error);
    return { success: false, error: "Failed to sync counter" };
  }
}

type SelectiveResetSelection = {
  patientRecords?: boolean;
  appointments?: boolean;
  billingRecords?: boolean;
  patientAccounts?: boolean;
  systemAccounts?: boolean;
  proceduresAndServices?: boolean;
  patientIdCounter?: boolean;
  deleteLinkedImages?: boolean;
};

type SelectiveResetInput = {
  idToken: string;
  confirmationText: string;
  selection: SelectiveResetSelection;
};

type ResetSummary = {
  patientRecordsDeleted: number;
  appointmentsDeleted: number;
  billingRecordsDeleted: number;
  patientAccountsDeleted: number;
  patientAuthDeleted: number;
  systemAccountsDeleted: number;
  systemAuthDeleted: number;
  dentistProfilesDeleted: number;
  proceduresDeleted: number;
  servicesDeleted: number;
  patientIdCounterReset: boolean;
  imagesDeleted: number;
  imagesFailed: number;
  preservedCurrentAdmin: boolean;
};

const RESET_CONFIRMATION_TEXT = "DELETE SELECTED DATA";
const SYSTEM_ROLES = ["admin", "front-desk", "dentist"] as const;

function createEmptySummary(): ResetSummary {
  return {
    patientRecordsDeleted: 0,
    appointmentsDeleted: 0,
    billingRecordsDeleted: 0,
    patientAccountsDeleted: 0,
    patientAuthDeleted: 0,
    systemAccountsDeleted: 0,
    systemAuthDeleted: 0,
    dentistProfilesDeleted: 0,
    proceduresDeleted: 0,
    servicesDeleted: 0,
    patientIdCounterReset: false,
    imagesDeleted: 0,
    imagesFailed: 0,
    preservedCurrentAdmin: false,
  };
}

async function deleteDocsInChunks(
  refs: Array<{ delete: () => Promise<unknown> }>
) {
  let deleted = 0;
  for (const ref of refs) {
    await ref.delete();
    deleted += 1;
  }
  return deleted;
}

async function deleteAuthUsersInChunks(uids: string[]) {
  let deleted = 0;
  for (const uid of uids) {
    try {
      await adminAuth.deleteUser(uid);
      deleted += 1;
    } catch (error) {
      console.error(`Failed to delete auth user ${uid}:`, error);
    }
  }
  return deleted;
}

async function deleteImageUrls(urls: Set<string>) {
  let deleted = 0;
  let failed = 0;

  for (const url of urls) {
    const res = await deleteCloudinaryAssetByUrl(url);
    if (res.success) deleted += 1;
    else failed += 1;
  }

  return { deleted, failed };
}

export async function selectiveResetClinicDataAction(input: SelectiveResetInput) {
  try {
    const token = input?.idToken;
    if (!token) {
      return { success: false, error: "Unauthorized: No token provided" };
    }

    const ok = await verifyAdminToken(token);
    if (!ok) {
      return { success: false, error: "Unauthorized: Admin access required" };
    }

    if (String(input?.confirmationText || "").trim() !== RESET_CONFIRMATION_TEXT) {
      return {
        success: false,
        error: `Type ${RESET_CONFIRMATION_TEXT} to confirm.`,
      };
    }

    const decoded = await adminAuth.verifyIdToken(token);
    const currentAdminUid = String(decoded.uid || "");

    const selection = input?.selection || {};
    const hasSelection = Object.values(selection).some(Boolean);
    if (!hasSelection) {
      return { success: false, error: "Select at least one dataset to delete." };
    }

    const summary = createEmptySummary();
    const imageUrls = new Set<string>();

    if (selection.patientRecords) {
      const snap = await adminDb.collection("patient_records").get();
      summary.patientRecordsDeleted = await deleteDocsInChunks(
        snap.docs.map((doc) => doc.ref)
      );
    }

    if (selection.appointments) {
      const snap = await adminDb.collection("appointments").get();
      if (selection.deleteLinkedImages) {
        snap.docs.forEach((doc) => {
          const treatment = doc.data()?.treatment;
          const urls = Array.isArray(treatment?.imageUrls) ? treatment.imageUrls : [];
          urls.forEach((url: unknown) => {
            const value = String(url || "").trim();
            if (value) imageUrls.add(value);
          });
        });
      }
      summary.appointmentsDeleted = await deleteDocsInChunks(
        snap.docs.map((doc) => doc.ref)
      );
    }

    if (selection.billingRecords) {
      const snap = await adminDb.collection("billing_records").get();
      summary.billingRecordsDeleted = await deleteDocsInChunks(
        snap.docs.map((doc) => doc.ref)
      );
    }

    if (selection.patientAccounts) {
      const snap = await adminDb.collection("users").where("role", "==", "client").get();
      if (selection.deleteLinkedImages) {
        snap.docs.forEach((doc) => {
          const photoURL = String(doc.data()?.photoURL || "").trim();
          if (photoURL) imageUrls.add(photoURL);
        });
      }

      summary.patientAccountsDeleted = await deleteDocsInChunks(
        snap.docs.map((doc) => doc.ref)
      );
      summary.patientAuthDeleted = await deleteAuthUsersInChunks(
        snap.docs.map((doc) => doc.id)
      );
    }

    if (selection.systemAccounts) {
      const snap = await adminDb
        .collection("users")
        .where("role", "in", [...SYSTEM_ROLES])
        .get();

      const deletableUsers = snap.docs.filter((doc) => doc.id !== currentAdminUid);
      summary.preservedCurrentAdmin = snap.docs.some((doc) => doc.id === currentAdminUid);

      if (selection.deleteLinkedImages) {
        deletableUsers.forEach((doc) => {
          const photoURL = String(doc.data()?.photoURL || "").trim();
          if (photoURL) imageUrls.add(photoURL);
        });
      }

      const dentistProfileRefs = deletableUsers
        .filter((doc) => String(doc.data()?.role || "") === "dentist")
        .map((doc) => adminDb.collection("dentist_profiles").doc(doc.id));

      summary.systemAccountsDeleted = await deleteDocsInChunks(
        deletableUsers.map((doc) => doc.ref)
      );
      summary.systemAuthDeleted = await deleteAuthUsersInChunks(
        deletableUsers.map((doc) => doc.id)
      );
      summary.dentistProfilesDeleted = await deleteDocsInChunks(dentistProfileRefs);
    }

    if (selection.proceduresAndServices) {
      const [proceduresSnap, servicesSnap] = await Promise.all([
        adminDb.collection("procedures").get(),
        adminDb.collection("services").get(),
      ]);

      if (selection.deleteLinkedImages) {
        servicesSnap.docs.forEach((doc) => {
          const imageUrl = String(doc.data()?.imageUrl || "").trim();
          if (imageUrl) imageUrls.add(imageUrl);
        });
      }

      summary.proceduresDeleted = await deleteDocsInChunks(
        proceduresSnap.docs.map((doc) => doc.ref)
      );
      summary.servicesDeleted = await deleteDocsInChunks(
        servicesSnap.docs.map((doc) => doc.ref)
      );
    }

    if (selection.patientIdCounter) {
      await adminDb
        .collection("counters")
        .doc("patientId")
        .set(
          {
            year: new Date().getFullYear(),
            seq: 0,
            updatedAt: Timestamp.now(),
          },
          { merge: true }
        );
      summary.patientIdCounterReset = true;
    }

    if (selection.deleteLinkedImages && imageUrls.size > 0) {
      const imageResult = await deleteImageUrls(imageUrls);
      summary.imagesDeleted = imageResult.deleted;
      summary.imagesFailed = imageResult.failed;
    }

    return { success: true, summary };
  } catch (error) {
    console.error("Error selectively resetting clinic data:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to reset selected data",
    };
  }
}
