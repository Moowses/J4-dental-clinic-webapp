import "server-only";
import { adminDb } from "../firebase/server";
import { Appointment } from "../types/appointment";

const APPOINTMENTS_COLLECTION = "appointments";

function serializeAppointment(data: any, id: string): Appointment {
  return {
    ...data,
    id,
    createdAt:
      data?.createdAt && typeof data.createdAt.toDate === "function"
        ? data.createdAt.toDate().toISOString()
        : data?.createdAt,
    paymentDate:
      data?.paymentDate && typeof data.paymentDate.toDate === "function"
        ? data.paymentDate.toDate().toISOString()
        : data?.paymentDate,
    treatment: data?.treatment
      ? {
          ...data.treatment,
          completedAt:
            data.treatment.completedAt &&
            typeof data.treatment.completedAt.toDate === "function"
              ? data.treatment.completedAt.toDate().toISOString()
              : data.treatment.completedAt,
        }
      : undefined,
  } as Appointment;
}

export async function getAppointmentByIdAdmin(appointmentId: string): Promise<{ success: boolean; data?: Appointment; error?: string }> {
  try {
    // Use Admin SDK (bypasses rules)
    const docRef = adminDb.collection(APPOINTMENTS_COLLECTION).doc(appointmentId);
    const snap = await docRef.get();
    
    if (!snap.exists) {
      return { success: false, error: "Appointment not found" };
    }

    const data = snap.data();
    
    // Convert Firestore Timestamps to ISO strings for Next.js serialization
    return { success: true, data: serializeAppointment(data, snap.id) };
  } catch (error) {
    console.error("Error fetching appointment (Admin):", error);
    return { success: false, error: "Failed to fetch appointment" };
  }
}

export async function getAppointmentsByPatientIdAdmin(
  patientId: string
): Promise<{ success: boolean; data?: Appointment[]; error?: string }> {
  try {
    const snap = await adminDb
      .collection(APPOINTMENTS_COLLECTION)
      .where("patientId", "==", patientId)
      .orderBy("date", "desc")
      .orderBy("time", "desc")
      .get();

    const rows = snap.docs.map((doc) =>
      serializeAppointment(doc.data(), doc.id)
    );

    return { success: true, data: rows };
  } catch (error) {
    console.error("Error fetching appointments by patient (Admin):", error);
    return { success: false, error: "Failed to fetch appointment history" };
  }
}

export async function updateTreatmentExtrasAdmin(
  appointmentId: string,
  updates: {
    notes?: string;
    imageUrls?: string[];
    dentalChartPatch?: Record<
      string,
      { status?: string; notes?: string; updatedAt?: number; updatedBy?: string }
    >;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const docRef = adminDb.collection(APPOINTMENTS_COLLECTION).doc(appointmentId);
    const snap = await docRef.get();

    if (!snap.exists) {
      return { success: false, error: "Appointment not found" };
    }

    const data = snap.data() as Appointment;
    if (!data?.treatment) {
      return { success: false, error: "Treatment record not found" };
    }

    const patch: Record<string, unknown> = {};

    if (typeof updates.notes === "string") {
      patch["treatment.notes"] = updates.notes;
    }

    if (Array.isArray(updates.imageUrls)) {
      patch["treatment.imageUrls"] = updates.imageUrls;
    }

    if (updates.dentalChartPatch && typeof updates.dentalChartPatch === "object") {
      const cleanedChartPatch: Record<string, { status?: string; notes?: string; updatedAt?: number; updatedBy?: string }> = {};
      for (const [key, value] of Object.entries(updates.dentalChartPatch)) {
        if (!key || !value || typeof value !== "object") continue;
        cleanedChartPatch[key] = {
          ...(typeof value.status === "string" ? { status: value.status } : {}),
          ...(typeof value.notes === "string" ? { notes: value.notes } : {}),
          ...(typeof value.updatedAt === "number" ? { updatedAt: value.updatedAt } : {}),
          ...(typeof value.updatedBy === "string" ? { updatedBy: value.updatedBy } : {}),
        };
      }

      patch["treatment.dentalChart"] = {
        ...(data.treatment.dentalChart || {}),
        ...cleanedChartPatch,
      };
    }

    if (Object.keys(patch).length === 0) {
      return { success: true };
    }

    await docRef.update(patch);

    return { success: true };
  } catch (error) {
    console.error("Error updating treatment extras (Admin):", error);
    return { success: false, error: "Failed to update treatment record" };
  }
}
