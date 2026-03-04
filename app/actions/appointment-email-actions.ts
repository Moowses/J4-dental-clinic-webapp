"use server";

import { sendAppointmentEmail, sendCancellationEmail, sendNoShowEmail } from "@/lib/services/email-service";

export async function sendAppointmentConfirmationEmailAction(input: {
  appointmentId: string;
  date: string;
  time: string;
  serviceName: string;
  patientName: string;
  patientEmail: string;
}) {
  const { appointmentId, date, time, serviceName, patientName, patientEmail } = input;
  if (!appointmentId || !date || !time || !patientEmail) {
    return { success: false, error: "Missing required fields" };
  }

  console.log("[booking-email] start", { appointmentId, patientEmail });
  const res = await sendAppointmentEmail({
    id: appointmentId,
    date,
    time,
    serviceName,
    patientName,
    patientEmail,
    subjectOverride: `Appointment Confirmation - ${date}`,
  });
  console.log("[booking-email] done", res?.success ? "ok" : res?.error);
  return res;
}

export async function sendAppointmentRequestEmailAction(input: {
  appointmentId: string;
  date: string;
  time: string;
  serviceName: string;
  patientName: string;
  patientEmail: string;
}) {
  const { appointmentId, date, time, serviceName, patientName, patientEmail } = input;
  if (!appointmentId || !date || !time || !patientEmail) {
    return { success: false, error: "Missing required fields" };
  }

  console.log("[booking-request-email] start", { appointmentId, patientEmail });
  const res = await sendAppointmentEmail({
    id: appointmentId,
    date,
    time,
    serviceName,
    patientName,
    patientEmail,
    isPendingApproval: true,
    subjectOverride: `Appointment Request Received - ${date}`,
  });
  console.log("[booking-request-email] done", res?.success ? "ok" : res?.error);
  return res;
}

export async function sendRescheduleEmailsAction(input: {
  appointmentId: string;
  serviceName: string;
  newDate: string;
  newTime: string;
  previousDate?: string;
  previousTime?: string;
  patient?: { name: string; email: string };
  dentist?: { name: string; email: string };
}) {
  const {
    appointmentId,
    serviceName,
    newDate,
    newTime,
    previousDate,
    previousTime,
    patient,
    dentist,
  } = input;

  if (!appointmentId || !newDate || !newTime) {
    return { success: false, error: "Missing required fields" };
  }

  console.log("[reschedule-email] start", {
    appointmentId,
    newDate,
    newTime,
    patientEmail: patient?.email || null,
    dentistEmail: dentist?.email || null,
  });

  const results: Array<{ who: string; success: boolean; error?: unknown }> = [];

  if (patient?.email) {
    const res = await sendAppointmentEmail({
      id: appointmentId,
      date: newDate,
      time: newTime,
      serviceName,
      patientName: patient.name,
      patientEmail: patient.email,
      isRescheduled: true,
      previousDate,
      previousTime,
      patientLabel: serviceName,
      subjectOverride: `Appointment Rescheduled - ${newDate}`,
    });
    results.push({ who: "patient", success: !!res?.success, error: res?.error });
  } else {
    results.push({ who: "patient", success: false, error: "Missing patient email" });
  }

  if (dentist?.email) {
    const res = await sendAppointmentEmail({
      id: appointmentId,
      date: newDate,
      time: newTime,
      serviceName,
      patientName: dentist.name,
      patientEmail: dentist.email,
      recipientEmail: dentist.email,
      recipientName: dentist.name,
      isRescheduled: true,
      previousDate,
      previousTime,
      patientLabel: serviceName,
      subjectOverride: `Appointment Rescheduled - ${newDate}`,
    });
    results.push({ who: "dentist", success: !!res?.success, error: res?.error });
  } else {
    results.push({ who: "dentist", success: false, error: "Missing dentist email" });
  }

  console.log("[reschedule-email] done", results);
  return { success: true, results };
}

export async function sendNoShowEmailAction(input: {
  appointmentId: string;
  date: string;
  time: string;
  serviceName: string;
  patientName: string;
  patientEmail: string;
}) {
  const { appointmentId, date, time, serviceName, patientName, patientEmail } = input;
  if (!appointmentId || !date || !time || !patientEmail) {
    return { success: false, error: "Missing required fields" };
  }

  console.log("[no-show-email] start", { appointmentId, patientEmail });
  const res = await sendNoShowEmail({
    id: appointmentId,
    date,
    time,
    serviceName,
    patientName,
    patientEmail,
  });
  console.log("[no-show-email] done", res?.success ? "ok" : res?.error);
  return res;
}

export async function sendCancellationEmailAction(input: {
  appointmentId: string;
  date: string;
  time: string;
  serviceName: string;
  patientName: string;
  patientEmail: string;
}) {
  const { appointmentId, date, time, serviceName, patientName, patientEmail } = input;
  if (!appointmentId || !date || !time || !patientEmail) {
    return { success: false, error: "Missing required fields" };
  }

  console.log("[cancel-email] start", { appointmentId, patientEmail });
  const res = await sendCancellationEmail({
    id: appointmentId,
    date,
    time,
    serviceName,
    patientName,
    patientEmail,
  });
  console.log("[cancel-email] done", res?.success ? "ok" : res?.error);
  return res;
}
