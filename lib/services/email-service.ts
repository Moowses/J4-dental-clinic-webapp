"use server";

import { Resend } from 'resend';
import { AppointmentConfirmationEmail } from '@/lib/email/templates/AppointmentConfirmation';
import { NoShowNotificationEmail } from '@/lib/email/templates/NoShowNotification';
import { render } from '@react-email/render';
import { createEvent, EventAttributes } from 'ics';

interface EmailAppointmentDetails {
  id: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  serviceName: string;
  patientName: string;
  patientEmail: string;
  recipientName?: string;
  recipientEmail?: string;
  isRescheduled?: boolean;
  previousDate?: string;
  previousTime?: string;
  patientLabel?: string;
  subjectOverride?: string;
}

interface NoShowEmailDetails {
  id: string;
  date: string;
  time: string;
  serviceName: string;
  patientName: string;
  patientEmail: string;
}

export async function sendAppointmentEmail(details: EmailAppointmentDetails, apiKey?: string) {
  const finalApiKey = apiKey || process.env.RESEND_API_KEY;
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const recipientEmail = details.recipientEmail || details.patientEmail;
  const recipientName = details.recipientName || details.patientName;

  if (!finalApiKey) {
    console.warn("RESEND_API_KEY is missing. Email sending skipped.");
    return { success: false, error: "API Key missing" };
  }

  const resend = new Resend(finalApiKey);

  // 1. Generate ICS Calendar File
  const [year, month, day] = details.date.split('-').map(Number);
  const [hour, minute] = details.time.split(':').map(Number);
  const duration = 60;

  const event: EventAttributes = {
    start: [year, month, day, hour, minute],
    duration: { minutes: duration },
    title: `Dental Appointment: ${details.serviceName}`,
    description: `Appointment for ${details.patientName}. Reference ID: ${details.id}`,
    location: 'Dental Clinic, 123 Dental Street',
    url: `${APP_URL}/appointment/confirm/${details.id}`,
    status: 'CONFIRMED',
    busyStatus: 'BUSY',
    organizer: { name: 'Dental Clinic', email: 'no-reply@dentalclinic.com' },
    attendees: [
      { name: recipientName, email: recipientEmail, rsvp: true }
    ]
  };

  const icsFilePromise = new Promise<string>((resolve, reject) => {
    createEvent(event, (error, value) => {
      if (error) reject(error);
      else resolve(value);
    });
  });

  try {
    const icsContent = await icsFilePromise;
    const confirmUrl = `${APP_URL}/appointment/confirm/${details.id}`;

    // 2. Render Email HTML
    const emailHtml = await render(
      AppointmentConfirmationEmail({
        patientName: recipientName,
        date: details.date,
        time: details.time,
        serviceName: details.serviceName,
        appointmentId: details.id,
        confirmUrl: confirmUrl,
        isRescheduled: details.isRescheduled,
        previousDate: details.previousDate,
        previousTime: details.previousTime,
        patientLabel: details.patientLabel,
      })
    );

    // 3. Send Email
    const response = await resend.emails.send({
      from: 'Dental Clinic <no-reply@j4dentalclinic.karlmosses.com>',
      to: [recipientEmail],
      subject: details.subjectOverride || `Appointment Confirmation - ${details.date}`,
      html: emailHtml,
      attachments: [
        {
          filename: 'appointment.ics',
          content: Buffer.from(icsContent).toString('base64'),
          contentType: 'text/calendar',
        },
      ],
    });

    if (response.error) {
      console.error("Resend Error:", response.error);
      return { success: false, error: response.error };
    }

    return { success: true, id: response.data?.id };
  } catch (error) {
    console.error('Failed to send email:', error);
    return { success: false, error };
  }
}

export async function sendNoShowEmail(details: NoShowEmailDetails, apiKey?: string) {
  const finalApiKey = apiKey || process.env.RESEND_API_KEY;
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  if (!finalApiKey) {
    console.warn("RESEND_API_KEY is missing. Email sending skipped.");
    return { success: false, error: "API Key missing" };
  }

  const resend = new Resend(finalApiKey);
  const patientDashboardUrl = `${APP_URL}/client-dashboard`;

  try {
    const emailHtml = await render(
      NoShowNotificationEmail({
        patientName: details.patientName,
        date: details.date,
        time: details.time,
        serviceName: details.serviceName,
        appointmentId: details.id,
        patientDashboardUrl,
      })
    );

    const response = await resend.emails.send({
      from: "Dental Clinic <no-reply@j4dentalclinic.karlmosses.com>",
      to: [details.patientEmail],
      subject: `Missed Appointment - Please Rebook (${details.date})`,
      html: emailHtml,
    });

    if (response.error) {
      console.error("Resend Error:", response.error);
      return { success: false, error: response.error };
    }

    return { success: true, id: response.data?.id };
  } catch (error) {
    console.error("Failed to send no show email:", error);
    return { success: false, error };
  }
}
