import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/server";
import { verifyAdminToken } from "@/lib/services/admin-service";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const idToken = String(body?.idToken || "").trim();
    const appointmentId = String(body?.appointmentId || "").trim();

    if (!idToken) {
      return NextResponse.json(
        { success: false, error: "Unauthorized: No token provided" },
        { status: 401 }
      );
    }

    const ok = await verifyAdminToken(idToken);
    if (!ok) {
      return NextResponse.json(
        { success: false, error: "Unauthorized: Admin access required" },
        { status: 403 }
      );
    }

    if (!appointmentId) {
      return NextResponse.json(
        { success: false, error: "Missing appointmentId" },
        { status: 400 }
      );
    }

    const apptRef = adminDb.collection("appointments").doc(appointmentId);
    const billingRef = adminDb.collection("billing_records").doc(appointmentId);

    const apptSnap = await apptRef.get();
    if (!apptSnap.exists) {
      return NextResponse.json(
        { success: false, error: "Appointment not found" },
        { status: 404 }
      );
    }

    await Promise.all([apptRef.delete(), billingRef.delete()]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting appointment via admin route:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete appointment" },
      { status: 500 }
    );
  }
}
