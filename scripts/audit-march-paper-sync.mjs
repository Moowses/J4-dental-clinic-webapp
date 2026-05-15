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

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeService(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\(metal\)/g, "(metal)")
    .replace(/\(metal\)/g, "(metal)");
}

function normalizeTime(value) {
  const raw = String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*:\s*/g, ":");
  const m = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
  if (!m) return raw;
  let hour = Number(m[1]);
  const minute = m[2];
  const suffix = m[3].toUpperCase();
  if (suffix === "AM") {
    if (hour === 12) hour = 0;
  } else if (hour !== 12) {
    hour += 12;
  }
  return `${String(hour).padStart(2, "0")}:${minute}`;
}

function row(date, name, email, service, time) {
  return {
    date,
    name,
    email: normalizeEmail(email),
    service,
    serviceKey: normalizeService(service),
    time: normalizeTime(time),
  };
}

const paperRows = [
  row("2026-03-10", "Angelica Curtel", "anwgelicacortel@gmail.com", "Braces", "9:00:00 AM"),
  row("2026-03-10", "Jerlyn Javison", "jerlyn123@gmail.com", "Braces", "9:00:00 AM"),
  row("2026-03-10", "Jowena Cuerpo", "jowenacuerpo1@gmail.com", "Odontectomy", "11:00:00 AM"),
  row("2026-03-10", "Sala Bauglo", "bauglosarah000@gmail.com", "Braces", "1:00:00 PM"),
  row("2026-03-10", "Mary Dagondon", "marydagondon2@gmail.com", "Tooth Restoration", "1:00:00 PM"),
  row("2026-03-10", "Nora Gumela", "gumela.nora7466@gmail.com", "Braces", "2:00:00 PM"),

  row("2026-03-11", "Maeleen Amencio", "maeleenamencio@gmail.com", "Veneers", "9:00:00 AM"),
  row("2026-03-11", "Jobhe Correa", "jobhecorrea@gmail.com", "Tooth Extraction", "9:00:00 AM"),
  row("2026-03-11", "Ronald Calamba", "romnaldcalamba@gmail.com", "Tooth Extraction", "10:00:00 AM"),
  row("2026-03-11", "Marry Montillano", "marrymontillano@gmail.com", "Braces", "10:00:00 AM"),

  row("2026-03-12", "Kyle Adrian Dela Cruz", "kyle.delacruz21@gmail.com", "Tooth Restoration", "9:00:00 AM"),
  row("2026-03-12", "Carla Denise Garcia", "carla.garcia.denise@gmail.com", "Braces", "11:00:00 AM"),
  row("2026-03-12", "Patrick Corpuz", "patrickcorpuz@gmail.com", "Cleaning", "11:00:00 AM"),
  row("2026-03-12", "Josh Carlo Sinahon", "joshsinahon2003@gmail.com", "Braces", "1:00:00 AM"),
  row("2026-03-12", "Chiella Mae Velasco", "chiellavelasco@gmail.com", "Braces", "2:00:00 PM"),
  row("2026-03-12", "Lauren Perez", "laurenprz@gmail.com", "Tooth Restoration", "3:00:00 PM"),
  row("2026-03-12", "Eloise Arobo", "eloiseearobo@gmail.com", "Tooth Restoration", "4:00:00 PM"),

  row("2026-03-13", "Princess Joy Alonzo", "princess.alonzo.joy@gmail.com", "Braces", "8:00:00 AM"),
  row("2026-03-13", "John Carlo Ramirez", "johncarloramirez21@gmail.com", "Veneers", "9:00:00 AM"),
  row("2026-03-13", "Kevin Paul Gutierrez", "kevin.gutierrez.ph@gmail.com", "Tooth Restoration", "10:00:00 AM"),
  row("2026-03-13", "Mary Claire Evangelista", "maryclaire.evangelista@gmail.com", "Tooth Extraction", "10:00:00 AM"),
  row("2026-03-13", "Nathaniel Cruz Reyes", "nathaniel.reyes.cruz@gmail.com", "Braces", "11:00:00 AM"),
  row("2026-03-13", "Rhea Camille Lopez", "rhea.lopez.camille@gmail.com", "Braces", "2:00:00 PM"),

  row("2026-03-16", "Kyle Amedo", "kyle.amedo14@gmail.com", "Braces", "1:00:00 PM"),
  row("2026-03-16", "Krisha Mae Fernandez", "krishamaefdz@gmail.com", "Tooth Extraction", "10:00:00 PM"),
  row("2026-03-16", "Mikaela Joy Reyes", "mikaelajreyes@gmail.com", "Tooth Extraction", "2:00:00 PM"),
  row("2026-03-16", "Nathaniel Cruz Lopez", "mikaelajreyes@gmail.com", "Braces", "3:00:00 PM"),

  row("2026-03-17", "Janelle Mae Dizon", "janelle.dizon01@gmail.com", "Veneers", "8:00:00 PM"),
  row("2026-03-17", "Kyle Adrian Torres", "kyleatorres98@gmail.com", "Braces", "8:00:00 AM"),
  row("2026-03-17", "Krisha Mae Flores", "krishaflores03@gmail.com", "Cleaning", "10:00:00 AM"),
  row("2026-03-17", "Camille Zoe Peralta", "camillezoe01@gmail.com", "Cleaning", "2:00:00 PM"),

  row("2026-03-18", "Kyle Andrei Mendoza", "kyleandreimendoza@gmail.com", "Braces", "10:00:00 AM"),
  row("2026-03-18", "Darren Miguel Ramos", "darrenmiguelramos@gmail.com", "Tooth Extraction", "11:00:00 AM"),
  row("2026-03-18", "Trisha Anne Flores", "trishaanneflores@gmail.com", "Tooth Extraction", "11:00:00 AM"),
  row("2026-03-18", "Nicole Faith Garcia", "nicolefaithgarcia@gmail.com", "Veneers", "1:00:00 PM"),
  row("2026-03-18", "Bryle Adrian Lopez", "bryleadrianlopez@gmail.com", "Veneers", "4:00:00 PM"),

  row("2026-03-19", "Sean Patrick Dela Cruz", "seanpatrickdc00@gmail.com", "Hawley (metal)", "8:00:00 AM"),
  row("2026-03-19", "Vince Raphael Aquino", "vinceraphaelaquino98@gmail.com", "Veneers", "9:00:00 AM"),
  row("2026-03-19", "Jericho Dane Castillo", "jerichodanecastillo96@gmail.com", "Cleaning", "2:00:00 PM"),
  row("2026-03-19", "Ethan Miguel Perez", "ethanmiguelperez02@gmail.com", "Hawley (metal)", "2:00:00 PM"),
  row("2026-03-19", "Hazel Marie Dominguez", "hazelmariedominguez97@gmail.com", "Clear retainer", "3:00:00 PM"),
  row("2026-03-19", "Zyra Mae Madriaga", "zyramaqmadriaga97@gmail.com", "Braces", "4:00:00 PM"),

  row("2026-03-20", "Francine Joy Tizon", "francinejptizon03@gmail.com", "Hawley (metal)", "9:00:00 AM"),
  row("2026-03-20", "Maica Rose Almeria", "maicarcalmeria00@gmail.com", "Clear retainer", "3:00:00 PM"),
  row("2026-03-20", "Kian Raphael Suan", "kianraphaelsuan98@gmail.com", "Braces", "4:00:00 PM"),
  row("2026-03-20", "Danica Faith Tumulak", "danicafmtumulak03@gmail.com", "Braces", "4:00:00 PM"),

  row("2026-03-23", "Elaine Espinosa", "espnsaelaine@gmail.com", "Veneers", "8:00:00 AM"),
  row("2026-03-23", "Maria Fe Alvarez", "mariaaalvarez@gmail.com", "Emergency surgery", "10:00:00 AM"),
  row("2026-03-23", "Flore Amador", "floreamador09@gmail.com", "Veneers", "11:00:00 AM"),
  row("2026-03-23", "Chelsea Mae Cero", "chelsmaecero@gmail.com", "Braces", "1:00:00 PM"),
  row("2026-03-23", "Dwight Abalona", "abalona.ddwight@gmail.com", "Root Canal Treatment(Per Canal Free Xray)", "4:00:00 PM"),

  row("2026-03-24", "Meredith Balabat", "meredith.balabat97@gmail.com", "Veneers", "8:00:00 AM"),
  row("2026-03-24", "Ma. Kimberly Laurente", "laukimberly@gmail.com", "Tooth Extraction", "9:00:00 AM"),
  row("2026-03-24", "Oliver John Sevilla", "oliverjsev@gmail.com", "Consultation", "9:00:00 AM"),
  row("2026-03-24", "Joshua Olivarez", "joshua21olivarez@gmail.com", "Consultation", "3:00:00 PM"),
  row("2026-03-24", "Vanessa Marie Chavez", "vanessachvz@gmail.com", "Tooth Extraction", "3:00:00 PM"),

  row("2026-03-25", "John Henry Solano", "solano.johnhenryy@gmail.com", "Veneers", "8:00:00 AM"),
  row("2026-03-25", "Hannah Mae De Leon", "hannahmdeleon@gmail.com", "Flexible", "8:00:00 AM"),
  row("2026-03-25", "Dexter Damasco", "dexterrrdamasco@gmail.com", "Hawley (Metal)", "9:00:00 AM"),
  row("2026-03-25", "Jeanamie Lopez", "lopezjeanam13@gmail.com", "Braces", "10:00:00 AM"),
  row("2026-03-25", "Pauline Mae Manalo", "manalopauline98@gmail.com", "Cleaning", "10:00:00 AM"),
  row("2026-03-25", "Patrick Flloyd Ramirez", "patflloyd44@gmail.com", "Tooth Restoration", "2:00:00 PM"),

  row("2026-03-26", "Levi Ocampo", "ocampolev@gmail.com", "Consultation", "8:00:00 AM"),
  row("2026-03-26", "Jasmine Joy Malco", "jasmine.malco@gmail.com", "Clear Retainer", "8:00:00 AM"),
  row("2026-03-26", "Arlene Daganos", "arlenedagan0s@gmail.com", "Braces", "9:00:00 AM"),
  row("2026-03-26", "Joymie Talaro", "talar0joymie@gmail.com", "Tooth Extraction", "2:00:00 PM"),
  row("2026-03-26", "Eunice Faith Lapid", "euniceflapid03@gmail.com", "Tooth Restoration", "2:00:00 PM"),

  row("2026-03-27", "Ray Anthony Espinosa", "rayespinosa@gmail.com", "Veneers", "8:00:00 AM"),
  row("2026-03-27", "Julie Anne Asis", "asis.julieann3@gmail.com", "Veneers", "8:00:00 AM"),
  row("2026-03-27", "Francis Harold Callos", "francis.callos27@gmail.com", "Veneers", "11:00:00 AM"),
  row("2026-03-27", "Steve Angelo Cruz", "cruz.stvangelo@gmail.com", "Cleaning", "1:00:00 PM"),
  row("2026-03-27", "Cherry Mae Salas", "imcherryy02@gmail.com", "Cleaning", "3:00:00 PM"),

  row("2026-03-30", "Erica Faith Rivas", "ericaafaithxx@gmail.com", "Braces", "8:00:00 AM"),
  row("2026-03-30", "Irishlyn Sadullo", "sadullo.irishlyn@gmail.com", "Tooth Extraction", "8:00:00 AM"),
  row("2026-03-30", "Ynah Claire Manguera", "ynahcjmanguera99@gmail.com", "Tooth Extraction", "9:00 AM"),
  row("2026-03-30", "Shaira Mae Banogon", "shairamdbanogon97@gmail.com", "Odontectomy", "10:00 AM"),
  row("2026-03-30", "Kobe Allen Dumlao", "kobeallendumlao02@gmail.com", "Hawley (metal)", "10:00 AM"),
  row("2026-03-30", "Zedrick James Agpaoa", "zedrickjamesagpaoa95@gmail.com", "Braces", "3:00 PM"),
  row("2026-03-30", "Francis Leo Abarquez", "francisleoabarquez96@gmail.com", "Hawley (metal)", "3:00 PM"),
];

