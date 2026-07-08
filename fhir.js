// HL7 FHIR R4 export.
//
// Maps a patient and their recorded voice takes into a standard FHIR R4
// transaction Bundle so the data can be ingested by a FHIR-capable EHR
// (e.g. Epic at Weill Cornell / NYP ??). NOT CERTIFIED INTERFACE, see  notes at the 
// bottom of the file and the mapping table for what full compliance would still require.
//
// Resource mapping (one Bundle per patient):
//   Patient            ← the patient record (id, name, gender, age)
//   Media              ← each WAV take (audio, inline base64, self-contained)
//   Observation × N    ← each acoustic feature of a take (F0, HNR, jitter,
//                        shimmer, formants) with UCUM units (Unified Code 
//                        for Units of Measure), derivedFrom Media
//   DiagnosticReport   ← ties one take's Observations + Media together
//
// The Bundle is a "transaction": every entry has a urn:uuid fullUrl and a
// POST request, so a FHIR server can accept the whole thing in one call and
// wire up the internal references itself.

// Local code system for the acoustic measures. These voice-biomarker metrics
// have no clean LOINC (Logical Observation Identifiers, Names and Codes) codes today, 
// so we bind them to a project system and carry a human-readable display. 
// Swap to LOINC/SNOMED when codes are chosen.

const FHIR_ACOUSTIC_SYSTEM = "http://audiomx.org/fhir/CodeSystem/acoustic-voice";
const FHIR_PATIENT_SYSTEM = "http://audiomx.org/fhir/identifier/patient";

const FHIR_FEATURES = [
  { key: "f0", code: "F0", display: "Fundamental frequency (mean)", unit: "Hz", ucum: "Hz", digits: 1 },
  { key: "hnrDb", code: "HNR", display: "Harmonics-to-noise ratio", unit: "dB", ucum: "dB", digits: 1 },
  { key: "jitterPct", code: "JITTER", display: "Jitter (local)", unit: "%", ucum: "%", digits: 3 },
  { key: "shimmerPct", code: "SHIMMER", display: "Shimmer (local)", unit: "%", ucum: "%", digits: 2 },
  { key: "f1", code: "F1", display: "First formant", unit: "Hz", ucum: "Hz", digits: 0 },
  { key: "f2", code: "F2", display: "Second formant", unit: "Hz", ucum: "Hz", digits: 0 }
];

function fhirUuid() {
  if (window.crypto && crypto.randomUUID) return "urn:uuid:" + crypto.randomUUID();
  fhirUuid._n = (fhirUuid._n || 0) + 1;
  return "urn:uuid:audiomx-" + Date.now() + "-" + fhirUuid._n;
}

function fhirGender(sex) {
  const s = (sex || "").trim().toLowerCase();
  if (s === "m" || s === "male") return "male";
  if (s === "f" || s === "female") return "female";
  if (s === "other" || s === "o") return "other";
  return "unknown";
}

async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode.apply(null, buf.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fhirPatientResource(patient) {
  const res = {
    resourceType: "Patient",
    identifier: [{ system: FHIR_PATIENT_SYSTEM, value: patient.id }],
    gender: fhirGender(patient.sex)
  };
  if (patient.name) res.name = [{ text: patient.name }];
  // Age (no DOB is collected) is carried as an extension, in years.
  if (patient.age) {
    res.extension = [{
      url: "http://audiomx.org/fhir/StructureDefinition/patient-age-years",
      valueQuantity: { value: Number(patient.age) || patient.age, unit: "years", system: "http://unitsofmeasure.org", code: "a" }
    }];
  }
  return res;
}

function fhirObservationResource(feature, value, patientRef, mediaRef, when, sessionId, testName) {
  return {
    resourceType: "Observation",
    status: "final",
    category: [{
      coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "exam", display: "Exam" }]
    }],
    code: {
      coding: [{ system: FHIR_ACOUSTIC_SYSTEM, code: feature.code, display: feature.display }],
      text: feature.display
    },
    subject: { reference: patientRef },
    effectiveDateTime: when,
    valueQuantity: {
      value: Number(value.toFixed(feature.digits)),
      unit: feature.unit,
      system: "http://unitsofmeasure.org",
      code: feature.ucum
    },
    derivedFrom: [{ reference: mediaRef }],
    method: { text: "AudioMX in-browser acoustic analysis (" + (testName || "voice task") + ")" }
  };
}

