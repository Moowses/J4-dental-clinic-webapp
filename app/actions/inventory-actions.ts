import { ActionState } from "@/lib/utils";
import { inventorySchema } from "@/lib/validations/inventory";
import { addInventoryItem, updateInventoryItem, adjustStock } from "@/lib/services/inventory-service";
import { getUserProfile } from "@/lib/services/user-service";
import { InventoryItem } from "@/lib/types/inventory";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase/firebase";

export async function addInventoryItemAction(prevState: ActionState, data: FormData): Promise<ActionState> {
  console.log("Action: Adding Inventory Item...");
  const { auth } = await import("@/lib/firebase/firebase");
  if (!auth.currentUser) return { success: false, error: "Not authenticated" };

  const profile = await getUserProfile(auth.currentUser.uid);
  console.log("User Role:", profile.data?.role);
  
  // Allow any Staff member to add items
  if (!profile.success || profile.data?.role === "client") {
    console.error("Action Failed: Unauthorized");
    return { success: false, error: "Unauthorized: Staff access required" };
  }

  const rawData = Object.fromEntries(data);
  const formattedData = {
    ...rawData,
    stock: Number(rawData.stock),
    minThreshold: Number(rawData.minThreshold),
    costPerUnit: Number(rawData.costPerUnit),
    tag: rawData.tag ? String(rawData.tag) : undefined,
    batchNumber: rawData.batchNumber ? String(rawData.batchNumber) : undefined,
    expirationDate: rawData.expirationDate ? String(rawData.expirationDate) : undefined,
    isActive: true,
  };

  const parsed = inventorySchema.safeParse(formattedData);
  if (!parsed.success) {
    console.error("Action Failed: Validation Error", parsed.error);
    return { success: false, error: parsed.error.issues[0].message };
  }

  return await addInventoryItem(parsed.data);
}

export async function adjustStockAction(itemId: string, amount: number): Promise<ActionState> {
  const { auth } = await import("@/lib/firebase/firebase");
  if (!auth.currentUser) return { success: false, error: "Not authenticated" };

  const profile = await getUserProfile(auth.currentUser.uid);
  const isStaff = profile.success && profile.data && profile.data.role !== "client";
  
  if (!isStaff) return { success: false, error: "Unauthorized" };

  return await adjustStock(itemId, amount);
}

export async function updateInventoryItemAction(itemId: string, data: FormData): Promise<ActionState> {
  const { auth } = await import("@/lib/firebase/firebase");
  if (!auth.currentUser) return { success: false, error: "Not authenticated" };

  const profile = await getUserProfile(auth.currentUser.uid);
  if (!profile.success || profile.data?.role === "client") {
    return { success: false, error: "Unauthorized" };
  }

  const rawData = Object.fromEntries(data);
  const formattedData = {
    ...rawData,
    stock: Number(rawData.stock),
    minThreshold: Number(rawData.minThreshold),
    costPerUnit: Number(rawData.costPerUnit),
    tag: rawData.tag ? String(rawData.tag) : undefined,
    batchNumber: rawData.batchNumber ? String(rawData.batchNumber) : undefined,
    expirationDate: rawData.expirationDate ? String(rawData.expirationDate) : undefined,
    isActive: rawData.isActive === "true" || rawData.isActive === "on",
  };

  const parsed = inventorySchema.safeParse(formattedData);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };

  const { itemCode, ...safe } = parsed.data as any;
  return await updateInventoryItem(itemId, safe);
}

export async function deleteInventoryItemAction(itemId: string): Promise<ActionState> {
  const { auth } = await import("@/lib/firebase/firebase");
  if (!auth.currentUser) return { success: false, error: "Not authenticated" };

  const profile = await getUserProfile(auth.currentUser.uid);
  if (!profile.success || profile.data?.role !== "admin") {
    return { success: false, error: "Unauthorized" };
  }

  return await updateInventoryItem(itemId, { isActive: false } as Partial<InventoryItem>);
}

export async function getInventoryReport() {
  const { auth } = await import("@/lib/firebase/firebase");
  if (!auth.currentUser) throw new Error("Not authenticated");

  const profile = await getUserProfile(auth.currentUser.uid);
  if (!profile.success || !profile.data) throw new Error("User profile not found");
  if (profile.data.role === "client") throw new Error("Unauthorized: Staff access required");

  const snap = await getDocs(collection(db, "inventory"));

  const rows = snap.docs.map((doc) => {
    const data: any = doc.data();

    // Firestore uses: stock, minThreshold
    // Keep fallbacks for older shapes: qtyOnHand, quantity, reorderLevel
    const qtyOnHand = Number(
      data.stock ?? data.qtyOnHand ?? data.quantity ?? 0
    );

    const reorderLevelRaw = data.minThreshold ?? data.reorderLevel;
    const reorderLevel =
      typeof reorderLevelRaw === "number"
        ? reorderLevelRaw
        : reorderLevelRaw != null && reorderLevelRaw !== ""
        ? Number(reorderLevelRaw)
        : undefined;

    return {
      id: doc.id,
      itemCode: data.itemCode,
      name: data.name ?? "Unnamed Item",
      sku: data.sku,
      category: data.category,
      tag: data.tag,
      qtyOnHand: Number.isFinite(qtyOnHand) ? qtyOnHand : 0,
      reorderLevel: Number.isFinite(reorderLevel as number)
        ? (reorderLevel as number)
        : undefined,
      unit: data.unit,
      costPerUnit:
        typeof data.costPerUnit === "number"
          ? data.costPerUnit
          : data.costPerUnit != null && data.costPerUnit !== ""
          ? Number(data.costPerUnit)
          : undefined,
      batchNumber: data.batchNumber,
      expirationDate: data.expirationDate,
      updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() ?? data.updatedAt,
    };
  });

  const totalItems = rows.length;
  const lowStockCount = rows.filter(
    (r) => typeof r.reorderLevel === "number" && r.qtyOnHand <= r.reorderLevel
  ).length;
  const outOfStockCount = rows.filter((r) => r.qtyOnHand <= 0).length;

  return {
    rows,
    summary: {
      totalItems,
      lowStockCount,
      outOfStockCount,
    },
  };
}
