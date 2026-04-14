import { db } from "../firebase/firebase";
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  getDocs,
  getDoc, 
  serverTimestamp, 
  orderBy,
  doc,
  updateDoc,
  Timestamp
} from "firebase/firestore";
import { Appointment, AppointmentStatus, TreatmentRecord, PaymentMethod } from "../types/appointment";
import { ClinicOffDay } from "../types/calendar";
import { bookingSchema } from "../validations/appointment";
import { z } from "zod";

const APPOINTMENTS_COLLECTION = "appointments";
const OFF_DAYS_COLLECTION = "clinic_off_days";

function omitUndefined<T extends Record<string, any>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined)
  ) as T;
}

function cleanDentalChart(
  chart?: Record<string, { status?: string; notes?: string; updatedAt?: number; updatedBy?: string }>
) {
  if (!chart) return undefined;
  const cleaned: Record<string, any> = {};
  Object.entries(chart).forEach(([tooth, entry]) => {
    if (!entry) return;
    const cleanedEntry = omitUndefined(entry as any);
    if (Object.keys(cleanedEntry).length > 0) {
      cleaned[tooth] = cleanedEntry;
    }
  });
  return Object.keys(cleaned).length ? cleaned : undefined;
}

export async function recordPayment(appointmentId: string, method: PaymentMethod) {
  try {
    const docRef = doc(db, APPOINTMENTS_COLLECTION, appointmentId);
    await updateDoc(docRef, {
      paymentStatus: "paid",
      paymentMethod: method,
      paymentDate: serverTimestamp()
    });
    return { success: true };
  } catch (error) {
    console.error("Error recording payment:", error);
    return { success: false, error: "Failed to record payment" };
  }
}

export async function createAppointment(uid: string, data: z.infer<typeof bookingSchema>) {
  try {
    const docRef = await addDoc(collection(db, APPOINTMENTS_COLLECTION), {
      patientId: uid,
      serviceType: data.serviceType,
      date: data.date,
      time: data.time,
      notes: data.notes || "",
      status: "pending",
      paymentStatus: "unpaid", // Default
      createdAt: serverTimestamp(),
    });

    return { success: true, id: docRef.id };
  } catch (error) {
    console.error("Error creating appointment:", error);
    return { success: false, error: "Failed to book appointment" };
  }
}

export async function getAppointmentById(appointmentId: string) {
  try {
    const docRef = doc(db, APPOINTMENTS_COLLECTION, appointmentId);
    const snap = await getDoc(docRef);
    
    if (!snap.exists()) {
      return { success: false, error: "Appointment not found" };
    }

    return { 
      success: true, 
      data: { id: snap.id, ...snap.data() } as Appointment 
    };
  } catch (error) {
    console.error("Error fetching appointment:", error);
    return { success: false, error: "Failed to fetch appointment" };
  }
}

export async function updateAppointmentStatus(appointmentId: string, status: AppointmentStatus) {
  try {
    const docRef = doc(db, APPOINTMENTS_COLLECTION, appointmentId);
    await updateDoc(docRef, { status });
    return { success: true };
  } catch (error) {
    console.error("Error updating appointment status:", error);
    return { success: false, error: "Failed to update status" };
  }
}

import { getClinicSettings } from "./clinic-service";

export async function getTakenSlots(date: string) {
  try {
    // 1. Get Clinic Capacity
    const settingsRes = await getClinicSettings();
    const capacity = settingsRes.data?.maxConcurrentPatients || 1;

    // 2. Fetch all active appointments for the day
    const q = query(
      collection(db, APPOINTMENTS_COLLECTION),
      where("date", "==", date),
      where("status", "in", ["pending", "confirmed"])
    );
    
    const snap = await getDocs(q);
    const appointments = snap.docs.map(doc => (doc.data() as Appointment));
    
    // 3. Count slots
    const slotCounts: Record<string, number> = {};
    appointments.forEach(app => {
      slotCounts[app.time] = (slotCounts[app.time] || 0) + 1;
    });

    // 4. Return ONLY times that are full
    const takenTimes = Object.entries(slotCounts)
      .filter(([_, count]) => count >= capacity)
      .map(([time]) => time);
    
    return { success: true, data: takenTimes };
  } catch (error) {
    console.error("Error fetching taken slots:", error);
    return { success: false, error: "Failed to check availability" };
  }
}

export async function getClinicOffDays(startDate: string, endDate: string) {
  try {
    const q = query(
      collection(db, OFF_DAYS_COLLECTION),
      where("date", ">=", startDate),
      where("date", "<=", endDate)
    );
    
    const snap = await getDocs(q);
    const days = snap.docs.map(doc => doc.data() as ClinicOffDay);
    
    return { success: true, data: days };
  } catch (error) {
    console.error("Error fetching off days:", error);
    return { success: false, error: "Failed to fetch calendar info" };
  }
}

export async function getUserAppointments(uid: string) {
  try {
    const q = query(
      collection(db, APPOINTMENTS_COLLECTION),
      where("patientId", "==", uid),
      orderBy("date", "desc"),
      orderBy("time", "desc")
    );
    
    const snap = await getDocs(q);
    const appointments = snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as Appointment[];
    
    return { success: true, data: appointments };
  } catch (error) {
    console.error("Error fetching user appointments:", error);
    return { success: false, error: "Failed to load history" };
  }
}

