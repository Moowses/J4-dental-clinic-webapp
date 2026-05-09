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

function normalizeName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\bma\./g, "ma")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const MANUAL_NAME_ALIASES = new Map([
  [normalizeName("Will Mark Torremocha"), normalizeName("Wil Mark Torremocha")],
  [normalizeName("Eunice Faith R. Lapid"), normalizeName("Eunice Faith Lapid")],
]);

function buildTimestamp(year, month, day, index, slot = "created") {
  const hourBase = slot === "created" ? 8 : 15;
  const minuteSeed = (index * 17 + (slot === "created" ? 11 : 29)) % 60;
  const hourOffset = Math.floor(index / 4) % 8;
  return Timestamp.fromDate(
    new Date(Date.UTC(year, month - 1, day, hourBase + hourOffset, minuteSeed, 0, 0))
  );
}

function pushEntries(target, year, month, day, names) {
  names.forEach((name, index) => {
    const normalized = normalizeName(name);
    if (!normalized) return;
    const current = target.get(normalized) || {
      originalName: String(name).trim(),
      occurrences: [],
    };
    current.occurrences.push({
      year,
      month,
      day,
      index,
      originalName: String(name).trim(),
    });
    target.set(normalized, current);
  });
}

function buildTimelineMap() {
  const entries = new Map();

  pushEntries(entries, 2026, 3, 10, [
    "Angelica Curtel",
    "Jerlyn Javison",
    "Gina Montilla",
    "Mary Dagondon",
    "Sarah Bauglo",
    "Jane Socorro",
    "Gina Montilla",
    "Nora Gumela",
    "Juwena Cuerpo",
    "Rodzma Juloh",
    "Jalima Melecio",
  ]);
  pushEntries(entries, 2026, 3, 11, [
    "Will Mark Torremocha",
    "John Michael Pelicano",
    "Maeleen Amencio",
    "Jobhe Correa",
    "Ronald Calamba",
    "Marry Montillano",
    "Keizer Bactasa",
    "Jocelyn Hamili",
    "Yoann Delos Santos",
    "Antens Torredes",
    "Racel Eboy",
    "Fredilyn Alcoseba",
  ]);
  pushEntries(entries, 2026, 3, 12, [
    "Trisha Anne Bautista",
    "Mark Angelo Fernandez",
    "Janelle Mae Rivera Santos",
    "Kyle Adrian Dela Cruz",
    "Eljay Mercado",
    "Joyce Ortega",
    "Carla Denise Garcia",
    "Patrick Corpuz",
    "Josh Carlo Sinahon",
    "Nicole Grace Villanueva",
    "Joshua Miguel Torres",
    "Chiella Mae Velasco",
    "Alyssa Kate Mendoza",
    "Lauren Perez",
    "Ethan James Navarro",
    "Eloise Arobo",
  ]);
  pushEntries(entries, 2026, 3, 13, [
    "Andre Luis Cabrera",
    "Princess Joy Alonzo",
    "Angelica Mae Flores",
    "John Carlo Ramirez",
    "Kevin Paul Gutierrez",
    "Mary Claire Evangelista",
    "Bea Louise Santos",
    "Nathaniel Cruz Reyes",
    "Denise Anne Mercado",
    "Adrian Kyle Navarro",
    "Ralph Christian Lopez",
    "Rhea Camille Lopez",
    "Kevin Matthew Ramos",
    "Angela Mae Castillo",
    "Bryan Jude Herrera",
    "Princess Joy Alvarez",
  ]);
  pushEntries(entries, 2026, 3, 16, [
    "Andre Luis Aquino",
    "Kyle Adrian Ramos",
    "Sean Lacsama",
    "Trisha Anne Dela Cruz",
    "Kyle Amedo",
    "Vince Miguel Torres",
    "Cheska Marie Lim",
    "Aaron James Navarro",
    "Krisha Mae Fernandez",
    "Elijah Paul Santos",
    "Mikaela Joy Reyes",
    "Janelle Mae Cabrera",
    "Nathaniel Cruz Lopez",
    "Mark Angelo Torres",
    "Kyle Adrian Mendoza",
  ]);
  pushEntries(entries, 2026, 3, 17, [
    "Janelle Mae Dizon",
    "Kyle Adrian Torres",
    "Trisha Anne Ramos",
    "Mark Vince Caballero",
    "Sean Miguel Bautista",
    "Krisha Mae Flores",
    "Jeric Paul Navarro",
    "Camille Zoe Peralta",
    "Maria Jean Santos",
    "Nathan James Cruz",
  ]);
  pushEntries(entries, 2026, 3, 18, [
    "Jared Neil Caballero",
    "Kyla Mae Villanueva",
    "Janelle Mae Bautista",
    "Alyana Faith Mendoza",
    "Kyle Andrei Mendoza",
    "Alyssa Joy Navarro",
    "Darren Miguel Ramos",
    "Trisha Anne Flores",
    "Cedrick Paul Villanueva",
    "Nicole Faith Garcia",
  ]);
  pushEntries(entries, 2026, 3, 19, [
    "Camille Joy Navarro",
    "Sean Patrick Dela Cruz",
    "Andrea Faith Molina",
    "Vince Raphael Aquino",
    "Jericho Dane Castillo",
    "Ethan Miguel Perez",
    "Carlo Vincent Herrera",
    "Hazel Marie Dominguez",
    "Zyra Mae Madriaga",
    "Kean Dominic Balmes",
  ]);
  pushEntries(entries, 2026, 3, 20, [
    "Francine Joy Tizon",
    "Dwayne Karl Lanticse",
    "Tricia Anne Maboloc",
    "Jiro Nathaniel Casiple",
    "Elisha Kate Palanas",
    "Raven Miguel Cabalquinto",
    "Janica Pear Barte",
    "Tyrone Jade Paderanga",
    "Maica Rose Almeria",
    "Aldrin Seth Bation",
    "Kian Raphael Suan",
    "Danica Faith Tumulak",
  ]);
  pushEntries(entries, 2026, 3, 22, [
    "Jamaica Naval",
    "Adrian Morales",
    "John Rey Limosa",
    "Mikaela Joy Vista",
    "Trisha Mae Abarra",
    "Christian Dave Basalo",
    "Eloise Campoy",
  ]);
  pushEntries(entries, 2026, 3, 23, [
    "Elaine Espinosa",
    "Jan Joseph Tan",
    "Angel Mae David",
    "Cyril Fernandez",
    "Charize Rosales",
    "Maria Fe Alvarez",
    "Flore Amador",
  ]);
  pushEntries(entries, 2026, 3, 24, [
    "Irish Javier",
    "Meredith Balabat",
    "Ma. Kimberly Laurente",
    "Oliver Jhon Sevilla",
    "Joshua Olivarez",
    "Vanessa Marie Chavez",
    "Eunice Faith R. Lapid",
  ]);
  pushEntries(entries, 2026, 3, 25, [
    "John Henry Solano",
    "Hannah Mae De Leon",
    "Dexter Damasco",
    "Jeanamie Lopez",
    "Pauline Mae Manalo",
    "Patrick Flloyd Ramirez",
    "Mary Jane Zurbano",
  ]);
  pushEntries(entries, 2026, 3, 26, [
    "Levi Ocampo",
    "Jasmine Joy Malco",
    "Arlene Daganos",
    "Danilyn Esteves",
    "Joymie Talaro",
    "Ritchelle Mae Quilao",
    "Godfrey Padilla",
  ]);
  pushEntries(entries, 2026, 3, 27, [
    "Ray Anthony Espinosa",
    "Julie Anne Asis",
    "Francis Harold Callos",
    "Steve Angelo Cruz",
    "Cherry Mae Salas",
    "Kathleen Mae Alvar",
    "John Edward Natividad",
  ]);
  pushEntries(entries, 2026, 3, 30, [
    "Erica Faith Rivas",
    "Irishlyn Sadullo",
    "Bryle Vincent Labis",
    "Ynah Claire Manguera",
    "Shaira Mae Banogon",
    "Kobe Allen Dumlao",
    "zedrickjamesagpaoa",
    "Aaron James Navarro",
  ]);
  pushEntries(entries, 2026, 4, 6, [
    "Marian Rose Ricar",
    "Althea Nerie Fernando",
    "Luca Paguro",
    "Athena Faith Kastila",
    "Rianne Lee",
    "Celyn Diaz",
    "Miguel Hernando",
  ]);
  pushEntries(entries, 2026, 4, 7, [
    "Coleen Panteros",
    "Merable Gloria",
    "Gillian Montemor",
    "Christina Juan",
    "Kirstine Largo",
    "Linalyn Ugyop",
    "Frances Naliza",
  ]);
  pushEntries(entries, 2026, 4, 8, [
    "Miguelito Gueriro",
    "Jazzy Rollerga",
    "Vallentina Trinidad",
    "Arvy Sansano",
    "Cherry Wong",
    "Mia Estallo",
    "Clint Balili",
  ]);
  pushEntries(entries, 2026, 4, 9, [
    "Loid Rey",
    "Lana Claire Alcantara",
    "Florencia Cruz",
    "Ariel Castillo",
    "Shamera Caspe",
    "Brianne Albios",
    "Glexie Causapin",
  ]);
  pushEntries(entries, 2026, 4, 10, [
    "Jake Flores",
    "Alberto Scorfano",
    "Andrea Pillaryo",
    "Sophie Miranda",
    "George Badilla",
    "Randell Arvon",
    "Marialyn Clee",
  ]);
  pushEntries(entries, 2026, 4, 11, [
    "Jholeen Catallo",
    "Nelfaye Laurente",
    "Gabben Arellano",
    "Zyanna Quidoc",
    "Pj Montaos",
    "Irish Mae Montalban",
    "Marcky Gonzales",
  ]);
  pushEntries(entries, 2026, 4, 12, [
    "Kathleen Mae Alvar",
    "John Edward Natividad",
    "David Ocampo",
    "Paul Daniel Cabral",
    "Ruby Jean Tolentino",
  ]);
  pushEntries(entries, 2026, 4, 13, [
    "Lira Mae Obguia",
    "Mhedy Balinag",
    "Lilian O. Masillones",
    "Christoper Dagsil",
    "Mike Juvert C. Agravante",
    "Ralph Laurence Albinda",
  ]);
  pushEntries(entries, 2026, 4, 14, [
    "Mikaela Faye Adtoon",
    "Sanya Ombania",
    "Princess Encornal",
    "Angelo Rulida",
    "David Ocampo",
    "Paul Daniel Cabral",
    "Ruby Jean Tolentino",
  ]);
  pushEntries(entries, 2026, 4, 15, [
    "Jesse James Cortez",
    "Sophia Camille Ponce",
    "Yvonne Dasilao",
    "Aaron Jude Pedroso",
    "Justine Ray Bueno",
    "Dominique Gabion",
    "Ericson Oraca",
  ]);
  pushEntries(entries, 2026, 4, 16, [
    "Carla Joy Villanueva",
    "Jeff Ryan Tutor",
    "Diane Lustria",
    "Chelsea Mae Cero",
    "Charamie Casili",
    "Dwight Abalona",
  ]);
  pushEntries(entries, 2026, 4, 17, [
    "Sunshine Plazon",
    "Roxanne Anne Baya",
    "Clarisse Mae Badilles",
    "Daryl Sean Canete",
    "Joshua Liam Torres",
    "Mikaela Rose Perez",
    "Enzo Rafael Santos",
    "Shane Louise Domingo",
    "Bryan Miguel Santos",
    "Bryle Adrian Lopez",
  ]);

  return entries;
}

