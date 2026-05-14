import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function loadEnvLocal() {
  const envPath = path.join(repoRoot, ".env.local");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function getAdminDb() {
  loadEnvLocal();
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not set.");
  }

  const serviceAccount = JSON.parse(raw);
  if (serviceAccount.private_key) {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
  }

  const app =
    getApps()[0] ||
    initializeApp({
      credential: cert(serviceAccount),
    });

  return getFirestore(app);
}

function getArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return "";
  return String(process.argv[idx + 1] || "").trim();
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function parsePdfCreationDate(pdfPath) {
  const raw = fs.readFileSync(pdfPath);
  const text = raw.toString("latin1");
  const match = text.match(/\/CreationDate\(D:(\d{14})/);

  if (!match) {
    throw new Error("No PDF CreationDate metadata found.");
  }

  const value = match[1];
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const hour = Number(value.slice(8, 10));
  const minute = Number(value.slice(10, 12));
  const second = Number(value.slice(12, 14));

  return {
    raw: value,
    date: `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`,
    time: `${value.slice(8, 10)}:${value.slice(10, 12)}`,
    asDate: new Date(year, month - 1, day, hour, minute, second, 0),
  };
}

async function run() {
  const appointmentId = getArg("--appointment-id") || getArg("--id");
  const pdfPathArg = getArg("--pdf");
  const apply = hasFlag("--apply");
  const setCreatedAt = hasFlag("--set-created-at");

  if (!appointmentId) {
    throw new Error("Missing --appointment-id <document-id>.");
  }
  if (!pdfPathArg) {
    throw new Error("Missing --pdf <path-to-pdf>.");
  }

  const pdfPath = path.resolve(pdfPathArg);
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`PDF not found: ${pdfPath}`);
  }

  const extracted = parsePdfCreationDate(pdfPath);
  const db = getAdminDb();
  const ref = db.collection("appointments").doc(appointmentId);
  const snap = await ref.get();

  if (!snap.exists) {
    throw new Error(`Appointment not found: ${appointmentId}`);
  }

  const current = snap.data() || {};
  const updates = {
    date: extracted.date,
    time: extracted.time,
  };

  if (setCreatedAt) {
    updates.createdAt = Timestamp.fromDate(extracted.asDate);
  }

  console.log(
    JSON.stringify(
      {
        appointmentId,
        pdfPath,
        pdfCreationDateRaw: extracted.raw,
        updates,
        current: {
          date: current.date || null,
          time: current.time || null,
          createdAt:
            typeof current.createdAt?.toDate === "function"
              ? current.createdAt.toDate().toISOString()
              : current.createdAt || null,
          serviceType: current.serviceType || null,
          status: current.status || null,
        },
      },
      null,
      2
    )
  );

  if (!apply) {
    console.log("\nDry run only. Re-run with --apply to write changes.");
    return;
  }

  await ref.set(updates, { merge: true });
  console.log("\nAppointment updated.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
