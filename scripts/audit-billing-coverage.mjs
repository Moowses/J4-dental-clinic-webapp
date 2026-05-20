import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

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
    if (!(key in process.env)) process.env[key] = value;
  }
}

function getAdminDb() {
  loadEnvLocal();
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not set.");
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

function getArg(name, fallback = "") {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] || fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function toIsoDate(value) {
  return String(value || "").trim().slice(0, 10);
}

function toTimestampMs(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function isImportedAppointment(appt) {
  return String(appt.notes || "").includes("Imported from Appoint.xlsx");
}

function getAppointmentSummary(appt, billing) {
  const totalBill = Number(appt?.treatment?.totalBill || 0);
  return {
    appointmentId: String(appt.id || ""),
    patientId: String(appt.patientId || ""),
    date: String(appt.date || ""),
    time: String(appt.time || ""),
    status: String(appt.status || ""),
    paymentStatus: String(appt.paymentStatus || ""),
    serviceType: String(appt.serviceType || ""),
    importedFromExcel: isImportedAppointment(appt),
    hasTreatment: !!appt.treatment,
    treatmentProcedures: Array.isArray(appt?.treatment?.procedures)
      ? appt.treatment.procedures.length
      : 0,
    treatmentTotalBill: Number.isFinite(totalBill) ? totalBill : 0,
    hasBillingRecord: !!billing,
    billingStatus: billing ? String(billing.status || "") : "",
    billingRemainingBalance: billing ? Number(billing.remainingBalance || 0) : 0,
    billingTotalAmount: billing ? Number(billing.totalAmount || 0) : 0,
  };
}

async function run() {
  const db = getAdminDb();
  const fromArg = toIsoDate(getArg("--from", ""));
  const toArg = toIsoDate(getArg("--to", ""));
  const source = String(getArg("--source", "all") || "all").toLowerCase();
  const limit = Math.max(1, Number.parseInt(getArg("--limit", "25"), 10) || 25);
  const json = hasFlag("--json");

  let appointmentsQuery = db.collection("appointments");
  if (fromArg) appointmentsQuery = appointmentsQuery.where("date", ">=", fromArg);
  if (toArg) appointmentsQuery = appointmentsQuery.where("date", "<=", toArg);

  const [appointmentsSnap, billingSnap] = await Promise.all([
    appointmentsQuery.get(),
    db.collection("billing_records").get(),
  ]);

  const appointments = appointmentsSnap.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));

  const billingByAppointmentId = new Map(
    billingSnap.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }])
  );

  const completedMissingBilling = [];
  const completedWithBilling = [];
  const completedWithoutTreatment = [];
  const nonCompletedWithBilling = [];

  for (const appt of appointments) {
    if (source === "imported" && !isImportedAppointment(appt)) continue;
    if (source === "non-imported" && isImportedAppointment(appt)) continue;

    const billing = billingByAppointmentId.get(appt.id) || null;
    const status = normalizeStatus(appt.status);
    const hasTreatment = !!appt.treatment;
    const totalBill = Number(appt?.treatment?.totalBill || 0);

    if (status === "completed") {
      if (billing) {
        completedWithBilling.push(getAppointmentSummary(appt, billing));
      } else if (hasTreatment || Number.isFinite(totalBill) && totalBill > 0) {
        completedMissingBilling.push(getAppointmentSummary(appt, null));
      } else {
        completedWithoutTreatment.push(getAppointmentSummary(appt, null));
      }
      continue;
    }

    if (billing) {
      nonCompletedWithBilling.push(getAppointmentSummary(appt, billing));
    }
  }

  const orphanBilling = billingSnap.docs
    .filter((doc) => !appointmentsSnap.docs.find((apptDoc) => apptDoc.id === doc.id))
    .map((doc) => ({
      billingId: doc.id,
      appointmentId: String(doc.data().appointmentId || doc.id),
      patientId: String(doc.data().patientId || ""),
      status: String(doc.data().status || ""),
      totalAmount: Number(doc.data().totalAmount || 0),
      remainingBalance: Number(doc.data().remainingBalance || 0),
      createdAtMs: toTimestampMs(doc.data().createdAt),
    }))
    .sort((a, b) => b.createdAtMs - a.createdAtMs);

  completedMissingBilling.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  completedWithBilling.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  completedWithoutTreatment.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  nonCompletedWithBilling.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

  const summary = {
    filters: {
      from: fromArg || null,
      to: toArg || null,
      source,
    },
    totals: {
      appointmentsScanned: appointments.length,
      billingRecordsScanned: billingSnap.size,
      completedWithBilling: completedWithBilling.length,
      completedMissingBilling: completedMissingBilling.length,
      completedWithoutTreatment: completedWithoutTreatment.length,
      nonCompletedWithBilling: nonCompletedWithBilling.length,
      orphanBilling: orphanBilling.length,
      importedCompletedMissingBilling: completedMissingBilling.filter((item) => item.importedFromExcel).length,
    },
    samples: {
      completedMissingBilling: completedMissingBilling.slice(0, limit),
      completedWithoutTreatment: completedWithoutTreatment.slice(0, limit),
      nonCompletedWithBilling: nonCompletedWithBilling.slice(0, limit),
      orphanBilling: orphanBilling.slice(0, limit),
    },
    notes: [
      "Booking an appointment does not create a billing record in this app.",
      "Billing is normally created after treatment completion via completeTreatmentAction/createBillingRecord.",
      "The Excel sync script writes appointments only and does not create billing_records.",
    ],
  };

  if (json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log("\nBilling coverage audit");
  console.log(JSON.stringify(summary.totals, null, 2));

  if (completedMissingBilling.length) {
    console.log("\nCompleted appointments missing billing:");
    console.table(completedMissingBilling.slice(0, limit));
  }

  if (completedWithoutTreatment.length) {
    console.log("\nCompleted appointments without treatment data:");
    console.table(completedWithoutTreatment.slice(0, limit));
  }

  if (nonCompletedWithBilling.length) {
    console.log("\nNon-completed appointments that already have billing:");
    console.table(nonCompletedWithBilling.slice(0, limit));
  }

  if (orphanBilling.length) {
    console.log("\nBilling records without matching appointments:");
    console.table(orphanBilling.slice(0, limit));
  }

  if (
    !completedMissingBilling.length &&
    !completedWithoutTreatment.length &&
    !nonCompletedWithBilling.length &&
    !orphanBilling.length
  ) {
    console.log("\nNo audit mismatches found for the selected filters.");
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