async function fhirMediaResource(recording, patientRef, when, testName) {
  const media = {
    resourceType: "Media",
    status: "completed",
    type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/media-type", code: "audio", display: "Audio" }] },
    subject: { reference: patientRef },
    createdDateTime: when,
    duration: Number(recording.duration.toFixed(3)),
    content: {
      contentType: "audio/wav",
      data: await blobToBase64(recording.blob),
      title: (recording.name || testName || "voice take") + ".wav"
    }
  };
  return media;
}

// Build a FHIR R4 transaction Bundle for one patient's recordings.
async function buildFhirBundle(patient, recordings) {
  const entries = [];
  const patientRef = fhirUuid();

  entries.push({
    fullUrl: patientRef,
    resource: fhirPatientResource(patient),
    request: { method: "POST", url: "Patient" }
  });

  for (const r of recordings) {
    const when = (r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt)).toISOString();
    const testName = r.meta ? r.meta.testName : "";

    const mediaRef = fhirUuid();
    entries.push({
      fullUrl: mediaRef,
      resource: await fhirMediaResource(r, patientRef, when, testName),
      request: { method: "POST", url: "Media" }
    });

    const obsRefs = [];
    const f = r.features;
    if (f && f.voiced) {
      for (const feature of FHIR_FEATURES) {
        const v = f[feature.key];
        if (v == null || !isFinite(v)) continue;
        const obsRef = fhirUuid();
        obsRefs.push(obsRef);
        entries.push({
          fullUrl: obsRef,
          resource: fhirObservationResource(feature, v, patientRef, mediaRef, when, r.meta && r.meta.sessionId, testName),
          request: { method: "POST", url: "Observation" }
        });
      }
    }

    entries.push({
      fullUrl: fhirUuid(),
      resource: {
        resourceType: "DiagnosticReport",
        status: "final",
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0074", code: "OTH", display: "Other" }] }],
        code: { coding: [{ system: FHIR_ACOUSTIC_SYSTEM, code: "VOICE-ACOUSTIC", display: "Voice acoustic analysis" }], text: "Voice acoustic analysis — " + (testName || "voice task") },
        subject: { reference: patientRef },
        effectiveDateTime: when,
        result: obsRefs.map(ref => ({ reference: ref })),
        media: [{ link: { reference: mediaRef } }],
        conclusion: r.meta && r.meta.notes ? r.meta.notes : undefined
      },
      request: { method: "POST", url: "DiagnosticReport" }
    });
  }

  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: entries
  };
}

async function downloadPatientFhir() {
  if (!currentPatient) { alert("Open a patient first."); return; }
  const items = recordings.filter(r => r.meta && r.meta.patientId === currentPatient.id);
  if (items.length === 0) { alert("No recordings for this patient."); return; }

  log("Building FHIR R4 bundle for " + currentPatient.id + "…");
  const bundle = await buildFhirBundle(currentPatient, items);
  const json = JSON.stringify(bundle, null, 2);
  const blob = new Blob([json], { type: "application/fhir+json" });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, "AudioMX_FHIR_" + sanitizeForFilename(currentPatient.id) + ".json");
  URL.revokeObjectURL(url);

  const obs = bundle.entry.filter(e => e.resource.resourceType === "Observation").length;
  log("FHIR bundle exported: " + items.length + " Media + " + obs + " Observation resource(s).");
}
