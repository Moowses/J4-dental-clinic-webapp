import { getUserProfile } from "@/lib/services/user-service";
import {
  getBillingDetails,
  setupPaymentPlan,
  getAllBillingRecords,
  getBillingRecordsByPatient,
  processPayment,
  payInstallment,
} from "@/lib/services/billing-service";
import { BillingInstallment, BillingRecord } from "@/lib/types/billing";

function addMonthsISO(from: Date, monthsToAdd: number) {
  const d = new Date(from);
  d.setMonth(d.getMonth() + monthsToAdd);
  return d.toISOString().split("T")[0];
}

function buildInstallmentSchedule(
  total: number,
  terms: number,
  descriptionPrefix?: string
): BillingInstallment[] {
  const t = Number(terms);
  const amt = Number(total);
  if (!Number.isFinite(t) || t < 1 || t > 36) return [];
  if (!Number.isFinite(amt) || amt <= 0) return [];

  // 2-decimal, last installment fixes rounding (e.g. 833.33/833.33/833.34)
  const base = Math.floor((amt / t) * 100) / 100;
  let allocated = 0;

  const today = new Date();
  const out: BillingInstallment[] = [];
  for (let i = 0; i < t; i++) {
    const amount =
      i === t - 1 ? Number((amt - allocated).toFixed(2)) : Number(base.toFixed(2));
    allocated += amount;

    out.push({
      id: crypto.randomUUID(),
      dueDate: addMonthsISO(today, i + 1),
      amount,
      status: "pending" as any,
      description: descriptionPrefix
        ? `${descriptionPrefix} • Installment ${i + 1} of ${t}`
        : `Installment ${i + 1} of ${t}`,
    } as any);
  }
  return out;
}

// Computes already-paid amount for an item using transactions
function sumItemPaymentsFromTransactions(record: any, itemId: string) {
  const txns = Array.isArray(record?.transactions) ? record.transactions : [];
  let sum = 0;

  for (const tx of txns) {
    // preferred structure used in your UI: appliedTo: [{itemId, amount, installmentId?}]
    const applied = Array.isArray(tx?.appliedTo) ? tx.appliedTo : null;
    if (applied) {
      for (const a of applied) {
        if (a?.itemId === itemId) sum += Number(a?.amount || 0);
      }
      continue;
    }

    // fallback to older structure: itemIds: [...]
    const itemIds = Array.isArray(tx?.itemIds) ? tx.itemIds : [];
    if (itemIds.includes(itemId)) sum += Number(tx?.amount || 0);
  }

  return Number(sum.toFixed(2));
}

/**
 * Get billing details for ONE appointment
 */
export async function getBillingDetailsAction(
  appointmentId: string
): Promise<{ success: boolean; data?: BillingRecord; error?: string; isVirtual?: boolean }> {
  const { auth } = await import("@/lib/firebase/firebase");
  if (!auth.currentUser) return { success: false, error: "Not authenticated" };

  return await getBillingDetails(appointmentId);
}

type BillableStatus = "unpaid" | "paid" | "plan" | "void" | "waived" | string;

function isExcludedFromBalance(status: BillableStatus) {
  const s = String(status || "").toLowerCase();
  return s === "paid" || s === "void" || s === "waived";
}

function computeStatusFromRemaining(remaining: number, total: number) {
  const r = Number(remaining || 0);
  const t = Number(total || 0);
  if (r <= 0) return "paid";
  if (t > 0 && r < t) return "partial";
  return "unpaid";
}

/**
 * LEGACY: Creates plan at appointment-level (paymentPlan.installments)
 * and marks selected items as "plan"
 */
export async function createPaymentPlanAction(
  appointmentId: string,
  months: number,
  selectedItemIds: string[] = []
): Promise<{ success: boolean; error?: string }> {
  const { auth } = await import("@/lib/firebase/firebase");
  if (!auth.currentUser) return { success: false, error: "Not authenticated" };

  const profile = await getUserProfile(auth.currentUser.uid);
  if (!profile.success || !profile.data || profile.data.role === "client") {
    return { success: false, error: "Unauthorized: Staff only" };
  }

  const safeMonths = Number(months);
  if (!Number.isFinite(safeMonths) || safeMonths < 1 || safeMonths > 36) {
    return { success: false, error: "Invalid months. Must be 1–36." };
  }

  const billRes = await getBillingDetails(appointmentId);
  if (!billRes.success || !billRes.data) return { success: false, error: "Bill not found" };

  const bill = billRes.data;
  const items = Array.isArray((bill as any).items) ? ((bill as any).items as any[]) : [];

  const eligibleIds =
    selectedItemIds.length > 0
      ? selectedItemIds
      : items
          .filter((it) => !isExcludedFromBalance(it.status as BillableStatus))
          .map((it) => it.id);

  let planTotal = 0;

  if (items.length > 0) {
    planTotal = items
      .filter((it) => eligibleIds.includes(it.id))
      .filter((it) => !isExcludedFromBalance(it.status as BillableStatus))
      .reduce((sum, it) => sum + Number(it.price || 0), 0);
  } else {
    planTotal = Number((bill as any).remainingBalance || 0);
  }

  if (!Number.isFinite(planTotal) || planTotal <= 0) {
    return { success: false, error: "No balance to split" };
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
      description: `Installment ${i + 1} of ${safeMonths}`,
    } as any);
  }

  return await setupPaymentPlan(appointmentId, installments, eligibleIds);
}

