const maximumResponseBytes = 1024 * 1024;

export function parseOctoPrintPrinters(value = "") {
  if (!value.trim()) return [];

  let printers;
  try {
    printers = JSON.parse(value);
  } catch {
    throw new Error("OCTOPRINT_PRINTERS must be valid JSON.");
  }

  if (!Array.isArray(printers) || printers.length > 20) {
    throw new Error("OCTOPRINT_PRINTERS must be an array of at most 20 printers.");
  }

  const ids = new Set();
  return printers.map((printer, index) => {
    if (
      !printer ||
      typeof printer.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,40}$/.test(printer.id) ||
      ids.has(printer.id) ||
      typeof printer.name !== "string" ||
      !printer.name.trim() ||
      printer.name.trim().length > 80 ||
      typeof printer.url !== "string" ||
      typeof printer.apiKey !== "string" ||
      !printer.apiKey.trim()
    ) {
      throw new Error(`OCTOPRINT_PRINTERS contains an invalid printer at index ${index}.`);
    }

    let baseUrl;
    try {
      baseUrl = new URL(printer.url);
    } catch {
      throw new Error(`OCTOPRINT_PRINTERS contains an invalid URL at index ${index}.`);
    }
    if (
      !["http:", "https:"].includes(baseUrl.protocol) ||
      baseUrl.username ||
      baseUrl.password ||
      baseUrl.search ||
      baseUrl.hash
    ) {
      throw new Error(`OCTOPRINT_PRINTERS contains an unsafe URL at index ${index}.`);
    }

    ids.add(printer.id);
    return {
      id: printer.id,
      name: printer.name.trim(),
      url: baseUrl.toString().replace(/\/+$/, ""),
      apiKey: printer.apiKey.trim()
    };
  });
}

async function readOctoPrintJson(url, apiKey, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: { "X-Api-Key": apiKey, Accept: "application/json" },
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) {
    throw new Error(`OctoPrint returned HTTP ${response.status}.`);
  }

  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > maximumResponseBytes) {
    throw new Error("OctoPrint returned an unexpectedly large response.");
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > maximumResponseBytes) {
    throw new Error("OctoPrint returned an unexpectedly large response.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("OctoPrint returned an invalid JSON response.");
  }
}

export async function getOctoPrintStatus(printer, fetchImpl = fetch) {
  const [printerData, jobData] = await Promise.all([
    readOctoPrintJson(`${printer.url}/api/printer`, printer.apiKey, fetchImpl),
    readOctoPrintJson(`${printer.url}/api/job`, printer.apiKey, fetchImpl)
  ]);

  const state = printerData.state;
  if (!state || typeof state.text !== "string" || !state.flags) {
    throw new Error("OctoPrint returned an incomplete printer state.");
  }

  const completion = jobData.progress?.completion;
  const temperatures = Object.fromEntries(
    Object.entries(printerData.temperature ?? {})
      .filter(([, reading]) => reading && Number.isFinite(reading.actual))
      .map(([name, reading]) => [
        name,
        {
          actual: reading.actual,
          target: Number.isFinite(reading.target) ? reading.target : null
        }
      ])
  );

  return {
    id: printer.id,
    name: printer.name,
    online: true,
    state: state.text,
    flags: {
      operational: Boolean(state.flags.operational),
      printing: Boolean(state.flags.printing),
      paused: Boolean(state.flags.paused),
      error: Boolean(state.flags.error),
      ready: Boolean(state.flags.ready)
    },
    job: {
      name: typeof jobData.job?.file?.name === "string" ? jobData.job.file.name : null,
      completion: Number.isFinite(completion) ? Math.max(0, Math.min(100, completion)) : null,
      timeLeftSeconds: Number.isFinite(jobData.progress?.printTimeLeft)
        ? Math.max(0, jobData.progress.printTimeLeft)
        : null
    },
    temperatures,
    checkedAt: new Date().toISOString()
  };
}