function compareOccurrence(a, b) {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  if (a.day !== b.day) return a.day - b.day;
  return a.index - b.index;
}

function buildLookupPayload(entry) {
  const occurrences = [...entry.occurrences].sort(compareOccurrence);
  const first = occurrences[0];
  const last = occurrences[occurrences.length - 1];
  return {
    originalName: entry.originalName,
    occurrences,
    createdAt: buildTimestamp(first.year, first.month, first.day, first.index, "created"),
    updatedAt: buildTimestamp(last.year, last.month, last.day, last.index, "updated"),
  };
}

function scoreCandidate(targetName, candidateName) {
  const targetTokens = new Set(normalizeName(targetName).split(" ").filter(Boolean));
  const candidateTokens = new Set(normalizeName(candidateName).split(" ").filter(Boolean));
  if (!targetTokens.size || !candidateTokens.size) return 0;

  let overlap = 0;
  for (const token of targetTokens) {
    if (candidateTokens.has(token)) overlap += 1;
  }

  const targetLast = [...targetTokens].at(-1) || "";
  const candidateLast = [...candidateTokens].at(-1) || "";
  const lastNameBonus = targetLast && candidateLast && targetLast === candidateLast ? 2 : 0;

  return overlap + lastNameBonus;
}

async function fetchClientUsers(db) {
  const snap = await db.collection("users").where("role", "==", "client").get();
  return snap.docs.map((doc) => {
    const data = doc.data() || {};
    const displayName = String(data.displayName || "").trim();
    return {
      uid: doc.id,
      displayName,
      normalizedDisplayName: normalizeName(displayName),
      email: String(data.email || "").trim(),
    };
  });
}