async function run() {
  const db = getAdminDb();
  const usersSnap = await db.collection("users").where("role", "==", "client").get();
  const appointmentsSnap = await db.collection("appointments").get();

  const usersByEmail = new Map();
  usersSnap.docs.forEach((doc) => {
    const data = doc.data() || {};
    usersByEmail.set(normalizeEmail(data.email), { uid: doc.id, ...data });
  });

  const appointments = appointmentsSnap.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));

  const summary = {
    totalPaperRows: paperRows.length,
    matchedExact: 0,
    missingUsers: [],
    missingAppointments: [],
    mismatchedService: [],
    mismatchedTime: [],
    sameDayOtherAppointment: [],
  };

  for (const item of paperRows) {
    const user = usersByEmail.get(item.email);
    if (!user) {
      summary.missingUsers.push(item);
      continue;
    }

    const patientAppointments = appointments.filter(
      (appt) => String(appt.patientId || "").trim() === String(user.uid || "").trim()
    );

    const exact = patientAppointments.find((appt) => {
      return (
        String(appt.date || "").trim() === item.date &&
        String(appt.time || "").trim() === item.time &&
        normalizeService(appt.serviceType) === item.serviceKey
      );
    });

    if (exact) {
      summary.matchedExact += 1;
      continue;
    }

    const sameDateTime = patientAppointments.find((appt) => {
      return String(appt.date || "").trim() === item.date && String(appt.time || "").trim() === item.time;
    });
    if (sameDateTime) {
      summary.mismatchedService.push({
        paper: item,
        db: {
          id: sameDateTime.id,
          date: sameDateTime.date || "",
          time: sameDateTime.time || "",
          serviceType: sameDateTime.serviceType || "",
          status: sameDateTime.status || "",
        },
      });
      continue;
    }

    const sameDayService = patientAppointments.find((appt) => {
      return String(appt.date || "").trim() === item.date && normalizeService(appt.serviceType) === item.serviceKey;
    });
    if (sameDayService) {
      summary.mismatchedTime.push({
        paper: item,
        db: {
          id: sameDayService.id,
          date: sameDayService.date || "",
          time: sameDayService.time || "",
          serviceType: sameDayService.serviceType || "",
          status: sameDayService.status || "",
        },
      });
      continue;
    }

    const sameDayOther = patientAppointments.filter((appt) => String(appt.date || "").trim() === item.date);
    if (sameDayOther.length) {
      summary.sameDayOtherAppointment.push({
        paper: item,
        db: sameDayOther.map((appt) => ({
          id: appt.id,
          date: appt.date || "",
          time: appt.time || "",
          serviceType: appt.serviceType || "",
          status: appt.status || "",
        })),
      });
      continue;
    }

    summary.missingAppointments.push(item);
  }

  console.log(JSON.stringify(summary, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
