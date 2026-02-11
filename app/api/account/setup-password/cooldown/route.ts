import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/server";

const WINDOW_SECONDS = 120;

function getIp(req: NextRequest) {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

function keyFromIp(ip: string) {
  return createHash("sha256").update(ip).digest("hex");
}

async function getRemainingSeconds(docId: string) {
  const ref = adminDb.collection("password_setup_cooldowns").doc(docId);
  const snap = await ref.get();
  if (!snap.exists) return 0;
  const until = snap.data()?.cooldownUntil;
  if (!until?.toDate) return 0;
  const ms = until.toDate().getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / 1000) : 0;
}

export async function GET(req: NextRequest) {
  try {
    const ip = getIp(req);
    const docId = keyFromIp(ip);
    const remaining = await getRemainingSeconds(docId);
    return NextResponse.json({ success: true, remaining });
  } catch {
    return NextResponse.json({ success: false, remaining: 0 }, { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ip = getIp(req);
    const docId = keyFromIp(ip);
    const ref = adminDb.collection("password_setup_cooldowns").doc(docId);
    const remaining = await getRemainingSeconds(docId);
    if (remaining > 0) {
      return NextResponse.json({ success: true, remaining });
    }

    const untilMs = Date.now() + WINDOW_SECONDS * 1000;
    await ref.set(
      {
        cooldownUntil: Timestamp.fromDate(new Date(untilMs)),
        updatedAt: Timestamp.now(),
      },
      { merge: true }
    );

    return NextResponse.json({ success: true, remaining: WINDOW_SECONDS });
  } catch {
    return NextResponse.json({ success: false, remaining: 0 }, { status: 200 });
  }
}