export async function getAllAppointments(date?: string) {
  try {
    let q;
    if (date) {
      q = query(
        collection(db, APPOINTMENTS_COLLECTION),
        where("date", "==", date),
        orderBy("time", "asc")
      );
    } else {
      q = query(
        collection(db, APPOINTMENTS_COLLECTION),
        orderBy("date", "desc"),
        orderBy("time", "desc")
      );
    }
    
    const snap = await getDocs(q);
    const appointments = snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as Appointment[];
    
    return { success: true, data: appointments };
  } catch (error) {
    console.error("Error fetching all appointments:", error);
    return { success: false, error: "Failed to load clinic schedule" };
  }
}

export async function assignDentist(appointmentId: string, dentistId: string) {
  try {
    const docRef = doc(db, APPOINTMENTS_COLLECTION, appointmentId);
    await updateDoc(docRef, { dentistId });
    return { success: true };
  } catch (error) {
    console.error("Error assigning dentist:", error);
    return { success: false, error: "Failed to assign dentist" };
  }
}

export async function getDentistAppointments(dentistId: string, date?: string) {
  try {
    let q;
    if (date) {
      q = query(
        collection(db, APPOINTMENTS_COLLECTION),
        where("dentistId", "==", dentistId),
        where("date", "==", date),
        orderBy("time", "asc")
      );
    } else {
      q = query(
        collection(db, APPOINTMENTS_COLLECTION),
        where("dentistId", "==", dentistId),
        orderBy("date", "desc"),
        orderBy("time", "asc")
      );
    }
    
    const snap = await getDocs(q);
    const appointments = snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as Appointment[];
    
    return { success: true, data: appointments };
  } catch (error) {
    console.error("Error fetching dentist schedule:", error);
    return { success: false, error: "Failed to load schedule" };
  }
}

import { adjustStock } from "./inventory-service";

export async function saveTreatmentRecord(appointmentId: string, data: Omit<TreatmentRecord, 'completedAt' | 'totalBill'>) {
  try {
    const docRef = doc(db, APPOINTMENTS_COLLECTION, appointmentId);
    
    // Calculate total bill
    const totalBill = data.procedures.reduce((sum, p) => sum + p.price, 0);
    const cleanedDentalChart = cleanDentalChart(data.dentalChart);

    const treatment: TreatmentRecord = {
      ...data,
      dentalChart: cleanedDentalChart,
      totalBill,
      completedAt: serverTimestamp() as unknown as Timestamp,
    };
    const cleanedTreatment = omitUndefined(treatment as any);

    // Decrement inventory stock
    if (data.inventoryUsed && data.inventoryUsed.length > 0) {
      await Promise.all(data.inventoryUsed.map(item => 
        adjustStock(item.id, -item.quantity)
      ));
    }

    await updateDoc(docRef, {
      status: "completed",
      treatment: cleanedTreatment
    });

    return { success: true };
  } catch (error) {
    console.error("Error saving treatment record:", error);
    return { success: false, error: "Failed to save clinical record" };
  }
}


export async function rescheduleAppointment(
  appointmentId: string,
  newDate: string,
  newTime: string,
  meta?: { reason?: string }
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!appointmentId || !newDate || !newTime) {
      return { success: false, error: "Missing required fields" };
    }

    const apptRef = doc(db, APPOINTMENTS_COLLECTION, appointmentId);
    const snap = await getDoc(apptRef);

    if (!snap.exists()) {
      return { success: false, error: "Appointment not found" };
    }

    const appt = snap.data() as Appointment;
    const status = String(appt.status || "pending").toLowerCase();
    const rescheduleCount = Number(appt.rescheduleCount || 0);

    // ❌ cannot reschedule cancelled/completed
    if (status === "cancelled" || status === "completed") {
      return { success: false, error: "Cannot reschedule cancelled/completed appointments" };
    }

    if (rescheduleCount >= 1) {
      return { success: false, error: "This appointment has already been rescheduled once." };
    }

    // No-op if same date/time
    if (appt.date === newDate && appt.time === newTime) {
      return { success: true };
    }

    // 1) Check global clinic schedule (operatingHours)
    const settingsRes = await getClinicSettings();
    const dayName = new Date(`${newDate}T00:00:00`).toLocaleDateString("en-US", {
      weekday: "long",
    }).toLowerCase();

    const operatingHours = settingsRes.data?.operatingHours as any;
    const schedule = operatingHours?.[dayName];

    if (schedule && schedule.isOpen === false) {
      return { success: false, error: "Clinic is closed on this date" };
    }

    // 2) Check manual off-days / holidays
    const offDaysRes = await getClinicOffDays(newDate, newDate);
    const isHoliday = !!(offDaysRes.success && offDaysRes.data && offDaysRes.data.length > 0);
    if (isHoliday) {
      const reason = (offDaysRes.data?.[0] as any)?.reason;
      return { success: false, error: reason ? `Clinic closed: ${reason}` : "Clinic is closed" };
    }

    // 3) Capacity check (conflict prevention)
    const takenRes = await getTakenSlots(newDate);
    const taken = (takenRes.success ? takenRes.data : []) || [];

    // If the new slot is full -> block
    if (taken.includes(newTime)) {
      return { success: false, error: "Selected time slot is not available" };
    }

    // ✅ Reschedule (keep dentistId as-is)
    // Set status back to pending so staff can confirm again
    const updates: Record<string, unknown> = {
      date: newDate,
      time: newTime,
      status: "pending",
      rescheduleCount: rescheduleCount + 1,
      rescheduledAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (meta?.reason) {
      updates.rescheduleReason = String(meta.reason).trim();
    }
    await updateDoc(apptRef, updates);

    return { success: true };
  } catch (error) {
    console.error("Error rescheduling appointment:", error);
    return { success: false, error: "Failed to reschedule appointment" };
  }
}