async function fetchPatientRecordName(db, uid) {
  const snap = await db.collection("patient_records").doc(uid).get();
  if (!snap.exists) return "";
  const data = snap.data() || {};
  const name = data?.registration?.personal_information?.name || {};
  return [name.first_name, name.middle_initial, name.last_name]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

async function run() {
  const apply = process.argv.includes("--apply");
  const db = getAdminDb();
  const timeline = buildTimelineMap();
  const users = await fetchClientUsers(db);

  const byNormalizedName = new Map();
  for (const user of users) {
    const key = user.normalizedDisplayName;
    if (!key) continue;
    const list = byNormalizedName.get(key) || [];
    list.push(user);
    byNormalizedName.set(key, list);
  }

  const updates = [];
  const unmatched = [];
  const ambiguous = [];

  for (const [normalizedName, entry] of timeline.entries()) {
    const payload = buildLookupPayload(entry);
    const lookupNames = [normalizedName];
    const aliasName = MANUAL_NAME_ALIASES.get(normalizedName);
    if (aliasName && aliasName !== normalizedName) {
      lookupNames.push(aliasName);
    }

    let matches = [];
    for (const lookupName of lookupNames) {
      matches = byNormalizedName.get(lookupName) || [];
      if (matches.length) break;
    }

    if (matches.length > 1) {
      const filtered = [];
      for (const user of matches) {
        const recordName = normalizeName(await fetchPatientRecordName(db, user.uid));
        if (recordName === normalizedName) {
          filtered.push(user);
        }
      }
      if (filtered.length === 1) {
        matches = filtered;
      } else if (filtered.length > 1) {
        matches = filtered;
      }
    }

    if (matches.length === 0) {
      const suggestions = users
        .map((user) => ({
          uid: user.uid,
          displayName: user.displayName,
          email: user.email,
          score: scoreCandidate(payload.originalName, user.displayName),
        }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName))
        .slice(0, 5);

      unmatched.push({
        name: payload.originalName,
        suggestions,
      });
      continue;
    }

    if (matches.length > 1) {
      ambiguous.push({
        name: payload.originalName,
        matches: matches.map((user) => ({
          uid: user.uid,
          displayName: user.displayName,
          email: user.email,
        })),
      });
      continue;
    }

    updates.push({
      uid: matches[0].uid,
      displayName: matches[0].displayName,
      email: matches[0].email,
      originalName: payload.originalName,
      occurrences: payload.occurrences,
      createdAt: payload.createdAt,
      updatedAt: payload.updatedAt,
    });
  }

  console.log(`Matched patients: ${updates.length}`);
  console.log(`Unmatched patients: ${unmatched.length}`);
  console.log(`Ambiguous patients: ${ambiguous.length}`);

  if (unmatched.length) {
    console.log("\nUnmatched:");
    unmatched.forEach((item) => {
      console.log(`- ${item.name}`);
      item.suggestions.forEach((suggestion) => {
        console.log(
          `  maybe uid=${suggestion.uid} name=${suggestion.displayName} email=${suggestion.email} score=${suggestion.score}`
        );
      });
    });
  }

  if (ambiguous.length) {
    console.log("\nAmbiguous:");
    ambiguous.forEach((item) => {
      console.log(`- ${item.name}`);
      item.matches.forEach((match) => {
        console.log(`  uid=${match.uid} name=${match.displayName} email=${match.email}`);
      });
    });
  }

  console.log("\nMatched preview:");
  updates.slice(0, 20).forEach((item) => {
    console.log(
      `- ${item.originalName} -> ${item.uid} | createdAt=${item.createdAt.toDate().toISOString()} | updatedAt=${item.updatedAt.toDate().toISOString()}`
    );
  });

  if (!apply) {
    console.log("\nDry run only. Re-run with --apply to write changes.");
    return;
  }

  if (ambiguous.length) {
    throw new Error("Refusing to apply while ambiguous patients remain.");
  }

  const batchSize = 250;
  for (let i = 0; i < updates.length; i += batchSize) {
    const chunk = updates.slice(i, i + batchSize);
    const batch = db.batch();
    chunk.forEach((item) => {
      batch.set(
        db.collection("users").doc(item.uid),
        { createdAt: item.createdAt },
        { merge: true }
      );
      batch.set(
        db.collection("patient_records").doc(item.uid),
        { updatedAt: item.updatedAt },
        { merge: true }
      );
    });
    await batch.commit();
  }

  console.log(`\nApplied updates for ${updates.length} patients.`);
  if (unmatched.length) {
    console.log(`Skipped ${unmatched.length} unmatched patient(s).`);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
