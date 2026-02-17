import { db } from "../firebase/firebase";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  Timestamp,
  collection,
  query,
  where,
  getDocs,
} from "firebase/firestore";

import {
  BillingRecord,
  BillingInstallment,
  BillingItem,
} from "../types/billing";

const BILLING_COLLECTION = "billing_records";
const APPOINTMENTS_COLLECTION = "appointments";

/**
 * Items that do NOT count toward remaining balance:
 * - paid / void / waived
 * Everything else counts (unpaid + plan + pending, etc.)
 */
function isExcludedFromBalance(status: any) {
  const s = String(status || "").toLowerCase();
  return s === "paid" || s === "void" || s === "waived";
}

function computeFromItems(
  items: BillingItem[],
  fallbackTotal = 0
): { totalAmount: number; remainingBalance: number; status: BillingRecord["status"] } {
  const hasItems = Array.isArray(items) && items.length > 0;

  const totalAmount = hasItems
    ? items.reduce((sum, it: any) => sum + Number(it?.price || 0), 0)
    : Number(fallbackTotal || 0);

  const remainingBalance = hasItems
    ? items
        .filter((it: any) => !isExcludedFromBalance(it?.status))
        .reduce((sum, it: any) => sum + Number(it?.price || 0), 0)
    : Number(fallbackTotal || 0);

  const status =
    remainingBalance <= 0
      ? "paid"
      : remainingBalance < totalAmount
        ? "partial"
        : "unpaid";

  return { totalAmount, remainingBalance, status };
}

