import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
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

function getArg(name, fallback = "") {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  return String(process.argv[idx + 1] || fallback).trim();
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeService(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*\(\s*/g, " (")
    .replace(/\s*\)\s*/g, ")")
    .replace(/\s+,/g, ",");
}

function formatExcelSerialTime(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";

  const totalMinutes = Math.round(numeric * 24 * 60);
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatExcelSerialDate(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";

  const excelEpochUtc = Date.UTC(1899, 11, 30);
  const asDate = new Date(excelEpochUtc + numeric * 24 * 60 * 60 * 1000);
  if (Number.isNaN(asDate.getTime())) return "";

  const year = asDate.getUTCFullYear();
  const month = String(asDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(asDate.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeTime(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  if (/^\d+(\.\d+)?$/.test(raw)) {
    return formatExcelSerialTime(raw);
  }

  const compact = raw.replace(/\s+/g, " ").replace(/\s*:\s*/g, ":");
  const match = compact.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!match) return compact;

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const suffix = match[4].toUpperCase();

  if (suffix === "AM") {
    if (hour === 12) hour = 0;
  } else if (hour !== 12) {
    hour += 12;
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  if (/^\d+(\.\d+)?$/.test(raw)) {
    return formatExcelSerialDate(raw);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return raw;
  }

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getTimestampForSchedule(date, time) {
  if (!date || !time) return Timestamp.now();
  const iso = `${date}T${time}:00+08:00`;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return Timestamp.now();
  return Timestamp.fromDate(parsed);
}

function getTimestampForLoggedAt(loggedAt, fallbackDate, fallbackTime) {
  const raw = String(loggedAt || "").trim();
  if (raw) {
    const normalized = raw.replace(/\s*-\s*/g, " ").replace(/\s+/g, " ").trim();
    const parsed = new Date(`${normalized} GMT+0800`);
    if (!Number.isNaN(parsed.getTime())) {
      return Timestamp.fromDate(parsed);
    }
  }
  return getTimestampForSchedule(fallbackDate, fallbackTime);
}

function dedupeRows(rows) {
  const byKey = new Map();

  for (const row of rows) {
    const key = [row.email, row.date, row.time, normalizeService(row.service)].join("|");
    byKey.set(key, row);
  }

  return Array.from(byKey.values());
}

function parseRowsFromWorkbook(workbookPath) {
  const parserScript = `
Add-Type -AssemblyName System.IO.Compression.FileSystem
$path = '${workbookPath.replace(/'/g, "''")}'
$zip = [System.IO.Compression.ZipFile]::OpenRead($path)
function Get-EntryText([string]$name) {
  $entry = $zip.GetEntry($name)
  if (-not $entry) { return $null }
  $reader = New-Object System.IO.StreamReader($entry.Open())
  $text = $reader.ReadToEnd()
  $reader.Dispose()
  return $text
}
$nsUri = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
$sharedDoc = New-Object System.Xml.XmlDocument
$sharedDoc.LoadXml((Get-EntryText 'xl/sharedStrings.xml'))
$sharedNs = New-Object System.Xml.XmlNamespaceManager($sharedDoc.NameTable)
$sharedNs.AddNamespace('x', $nsUri)
$shared = @()
foreach ($si in $sharedDoc.SelectNodes('//x:si', $sharedNs)) {
  $texts = $si.SelectNodes('.//x:t', $sharedNs) | ForEach-Object { $_.'#text' }
  $shared += (($texts -join '') -replace '\\s+$','')
}
$sheetDoc = New-Object System.Xml.XmlDocument
$sheetDoc.LoadXml((Get-EntryText 'xl/worksheets/sheet1.xml'))
$sheetNs = New-Object System.Xml.XmlNamespaceManager($sheetDoc.NameTable)
$sheetNs.AddNamespace('x', $nsUri)
$rows = @()
foreach ($row in $sheetDoc.SelectNodes('//x:sheetData/x:row', $sheetNs)) {
  $cells = @{}
  foreach ($c in $row.SelectNodes('./x:c', $sheetNs)) {
    $ref = [string]$c.r
    $col = ($ref -replace '\\d', '')
    $type = [string]$c.t
    $vNode = $c.SelectSingleNode('./x:v', $sheetNs)
    $raw = if ($vNode) { [string]$vNode.InnerText } else { '' }
    $value = if ($type -eq 's') { $shared[[int]$raw] } else { $raw }
    $cells[$col] = [string]$value
  }
      $rows += [PSCustomObject]@{
        Name = [string]($cells['A'])
        Email = [string]($cells['B'])
        Service = [string]($cells['C'])
        Time = [string]($cells['D'])
        Date = [string]($cells['E'])
        LoggedAt = [string]($cells['F'])
      }
}
$zip.Dispose()
$rows | ConvertTo-Json -Depth 3 -Compress
`;

  const raw = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", parserScript],
    {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  const parsed = JSON.parse(raw);
  const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];

  return dedupeRows(
    rows
    .map((row) => ({
      name: String(row.Name || "").trim(),
      email: normalizeEmail(row.Email),
      service: String(row.Service || "").trim(),
      time: normalizeTime(row.Time),
      date: normalizeDate(row.Date),
      loggedAt: String(row.LoggedAt || "").trim(),
    }))
    .filter((row) => {
      if (!row.name && !row.email && !row.service && !row.time && !row.date) return false;
      if (row.name && !row.email && !row.service && !row.time && !row.date) return false;
      if (normalizeEmail(row.email) === "email") return false;
      if (row.name.toLowerCase() === "name") return false;
      return true;
    })
  );
}

function buildAppointmentMaps(appointments) {
  const byPatient = new Map();
  for (const appt of appointments) {
    const patientId = String(appt.patientId || "").trim();
    if (!patientId) continue;
    const bucket = byPatient.get(patientId) || [];
    bucket.push(appt);
    byPatient.set(patientId, bucket);
  }
  return byPatient;
}

function getMatchState(matchStateByPatient, patientId, appointments) {
  if (!matchStateByPatient.has(patientId)) {
    matchStateByPatient.set(patientId, {
      appointments,
      usedIds: new Set(),
    });
  }
  return matchStateByPatient.get(patientId);
}

async function deleteRefsInBatches(refs, batchSize = 400) {
  let deleted = 0;
  for (let i = 0; i < refs.length; i += batchSize) {
    const chunk = refs.slice(i, i + batchSize);
    await Promise.all(chunk.map((ref) => ref.delete()));
    deleted += chunk.length;
  }
  return deleted;
}

async function run() {
  const workbookArg = getArg("--xlsx", "C:\\Users\\Mosses1\\Documents\\damla\\Appoint.xlsx");
  const workbookPath = path.resolve(workbookArg);
  const apply = hasFlag("--apply");
  const markCompleted = !hasFlag("--keep-pending");
  const showActions = hasFlag("--show-actions");
  const replaceAll = hasFlag("--replace-all");

  if (!fs.existsSync(workbookPath)) {
    throw new Error(`Workbook not found: ${workbookPath}`);
  }

  const db = getAdminDb();
  const rows = parseRowsFromWorkbook(workbookPath);

  const [usersSnap, appointmentsSnap, billingSnap] = await Promise.all([
    db.collection("users").where("role", "==", "client").get(),
    db.collection("appointments").get(),
    db.collection("billing_records").get(),
  ]);

  const usersByEmail = new Map();
  usersSnap.docs.forEach((doc) => {
    const data = doc.data() || {};
    const email = normalizeEmail(data.email);
    if (!email) return;
    usersByEmail.set(email, { uid: doc.id, ...data });
  });

  const appointments = appointmentsSnap.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
  const appointmentsByPatient = buildAppointmentMaps(appointments);
  const matchStateByPatient = new Map();

  const summary = {
    workbookPath,
    totalRows: rows.length,
    replaceAll,
    existingAppointments: appointmentsSnap.size,
    existingBillingRecords: billingSnap.size,
    matchedExact: 0,
    createCount: 0,
    updateServiceCount: 0,
    updateTimeCount: 0,
    updateServiceAndTimeCount: 0,
    missingUsers: [],
    ambiguousSameDay: [],
    invalidRows: [],
    actions: [],
  };

  for (const row of rows) {
    if (!row.email || !row.date || !row.time || !row.service) {
      summary.invalidRows.push(row);
      continue;
    }

    const user = usersByEmail.get(row.email);
    if (!user) {
      summary.missingUsers.push(row);
      continue;
    }

    const patientId = String(user.uid || "").trim();
    const allPatientAppointments = appointmentsByPatient.get(patientId) || [];
    const matchState = getMatchState(matchStateByPatient, patientId, allPatientAppointments);
    const patientAppointments = matchState.appointments.filter(
      (appt) => !matchState.usedIds.has(appt.id)
    );

    if (replaceAll) {
      summary.createCount += 1;
      const loggedTimestamp = getTimestampForLoggedAt(row.loggedAt, row.date, row.time);
      summary.actions.push({
        type: "create",
        uid: patientId,
        email: row.email,
        payload: {
          patientId,
          serviceType: row.service,
          date: row.date,
          time: row.time,
          notes: "Imported from Appoint.xlsx",
          status: markCompleted ? "completed" : "pending",
          paymentStatus: "unpaid",
          createdAt: loggedTimestamp,
          updatedAt: loggedTimestamp,
        },
      });
      continue;
    }

    const exact = patientAppointments.find((appt) => {
      return (
        String(appt.date || "").trim() === row.date &&
        String(appt.time || "").trim() === row.time &&
        normalizeService(appt.serviceType) === normalizeService(row.service)
      );
    });

    if (exact) {
      summary.matchedExact += 1;
      matchState.usedIds.add(exact.id);
      continue;
    }

    const sameDateTime = patientAppointments.find((appt) => {
      return String(appt.date || "").trim() === row.date && String(appt.time || "").trim() === row.time;
    });
    if (sameDateTime) {
      summary.updateServiceCount += 1;
      matchState.usedIds.add(sameDateTime.id);
      summary.actions.push({
        type: "update-service",
        appointmentId: sameDateTime.id,
        uid: patientId,
        email: row.email,
        updates: {
          serviceType: row.service,
          ...(markCompleted ? { status: "completed" } : {}),
        },
      });
      continue;
    }

    const sameDayService = patientAppointments.find((appt) => {
      return (
        String(appt.date || "").trim() === row.date &&
        normalizeService(appt.serviceType) === normalizeService(row.service)
      );
    });
    if (sameDayService) {
      summary.updateTimeCount += 1;
      matchState.usedIds.add(sameDayService.id);
      summary.actions.push({
        type: "update-time",
        appointmentId: sameDayService.id,
        uid: patientId,
        email: row.email,
        updates: {
          time: row.time,
          ...(markCompleted ? { status: "completed" } : {}),
        },
      });
      continue;
    }

    const sameDayAppointments = patientAppointments.filter(
      (appt) => String(appt.date || "").trim() === row.date
    );
    if (sameDayAppointments.length === 1) {
      summary.updateServiceAndTimeCount += 1;
      matchState.usedIds.add(sameDayAppointments[0].id);
      summary.actions.push({
        type: "update-service-and-time",
        appointmentId: sameDayAppointments[0].id,
        uid: patientId,
        email: row.email,
        updates: {
          serviceType: row.service,
          time: row.time,
          ...(markCompleted ? { status: "completed" } : {}),
        },
      });
      continue;
    }

    if (sameDayAppointments.length > 1) {
      summary.ambiguousSameDay.push({
        row,
        user: {
          uid: user.uid,
          displayName: user.displayName || "",
        },
        appointments: sameDayAppointments.map((appt) => ({
          id: appt.id,
          date: appt.date || "",
          time: appt.time || "",
          serviceType: appt.serviceType || "",
          status: appt.status || "",
        })),
      });
      continue;
    }

    summary.createCount += 1;
    const scheduleTimestamp = getTimestampForSchedule(row.date, row.time);
    summary.actions.push({
      type: "create",
      uid: patientId,
      email: row.email,
      payload: {
        patientId,
        serviceType: row.service,
        date: row.date,
        time: row.time,
        notes: "Imported from Appoint.xlsx",
        status: markCompleted ? "completed" : "pending",
        paymentStatus: "unpaid",
        createdAt: scheduleTimestamp,
        updatedAt: scheduleTimestamp,
      },
    });
  }

  const preview = {
    workbookPath: summary.workbookPath,
    totalRows: summary.totalRows,
    replaceAll: summary.replaceAll,
    existingAppointments: summary.existingAppointments,
    existingBillingRecords: summary.existingBillingRecords,
    matchedExact: summary.matchedExact,
    createCount: summary.createCount,
    updateServiceCount: summary.updateServiceCount,
    updateTimeCount: summary.updateTimeCount,
    updateServiceAndTimeCount: summary.updateServiceAndTimeCount,
    missingUsers: summary.missingUsers,
    invalidRows: summary.invalidRows,
    ambiguousSameDay: summary.ambiguousSameDay,
    ...(showActions ? { actions: summary.actions } : {}),
  };

  console.log(JSON.stringify(preview, null, 2));

  if (!apply) {
    console.log("\nDry run only. Re-run with --apply to write changes.");
    return;
  }

  if (summary.ambiguousSameDay.length > 0) {
    throw new Error(
      `Refusing to write because ${summary.ambiguousSameDay.length} rows have multiple same-day appointments.`
    );
  }

  if (summary.invalidRows.length > 0) {
    throw new Error(`Refusing to write because ${summary.invalidRows.length} rows are incomplete.`);
  }

  let deletedAppointments = 0;
  let deletedBillingRecords = 0;
  if (replaceAll) {
    deletedBillingRecords = await deleteRefsInBatches(billingSnap.docs.map((doc) => doc.ref));
    deletedAppointments = await deleteRefsInBatches(appointmentsSnap.docs.map((doc) => doc.ref));
  }

  let writes = 0;
  for (const action of summary.actions) {
    if (action.type === "create") {
      await db.collection("appointments").add(action.payload);
      writes += 1;
      continue;
    }

    await db.collection("appointments").doc(action.appointmentId).set(action.updates, { merge: true });
    writes += 1;
  }

  console.log(
    `\nApplied ${writes} Firestore write(s).` +
      (replaceAll
        ? ` Deleted ${deletedAppointments} appointment(s) and ${deletedBillingRecords} billing record(s) first.`
        : "")
  );
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
