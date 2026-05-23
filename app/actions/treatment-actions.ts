import { ActionState } from "@/lib/utils";
import { getAllProcedures } from "@/lib/services/clinic-service";
import { getInventory } from "@/lib/services/inventory-service";
import { getUserProfile } from "@/lib/services/user-service";
import { saveTreatmentRecord, getAppointmentById } from "@/lib/services/appointment-service";
import { createBillingRecord } from "@/lib/services/billing-service";
import { TreatmentRecord } from "@/lib/types/appointment";
import { DentalProcedure } from "@/lib/types/clinic";
import { InventoryItem } from "@/lib/types/inventory";

// Helper Action to get all data needed for a treatment session
export async function getTreatmentToolsAction(): Promise<{ 
  success: boolean; 
  data?: { procedures: DentalProcedure[], inventory: InventoryItem[] }; 
  error?: string 
}> {
  const { auth } = await import("@/lib/firebase/firebase");
  if (!auth.currentUser) return { success: false, error: "Not authenticated" };

  // Check Role (Staff Only)
  const profile = await getUserProfile(auth.currentUser.uid);
  if (!profile.success || !profile.data || profile.data.role === 'client') {
    return { success: false, error: "Unauthorized" };
  }

  // Fetch Procedures and Inventory in parallel
  const [proceduresRes, inventoryRes] = await Promise.all([
    getAllProcedures(true),
    getInventory(true)
  ]);

  return {
    success: true,
    data: {
      procedures: proceduresRes.data || [],
      inventory: inventoryRes.data || []
    }
  };
}

export async function completeTreatmentAction(
  appointmentId: string, 
  data: Omit<TreatmentRecord, 'completedAt' | 'totalBill'>
): Promise<ActionState> {
  const { auth } = await import("@/lib/firebase/firebase");
  if (!auth.currentUser) return { success: false, error: "Not authenticated" };

  const profile = await getUserProfile(auth.currentUser.uid);
  if (!profile.success || !profile.data || profile.data.role !== 'dentist') {
    return { success: false, error: "Unauthorized: Only dentists can log treatments" };
  }

  // 1. Save clinical record
  const result = await saveTreatmentRecord(appointmentId, data);
  if (!result.success) return result;

  // 2. Fetch appointment to get totalBill (calculated by saveTreatmentRecord) and patientId
  const appResult = await getAppointmentById(appointmentId);
  if (appResult.success && appResult.data && appResult.data.treatment) {
    
    // Map treatment procedures to billing items
    const billingItems = appResult.data.treatment.procedures.map(p => ({
      id: p.id,
      name: p.name,
      price: p.price,
      toothNumber: p.toothNumber,
      status: "unpaid" as const
    }));

    // 3. Create Billing Record
    await createBillingRecord(
      appointmentId, 
      appResult.data.patientId, 
      appResult.data.treatment.totalBill,
      billingItems
    );
  }

  return { success: true };
}
