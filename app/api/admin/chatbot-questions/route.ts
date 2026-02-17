import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase/server";
import { FieldValue } from "firebase-admin/firestore";

async function requireAdmin(request: Request) {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return { ok: false as const, status: 401, error: "Missing auth token." };

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    const userSnap = await adminDb.collection("users").doc(decoded.uid).get();
    const role = String(userSnap.data()?.role || "").toLowerCase();
    if (role !== "admin") {
      return { ok: false as const, status: 403, error: "Unauthorized: Admin only." };
    }
    return { ok: true as const, uid: decoded.uid };
  } catch {
    return { ok: false as const, status: 401, error: "Invalid auth token." };
  }
}

export async function GET(request: Request) {
  const authz = await requireAdmin(request);
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

  try {
    const { searchParams } = new URL(request.url);
    const limitRaw = Number(searchParams.get("limit") || 3);
    const limitCount = Number.isFinite(limitRaw) ? Math.min(10, Math.max(1, Math.floor(limitRaw))) : 3;

    const snap = await adminDb
      .collection("chatbot_question_stats")
      .orderBy("count", "desc")
      .limit(limitCount)
      .get();

    const data = snap.docs.map((d) => {
      const row = d.data() as { label?: unknown; count?: unknown };
      return {
        id: d.id,
        label: String(row?.label || "").trim(),
        count: Number(row?.count || 0),
      };
    });

    return NextResponse.json({ data });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to load top chatbot questions.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const authz = await requireAdmin(request);
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

  try {
    const body = (await request.json()) as { id?: unknown; label?: unknown };
    const id = String(body?.id || "").trim();
    const label = String(body?.label || "").trim();
    if (!id) return NextResponse.json({ error: "Missing question id." }, { status: 400 });
    if (!label) return NextResponse.json({ error: "Question label is required." }, { status: 400 });
    if (label.length > 180) {
      return NextResponse.json({ error: "Question is too long (max 180 chars)." }, { status: 400 });
    }

    await adminDb.collection("chatbot_question_stats").doc(id).set(
      {
        label,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to update question label.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

