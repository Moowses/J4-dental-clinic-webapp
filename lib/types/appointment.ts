import { Timestamp } from "firebase/firestore";

export type AppointmentStatus =
  | "pending"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "no_show";

export interface TreatmentProcedure {
  id: string; // Original ID (if from catalog) or random (if custom)
  name: string; 
  price: number;
  toothNumber?: string; // Optional: e.g. "14", "UL", "All"
}

export interface TreatmentRecord {
  notes: string;
  procedures: TreatmentProcedure[];
  inventoryUsed: { id: string; name: string; quantity: number }[];
  totalBill: number;
  completedAt: Timestamp;
  imageUrls?: string[];
  dentalChart?: Record<
    string,
    {
      status?: string;
      notes?: string;
      updatedAt?: number;
      updatedBy?: string;
    }
  >;
}

export type PaymentStatus = "unpaid" | "paid" | "refunded";
export type PaymentMethod = "cash" | "card" | "insurance" | "other";

export interface Appointment {
  id: string; // Firestore Document ID
  patientId: string; // User UID
  dentistId?: string; // Optional (assigned later or selected)
  serviceType: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  status: AppointmentStatus;
  notes?: string;
  treatment?: TreatmentRecord; // Added for clinical records
  
  // Billing Fields
  paymentStatus: PaymentStatus;
  paymentMethod?: PaymentMethod;
  paymentDate?: Timestamp;
  rescheduleCount?: number;
  rescheduledAt?: Timestamp;
  rescheduleReason?: string;
  
  createdAt: Timestamp;
}
