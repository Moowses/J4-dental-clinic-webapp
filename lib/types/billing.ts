import { Timestamp } from "firebase/firestore";
import { BillingRecordData } from "../validations/billing";

// The Firestore representation (Types converted to Timestamps where applicable)
export interface BillingTransaction {
  id: string;
  amount: number;
  method: "cash" | "card" | "insurance" | "bank_transfer" | "other";
  date: Timestamp;
  note?: string;
  recordedBy?: string;
}

export interface BillingInstallment {
  id: string;
  dueDate: string; // YYYY-MM-DD
  amount: number;
  status: "pending" | "paid" | "overdue" | "cancelled";
  paidAt?: Timestamp;
  description?: string;
}

export interface BillingItem {
  id: string;
  name: string;
  price: number;
  toothNumber?: string;
  status: "unpaid" | "plan" | "paid";
}

export interface BillingRecord {
  id: string; // Matches Appointment ID
  appointmentId: string;
  patientId: string;
  
  totalAmount: number;
  remainingBalance: number;
  status: "unpaid" | "partial" | "paid" | "overdue" | "refunded";
  
  items: BillingItem[];

  paymentPlan: {
    type: "full" | "installments";
    installments: BillingInstallment[];
  };

  transactions: BillingTransaction[];
  
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