/**
 * Get all billing records (admin)
 */
export async function getAllBillingAction(
  filter: "paid" | "unpaid" | "partial" | "all" = "all"
): Promise<{ success: boolean; data?: BillingRecord[]; error?: string }> {
  const { auth } = await import("@/lib/firebase/firebase");
  if (!auth.currentUser) return { success: false, error: "Not authenticated" };

  const profile = await getUserProfile(auth.currentUser.uid);
  if (!profile.success || !profile.data || profile.data.role === "client") {
    return { success: false, error: "Unauthorized: Staff only" };
  }

  return await getAllBillingRecords(filter);
}

/**
 * LEGACY installment payment (appointmentId + installmentId)
 */
export async function payInstallmentAction(
  appointmentId: string,
  installmentId: string,
  method: string
) {
  const { auth } = await import("@/lib/firebase/firebase");
  if (!auth.currentUser) return { success: false, error: "Not authenticated" };

  const profile = await getUserProfile(auth.currentUser.uid);
  if (!profile.success || !profile.data || profile.data.role === "client") {
    return { success: false, error: "Unauthorized: Staff only" };
  }

  return await payInstallment(appointmentId, installmentId, method, auth.currentUser.uid);
}

export async function payItemInstallmentAction(
  appointmentId: string,
  itemId: string,
  installmentId: string,
  method: string
) {
  return await payInstallmentAction(appointmentId, installmentId, method);
}

/**
 * Billing records by patient (admin)
 */
export async function getBillingByPatientAction(
  patientId: string,
  filter: "paid" | "unpaid" | "partial" | "all" = "all"
): Promise<{ success: boolean; data?: BillingRecord[]; error?: string }> {
  const { auth } = await import("@/lib/firebase/firebase");
  if (!auth.currentUser) return { success: false, error: "Not authenticated" };

  const profile = await getUserProfile(auth.currentUser.uid);
  if (!profile.success || !profile.data || profile.data.role === "client") {
    return { success: false, error: "Unauthorized: Staff only" };
  }

  return await getBillingRecordsByPatient(patientId, filter);
}
export async function recordBillingPaymentAction(input: {
  appointmentId: string;
  amount: number;
  method: string;
  note?: string;
  itemIds?: string[];
}) {
  const { auth } = await import("@/lib/firebase/firebase");
  if (!auth.currentUser) return { success: false, error: "Not authenticated" };

  const profile = await getUserProfile(auth.currentUser.uid);
  if (!profile.success || !profile.data || profile.data.role === "client") {
    return { success: false, error: "Unauthorized: Staff only" };
  }
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { success: false, error: "Amount must be greater than 0." };
  }

  const bill = await getBillingDetails(input.appointmentId);
  if (!bill?.success || !bill.data) {
    return { success: false, error: bill?.error || "Billing record not found." };
  }
  const remaining = Math.max(0, Number((bill.data as any).remainingBalance || 0));
  if (remaining <= 0) {
    return { success: false, error: "This billing record is already fully paid." };
  }

  const normalizedAmount = Number(amount.toFixed(2));
  if (normalizedAmount > remaining + 0.01) {
    return {
      success: false,
      error: `Amount cannot exceed remaining balance (${remaining.toFixed(2)}).`,
    };
  }

  return await processPayment(
    input.appointmentId,
    normalizedAmount,
    String(input.method || "cash"),
    auth.currentUser.uid,
    Array.isArray(input.itemIds) ? input.itemIds : []
  );
}

/**
 * ✅ FIXED: Create installment plan with optional downpayment (and APPLY it to balances).
 *
 * This uses a Firestore transaction to keep:
 * - remainingBalance accurate
 * - paymentPlan.installments based on (itemRemaining - downpayment)
 * - transaction linked to item via itemIds/appliedTo
 */