export async function createBillingRecord(
  appointmentId: string,
  patientId: string,
  totalAmount: number,
  items: BillingItem[] = []
) {
  try {
    const id = appointmentId; // force 1-to-1 mapping
    const docRef = doc(db, BILLING_COLLECTION, id);

    // Check if exists to avoid overwrite
    const snap = await getDoc(docRef);
    if (snap.exists()) return { success: false, error: "Billing record already exists" };

    // ✅ compute totals from items if items are provided
    const computed = computeFromItems(items, totalAmount);

    const newRecord = {
      id,
      appointmentId,
      patientId,
      totalAmount: computed.totalAmount,
      remainingBalance: computed.remainingBalance,
      status: computed.status,
      items, // Save itemized list
      paymentPlan: { type: "full", installments: [] },
      transactions: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await setDoc(docRef, newRecord);
    return { success: true, id };
  } catch (error) {
    console.error("Error creating billing record:", error);
    return { success: false, error: "Failed to create billing record" };
  }
}

export async function getBillingDetails(appointmentId: string) {
  try {
    const docRef = doc(db, BILLING_COLLECTION, appointmentId);
    const snap = await getDoc(docRef);

    if (snap.exists()) {
      return { success: true, data: snap.data() as BillingRecord };
    }

    // --- SHIM / FALLBACK ---
    // If no billing record exists, check the appointment.
    // If appointment is completed with a totalBill, generate a virtual record.
    const appRef = doc(db, APPOINTMENTS_COLLECTION, appointmentId);
    const appSnap = await getDoc(appRef);

    if (appSnap.exists()) {
      const appData: any = appSnap.data();

      if (appData.treatment?.totalBill !== undefined) {
        const itemsFromAppointment: BillingItem[] = Array.isArray(appData.treatment?.items)
          ? appData.treatment.items
          : [];

        // ✅ compute totals from items if available, else fallback to totalBill/paymentStatus
        const computed: { totalAmount: number; remainingBalance: number; status: BillingRecord["status"] } =
          itemsFromAppointment.length
            ? computeFromItems(itemsFromAppointment, Number(appData.treatment.totalBill || 0))
            : {
                totalAmount: Number(appData.treatment.totalBill || 0),
                remainingBalance: appData.paymentStatus === "paid" ? 0 : Number(appData.treatment.totalBill || 0),
                status: appData.paymentStatus === "paid" ? "paid" : "unpaid",
              };

        const virtualRecord: BillingRecord = {
          id: appointmentId,
          appointmentId,
          patientId: appData.patientId,
          totalAmount: computed.totalAmount,
          remainingBalance: computed.remainingBalance,
          status: computed.status,

          // ✅ required field in BillingRecord
          items: itemsFromAppointment,

          paymentPlan: { type: "full", installments: [] },
          transactions: [],
          createdAt: appData.createdAt,
          updatedAt: appData.createdAt,
        };

        return { success: true, data: virtualRecord, isVirtual: true };
      }
    }

    return { success: false, error: "No billing information found" };
  } catch (error) {
    console.error("Error fetching billing:", error);
    return { success: false, error: "Failed to fetch billing" };
  }
}

export async function processPayment(
  appointmentId: string,
  amount: number,
  method: string,
  staffId?: string,
  itemIds: string[] = []
) {
  try {
    const docRef = doc(db, BILLING_COLLECTION, appointmentId);
    const snap = await getDoc(docRef);

    if (!snap.exists()) {
      return { success: false, error: "Billing record not found. Finalize treatment first." };
    }

    const current = snap.data() as BillingRecord;

    if (!Number.isFinite(amount) || amount <= 0) {
      return { success: false, error: "Invalid amount" };
    }
    const normalizedAmount = Number(Number(amount).toFixed(2));
    const currentRemaining = Math.max(0, Number(current.remainingBalance || 0));
    if (currentRemaining <= 0) {
      return { success: false, error: "This billing record is already fully paid." };
    }
    if (normalizedAmount > currentRemaining + 0.01) {
      return {
        success: false,
        error: `Amount exceeds remaining balance (${currentRemaining.toFixed(2)}).`,
      };
    }

    const hasItems = Array.isArray(current.items) && current.items.length > 0;

    const isExcluded = (status: any) => {
      const s = String(status || "").toLowerCase();
      return s === "paid" || s === "void" || s === "waived";
    };

    const settleInstallments = (plan: any, methodUsed?: string, staff?: string) => {
      if (!plan || !Array.isArray(plan.installments)) return plan;
      return {
        ...plan,
        type: "full",
        installments: plan.installments.map((inst: any) => {
          const st = String(inst?.status || "").toLowerCase();
          if (st === "paid") return inst;
          return {
            ...inst,
            status: "paid",
            paidAt: Timestamp.now(),
            paidBy: staff || "system",
            paidMethod: methodUsed || inst?.paidMethod,
          };
        }),
      };
    };

    // --- ITEM-BASED PAYMENT MODE ---
    if (hasItems && Array.isArray(itemIds) && itemIds.length > 0) {
      // 1) Only allow paying items that are not excluded
      const payableTargets = current.items.filter((it: any) => itemIds.includes(it.id));
      if (payableTargets.length === 0) {
        return { success: false, error: "Selected items not found" };
      }

      const alreadyExcluded = payableTargets.every((it: any) => isExcluded(it.status));
      if (alreadyExcluded) {
        return { success: false, error: "Selected items are already settled" };
      }
      const selectedRemaining = payableTargets
        .filter((it: any) => !isExcluded(it.status))
        .reduce((sum: number, it: any) => sum + Number(it?.price || 0), 0);
      if (!Number.isFinite(selectedRemaining) || selectedRemaining <= 0) {
        return { success: false, error: "Selected items have no payable balance." };
      }
      if (normalizedAmount > selectedRemaining + 0.01) {
        return {
          success: false,
          error: `Amount exceeds selected items balance (${selectedRemaining.toFixed(2)}).`,
        };
      }
      // Item-mode marks selected items fully paid, so amount must match selected payable total.
      if (Math.abs(normalizedAmount - selectedRemaining) > 0.01) {
        return {
          success: false,
          error: `Amount must match selected items balance (${selectedRemaining.toFixed(2)}).`,
        };
      }

      // 2) Mark selected items as paid
      const updatedItems = current.items.map((it: any) => {
        if (itemIds.includes(it.id) && !isExcluded(it.status)) {
          return { ...it, status: "paid" };
        }
        return it;
      });

      // 3) Recompute totals from items
      const totalAmount = updatedItems.reduce((sum: number, it: any) => sum + Number(it.price || 0), 0);

      const remainingBalance = updatedItems
        .filter((it: any) => !isExcluded(it.status))
        .reduce((sum: number, it: any) => sum + Number(it.price || 0), 0);

      const status =
        remainingBalance <= 0
          ? "paid"
          : remainingBalance < totalAmount
            ? "partial"
            : "unpaid";

      // 4) Add transaction (store itemIds for audit trail)
      const hasPlan =
        Array.isArray(current?.paymentPlan?.installments) && current.paymentPlan.installments.length > 0;
      const transaction: any = {
        // NOTE: crypto.randomUUID() fails on non-secure origins (e.g. http://<public-ip>)
        // while http://localhost is treated as secure. Use a Firestore-style auto id instead.
        id: doc(collection(db, "_ids")).id,
        amount: normalizedAmount,
        method,
        date: Timestamp.now(),
        recordedBy: staffId || "system",
        mode: status === "paid" && hasPlan ? "installment_full" : "amount",
      };

      const paymentPlan =
        status === "paid"
          ? settleInstallments(current.paymentPlan || {}, method, staffId)
          : current.paymentPlan || undefined;

      const updatePayload: any = {
        items: updatedItems,
        totalAmount,
        remainingBalance,
        status,
        transactions: [...(current.transactions || []), transaction],
        updatedAt: serverTimestamp(),
      };

      if (paymentPlan) updatePayload.paymentPlan = paymentPlan;

      await updateDoc(docRef, updatePayload);

      // 5) Keep appointment in sync
      const appRef = doc(db, APPOINTMENTS_COLLECTION, appointmentId);
      await updateDoc(appRef, {
        paymentStatus: status,
        paymentMethod: method,
        paymentDate: serverTimestamp(),
      });

      return { success: true };
    }

    // --- LEGACY AMOUNT-BASED MODE (no itemIds) ---
    // This keeps old flows working even if items are missing.
    const newBalance = Math.max(0, Number(current.remainingBalance || 0) - normalizedAmount);
    const totalAmount = Number(current.totalAmount || 0);

    const status =
      newBalance <= 0
        ? "paid"
        : newBalance < totalAmount
          ? "partial"
          : "unpaid";

    const hasPlan =
      Array.isArray(current?.paymentPlan?.installments) && current.paymentPlan.installments.length > 0;
    const transaction: any = {
      id: crypto.randomUUID(),
      amount: normalizedAmount,
      method,
      date: Timestamp.now(),
      recordedBy: staffId || "system",
      mode: status === "paid" && hasPlan ? "installment_full" : "amount",
    };

    const paymentPlan =
      status === "paid"
        ? settleInstallments(current.paymentPlan || {}, method, staffId)
        : current.paymentPlan || undefined;

    await updateDoc(docRef, {
      ...(paymentPlan ? { paymentPlan } : {}),
      remainingBalance: newBalance,
      status,
      transactions: [...(current.transactions || []), transaction],
      updatedAt: serverTimestamp(),
    });

    const appRef = doc(db, APPOINTMENTS_COLLECTION, appointmentId);
    await updateDoc(appRef, {
      paymentStatus: status,
      paymentMethod: method,
      paymentDate: serverTimestamp(),
    });

    return { success: true };
  } catch (error) {
    console.error("Error processing payment:", error);
    return { success: false, error: "Payment processing failed" };
  }
}

export async function payInstallment(
  appointmentId: string,
  installmentId: string,
  method: string,
  staffId?: string
) {
  try {
    const docRef = doc(db, BILLING_COLLECTION, appointmentId);
    const snap = await getDoc(docRef);

    if (!snap.exists()) {
      return { success: false, error: "Billing record not found" };
    }

    const current = snap.data() as BillingRecord;

    const installments: any[] = Array.isArray(current?.paymentPlan?.installments)
      ? [...current.paymentPlan.installments]
      : [];

    if (installments.length === 0) {
      return { success: false, error: "No installment plan found" };
    }

    const idx = installments.findIndex((x) => String(x?.id) === String(installmentId));
    if (idx === -1) {
      return { success: false, error: "Installment not found" };
    }

    const inst = installments[idx];
    const instStatus = String(inst?.status || "").toLowerCase();

    if (instStatus === "paid") {
      return { success: false, error: "Installment already paid" };
    }

    const amount = Number(inst?.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { success: false, error: "Invalid installment amount" };
    }

    // Mark installment as paid
    installments[idx] = {
      ...inst,
      status: "paid",
      paidAt: Timestamp.now(), // 
      paidBy: staffId || "system",
      paidMethod: method,
    };

    // Reduce remaining balance (simple + effective)
    const prevRemaining = Number(current.remainingBalance || 0);
    const newRemaining = Math.max(0, prevRemaining - amount);

    const totalAmount = Number(current.totalAmount || 0);
    const newStatus =
      newRemaining <= 0 ? "paid" : newRemaining < totalAmount ? "partial" : "unpaid";

    const transaction: any = {
      id: crypto.randomUUID(),
      amount,
      method,
      date: Timestamp.now(),
      recordedBy: staffId || "system",
      mode: "installment",
      installmentId,
      dueDate: inst?.dueDate || null,
    };

    await updateDoc(docRef, {
      paymentPlan: {
        ...(current.paymentPlan || {}),
        installments,
      },
      remainingBalance: newRemaining,
      status: newStatus,
      transactions: [...(current.transactions || []), transaction],
      updatedAt: serverTimestamp(),
    });

    // Keep appointment in sync (optional but recommended)
    const appRef = doc(db, APPOINTMENTS_COLLECTION, appointmentId);
    await updateDoc(appRef, {
      paymentStatus: newStatus,
      paymentMethod: method,
      paymentDate: serverTimestamp(),
    });

    return { success: true };
  } catch (error) {
    console.error("Error paying installment:", error);
    return { success: false, error: "Failed to pay installment" };
  }
}

export async function setupPaymentPlan(
  appointmentId: string,
  installments: BillingInstallment[],
  selectedItemIds?: string[]
) {
  try {
    const docRef = doc(db, BILLING_COLLECTION, appointmentId);
    const snap = await getDoc(docRef);

    if (!snap.exists()) return { success: false, error: "Record not found" };
    const current = snap.data() as BillingRecord;

    // 1) Update item statuses to "plan" (only those selected)
    let updatedItems: BillingItem[] = Array.isArray(current.items) ? current.items : [];

    if (selectedItemIds && selectedItemIds.length > 0 && updatedItems.length > 0) {
      updatedItems = updatedItems.map((item: any) => ({
        ...item,
        status: selectedItemIds.includes(item.id) ? "plan" : item.status,
      }));
    }

    // 2) Recompute totals from items (authoritative)
    const computed = updatedItems.length
      ? computeFromItems(updatedItems, Number(current.totalAmount || 0))
      : {
          totalAmount: Number(current.totalAmount || 0),
          remainingBalance: Number(current.remainingBalance || 0),
          status: current.status || "unpaid",
        };

    // 3) Persist plan + items + recomputed balances
    await updateDoc(docRef, {
      paymentPlan: {
        type: "installments",
        installments,
      },
      items: updatedItems,
      totalAmount: computed.totalAmount,
      remainingBalance: computed.remainingBalance,
      status: computed.status,
      updatedAt: serverTimestamp(),
    });

    return { success: true };
  } catch (error) {
    console.error("Error setting plan:", error);
    return { success: false, error: "Failed to set payment plan" };
  }
}

export async function getAllBillingRecords(
  statusFilter: "paid" | "unpaid" | "partial" | "all" = "all"
) {
  try {
    const billingRef = collection(db, BILLING_COLLECTION);
    let q = query(billingRef);

    if (statusFilter !== "all") {
      q = query(billingRef, where("status", "==", statusFilter));
    }

    const snapshot = await getDocs(q);
    // test remove this comment const bills = snapshot.docs.map((d) => d.data() as BillingRecord);

  const bills = snapshot.docs.map((d) => ({
  id: d.id,
  ...(d.data() as Omit<BillingRecord, "id">),
})) as BillingRecord[];

    // Sort by createdAt desc
    bills.sort((a, b) => {
      const timeA = (a.createdAt as any)?.seconds || 0;
      const timeB = (b.createdAt as any)?.seconds || 0;
      return timeB - timeA;
    });

    return { success: true, data: bills };
  } catch (error) {
    console.error("Error fetching all bills:", error);
    return { success: false, error: "Failed to fetch bills" };
  }
}


export async function getBillingRecordsByPatient(
  patientId: string,
  statusFilter: "paid" | "unpaid" | "partial" | "all" = "all"
) {
  try {
    if (!patientId) return { success: false, error: "Missing patientId" };

    const billingRef = collection(db, BILLING_COLLECTION);

    // Most efficient query: patientId filter first
    let q = query(billingRef, where("patientId", "==", patientId));

    // Optional server-side status filter (may require composite index)
    if (statusFilter !== "all") {
      q = query(billingRef, where("patientId", "==", patientId), where("status", "==", statusFilter));
    }

    const snapshot = await getDocs(q);

    const bills = snapshot.docs.map((d) => ({
      id: d.id, 
      ...(d.data() as Omit<BillingRecord, "id">),
    })) as BillingRecord[];

    
    bills.sort((a, b) => {
      const au = (a.updatedAt as any)?.seconds || 0;
      const bu = (b.updatedAt as any)?.seconds || 0;
      if (bu !== au) return bu - au;

      const ac = (a.createdAt as any)?.seconds || 0;
      const bc = (b.createdAt as any)?.seconds || 0;
      return bc - ac;
    });

    return { success: true, data: bills };
  } catch (error: any) {
    // If composite index error happens, fallback to patient-only query then filter in memory
    const msg = String(error?.message || "");
    const looksLikeIndexError =
      msg.toLowerCase().includes("index") || msg.toLowerCase().includes("failed-precondition");

    if (looksLikeIndexError && statusFilter !== "all") {
      try {
        const billingRef = collection(db, BILLING_COLLECTION);
        const q2 = query(billingRef, where("patientId", "==", patientId));
        const snap2 = await getDocs(q2);

        const allBills = snap2.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        })) as BillingRecord[];

        const filtered = allBills.filter((b) => String((b as any).status) === statusFilter);

        filtered.sort((a, b) => {
          const au = (a.updatedAt as any)?.seconds || 0;
          const bu = (b.updatedAt as any)?.seconds || 0;
          if (bu !== au) return bu - au;
          const ac = (a.createdAt as any)?.seconds || 0;
          const bc = (b.createdAt as any)?.seconds || 0;
          return bc - ac;
        });

        return { success: true, data: filtered };
      } catch (e) {
        console.error("Fallback patient billing query failed:", e);
      }
    }

    console.error("Error fetching bills by patient:", error);
    return { success: false, error: "Failed to fetch bills by patient" };
  }
}

