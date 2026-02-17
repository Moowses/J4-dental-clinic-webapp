import { actionWrapper, ActionState } from "@/lib/utils";
import {
  bookingSchema,
  paymentSchema,
  validateAppointmentDate,
  validateAppointmentTime,
} from "@/lib/validations/appointment";
import {
  createAppointment,
  getTakenSlots,
  getClinicOffDays,
  getAllAppointments,
  updateAppointmentStatus,
  assignDentist,
  getDentistAppointments,
} from "@/lib/services/appointment-service";
import { processPayment } from "@/lib/services/billing-service";
import { getClinicSettings } from "@/lib/services/clinic-service";
import {
  updatePatientRecord,
  getPatientRecord,
} from "@/lib/services/patient-service";
import { updateUserProfile } from "@/lib/services/auth-service";
import { getUserProfile } from "@/lib/services/user-service";
import { patientRecordSchema } from "@/lib/validations/auth";
import { z } from "zod";
import {
  AppointmentStatus,
  Appointment,
  PaymentMethod,
} from "@/lib/types/appointment";
import {
  sendAppointmentConfirmationEmailAction,
  sendRescheduleEmailsAction,
  sendNoShowEmailAction,
} from "@/app/actions/appointment-email-actions";
import { getAppointmentById, rescheduleAppointment } from "@/lib/services/appointment-service";
import { getBillingDetails, setupPaymentPlan } from "@/lib/services/billing-service";
import type { BillingRecord } from "@/lib/types/billing";
import {
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase/firebase";
type GetAppointmentsInRangeInput = {
  fromISO: string;
  toISO: string;
};


export type BookingState = ActionState;

export interface CalendarAvailability {
  takenSlots: string[];
  isHoliday: boolean;
  holidayReason?: string | null;
}

export interface AppointmentWithPatient extends Appointment {
  patientName?: string;
  isProfileComplete?: boolean;
}

// Client Action: Book Appointment
export async function bookAppointmentAction(
  prevState: BookingState,
  data: FormData
): Promise<BookingState> {
  const { auth } = await import("@/lib/firebase/firebase");

  if (!auth.currentUser) {
    return {
      success: false,
      error: "You must be logged in to book an appointment.",
    };
  }

  const uid = auth.currentUser.uid;
  return actionWrapper(
    bookingSchema,
    async (parsedData) => {
      // 1. Validate Business Rules (Date/Time)
      const dateError = validateAppointmentDate(parsedData.date);
      if (dateError) throw new Error(dateError);

      const timeError = validateAppointmentTime(parsedData.time);
      if (timeError) throw new Error(timeError);

      // 2. Conditional Profile Update
      if (
        parsedData.displayName &&
        parsedData.displayName !== auth.currentUser?.displayName
      ) {
        await updateUserProfile(auth.currentUser!, {
          displayName: parsedData.displayName,
        });
      }

      if (parsedData.phoneNumber) {
        const patientData: z.input<typeof patientRecordSchema> = {
          phoneNumber: parsedData.phoneNumber,
        };
        await updatePatientRecord(uid, patientData);
      }

      // 3. Create the Appointment
      const result = await createAppointment(uid, parsedData);
      if (!result.success || !result.id) {
        throw new Error(result.error || "Failed to create appointment");
      }

      return { success: true };
    },
    data
  );
}

const staffBookingSchema = bookingSchema.extend({
  patientId: z.string().min(1, "Please select a patient"),
});

export async function staffBookAppointmentAction(prevState: any, data: FormData) {
  const { auth } = await import("@/lib/firebase/firebase");

  if (!auth.currentUser) {
    return { success: false, error: "Not authenticated" };
  }

  const staffProfile = await getUserProfile(auth.currentUser.uid);
  if (!staffProfile.success || !staffProfile.data) {
    return { success: false, error: "User profile not found" };
  }

  if (staffProfile.data.role === "client") {
    return { success: false, error: "Unauthorized: Staff access required" };
  }

  return actionWrapper(staffBookingSchema, async (parsed) => {
    // Business rules
    const dateError = validateAppointmentDate(parsed.date);
    if (dateError) throw new Error(dateError);

    const timeError = validateAppointmentTime(parsed.time);
    if (timeError) throw new Error(timeError);

    // Patient profile (for name/email)
    const patientProfileRes = await getUserProfile(parsed.patientId);
    if (!patientProfileRes.success || !patientProfileRes.data) {
      throw new Error("Selected patient not found");
    }

    const patientName =
      patientProfileRes.data.displayName ||
      parsed.displayName ||
      "Patient";

    // Create appointment under patientId (NOT staff uid)
    const result = await createAppointment(parsed.patientId, {
      serviceType: parsed.serviceType,
      date: parsed.date,
      time: parsed.time,
      notes: parsed.notes,
      displayName: patientName,
    });

    if (!result.success || !result.id) {
      throw new Error(result.error || "Failed to create appointment");
    }

    return { success: true };
  }, data);
}

// Client Action: Confirm Appointment (from Email)
export async function confirmAppointmentAction(
  appointmentId: string
): Promise<{ success: boolean; error?: string }> {
  // This action is public (via email link) so we don't strictly check for auth session,
  // but in a real app you might want a signed token.
  // For now, ID is sufficient proof of access for this specific action.

  // We use the service directly.
  const result = await updateAppointmentStatus(appointmentId, "confirmed");
  if (!result)
    return { success: false, error: "Failed to confirm appointment" };

  return { success: true };
}

// Client Action: Cancel Appointment (from Email/Page)
export async function cancelAppointmentAction(
  appointmentId: string
): Promise<{ success: boolean; error?: string }> {
  const apptRes = await getAppointmentById(appointmentId);
  if (!apptRes.success || !apptRes.data) {
    return { success: false, error: apptRes.error || "Appointment not found." };
  }

  const appointment = apptRes.data as Appointment;
  const status = String(appointment.status || "").toLowerCase();
  if (status !== "pending") {
    return { success: false, error: "Only pending appointments can be cancelled." };
  }

  const dateStr = String(appointment.date || "").trim();
  const timeStr = String(appointment.time || "").trim();
  if (dateStr && timeStr) {
    const [y, m, d] = dateStr.split("-").map((v) => parseInt(v, 10));
    const [hh, mm] = timeStr.split(":").map((v) => parseInt(v, 10));
    if (y && m && d && !Number.isNaN(hh) && !Number.isNaN(mm)) {
      const apptDate = new Date(y, m - 1, d, hh, mm, 0, 0);
      const diffMs = apptDate.getTime() - Date.now();
      const diffHours = diffMs / (1000 * 60 * 60);
      if (diffMs < 0) {
        return {
          success: false,
          error: "This appointment has already started/passed. Please call front desk.",
        };
      }
      if (diffHours <= 3) {
        return {
          success: false,
          error:
            "You can't cancel your appointment 3 hours before your appointment. Please call front desk about this.",
        };
      }
    }
  }

  const result = await updateAppointmentStatus(appointmentId, "cancelled");
  if (!result?.success) return { success: false, error: result?.error || "Failed to cancel appointment." };
  return { success: true };
}

// TODO: Normalize this action to return { success, data, error } in the future
// Client Action: Check Availability
export async function getAvailabilityAction(
  date: string
): Promise<CalendarAvailability> {
  // 1. Check Global Clinic Schedule (Day of Week)
  const settingsRes = await getClinicSettings();
  const dayName = new Date(date).toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  
  const schedule = settingsRes.data?.operatingHours?.[dayName as keyof typeof settingsRes.data.operatingHours];
  
  // If clinic is closed on this day (e.g. Sunday)
  if (schedule && !schedule.isOpen) {
    return {
      takenSlots: [],
      isHoliday: true,
      holidayReason: "Clinic Closed (Regular Schedule)"
    };
  }

  // 2. Check Specific Holidays (Manual Off Days)
  const offDaysRes = await getClinicOffDays(date, date);
  const isHoliday = !!(
    offDaysRes.success &&
    offDaysRes.data &&
    offDaysRes.data.length > 0
  );

  if (isHoliday) {
    return {
      takenSlots: [],
      isHoliday: true,
      holidayReason: offDaysRes.data![0].reason
    };
  }

  // 3. Check Capacity
  const takenRes = await getTakenSlots(date);

  return {
    takenSlots: takenRes.data || [],
    isHoliday: false,
    holidayReason: null,
  };
}

// Staff Action: Fetch Clinic Schedule
export async function getClinicScheduleAction(date?: string): Promise<{
  success: boolean;
  data?: AppointmentWithPatient[];
  error?: string;
}> {
  const { auth } = await import("@/lib/firebase/firebase");
  if (!auth.currentUser) return { success: false, error: "Not authenticated" };

  const profile = await getUserProfile(auth.currentUser.uid);
  if (!profile.success || !profile.data)
    return { success: false, error: "User profile not found" };

  const role = profile.data.role;
  if (role === "client") {
    return { success: false, error: "Unauthorized: Staff access required" };
  }

  const result = await getAllAppointments(date);
  if (!result.success || !result.data) return result;

  const enrichedAppointments = await Promise.all(
    result.data.map(async (app) => {
      const [patientProfile, patientRecord] = await Promise.all([
        getUserProfile(app.patientId),
        getPatientRecord(app.patientId),
      ]);

      return {
        ...app,
        patientName: patientProfile.data?.displayName || "Unknown",
        isProfileComplete: patientRecord.data?.isProfileComplete || false,
      } as AppointmentWithPatient;
    })
  );

  return { success: true, data: enrichedAppointments };
}

// Staff Action: Assign Dentist
export async function assignDentistAction(
  appointmentId: string,
  dentistId: string
) {
  const { auth } = await import("@/lib/firebase/firebase");
  if (!auth.currentUser) return { success: false, error: "Not authenticated" };

  const profile = await getUserProfile(auth.currentUser.uid);
  if (!profile.success || !profile.data || profile.data.role === "client") {
    return { success: false, error: "Unauthorized" };
  }

  return await assignDentist(appointmentId, dentistId);
}

// Dentist Action: Get My Schedule
export async function getDentistScheduleAction(
  date?: string
): Promise<{ success: boolean; data?: Appointment[]; error?: string }> {
  const { auth } = await import("@/lib/firebase/firebase");
  if (!auth.currentUser) return { success: false, error: "Not authenticated" };

  const profile = await getUserProfile(auth.currentUser.uid);
  if (!profile.success || !profile.data)
    return { success: false, error: "Unauthorized" };

  const role = profile.data.role;
  if (role === "client") return { success: false, error: "Unauthorized" };

  if (role === "dentist") {
    return await getDentistAppointments(auth.currentUser.uid, date);
  }

  return { success: false, error: "Use Clinic Schedule for Admin view" };
}

// Staff Action: Update Status
export async function updateAppointmentStatusAction(
  appointmentId: string,
  status: AppointmentStatus
) {
  const { auth } = await import("@/lib/firebase/firebase");
  if (!auth.currentUser) return { success: false, error: "Not authenticated" };

  const profile = await getUserProfile(auth.currentUser.uid);
  if (!profile.success || !profile.data || profile.data.role === "client") {
    return { success: false, error: "Unauthorized" };
  }

  const result = await updateAppointmentStatus(appointmentId, status);
  if (!result?.success) return result;

  if (status === "confirmed") {
    try {
      const apptRes = await getAppointmentById(appointmentId);
      if (apptRes.success && apptRes.data) {
        const appt = apptRes.data as Appointment;
        const profileRes = await getUserProfile(appt.patientId);
        const patientEmail = profileRes?.success ? profileRes.data?.email : "";

        if (patientEmail) {
          await sendAppointmentConfirmationEmailAction({
            appointmentId: appt.id,
            date: String(appt.date || ""),
            time: String(appt.time || ""),
            serviceName: String(appt.serviceType || "Dental Service"),
            patientName:
              (profileRes?.success && profileRes.data?.displayName) ||
              profileRes?.data?.email ||
              "Patient",
            patientEmail,
          });
        }
      }
    } catch (e) {
      console.error("Failed to send confirmed appointment email:", e);
    }
  }

  if (status === "no_show") {
    try {
      const apptRes = await getAppointmentById(appointmentId);
      if (apptRes.success && apptRes.data) {
        const appt = apptRes.data as Appointment;
        const profileRes = await getUserProfile(appt.patientId);
        const patientEmail = profileRes?.success ? profileRes.data?.email : "";

        if (patientEmail) {
          await sendNoShowEmailAction({
            appointmentId: appt.id,
            date: String(appt.date || ""),
            time: String(appt.time || ""),
            serviceName: String(appt.serviceType || "Dental Service"),
            patientName:
              (profileRes?.success && profileRes.data?.displayName) ||
              profileRes?.data?.email ||
              "Patient",
            patientEmail,
          });
        }
      }
    } catch (e) {
      console.error("Failed to send no show email:", e);
    }
  }

  return result;
}
///resceduleAppointmentAction

export async function rescheduleAppointmentAction(
  appointmentId: string,
  newDate: string,
  newTime: string
) {
  try {
    if (!appointmentId || !newDate || !newTime) {
      return { success: false, error: "Missing required fields" };
    }

    const currentAppt = await getAppointmentById(appointmentId);
    if (!currentAppt.success || !currentAppt.data) {
      return { success: false, error: currentAppt.error || "Appointment not found" };
    }

    const oldDate = (currentAppt.data as any).date;
    const oldTime = (currentAppt.data as any).time;
    const patientId = (currentAppt.data as any).patientId;
    const dentistId = (currentAppt.data as any).dentistId;
    const serviceName = String((currentAppt.data as any).serviceType || "Dental Service");

    const res = await rescheduleAppointment(appointmentId, newDate, newTime);
    if (!res.success) return { success: false, error: res.error || "Failed to reschedule" };

    const patientProfileRes = patientId ? await getUserProfile(patientId) : null;
    const dentistProfileRes = dentistId ? await getUserProfile(dentistId) : null;

    const apptPatientEmail = String((currentAppt.data as any)?.patientEmail || "");
    const apptPatientName = String((currentAppt.data as any)?.patientName || "");

    const patientEmail =
      patientProfileRes?.success && patientProfileRes.data?.email
        ? patientProfileRes.data.email
        : apptPatientEmail;
    const patientName =
      patientProfileRes?.success && patientProfileRes.data
        ? patientProfileRes.data.displayName || patientProfileRes.data.email || apptPatientName || "Patient"
        : apptPatientName || "Patient";

    const patient =
      patientEmail
        ? {
            name: patientName,
            email: patientEmail,
          }
        : undefined;

    const dentist =
      dentistProfileRes?.success && dentistProfileRes.data?.email
        ? {
            name:
              dentistProfileRes.data.displayName ||
              dentistProfileRes.data.email ||
              "Dentist",
            email: dentistProfileRes.data.email,
          }
        : undefined;

    const emailResult = await sendRescheduleEmailsAction({
      appointmentId,
      serviceName,
      newDate,
      newTime,
      previousDate: oldDate,
      previousTime: oldTime,
      patient,
      dentist,
    });

    return { success: true, emailResult };
  } catch (e: any) {
    console.error("rescheduleAppointmentAction error:", e);
    return { success: false, error: e?.message || "Failed to reschedule" };
  }
}



// Staff Action: Record Payment
export async function recordPaymentAction(
  appointmentId: string,
  method: string,
  amount?: number,
  itemIds: string[] = []
) {
  const { auth } = await import("@/lib/firebase/firebase");
  if (!auth.currentUser) return { success: false, error: "Not authenticated" };

  const profile = await getUserProfile(auth.currentUser.uid);
  if (!profile.success || !profile.data || profile.data.role === "client") {
    return { success: false, error: "Unauthorized" };
  }

  // Validate method
  const parsed = paymentSchema.safeParse({ method });
  if (!parsed.success)
    return { success: false, error: "Invalid payment method" };

  // For backward compatibility, if amount is not provided, we fetch the bill to pay in full.
  let paymentAmount = amount;
  if (!paymentAmount) {
    const { getBillingDetails } = await import(
      "@/lib/services/billing-service"
    );
    const bill = await getBillingDetails(appointmentId);
    if (bill.success && bill.data) {
      paymentAmount = bill.data.remainingBalance;
    } else {
      return { success: false, error: "Could not determine payment amount" };
    }
  }

  if (paymentAmount <= 0) return { success: true }; // Nothing to pay

  return await processPayment(
    appointmentId,
    paymentAmount,
    method,
    auth.currentUser.uid
  );
}


export async function getAppointmentsInRange({
  fromISO,
  toISO,
}: GetAppointmentsInRangeInput) {
  const fromStr = fromISO.slice(0, 10); // YYYY-MM-DD
  const toStr = toISO.slice(0, 10);     // YYYY-MM-DD

  const q = query(
    collection(db, "appointments"),
    where("date", ">=", fromStr),
    where("date", "<=", toStr)
  );

  const snap = await getDocs(q);

  const rows = snap.docs.map((doc) => {
    const data: any = doc.data();

    const dateStr = typeof data.date === "string" ? data.date : null;
    const timeStr = typeof data.time === "string" ? data.time : "00:00";

    // If date is missing, avoid crash and still return a row
    const startAtDate = dateStr
      ? new Date(`${dateStr}T${timeStr}:00`)
      : null;

    const proceduresCount = Array.isArray(data?.treatment?.procedures)
      ? data.treatment.procedures.length
      : 0;

    return {
      id: doc.id,
      startAt: startAtDate && !Number.isNaN(startAtDate.getTime())
        ? startAtDate.toISOString()
        : new Date().toISOString(), // fallback
      status: data.status ?? "unknown",
      paymentStatus: data.paymentStatus ?? "unknown",
      dentistId: data.dentistId ?? null,
      proceduresCount,
    };
  });

  return { rows };
}
