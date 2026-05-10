import { z } from "zod";

export const bookingSchema = z.object({
  serviceType: z.string().min(1, "Please select a service"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)"),
  time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Invalid time format (HH:mm)"),
  notes: z.string().optional(),
  
  // Conditional Profile Update Fields
  displayName: z.string().optional(),
  phoneNumber: z.string().optional(), 
});

export const paymentSchema = z.object({
  method: z.enum(["cash", "card", "insurance", "other"]),
  notes: z.string().optional(),
});

// Helper to validate business rules (can be used in the Action)
export function validateAppointmentDate(dateStr: string) {
  const inputDate = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(inputDate.getTime())) {
    return "Invalid appointment date.";
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const minDate = new Date(today);
  minDate.setDate(minDate.getDate() + 1);

  if (inputDate < minDate) {
    return "Appointments must be booked at least 1 day in advance.";
  }

  // Extend max booking window to 3 months (approx 90 days)
  const maxDate = new Date(today);
  maxDate.setDate(maxDate.getDate() + 90);

  if (inputDate > maxDate) {
    return "Appointments cannot be booked more than 3 months in advance.";
  }
  return null; // Valid
}

export function validateAppointmentTime(timeStr: string) {
  // We only check format here. Business hours are checked against Clinic Settings in the DB.
  const [hours, minutes] = timeStr.split(":").map(Number);
  
  if (isNaN(hours) || isNaN(minutes)) {
    return "Invalid time format.";
  }
  return null; // Valid
}
