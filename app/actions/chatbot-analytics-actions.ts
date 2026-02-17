import { getUserProfile } from "@/lib/services/user-service";
import { auth, db } from "@/lib/firebase/firebase";
import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

export type ChatbotQuestionRow = {
  id: string;
  label: string;
  count: number;
};

async function requireAdmin() {
  if (!auth.currentUser) return { ok: false as const, error: "Not authenticated" };
  const profile = await getUserProfile(auth.currentUser.uid);
  if (!profile.success || !profile.data || profile.data.role !== "admin") {
    return { ok: false as const, error: "Unauthorized: Admin only" };
  }
  return { ok: true as const };
}

export async function getTopChatbotQuestionsAction(limitCount = 3): Promise<{
  success: boolean;
  data?: ChatbotQuestionRow[];
  error?: string;
}> {
  const authz = await requireAdmin();
  if (!authz.ok) return { success: false, error: authz.error };

  try {
    const safeLimit = Math.min(10, Math.max(1, Math.floor(Number(limitCount || 3))));
    const q = query(
      collection(db, "chatbot_question_stats"),
      orderBy("count", "desc"),
      limit(safeLimit)
    );
    const snap = await getDocs(q);

    const rows: ChatbotQuestionRow[] = snap.docs.map((d) => {
      const data = d.data() as { label?: unknown; count?: unknown };
      return {
        id: d.id,
        label: String(data?.label || "").trim(),
        count: Number(data?.count || 0),
      };
    });

    return { success: true, data: rows };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to load top chatbot questions.";
    return { success: false, error: msg };
  }
}

export async function updateChatbotQuestionLabelAction(input: {
  id: string;
  label: string;
}): Promise<{ success: boolean; error?: string }> {
  const authz = await requireAdmin();
  if (!authz.ok) return { success: false, error: authz.error };

  const id = String(input?.id || "").trim();
  const label = String(input?.label || "").trim();
  if (!id) return { success: false, error: "Missing question id." };
  if (!label) return { success: false, error: "Question label is required." };
  if (label.length > 180) return { success: false, error: "Question is too long (max 180 chars)." };

  try {
    await updateDoc(doc(db, "chatbot_question_stats", id), {
      label,
      updatedAt: serverTimestamp(),
    });
    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to update question label.";
    return { success: false, error: msg };
  }
}
