import { NextRequest, NextResponse } from "next/server";
import type { DocumentReference } from "firebase-admin/firestore";

import { adminAuth, adminDb } from "@/lib/firebase/server";
import { verifyAdminToken } from "@/lib/services/admin-service";
import { deleteCloudinaryAssetByUrl } from "@/lib/services/cloudinary-admin";

async function deleteImageUrls(urls: Set<string>) {
  let deleted = 0;
  let failed = 0;

  for (const url of urls) {
    const res = await deleteCloudinaryAssetByUrl(url);
    if (res.success) deleted += 1;
    else failed += 1;
  }

  return { deleted, failed };
}

export async function POST(req: NextRequest) {
  try {
    const { idToken, patientUid } = await req.json();

    if (!idToken) {
      return NextResponse.json(
        { success: false, error: "Unauthorized: No token provided" },
        { status: 401 }
      );
    }

    if (!patientUid || typeof patientUid !== "string") {
      return NextResponse.json(
        { success: false, error: "Missing patient UID" },
        { status: 400 }
      );
    }

    const isAdmin = await verifyAdminToken(idToken);
    if (!isAdmin) {
      return NextResponse.json(
        { success: false, error: "Unauthorized: Admin access required" },
        { status: 403 }
      );
    }

    const userRef = adminDb.collection("users").doc(patientUid);
    const patientRef = adminDb.collection("patient_records").doc(patientUid);

    const [userSnap, patientSnap, appointmentsSnap, patientBillingSnap] = await Promise.all([
      userRef.get(),
      patientRef.get(),
      adminDb.collection("appointments").where("patientId", "==", patientUid).get(),
      adminDb.collection("billing_records").where("patientId", "==", patientUid).get(),
    ]);

    if (!userSnap.exists && !patientSnap.exists && appointmentsSnap.empty && patientBillingSnap.empty) {
      return NextResponse.json(
        { success: false, error: "Patient data not found" },
        { status: 404 }
      );
    }

    const userRole = String(userSnap.data()?.role || "");
    if (userRole && userRole !== "client") {
      return NextResponse.json(
        { success: false, error: "Only patient/client accounts can be deleted from this action" },
        { status: 400 }
      );
    }

    const imageUrls = new Set<string>();

    const profilePhoto = String(userSnap.data()?.photoURL || "").trim();
    if (profilePhoto) imageUrls.add(profilePhoto);

    const billingRefs = new Map<string, DocumentReference>();
    patientBillingSnap.docs.forEach((doc) => billingRefs.set(doc.id, doc.ref));

    appointmentsSnap.docs.forEach((doc) => {
      const data = doc.data();
      const treatment = data?.treatment;
      const treatmentImages = Array.isArray(treatment?.imageUrls) ? treatment.imageUrls : [];

      treatmentImages.forEach((url: unknown) => {
        const value = String(url || "").trim();
        if (value) imageUrls.add(value);
      });

      billingRefs.set(doc.id, adminDb.collection("billing_records").doc(doc.id));
    });

    const deletePromises: Promise<unknown>[] = [];

    if (userSnap.exists) deletePromises.push(userRef.delete());
    if (patientSnap.exists) deletePromises.push(patientRef.delete());

    appointmentsSnap.docs.forEach((doc) => deletePromises.push(doc.ref.delete()));
    billingRefs.forEach((ref) => deletePromises.push(ref.delete().catch(() => null)));

    await Promise.all(deletePromises);

    let authDeleted = false;
    try {
      await adminAuth.deleteUser(patientUid);
      authDeleted = true;
    } catch (error) {
      console.error(`Failed to delete auth user ${patientUid}:`, error);
    }

    const imageResult = imageUrls.size > 0 ? await deleteImageUrls(imageUrls) : { deleted: 0, failed: 0 };

    return NextResponse.json({
      success: true,
      summary: {
        patientUid,
        appointmentsDeleted: appointmentsSnap.size,
        billingRecordsDeleted: billingRefs.size,
        authDeleted,
        imagesDeleted: imageResult.deleted,
        imagesFailed: imageResult.failed,
      },
    });
  } catch (error) {
    console.error("delete-patient route error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete patient" },
      { status: 500 }
    );
  }
}