export async function recordBillingPayment(input: {
  appointmentId: string;
  amount: number;
  method: string;
  note?: string;
  itemIds?: string[];
  staffId?: string;
}) {
  return await processPayment(
    input.appointmentId,
    input.amount,
    input.method,
    input.staffId,
    Array.isArray(input.itemIds) ? input.itemIds : []
  );
}

// new name used by some UI code (itemId included but legacy model is appointment-level plan)
export async function createItemInstallmentPlan(
  appointmentId: string,
  itemId: string,
  months: number,
  description?: string
) {
  // Legacy model: plan saved at billing.paymentPlan and item status set to "plan"
  // We will create a schedule for the selected item only.
  const safeMonths = Number(months);
  if (!Number.isFinite(safeMonths) || safeMonths < 1 || safeMonths > 36) {
    return { success: false, error: "Invalid months. Must be 1–36." };
  }

  const details = await getBillingDetails(appointmentId);
  if (!details.success || !details.data) return { success: false, error: "Bill not found" };

  const bill = details.data as any;
  const items = Array.isArray(bill.items) ? bill.items : [];
  const target = items.find((x: any) => x.id === itemId);
  if (!target) return { success: false, error: "Item not found" };

  const planTotal = Number(target.price || 0);
  if (!Number.isFinite(planTotal) || planTotal <= 0) {
    return { success: false, error: "Invalid item price" };
  }

  const rawPerMonth = planTotal / safeMonths;
  const amountPerMonth = Math.floor(rawPerMonth * 100) / 100;

  const installments: BillingInstallment[] = [];
  let due = new Date();

  for (let i = 0; i < safeMonths; i++) {
    due = new Date(due);
    due.setMonth(due.getMonth() + 1);

    const amt =
      i === safeMonths - 1
        ? Number((planTotal - amountPerMonth * (safeMonths - 1)).toFixed(2))
        : amountPerMonth;

    installments.push({
      id: crypto.randomUUID(),
      dueDate: due.toISOString().split("T")[0],
      amount: amt,
      status: "pending",
      description: `${description || target.name} • Installment ${i + 1} of ${safeMonths}`,
    } as any);
  }

  return await setupPaymentPlan(appointmentId, installments, [itemId]);
}

// new name used by some code (itemId param included for future upgrade)
export async function payItemInstallment(
  appointmentId: string,
  itemId: string,
  installmentId: string,
  method: string,
  staffId?: string
) {
  // Legacy service pays by installmentId only
  return await payInstallment(appointmentId, installmentId, method, staffId);
}