export async function createItemPaymentPlanWithDownpaymentAction(input: {
  appointmentId: string;
  itemId: string;
  terms: number;
  description?: string;
  downpaymentAmount?: number;
  downpaymentMethod?: string;
  note?: string;
}) {
  const { auth } = await import("@/lib/firebase/firebase");
  const user = auth.currentUser;
  if (!user) return { success: false, error: "Not authenticated" };

  const profile = await getUserProfile(user.uid);
  if (!profile.success || !profile.data || profile.data.role === "client") {
    return { success: false, error: "Unauthorized: Staff only" };
  }

  const terms = Number(input.terms || 0);
  if (!Number.isFinite(terms) || terms < 1 || terms > 36) {
    return { success: false, error: "Terms must be between 1 and 36." };
  }

  const down = Number(input.downpaymentAmount || 0);
  if (!Number.isFinite(down) || down < 0) {
    return { success: false, error: "Invalid downpayment amount." };
  }

  const { db } = await import("@/lib/firebase/firebase");
  const { doc, runTransaction, serverTimestamp } = await import("firebase/firestore");

  const billRef = doc(db as any, "billing_records", input.appointmentId);

  try {
    await runTransaction(db as any, async (tx) => {
      const snap = await tx.get(billRef);
      if (!snap.exists()) throw new Error("Bill not found");

      const data = snap.data() as any;
      const items = Array.isArray(data?.items) ? data.items : [];
      const idx = items.findIndex((x: any) => x?.id === input.itemId);
      if (idx === -1) throw new Error("Item not found.");

      const item = items[idx];
      const itemStatus = String(item?.status || "unpaid").toLowerCase();
      if (itemStatus === "paid") throw new Error("Item is already paid.");

      // If already has a plan schedule stored, block (prevents duplicates)
      if (
        itemStatus === "plan" &&
        Array.isArray(data?.paymentPlan?.installments) &&
        data.paymentPlan.installments.length
      ) {
        throw new Error("This item already has an installment plan.");
      }

      const itemPrice = Number(item?.price || 0);
      if (!Number.isFinite(itemPrice) || itemPrice <= 0) throw new Error("Invalid item price.");

      // Paid before this action
      const alreadyPaid = sumItemPaymentsFromTransactions(data, input.itemId);
      const itemRemainingBefore = Number((itemPrice - alreadyPaid).toFixed(2));

      if (itemRemainingBefore <= 0) throw new Error("Item is already fully paid.");
      if (down > itemRemainingBefore) {
        throw new Error("Downpayment cannot exceed item remaining balance.");
      }

      // Remaining after downpayment
      const netRemaining = Number((itemRemainingBefore - down).toFixed(2));

      const desc = input.description || String(item?.name || "").trim();
      const installments =
        netRemaining > 0 ? buildInstallmentSchedule(netRemaining, terms, desc) : [];

      if (netRemaining > 0 && !installments.length) {
        throw new Error("Unable to generate installment schedule.");
      }

      // Total amount fallback
      const totalAmount =
        typeof data?.totalAmount === "number"
          ? Number(data.totalAmount)
          : items
              .filter((it: any) => !isExcludedFromBalance(it?.status))
              .reduce((s: number, it: any) => s + Number(it?.price || 0), 0);

      // Remaining balance fallback
      const remainingBefore =
        typeof data?.remainingBalance === "number"
          ? Number(data.remainingBalance)
          : items
              .filter((it: any) => !isExcludedFromBalance(it?.status))
              .reduce((s: number, it: any) => {
                const price = Number(it?.price || 0);
                const paid = sumItemPaymentsFromTransactions(data, it?.id);
                const rem = Math.max(0, Number((price - paid).toFixed(2)));
                return s + rem;
              }, 0);

      const remainingAfter = Math.max(0, Number((remainingBefore - down).toFixed(2)));
      const overallStatus = computeStatusFromRemaining(remainingAfter, totalAmount);

      // Update item status
      const nextItemStatus = netRemaining <= 0 ? "paid" : "plan";
      const nextItems = [...items];
      nextItems[idx] = { ...item, status: nextItemStatus };

      // Append downpayment transaction (linked to item)
      const txns = Array.isArray(data?.transactions) ? [...data.transactions] : [];
      if (down > 0) {
       txns.push({
            id: crypto.randomUUID(),
            amount: down,
            method: String(input.downpaymentMethod || "cash"),
            mode: "item",
            itemIds: [input.itemId],
            appliedTo: [{ itemId: input.itemId, amount: down }],
            note: input.note || "Downpayment",
            recordedBy: user.uid,
            date: new Date(), 
          });

      }

      const nextPaymentPlan = {
        ...(data?.paymentPlan || {}),
        type: "installments",
        installments,
      };

      tx.update(billRef, {
        items: nextItems,
        paymentPlan: nextPaymentPlan,
        transactions: txns,
        totalAmount,
        remainingBalance: remainingAfter,
        status: overallStatus,
        updatedAt: serverTimestamp(),
      });
    });

    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message || "Failed to create plan with downpayment." };
  }
}

export async function createItemPaymentPlanAction(input: {
  appointmentId: string;
  itemId: string;
  terms: number;
  description?: string;
}) {
  // If your service already has createItemInstallmentPlan wrapper,
  // call it. Otherwise fallback to legacy createPaymentPlanAction.
  try {
    const { createItemInstallmentPlan } = await import("@/lib/services/billing-service");
    const res = await createItemInstallmentPlan(
      input.appointmentId,
      input.itemId,
      input.terms,
      input.description || ""
    );
    return res?.success === false ? res : { success: true };
  } catch {
    return await createPaymentPlanAction(input.appointmentId, input.terms, [input.itemId]);
  }
}
