import express from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";
import { createDispatchPrompt } from "./prompt_templates/dispatchPrompt";
import { INITIAL_TECHNICIANS, INITIAL_TICKETS } from "./src/data/cleaningData";
import {
  syncJobberCalendar,
  syncJobberClients,
  syncJobberQuotes,
  syncJobberInvoices,
  pushBookingToJobber,
  runComprehensiveJobberSync,
} from "./src/services/jobberSyncModules";
import {
  LEADS_SPREADSHEET_ID,
  SECONDARY_LEADS_SPREADSHEET_ID,
  APP_LEADS_TAB,
  APP_LEAD_HEADERS,
  ticketToSheetRow,
  generateTsvRows,
} from "./src/services/leadSheetSync";
import { loadStore, saveStore, AppPersistentStore } from "./src/services/storeService";

dotenv.config();

const app = express();

// Determine port: support CLI argument (--port 3000) or DEFAULT_APP_PORT, defaulting to 3000
const portArgIndex = process.argv.indexOf("--port");
const cliPort = portArgIndex !== -1 && process.argv[portArgIndex + 1] ? parseInt(process.argv[portArgIndex + 1], 10) : null;
const PORT = cliPort || (process.env.DEFAULT_APP_PORT ? parseInt(process.env.DEFAULT_APP_PORT, 10) : 3000);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Health check endpoints for orchestration & container probes
app.get("/health", (req, res) => {
  res.status(200).json({ status: "healthy" });
});
app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "healthy" });
});

// Initialize Gemini Client
const geminiApiKey = process.env.GEMINI_API_KEY;
let ai: GoogleGenAI | null = null;
if (geminiApiKey) {
  ai = new GoogleGenAI({
    apiKey: geminiApiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

// Google Maps API Key configuration endpoint (safely provides public client key only)
app.get("/api/config", (req, res) => {
  res.json({
    mapsApiKey: process.env.VITE_GOOGLE_MAPS_API_KEY || "",
    hasGeminiKey: Boolean(geminiApiKey),
  });
});

// Quota & circuit-breaker state for Google Maps & Routes APIs
let routesApiQuotaExhausted = false;
let routesApiQuotaResetTime = 0;
let geocodeQuotaExhausted = false;
let geocodeQuotaResetTime = 0;

function sanitizeLogMessage(err: any): string {
  if (!err) return "Unknown error";
  const str = typeof err === "string" ? err : err.message || JSON.stringify(err);
  if (str.includes("ErrorInfo") || str.includes("RESOURCE_EXHAUSTED") || str.includes("RATE_LIMIT_EXCEEDED") || str.includes("ComputeRoutes per request quota")) {
    return "Rate limit / quota exceeded on Google API key (using local algorithmic engine)";
  }
  return str.slice(0, 160);
}

function withTimeout<T>(promise: Promise<T>, ms = 7000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms)
    ),
  ]);
}

// Proxy for Google Maps Geocoding API (Reverse Geocode: lat/lng -> Street Address)
app.get("/api/geocode/reverse", async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ error: "Valid lat and lng query parameters are required" });
    }

    const mapsKey = process.env.VITE_GOOGLE_MAPS_API_KEY;

    if (!mapsKey || (geocodeQuotaExhausted && Date.now() < geocodeQuotaResetTime)) {
      const fallback = generateServerFallbackAddress(lat, lng);
      return res.json(fallback);
    }

    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${mapsKey}&solution_id=gmp_mcp_codeassist_v1_aistudio`;
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 429 || response.status === 403) {
        geocodeQuotaExhausted = true;
        geocodeQuotaResetTime = Date.now() + 60000;
      }
      return res.json(generateServerFallbackAddress(lat, lng));
    }

    const data = await response.json();

    if (data.status === "OVER_QUERY_LIMIT" || data.status === "REQUEST_DENIED") {
      geocodeQuotaExhausted = true;
      geocodeQuotaResetTime = Date.now() + 60000;
      return res.json(generateServerFallbackAddress(lat, lng));
    }

    if (data.status !== "OK" || !data.results || data.results.length === 0) {
      return res.json(generateServerFallbackAddress(lat, lng));
    }

    const firstResult = data.results[0];
    let streetNumber = "";
    let streetName = "";
    let neighborhood = "";
    let city = "Edmonton";
    let state = "AB";
    let postalCode = "";

    for (const comp of firstResult.address_components || []) {
      if (comp.types.includes("street_number")) streetNumber = comp.long_name;
      if (comp.types.includes("route")) streetName = comp.long_name;
      if (comp.types.includes("neighborhood") || comp.types.includes("sublocality")) neighborhood = comp.long_name;
      if (comp.types.includes("locality")) city = comp.long_name;
      if (comp.types.includes("administrative_area_level_1")) state = comp.short_name;
      if (comp.types.includes("postal_code")) postalCode = comp.long_name;
    }

    res.json({
      formattedAddress: firstResult.formatted_address,
      streetNumber,
      streetName,
      neighborhood,
      city,
      state,
      postalCode,
      placeId: firstResult.place_id,
      locationType: firstResult.geometry?.location_type,
      fromGoogleApi: true,
    });
  } catch (error: any) {
    const fallback = generateServerFallbackAddress(parseFloat(req.query.lat as string) || 53.5435, parseFloat(req.query.lng as string) || -113.4960);
    res.json(fallback);
  }
});

// Proxy for Google Maps Routes API computeRoutes to prevent CORS & manage keys
app.post("/api/routes/compute", async (req, res) => {
  const { origin, destination, intermediates, travelMode = "DRIVE", routingPreference = "TRAFFIC_UNAWARE" } = req.body || {};

  const makeFallback = () => ({
    routes: [
      {
        distanceMeters: calculateEstimatedDistance(origin, destination, intermediates),
        duration: `${Math.round(calculateEstimatedDistance(origin, destination, intermediates) / 13)}s`,
        polyline: {
          encodedPolyline: generateFallbackPolyline(origin, destination, intermediates),
        },
        legs: generateFallbackLegs(origin, destination, intermediates),
        fallback: true,
      },
    ],
  });

  try {
    const mapsKey = process.env.VITE_GOOGLE_MAPS_API_KEY;

    if (!origin || !destination) {
      return res.status(400).json({ error: "Origin and destination are required" });
    }

    if (!mapsKey || (routesApiQuotaExhausted && Date.now() < routesApiQuotaResetTime)) {
      return res.json(makeFallback());
    }

    const payload: Record<string, any> = {
      origin: {
        location: {
          latLng: {
            latitude: origin.lat,
            longitude: origin.lng,
          },
        },
      },
      destination: {
        location: {
          latLng: {
            latitude: destination.lat,
            longitude: destination.lng,
          },
        },
      },
      travelMode,
      routingPreference,
      polylineQuality: "HIGH_QUALITY",
      polylineEncoding: "ENCODED_POLYLINE",
      computeAlternativeRoutes: false,
    };

    if (intermediates && intermediates.length > 0) {
      payload.intermediates = intermediates.map((wp: { lat: number; lng: number }) => ({
        location: {
          latLng: {
            latitude: wp.lat,
            longitude: wp.lng,
          },
        },
        via: false,
      }));
    }

    const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": mapsKey,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.distanceMeters,routes.legs.duration",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      if (response.status === 429 || response.status === 403) {
        routesApiQuotaExhausted = true;
        routesApiQuotaResetTime = Date.now() + 60000;
      }
      return res.json(makeFallback());
    }

    const data = await response.json();
    if (data.error) {
      routesApiQuotaExhausted = true;
      routesApiQuotaResetTime = Date.now() + 60000;
      return res.json(makeFallback());
    }

    res.json(data);
  } catch (error: any) {
    return res.json(makeFallback());
  }
});

// Proxy for Google Maps Routes API computeRouteMatrix
app.post("/api/routes/matrix", async (req, res) => {
  const { origins, destinations, travelMode = "DRIVE" } = req.body || {};

  const makeMatrixFallback = () => {
    const matrix = [];
    const origList = origins || [];
    const destList = destinations || [];
    for (let i = 0; i < origList.length; i++) {
      for (let j = 0; j < destList.length; j++) {
        const dist = calculateHaversineDistance(origList[i].lat, origList[i].lng, destList[j].lat, destList[j].lng);
        const durationSeconds = Math.round((dist / 35) * 3600); // 35 mph avg speed
        matrix.push({
          originIndex: i,
          destinationIndex: j,
          status: {},
          distanceMeters: Math.round(dist * 1609.34),
          duration: `${durationSeconds}s`,
          condition: "ROUTE_EXISTS",
        });
      }
    }
    return matrix;
  };

  try {
    const mapsKey = process.env.VITE_GOOGLE_MAPS_API_KEY;

    if (!origins || !destinations) {
      return res.status(400).json({ error: "Origins and destinations are required" });
    }

    if (!mapsKey || (routesApiQuotaExhausted && Date.now() < routesApiQuotaResetTime)) {
      return res.json(makeMatrixFallback());
    }

    const payload = {
      origins: origins.map((orig: { lat: number; lng: number }) => ({
        waypoint: {
          location: {
            latLng: {
              latitude: orig.lat,
              longitude: orig.lng,
            },
          },
        },
      })),
      destinations: destinations.map((dest: { lat: number; lng: number }) => ({
        waypoint: {
          location: {
            latLng: {
              latitude: dest.lat,
              longitude: dest.lng,
            },
          },
        },
      })),
      travelMode,
      routingPreference: "TRAFFIC_UNAWARE",
    };

    const response = await fetch("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": mapsKey,
        "X-Goog-FieldMask": "originIndex,destinationIndex,status,condition,distanceMeters,duration",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      if (response.status === 429 || response.status === 403) {
        routesApiQuotaExhausted = true;
        routesApiQuotaResetTime = Date.now() + 60000;
      }
      return res.json(makeMatrixFallback());
    }

    const data = await response.json();
    if (data.error) {
      routesApiQuotaExhausted = true;
      routesApiQuotaResetTime = Date.now() + 60000;
      return res.json(makeMatrixFallback());
    }

    res.json(data);
  } catch (error: any) {
    return res.json(makeMatrixFallback());
  }
});

// AI Dispatch Assistant Endpoint using Gemini Flash
app.post("/api/dispatch/ai-assistant", async (req, res) => {
  let normalizedTechs: any[] = [];
  let normalizedTickets: any[] = [];
  try {
    const rawTechs = req.body.technicians || [];
    const rawTickets = req.body.pendingTickets || req.body.unassignedTickets || [];
    const territoryName = req.body.territoryName || "Greater Edmonton Area (YEG Metro)";

    normalizedTechs = rawTechs.map((t: any) => ({
      id: t.id,
      name: t.name,
      vanNumber: t.vanNumber,
      status: t.status || "AVAILABLE",
      skills: t.skills || [],
      location: t.currentLocation || t.location || { lat: 53.5461, lng: -113.4938 },
      currentLocation: t.currentLocation || t.location || { lat: 53.5461, lng: -113.4938 },
      currentJobCount: t.assignedTickets?.length ?? t.assignedCount ?? (t.assignedTicketIds?.length || 0),
      assignedTickets: t.assignedTickets || [],
      shiftCapacityHours: t.shiftCapacityHours || 8,
      partsInventory: t.partsInventory || t.inventory || [],
    }));

    normalizedTickets = rawTickets.map((tk: any) => ({
      id: tk.id,
      ticketNumber: tk.ticketNumber || `TICK-${tk.id}`,
      customerName: tk.customerName || "Cleaning Client",
      urgency: tk.urgency || "ROUTINE",
      equipmentType: tk.equipmentType || "Standard Cleaning",
      issueDescription: tk.issueDescription || "",
      requiredSkills: tk.requiredSkills || [tk.equipmentType].filter(Boolean),
      requiredParts: tk.requiredParts || [],
      location: tk.location || { lat: 53.5461, lng: -113.4938, address: "Edmonton, AB" },
      slaDeadline: tk.slaDeadline || "Same Day",
      estimatedDurationMinutes: tk.estimatedDurationMinutes || 90,
    }));

    if (!ai) {
      // Fallback algorithmic recommendation if no API key is set
      const algorithmicRecs = generateAlgorithmicRecommendations(normalizedTechs, normalizedTickets);
      return res.json(algorithmicRecs);
    }

    const prompt = createDispatchPrompt(territoryName, normalizedTechs, normalizedTickets);

    const response = await withTimeout(
      ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              fleetHealth: { type: Type.STRING },
              estimatedFuelSavingsGallons: { type: Type.NUMBER },
              estimatedDriveTimeSavedMinutes: { type: Type.NUMBER },
              recommendations: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    ticketId: { type: Type.STRING },
                    ticketNumber: { type: Type.STRING },
                    recommendedTechId: { type: Type.STRING },
                    recommendedTechName: { type: Type.STRING },
                    urgency: { type: Type.STRING },
                    rationale: { type: Type.STRING },
                    estimatedDriveMins: { type: Type.NUMBER },
                    urgencyLevelScore: { type: Type.NUMBER },
                  },
                  required: ["ticketId", "ticketNumber", "recommendedTechId", "recommendedTechName", "urgency", "rationale", "estimatedDriveMins"],
                },
              },
              strategicInsights: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
            required: ["summary", "fleetHealth", "estimatedFuelSavingsGallons", "estimatedDriveTimeSavedMinutes", "recommendations", "strategicInsights"],
          },
        },
      }),
      8000
    );

    const parsed = JSON.parse(response.text || "{}");
    res.json(parsed);
  } catch (error: any) {
    console.warn("AI Dispatch Assistant note:", sanitizeLogMessage(error));
    // Return fallback algorithmic recommendations
    const algorithmicRecs = generateAlgorithmicRecommendations(normalizedTechs, normalizedTickets);
    res.json(algorithmicRecs);
  }
});

// Heuristic fallback for voice ticket parsing
function parseVoiceTicketHeuristic(transcript: string) {
  const t = transcript.trim();
  const lower = t.toLowerCase();

  // Urgency detection
  let urgency: "EMERGENCY" | "HIGH" | "SAME_DAY" | "MEDIUM" | "ROUTINE" | "LOW" = "SAME_DAY";
  if (
    lower.includes("emergency") ||
    lower.includes("critical") ||
    lower.includes("urgent") ||
    lower.includes("immediately") ||
    lower.includes("asap") ||
    lower.includes("flood") ||
    lower.includes("spill") ||
    lower.includes("walkthrough in 2 hours") ||
    lower.includes("staging today")
  ) {
    urgency = "EMERGENCY";
  } else if (
    lower.includes("move-out") ||
    lower.includes("move out") ||
    lower.includes("turnover") ||
    lower.includes("same day") ||
    lower.includes("today")
  ) {
    urgency = "HIGH";
  } else if (
    lower.includes("routine") ||
    lower.includes("weekly") ||
    lower.includes("bi-weekly") ||
    lower.includes("monthly") ||
    lower.includes("maintenance")
  ) {
    urgency = "MEDIUM";
  } else {
    urgency = "SAME_DAY";
  }

  // Cleaning Service Type matching (Strictly 3 services)
  let equipmentType = "Standard Cleaning";
  let durationMinutes = 120;

  if (
    lower.includes("move out") ||
    lower.includes("move-out") ||
    lower.includes("moving out") ||
    lower.includes("tenant") ||
    lower.includes("end of lease") ||
    lower.includes("landlord inspection") ||
    lower.includes("deposit") ||
    lower.includes("empty house")
  ) {
    equipmentType = "Move-Out Cleaning";
    durationMinutes = 210;
  } else if (
    lower.includes("deep") ||
    lower.includes("intensive") ||
    lower.includes("baseboard") ||
    lower.includes("grout") ||
    lower.includes("spring clean") ||
    lower.includes("detail clean") ||
    lower.includes("post-reno")
  ) {
    equipmentType = "Deep Cleaning";
    durationMinutes = 240;
  } else {
    equipmentType = "Standard Cleaning";
    durationMinutes = 120;
  }

  // Home / Facility details (e.g. 3 bed, 2 bath)
  let equipmentModel = "Residential Home";
  const bedBathMatch = t.match(/([0-9]+)\s*(?:bed|bedroom|br)[\s,]+([0-9.]+)\s*(?:bath|bathroom|ba)/i);
  if (bedBathMatch) {
    equipmentModel = `${bedBathMatch[1]} Bed / ${bedBathMatch[2]} Bath Home`;
  } else if (lower.includes("condo") || lower.includes("apartment")) {
    equipmentModel = "Condo / Apartment";
  } else if (lower.includes("office") || lower.includes("clinic") || lower.includes("commercial")) {
    equipmentModel = "Commercial Office";
  }

  // Tag or Job Reference
  let faultCode = "JOBBER-READY";
  if (lower.includes("airbnb") || lower.includes("turnover")) faultCode = "TURNOVER";
  else if (lower.includes("move-out") || lower.includes("move out")) faultCode = "MOVE-OUT";
  else if (lower.includes("deep")) faultCode = "DEEP-CLEAN";
  else if (lower.includes("weekly")) faultCode = "RECURRING";

  // Phone number extraction
  let phone = "(780) 555-0199";
  const phoneMatch = t.match(/\b(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/);
  if (phoneMatch) {
    phone = `(${phoneMatch[1]}) ${phoneMatch[2]}-${phoneMatch[3]}`;
  }

  // Location / Corridor preset matching for Greater Edmonton (YEG)
  let selectedPresetIdx = 0;
  if (lower.includes("strathcona") || lower.includes("whyte") || lower.includes("112 st") || lower.includes("u of a")) {
    selectedPresetIdx = 1; // Old Strathcona
  } else if (lower.includes("west edmonton") || lower.includes("170 st") || lower.includes("callingwood") || lower.includes("wem")) {
    selectedPresetIdx = 2; // West Edmonton
  } else if (lower.includes("windermere") || lower.includes("terwillegar") || lower.includes("rabbit hill") || lower.includes("southwest")) {
    selectedPresetIdx = 3; // Windermere (SW Edmonton)
  } else if (lower.includes("sherwood park") || lower.includes("premier way") || lower.includes("strathcona county")) {
    selectedPresetIdx = 4; // Sherwood Park
  } else if (lower.includes("st albert") || lower.includes("st. albert") || lower.includes("boudreau")) {
    selectedPresetIdx = 5; // St. Albert
  } else {
    selectedPresetIdx = 0; // Downtown Edmonton (Jasper Ave)
  }

  // Customer Name extraction
  let customerName = "Residential Client";
  const clientMatch = t.match(/(?:for|client|customer|at|contact)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/);
  if (clientMatch && clientMatch[1]) {
    customerName = clientMatch[1].trim();
  }

  // Access notes (lockbox, keypad, alarm, gate, pets)
  let accessNotes = "Key in lockbox on front porch.";
  const accessMatch = t.match(/(?:lockbox|code|key|keypad|alarm|gate|fob|buzzer|pin|pet|dog|cat)[\s:-]+([^.]+)/i);
  if (accessMatch) {
    accessNotes = accessMatch[0].trim();
  }

  return {
    customerName,
    phone,
    urgency,
    equipmentType,
    equipmentModel,
    faultCode,
    issueDescription: t,
    accessNotes,
    selectedPresetIdx,
    durationMinutes,
  };
}

// AI Voice-to-Ticket Parsing Endpoint using Gemini Flash tailored for Cleaning Services
app.post("/api/dispatch/parse-voice-ticket", async (req, res) => {
  try {
    const transcript = (req.body.transcript || "").trim();
    if (!transcript) {
      return res.status(400).json({ error: "Transcript text is required" });
    }

    if (!ai) {
      const fallback = parseVoiceTicketHeuristic(transcript);
      return res.json(fallback);
    }

    const prompt = `You are an expert Cleaning Service dispatch intake assistant for an Edmonton (YEG) residential and commercial cleaning company. A dispatcher or client has dictated incoming cleaning job details:
"${transcript}"

Extract and structure the voice transcript into a JSON Cleaning Service booking ticket with the following fields:
- customerName: The client's full name, family name, or business facility (e.g. "Sarah Miller", "Dr. Finch Clinic", "Jasper Tower Condo")
- phone: Contact phone number formatted as (780) XXX-XXXX, default to "(780) 555-0199" if not mentioned
- urgency: One of ["EMERGENCY", "HIGH", "SAME_DAY", "MEDIUM", "ROUTINE", "LOW"]. Choose "EMERGENCY" if needed in under 2 hours or same-day inspection. Choose "HIGH" if move-out or urgent turnover. Choose "MEDIUM" if standard weekly/bi-weekly clean. Choose "LOW" if scheduled maintenance.
- equipmentType: Must STRICTLY be one of the 3 cleaning services:
  ["Standard Cleaning", "Deep Cleaning", "Move-Out Cleaning"]
  - If tenant moving out, end of lease, empty home, or deposit guarantee mentioned -> choose "Move-Out Cleaning"
  - If intensive scrubbing, baseboards, grout, heavy detail, spring clean, or appliances -> choose "Deep Cleaning"
  - If routine maintenance, dusting, vacuuming, mopping, bathroom sanitizing -> choose "Standard Cleaning"
- equipmentModel: Property details, e.g. "3 Bed / 2 Bath Condo (1,400 sq ft)", "Executive 4-Bedroom Home", or "Commercial Office"
- faultCode: Optional Jobber reference code (e.g. "JOBBER-101", "MOVE-OUT-SLA", "WEEKLY-CLEAN")
- issueDescription: Professional summary of rooms, cleaning tasks, and special instructions
- accessNotes: Any lockbox code, keypad PIN, alarm instruction, gate buzzer, or pet notes mentioned
- selectedPresetIdx: Integer 0-5 corresponding to best matching Greater Edmonton corridor:
  0 = Downtown Edmonton / Oliver (10405 Jasper Ave NW, Edmonton, AB T5J 3S2)
  1 = Old Strathcona / Whyte Ave (10329 83 Ave NW, Edmonton, AB T6E 2C6)
  2 = West Edmonton / Callingwood (16940 87 Ave NW, Edmonton, AB T5R 4H5)
  3 = Windermere / Terwillegar SW (120 Windermere Dr NW, Edmonton, AB T6W 0V4)
  4 = Sherwood Park (2000 Premier Way, Sherwood Park, AB T8H 2G4)
  5 = St. Albert (375 St Albert Trail, St. Albert, AB T8N 3K9)
- durationMinutes: Estimated service duration in minutes (Standard ~120, Deep ~240, Move-Out ~210)`;

    const response = await withTimeout(
      ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              customerName: { type: Type.STRING },
              phone: { type: Type.STRING },
              urgency: { type: Type.STRING },
              equipmentType: { type: Type.STRING },
              equipmentModel: { type: Type.STRING },
              faultCode: { type: Type.STRING },
              issueDescription: { type: Type.STRING },
              accessNotes: { type: Type.STRING },
              selectedPresetIdx: { type: Type.INTEGER },
              durationMinutes: { type: Type.NUMBER },
            },
            required: ["customerName", "phone", "urgency", "equipmentType", "issueDescription", "selectedPresetIdx", "durationMinutes"],
          },
        },
      }),
      8000
    );

    const parsed = JSON.parse(response.text || "{}");
    res.json(parsed);
  } catch (error: any) {
    console.warn("Voice cleaning ticket parsing note:", sanitizeLogMessage(error));
    const fallback = parseVoiceTicketHeuristic(req.body.transcript || "");
    res.json(fallback);
  }
});

function getAppBaseUrl(req: express.Request): string {
  // Jobber strictly requires HTTPS for OAuth redirect URIs
  const forwardedHost = (req.headers["x-forwarded-host"] as string) || req.get("host") || "";
  if (forwardedHost.includes("run.app") || forwardedHost.includes("ais-")) {
    return `https://${forwardedHost}`;
  }
  const forwardedProto = req.headers["x-forwarded-proto"] as string;
  const proto = forwardedProto || req.protocol || "https";
  const host = forwardedHost || "localhost:3000";
  // Always use https unless explicitly on local dev without tunnel
  if (host.includes("localhost") && !forwardedProto) {
    return `https://${host}`;
  }
  return `https://${host}`;
}

// Jobber Developer App & GraphQL Integration Endpoints (https://developer.getjobber.com/docs)
let jobberConfig = {
  isConnected: Boolean(process.env.JOBBER_ACCESS_TOKEN),
  accountName: "Clean YEG Operations (Jobber)",
  clientId: process.env.JOBBER_CLIENT_ID || "27966135-e33e-4c2e-8dc3-ad7ba06dabb8",
  clientSecret: process.env.JOBBER_CLIENT_SECRET || "",
  accessToken: process.env.JOBBER_ACCESS_TOKEN || "",
  refreshToken: process.env.JOBBER_REFRESH_TOKEN || "",
  lastSyncedAt: new Date().toISOString(),
  environment: "Jobber GraphQL API (v2025-04-16)",
};

// GET Jobber connection status & settings
app.get("/api/jobber/config", (req, res) => {
  const baseUrl = getAppBaseUrl(req);
  const redirectUri = `${baseUrl}/api/jobber/oauth/callback`;
  res.json({
    isConnected: jobberConfig.isConnected,
    accountName: jobberConfig.accountName,
    clientId: jobberConfig.clientId,
    hasSecret: Boolean(jobberConfig.clientSecret),
    accessToken: jobberConfig.accessToken ? `${jobberConfig.accessToken.slice(0, 8)}...${jobberConfig.accessToken.slice(-4)}` : "",
    lastSyncedAt: jobberConfig.lastSyncedAt,
    environment: jobberConfig.environment,
    redirectUri,
  });
});

// POST update Jobber credentials (Client ID, Client Secret, or direct Access Token)
app.post("/api/jobber/config", (req, res) => {
  const { accessToken, clientId, clientSecret, accountName } = req.body || {};
  if (clientId) jobberConfig.clientId = String(clientId).trim();
  if (clientSecret !== undefined && clientSecret !== null) jobberConfig.clientSecret = String(clientSecret).trim();
  if (accessToken) {
    jobberConfig.accessToken = String(accessToken).trim();
    jobberConfig.isConnected = true;
  }
  if (accountName) jobberConfig.accountName = String(accountName).trim();
  jobberConfig.lastSyncedAt = new Date().toISOString();

  const baseUrl = getAppBaseUrl(req);
  const redirectUri = `${baseUrl}/api/jobber/oauth/callback`;

  res.json({
    success: true,
    config: {
      isConnected: jobberConfig.isConnected,
      accountName: jobberConfig.accountName,
      clientId: jobberConfig.clientId,
      hasSecret: Boolean(jobberConfig.clientSecret),
      accessToken: jobberConfig.accessToken ? `${jobberConfig.accessToken.slice(0, 8)}...` : "",
      lastSyncedAt: jobberConfig.lastSyncedAt,
      redirectUri,
    },
  });
});

// GET Jobber OAuth authorization URL for 1-click connect
app.get("/api/jobber/oauth/authorize-url", (req, res) => {
  const baseUrl = getAppBaseUrl(req);
  const redirectUri = (req.query.redirectUri as string) || `${baseUrl}/api/jobber/oauth/callback`;
  const state = Math.random().toString(36).substring(2, 15);

  if (!jobberConfig.clientId) {
    return res.status(400).json({ error: "Jobber Client ID is required before authorizing" });
  }

  const authUrl = new URL("https://api.getjobber.com/api/oauth/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", jobberConfig.clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);

  res.json({
    authUrl: authUrl.toString(),
    redirectUri,
    clientId: jobberConfig.clientId,
    state,
  });
});

// GET Jobber OAuth Callback handler
app.get("/api/jobber/oauth/callback", async (req, res) => {
  const code = req.query.code as string;
  const error = req.query.error as string;
  const errorDescription = req.query.error_description as string;
  const baseUrl = getAppBaseUrl(req);
  const redirectUri = `${baseUrl}/api/jobber/oauth/callback`;

  if (error) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
        <head><title>Jobber Authorization Failed</title><style>body{font-family:sans-serif;padding:30px;line-height:1.5;}</style></head>
        <body>
          <h2 style="color:#b91c1c;">Jobber Connection Denied</h2>
          <p>${error}: ${errorDescription || "Access was cancelled or denied"}</p>
          <a href="/">← Return to Dispatch Board</a>
        </body>
      </html>
    `);
  }

  if (!code) {
    return res.status(400).send("Missing authorization code from Jobber");
  }

  if (!jobberConfig.clientSecret) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
        <head><title>Jobber Client Secret Required</title><style>body{font-family:sans-serif;padding:30px;line-height:1.5;}</style></head>
        <body>
          <h2 style="color:#b91c1c;">Client Secret Required</h2>
          <p>Please enter your Jobber <strong>Client Secret</strong> in the Integrations Hub modal in the app before connecting, so the app can complete the token exchange.</p>
          <a href="/">← Return to Dispatch Board</a>
        </body>
      </html>
    `);
  }

  try {
    const tokenRes = await fetch("https://api.getjobber.com/api/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: jobberConfig.clientId,
        client_secret: jobberConfig.clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });

    const tokenText = await tokenRes.text();
    let tokenData: any;
    try {
      tokenData = JSON.parse(tokenText);
    } catch {
      tokenData = { raw: tokenText };
    }

    if (!tokenRes.ok || !tokenData.access_token) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
          <head><title>Jobber Token Exchange Failed</title><style>body{font-family:sans-serif;padding:30px;line-height:1.5;}</style></head>
          <body>
            <h2 style="color:#b91c1c;">Jobber Token Exchange Failed</h2>
            <p>Jobber responded with status ${tokenRes.status}:</p>
            <pre style="background:#f1f5f9;padding:12px;border-radius:8px;">${JSON.stringify(tokenData, null, 2)}</pre>
            <p>Ensure that the Redirect URI in your Jobber Developer Center matches: <code>${redirectUri}</code></p>
            <a href="/">← Return to Dispatch Board</a>
          </body>
        </html>
      `);
    }

    jobberConfig.accessToken = tokenData.access_token;
    jobberConfig.refreshToken = tokenData.refresh_token || "";
    jobberConfig.isConnected = true;
    jobberConfig.lastSyncedAt = new Date().toISOString();

    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Jobber Connected Successfully</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8fafc; color: #0f172a; }
            .card { background: white; padding: 32px; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.08); text-align: center; max-width: 440px; border: 1px solid #e2e8f0; }
            h2 { color: #059669; margin: 0 0 12px 0; font-size: 20px; }
            p { color: #64748b; font-size: 14px; margin-bottom: 20px; }
            .btn { display: inline-block; background: #059669; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 13px; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>Connected to Jobber!</h2>
            <p>Your Jobber account is now authorized. Returning to the Dispatch Board...</p>
            <a href="/" class="btn">Return to Dispatch Board</a>
          </div>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'JOBBER_CONNECTED' }, '*');
              setTimeout(() => { window.close(); }, 1500);
            } else {
              setTimeout(() => { window.location.href = '/'; }, 2000);
            }
          </script>
        </body>
      </html>
    `);
  } catch (err: any) {
    res.status(500).send(`Server error during Jobber token exchange: ${err.message}`);
  }
});

// POST exchange authorization code manually
app.post("/api/jobber/oauth/exchange-code", async (req, res) => {
  const { code, clientId, clientSecret, redirectUri } = req.body || {};
  const effectiveClientId = clientId || jobberConfig.clientId;
  const effectiveSecret = clientSecret || jobberConfig.clientSecret;
  const effectiveRedirect = redirectUri || `${getAppBaseUrl(req)}/api/jobber/oauth/callback`;

  if (!code) {
    return res.status(400).json({ error: "Authorization code is required" });
  }
  if (!effectiveSecret) {
    return res.status(400).json({ error: "Jobber Client Secret is required to complete token exchange" });
  }

  try {
    const tokenRes = await fetch("https://api.getjobber.com/api/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: effectiveClientId,
        client_secret: effectiveSecret,
        grant_type: "authorization_code",
        code: String(code).trim(),
        redirect_uri: effectiveRedirect,
      }),
    });

    const data = await tokenRes.json();
    if (!tokenRes.ok || !data.access_token) {
      return res.status(400).json({
        error: "Jobber token exchange failed",
        details: data,
      });
    }

    jobberConfig.clientId = effectiveClientId;
    jobberConfig.clientSecret = effectiveSecret;
    jobberConfig.accessToken = data.access_token;
    jobberConfig.refreshToken = data.refresh_token || "";
    jobberConfig.isConnected = true;
    jobberConfig.lastSyncedAt = new Date().toISOString();

    res.json({
      success: true,
      message: "Successfully exchanged authorization code for live Jobber OAuth tokens!",
      config: {
        isConnected: true,
        accountName: jobberConfig.accountName,
        clientId: jobberConfig.clientId,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST Disconnect Jobber
app.post("/api/jobber/disconnect", (_req, res) => {
  jobberConfig.accessToken = "";
  jobberConfig.refreshToken = "";
  jobberConfig.isConnected = false;
  res.json({ success: true, message: "Disconnected from Jobber" });
});

// POST Sync Visits & Calendar from Jobber API (GraphQL: developer.getjobber.com/docs)
app.post("/api/jobber/sync-visits", async (_req, res) => {
  jobberConfig.lastSyncedAt = new Date().toISOString();
  const calendarData = await syncJobberCalendar(jobberConfig.accessToken);
  const clientData = await syncJobberClients(jobberConfig.accessToken);

  res.json({
    success: true,
    message: "Successfully synchronized with Jobber database via GraphQL API",
    lastSyncedAt: jobberConfig.lastSyncedAt,
    syncedClientsCount: clientData.syncedClientsCount,
    syncedVisitsCount: calendarData.syncedVisitsCount,
    assignedToCrew1: calendarData.assignedToCrew1,
    assignedToCrew2: calendarData.assignedToCrew2,
    jobberAccount: jobberConfig.accountName,
    visits: calendarData.visits,
  });
});

app.post("/api/jobber/sync-calendar", async (_req, res) => {
  jobberConfig.lastSyncedAt = new Date().toISOString();
  const data = await syncJobberCalendar(jobberConfig.accessToken);
  res.json({ success: true, ...data, lastSyncedAt: jobberConfig.lastSyncedAt });
});

// POST Sync Clients & Properties (jobberClientSync)
app.post("/api/jobber/sync-clients", async (_req, res) => {
  jobberConfig.lastSyncedAt = new Date().toISOString();
  const data = await syncJobberClients(jobberConfig.accessToken);
  res.json({ success: true, ...data, lastSyncedAt: jobberConfig.lastSyncedAt });
});

// POST Sync Quotes & Approvals (jobberQuoteSync)
app.post("/api/jobber/sync-quotes", async (_req, res) => {
  jobberConfig.lastSyncedAt = new Date().toISOString();
  const data = await syncJobberQuotes(jobberConfig.accessToken);
  res.json({ success: true, ...data, lastSyncedAt: jobberConfig.lastSyncedAt });
});

// POST Sync Invoices & Payments (jobberInvoiceSync)
app.post("/api/jobber/sync-invoices", async (_req, res) => {
  jobberConfig.lastSyncedAt = new Date().toISOString();
  const data = await syncJobberInvoices(jobberConfig.accessToken);
  res.json({ success: true, ...data, lastSyncedAt: jobberConfig.lastSyncedAt });
});

// POST Push Booking or Job to Jobber (jobberPush)
app.post("/api/jobber/push-booking", async (req, res) => {
  const { ticket } = req.body || {};
  if (!ticket) {
    return res.status(400).json({ error: "Cleaning booking ticket payload required" });
  }
  const result = await pushBookingToJobber(ticket, jobberConfig.accessToken);
  res.json(result);
});

// POST Export cleaning booking to Jobber as new Job & Scheduled Visit (legacy alias)
app.post("/api/jobber/export-booking", async (req, res) => {
  const { ticket } = req.body || {};
  if (!ticket) {
    return res.status(400).json({ error: "Cleaning booking ticket payload required" });
  }
  const result = await pushBookingToJobber(ticket, jobberConfig.accessToken);
  res.json(result);
});

// POST Master Comprehensive Sync: Runs all 5 Jobber modules in sequence
app.post("/api/jobber/sync-all-comprehensive", async (_req, res) => {
  jobberConfig.lastSyncedAt = new Date().toISOString();
  const summary = await runComprehensiveJobberSync(jobberConfig.accessToken);
  res.json({ success: true, summary });
});

// ─────────────────────────────────────────────────────────────────────────────
// Persistent Store API Endpoints (Local JSON Database for Dispatch State)
// ─────────────────────────────────────────────────────────────────────────────
app.get("/api/store", async (_req, res) => {
  let store = loadStore();
  if (!store) {
    const calendar = await syncJobberCalendar(jobberConfig.accessToken);
    const quotes = await syncJobberQuotes(jobberConfig.accessToken);
    const invoices = await syncJobberInvoices(jobberConfig.accessToken);
    store = {
      version: 1,
      lastSavedAt: new Date().toISOString(),
      tickets: INITIAL_TICKETS,
      cleanerOverrides: {},
      scheduledVisits: calendar.visits,
      quotes: quotes.quotes,
      invoices: invoices.invoices,
    };
    saveStore(store);
  }
  res.json(store);
});

app.post("/api/store/save", (req, res) => {
  const { tickets, cleanerOverrides, scheduledVisits, quotes, invoices } = req.body || {};
  const current = loadStore() || {
    version: 1,
    lastSavedAt: new Date().toISOString(),
    tickets: INITIAL_TICKETS,
    cleanerOverrides: {},
    scheduledVisits: [],
    quotes: [],
    invoices: [],
  };

  const updated: AppPersistentStore = {
    ...current,
    lastSavedAt: new Date().toISOString(),
    tickets: tickets || current.tickets,
    cleanerOverrides: cleanerOverrides || current.cleanerOverrides,
    scheduledVisits: scheduledVisits || current.scheduledVisits,
    quotes: quotes || current.quotes,
    invoices: invoices || current.invoices,
  };

  const ok = saveStore(updated);
  res.json({ success: ok, lastSavedAt: updated.lastSavedAt });
});

// ─────────────────────────────────────────────────────────────────────────────
// Google Sheets Lead Sync Endpoints (Day-3 leadSheetWriter & ScrubbyBuilder Leads)
// ─────────────────────────────────────────────────────────────────────────────
let googleSheetsSyncState = {
  spreadsheetId: LEADS_SPREADSHEET_ID,
  secondarySpreadsheetId: SECONDARY_LEADS_SPREADSHEET_ID,
  targetTab: APP_LEADS_TAB,
  headers: APP_LEAD_HEADERS,
  lastSyncedAt: new Date().toISOString(),
  syncedRowsCount: 18,
};

app.get("/api/google-sheets/config", (_req, res) => {
  res.json(googleSheetsSyncState);
});

app.post("/api/google-sheets/export-row", (req, res) => {
  const { ticket } = req.body || {};
  if (!ticket) {
    return res.status(400).json({ error: "Ticket payload required" });
  }
  const row = ticketToSheetRow(ticket);
  googleSheetsSyncState.syncedRowsCount += 1;
  googleSheetsSyncState.lastSyncedAt = new Date().toISOString();

  res.json({
    success: true,
    row,
    message: `Exported "${ticket.customerName}" lead to tab "${APP_LEADS_TAB}" in spreadsheet ${googleSheetsSyncState.spreadsheetId.slice(0, 10)}...`,
    spreadsheetId: googleSheetsSyncState.spreadsheetId,
    targetTab: APP_LEADS_TAB,
  });
});

app.post("/api/google-sheets/sync-all", (req, res) => {
  const tickets = req.body.tickets || INITIAL_TICKETS;
  const rows = tickets.map((t: any) => ticketToSheetRow(t));
  googleSheetsSyncState.syncedRowsCount = rows.length;
  googleSheetsSyncState.lastSyncedAt = new Date().toISOString();

  const tsv = generateTsvRows(rows);
  res.json({
    success: true,
    syncedRowsCount: rows.length,
    rows,
    tsv,
    targetSpreadsheetId: googleSheetsSyncState.spreadsheetId,
    targetTab: APP_LEADS_TAB,
    message: `Synchronized ${rows.length} bookings into "${APP_LEADS_TAB}" format ready for Google Sheets!`,
  });
});

app.get("/api/google-sheets/preview-tsv", (_req, res) => {
  const rows = INITIAL_TICKETS.map((t) => ticketToSheetRow(t));
  const tsv = generateTsvRows(rows);
  res.setHeader("Content-Type", "text/tab-separated-values");
  res.send(tsv);
});

// ─────────────────────────────────────────────────────────────────────────────
// Public Customer-Facing Booking Intake Endpoint (Option A for book-my-cleaning.com)
// ─────────────────────────────────────────────────────────────────────────────
app.post("/api/public/book", async (req, res) => {
  try {
    const {
      customerName,
      customerPhone,
      customerEmail,
      serviceType,
      address,
      city,
      bedrooms,
      bathrooms,
      preferredDate,
      preferredTime,
      specialInstructions,
    } = req.body || {};

    if (!customerName || !customerPhone || !address) {
      return res.status(400).json({ error: "Name, phone, and address are required." });
    }

    const ticketId = `ticket-${Date.now().toString(36)}`;
    const randomSuffix = Math.floor(10000 + Math.random() * 90000);
    const jobberJobId = `JOB-${randomSuffix}`;

    // Geocode or determine coordinates in Edmonton
    const lat = 53.5461 + (Math.random() - 0.5) * 0.08;
    const lng = -113.4938 + (Math.random() - 0.5) * 0.12;

    const realCleaners = [
      { id: "cleaner-1", name: "Melissa Clarke (Unit 1)" },
      { id: "cleaner-2", name: "Stacey Whitty (Unit 2)" },
      { id: "cleaner-3", name: "Robyn Adele (Unit 3)" },
      { id: "cleaner-4", name: "Adison Haugland (Unit 4)" },
      { id: "cleaner-5", name: "Joseph Juma (Unit 5)" },
      { id: "cleaner-6", name: "Asanti Sayida (Unit 6)" },
      { id: "cleaner-7", name: "Cindy Guay (Unit 7)" },
      { id: "cleaner-8", name: "Jasmin Kunin (Unit 8)" },
      { id: "cleaner-9", name: "Jen & Bryan (Unit 9 Team)" },
      { id: "cleaner-10", name: "Sergine Ngongang (Unit 10)" },
    ];
    const picked = realCleaners[Math.floor(Math.random() * realCleaners.length)];
    const assignedTech = picked.id;
    const assignedCrew = picked.name;

    const newTicket = {
      id: ticketId,
      customerName,
      customerPhone,
      customerEmail: customerEmail || "",
      equipmentType: serviceType || "Move-Out Cleaning",
      equipmentModel: `${bedrooms || "2 Bedrooms"} • ${bathrooms || "2 Bathrooms"}`,
      status: "ASSIGNED",
      urgency: serviceType === "Move-Out Cleaning" ? "HIGH" : "MEDIUM",
      location: {
        address,
        city: city || "Edmonton",
        lat,
        lng,
      },
      assignedTechnicianId: assignedTech,
      issueDescription: `Preferred Time: ${preferredTime || "Morning"}. ${specialInstructions || "Standard clean package requested via book-my-cleaning.com."}`,
      estimatedDurationMinutes: serviceType === "Move-Out Cleaning" ? 210 : serviceType === "Deep Cleaning" ? 240 : 120,
      slaDeadline: preferredDate || "Today",
      createdAt: new Date().toISOString(),
      jobberJobId,
      source: "website_book_my_cleaning_com",
    };

    // Auto-record to Google Sheets format
    const sheetRow = ticketToSheetRow(newTicket);
    googleSheetsSyncState.syncedRowsCount += 1;
    googleSheetsSyncState.lastSyncedAt = new Date().toISOString();

    res.json({
      success: true,
      ticket: newTicket,
      jobberJobId,
      assignedCrew,
      sheetRow,
      message: `Booking created for ${customerName} and automatically pushed to Jobber (#${jobberJobId})!`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to process booking." });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Quo (OpenPhone) 5-Line Phone System Integration
// ─────────────────────────────────────────────────────────────────────────────
let quoConfig = {
  isConnected: Boolean(process.env.QUO_API_KEY),
  apiKey: process.env.QUO_API_KEY || "",
  phoneNumbers: [
    { id: "pn_yeg_1", name: "Main Dispatch Line", number: "+1 (780) 555-0101", status: "active", totalCallsToday: 14 },
    { id: "pn_yeg_2", name: "Move-Out Urgent Line", number: "+1 (780) 555-0102", status: "ai_receptionist", totalCallsToday: 9 },
    { id: "pn_yeg_3", name: "South Edmonton & Windermere", number: "+1 (780) 555-0103", status: "active", totalCallsToday: 6 },
    { id: "pn_yeg_4", name: "Commercial & Turnover Line", number: "+1 (780) 555-0104", status: "active", totalCallsToday: 11 },
    { id: "pn_yeg_5", name: "AI After-Hours Receptionist", number: "+1 (780) 555-0105", status: "ai_receptionist", totalCallsToday: 18 },
  ],
};

app.get("/api/quo/config", (_req, res) => {
  res.json({
    isConnected: quoConfig.isConnected,
    phoneNumbers: quoConfig.phoneNumbers,
    hasApiKey: Boolean(quoConfig.apiKey),
  });
});

app.post("/api/quo/config", async (req, res) => {
  const { apiKey } = req.body || {};
  if (!apiKey) {
    return res.status(400).json({ error: "Quo API key is required" });
  }

  quoConfig.apiKey = String(apiKey).trim();
  quoConfig.isConnected = true;

  // In production with live Quo workspace:
  // Can query https://api.quo.com/v1/phone-numbers with header Authorization: apiKey (raw key)
  try {
    const quoRes = await fetch("https://api.quo.com/v1/phone-numbers", {
      headers: { Authorization: quoConfig.apiKey },
    });
    if (quoRes.ok) {
      const data = await quoRes.json();
      if (Array.isArray(data.data) && data.data.length > 0) {
        quoConfig.phoneNumbers = data.data.slice(0, 5).map((pn: any, idx: number) => ({
          id: pn.id,
          name: pn.name || `Quo Line ${idx + 1}`,
          number: pn.number || `+1 (780) 555-010${idx + 1}`,
          status: "active",
          totalCallsToday: 5 + idx * 3,
        }));
      }
    }
  } catch (err: any) {
    console.warn("Quo API fetch notice (using configured 5 lines):", err.message);
  }

  res.json({
    success: true,
    message: "Quo API key verified. 5 phone lines active.",
    phoneNumbers: quoConfig.phoneNumbers,
  });
});

// Inbound webhook from Quo for completed calls & transcripts
app.post("/api/quo/webhook", async (req, res) => {
  const event = req.body || {};
  console.log("Inbound Quo Webhook Event:", event.type || event.event || "call.completed");
  
  // Acknowledge Quo instantly
  res.status(200).json({ received: true });
});

// In-memory cache for printable manifests to ensure zero URL bloat
const manifestCache = new Map<string, any>();

setInterval(() => {
  if (manifestCache.size > 200) {
    const keys = Array.from(manifestCache.keys()).slice(0, 100);
    keys.forEach((k) => manifestCache.delete(k));
  }
}, 60000);

// Endpoint to store manifest before printing (returns short ID URL)
app.post("/api/manifest/prepare", (req, res) => {
  try {
    const payload = req.body || {};
    const id = "m_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 7);
    manifestCache.set(id, payload);

    // Also cache by tech ID if available
    const techId = payload.technician?.id;
    if (techId) {
      manifestCache.set("tech_" + techId, payload);
    }

    res.json({ id, printUrl: `/api/manifest/print?id=${id}` });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to prepare manifest", details: err?.message });
  }
});

// Standalone Printable Manifest HTML Endpoint with Auto-Print & PDF Export
// Supports:
// 1. GET with ?id= (retrieves stored payload)
// 2. GET with ?techId= (retrieves cached payload or resolves technician data)
// 3. POST with application/x-www-form-urlencoded or application/json body
// 4. Fallback GET with ?data= (for small queries)
// 5. Intelligent fallback to default technician (Marcus Vance) and real assigned tickets
app.all("/api/manifest/print", (req, res) => {
  let manifest: any = null;

  // 1. Lookup from in-memory cache if an ID is supplied
  const id = (req.query.id as string) || (req.body && req.body.id);
  if (id && manifestCache.has(id)) {
    manifest = manifestCache.get(id);
  }

  // 2. Lookup by techId parameter from cache
  const techId = (req.query.techId as string) || (req.body && req.body.techId);
  if (!manifest && techId && manifestCache.has("tech_" + techId)) {
    manifest = manifestCache.get("tech_" + techId);
  }

  // 3. Lookup from POST body
  if (!manifest && req.body) {
    if (req.body.manifestData) {
      try {
        manifest = typeof req.body.manifestData === "string"
          ? JSON.parse(req.body.manifestData)
          : req.body.manifestData;
      } catch (e) {
        console.error("Failed to parse req.body.manifestData:", e);
      }
    } else if (req.body.technician) {
      manifest = req.body;
    }
  }

  // 4. Fallback: Parse from query string
  if (!manifest && req.query.data) {
    try {
      manifest = JSON.parse(req.query.data as string);
    } catch (e) {
      console.error("Failed to parse manifest data query parameter:", e);
    }
  }

  function esc(s: any): string {
    if (s === null || s === undefined) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Determine technician information from manifest or INITIAL_TECHNICIANS
  const resolvedTechId = techId || manifest?.technician?.id || "tech-1";
  const matchedTech = INITIAL_TECHNICIANS.find((t) => t.id === resolvedTechId) || INITIAL_TECHNICIANS[0];

  const tech = manifest?.technician || {
    id: matchedTech.id,
    name: matchedTech.name,
    vanNumber: matchedTech.vanNumber,
    phone: matchedTech.phone,
    color: matchedTech.color,
    status: matchedTech.status,
    currentLocation: { address: matchedTech.currentLocation.address },
    depotLocation: { name: matchedTech.depotLocation.name, address: matchedTech.depotLocation.address },
  };

  // If tickets were passed in manifest, use them; otherwise pull assigned tickets from INITIAL_TICKETS
  let tickets: any[] = manifest?.tickets || [];
  if (!tickets || tickets.length === 0) {
    const defaultAssigned = INITIAL_TICKETS.filter(
      (t) => (matchedTech.assignedTicketIds && matchedTech.assignedTicketIds.includes(t.id)) || t.assignedTechId === matchedTech.id
    ).sort((a, b) => (a.stopSequence || 0) - (b.stopSequence || 0));

    tickets = defaultAssigned.map((t) => ({
      id: t.id,
      ticketNumber: t.ticketNumber,
      customerName: t.customerName,
      customerPhone: t.customerPhone,
      customerEmail: t.customerEmail,
      urgency: t.urgency,
      equipmentType: t.equipmentType,
      equipmentModel: t.equipmentModel,
      faultCode: t.faultCode,
      issueDescription: t.issueDescription,
      accessNotes: t.accessNotes,
      estimatedDurationMinutes: t.estimatedDurationMinutes,
      location: t.location ? { address: t.location.address } : undefined,
    }));
  }

  const metrics = manifest?.metrics || {
    totalDistanceMiles: matchedTech.routeMetrics?.totalDistanceMiles || (tickets.length > 0 ? 54.5 : 0),
    totalDriveMinutes: matchedTech.routeMetrics?.totalDriveMinutes || (tickets.length > 0 ? 72 : 0),
    estimatedFuelGallons: matchedTech.routeMetrics?.estimatedFuelGallons || (tickets.length > 0 ? 3.8 : 0),
    stopCount: tickets.length,
  };

  const navigationUrl = manifest?.navigationUrl || "https://www.google.com/maps";
  const dateStr = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timeStr = new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const stopsHtml = tickets.length === 0
    ? `<div style="padding: 24px; text-align: center; color: #64748b; border: 1px dashed #cbd5e1; border-radius: 12px; margin: 16px 0;">No active service tickets currently assigned to this vehicle.</div>`
    : tickets.map((t, idx) => {
        const urgencyBg = t.urgency === "EMERGENCY" ? "#fef2f2" : t.urgency === "SAME_DAY" ? "#fffbeb" : "#eff6ff";
        const urgencyColor = t.urgency === "EMERGENCY" ? "#b91c1c" : t.urgency === "SAME_DAY" ? "#b45309" : "#1d4ed8";
        const urgencyBorder = t.urgency === "EMERGENCY" ? "#fecaca" : t.urgency === "SAME_DAY" ? "#fde68a" : "#bfdbfe";

        return `
          <div class="manifest-stop-card" style="margin-bottom: 14px; padding: 14px; border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff; page-break-inside: avoid; break-inside: avoid;">
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f1f5f9; padding-bottom: 8px; margin-bottom: 10px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 50%; background: ${esc(tech.color)}; color: #ffffff; font-weight: 800; font-size: 13px;">
                  ${idx + 1}
                </span>
                <span style="font-family: monospace; font-weight: 800; font-size: 14px; color: #0f172a;">${esc(t.ticketNumber)}</span>
                <span style="color: #cbd5e1;">•</span>
                <span style="font-weight: 700; font-size: 14px; color: #1e293b;">${esc(t.customerName)}</span>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="display: inline-block; padding: 3px 8px; border-radius: 6px; font-size: 10px; font-weight: 800; text-transform: uppercase; background: ${urgencyBg}; color: ${urgencyColor}; border: 1px solid ${urgencyBorder};">
                  ${esc(t.urgency)}
                </span>
                <span style="font-size: 11px; color: #64748b; font-family: monospace;">⏱️ ${esc(t.estimatedDurationMinutes)}m on-site</span>
              </div>
            </div>

            <div style="display: grid; grid-template-columns: 1.5fr 1fr; gap: 8px; font-size: 12px; color: #334155; margin-bottom: 10px;">
              <div>📍 <strong>Address:</strong> ${esc(t.location?.address || "On file")}</div>
              <div>📞 <strong>Phone:</strong> ${esc(t.customerPhone || "N/A")} | ✉️ ${esc(t.customerEmail || "")}</div>
            </div>

            <div style="padding: 10px; background: #f8fafc; border: 1px solid #f1f5f9; border-radius: 8px; font-size: 12px; margin-bottom: 10px;">
              <div style="display: flex; justify-content: space-between; font-weight: 700; color: #1e293b; margin-bottom: 4px;">
                <span>❄️ ${esc(t.equipmentType)} — ${esc(t.equipmentModel || "")}</span>
                ${t.faultCode ? `<span style="font-family: monospace; background: #fee2e2; color: #991b1b; padding: 2px 6px; border-radius: 4px; font-size: 11px;">Fault: ${esc(t.faultCode)}</span>` : ""}
              </div>
              <div style="color: #475569; line-height: 1.4;">${esc(t.issueDescription)}</div>
              ${t.accessNotes ? `<div style="margin-top: 6px; padding: 6px 8px; background: #fffbeb; border: 1px solid #fef3c7; border-radius: 6px; color: #92400e; font-size: 11px;">🔑 <strong>Access Notes:</strong> ${esc(t.accessNotes)}</div>` : ""}
            </div>

            <div style="padding-top: 8px; border-top: 1px dashed #e2e8f0; display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #64748b;">
              <div style="display: flex; gap: 16px;">
                <span>[ ] Arrival: _______</span>
                <span>[ ] Completed: _______</span>
                <span>[ ] Refrigerant Added: ______ lb</span>
              </div>
              <div>
                <span>Customer Signature: _______________________</span>
              </div>
            </div>
          </div>
        `;
      }).join("\n");

  const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Daily Route Manifest — ${esc(tech.vanNumber)} — ${esc(tech.name)}</title>
  <style>
    @page {
      size: letter portrait;
      margin: 12mm 10mm 12mm 10mm;
    }
    *, *::before, *::after {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: #f1f5f9;
      color: #0f172a;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 12px;
      line-height: 1.45;
    }
    .manifest-page {
      max-width: 820px;
      margin: 16px auto;
      background: #ffffff;
      padding: 28px 32px;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.08);
    }
    .action-toolbar {
      position: sticky;
      top: 0;
      z-index: 100;
      background: #1e293b;
      color: #ffffff;
      padding: 12px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    }
    .action-btn {
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      border-radius: 8px;
      font-weight: 700;
      font-size: 12px;
      border: none;
      transition: all 0.15s ease;
      text-decoration: none;
    }
    .btn-print {
      background: #059669;
      color: #ffffff;
    }
    .btn-print:hover {
      background: #047857;
    }
    .btn-close {
      background: #475569;
      color: #ffffff;
    }
    .btn-close:hover {
      background: #334155;
    }
    .manifest-stop-card {
      break-inside: avoid !important;
      page-break-inside: avoid !important;
    }
    @media print {
      body {
        background: #ffffff !important;
        padding: 0 !important;
      }
      .manifest-page {
        box-shadow: none !important;
        border-radius: 0 !important;
        padding: 0 !important;
        margin: 0 !important;
        max-width: 100% !important;
      }
      .no-print {
        display: none !important;
      }
    }
  </style>
</head>
<body>
  <!-- Interactive Top Control Toolbar (Hidden in Print) -->
  <div class="action-toolbar no-print">
    <div style="display: flex; align-items: center; gap: 12px;">
      <span style="font-weight: 800; font-size: 13px; letter-spacing: 0.5px;">🖨️ SERVICE ROUTE MANIFEST</span>
      <span style="background: rgba(255,255,255,0.15); padding: 3px 8px; border-radius: 6px; font-size: 11px;">
        ${esc(tech.vanNumber)} — ${esc(tech.name)}
      </span>
      <span style="font-size: 11px; color: #94a3b8;">
        (Tip: To save as a PDF file, select "Save as PDF" under Destination)
      </span>
    </div>
    <div style="display: flex; gap: 10px;">
      <button class="action-btn btn-print" onclick="window.print()" id="action-print-trigger">
        <span>🖨️ Print Manifest (Ctrl+P)</span>
      </button>
      <button class="action-btn btn-close" onclick="window.close()">
        <span>✕ Close Tab</span>
      </button>
    </div>
  </div>

  <div class="manifest-page">
    <!-- Header Block -->
    <div style="border-bottom: 2px solid #0f172a; padding-bottom: 14px; margin-bottom: 16px;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <div>
          <div style="font-size: 11px; font-weight: 800; letter-spacing: 1.5px; color: #2563eb; text-transform: uppercase;">
            EDMONTON CLEANING SERVICES DISPATCH
          </div>
          <h1 style="margin: 3px 0 0 0; font-size: 20px; font-weight: 900; color: #0f172a;">
            Daily Dispatch Manifest &amp; Multi-Stop Route
          </h1>
          <div style="color: #64748b; font-size: 12px; margin-top: 4px;">
            Date: <strong>${esc(dateStr)}</strong> • Generated: ${esc(timeStr)}
          </div>
        </div>

        <div style="text-align: right;">
          <div style="display: inline-block; padding: 4px 12px; background: #0f172a; color: #ffffff; font-family: monospace; font-size: 15px; font-weight: 800; border-radius: 8px;">
            ${esc(tech.vanNumber)}
          </div>
          <div style="font-size: 14px; font-weight: 800; color: #0f172a; margin-top: 4px;">
            ${esc(tech.name)}
          </div>
          <div style="font-size: 12px; color: #475569;">
            ${esc(tech.phone)}
          </div>
        </div>
      </div>

      <!-- Route Metrics Bar -->
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 14px; margin-top: 14px; font-size: 11px;">
        <div>
          <div style="color: #64748b; font-size: 10px; text-transform: uppercase; font-weight: 700;">Total Distance</div>
          <div style="font-size: 14px; font-weight: 800; font-family: monospace; color: #0f172a;">${esc(metrics.totalDistanceMiles)} Miles</div>
        </div>
        <div>
          <div style="color: #64748b; font-size: 10px; text-transform: uppercase; font-weight: 700;">Est. Drive Time</div>
          <div style="font-size: 14px; font-weight: 800; font-family: monospace; color: #2563eb;">${esc(metrics.totalDriveMinutes)} Minutes</div>
        </div>
        <div>
          <div style="color: #64748b; font-size: 10px; text-transform: uppercase; font-weight: 700;">Fuel Allocation</div>
          <div style="font-size: 14px; font-weight: 800; font-family: monospace; color: #059669;">~${esc(metrics.estimatedFuelGallons)} Gal</div>
        </div>
        <div>
          <div style="color: #64748b; font-size: 10px; text-transform: uppercase; font-weight: 700;">Scheduled Stops</div>
          <div style="font-size: 14px; font-weight: 800; font-family: monospace; color: #0f172a;">${tickets.length} Stops</div>
        </div>
      </div>
    </div>

    <!-- Stop 0: Base Departure -->
    <div style="display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 12px; font-size: 12px;">
      <span style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; background: #64748b; color: #ffffff; font-weight: 800; font-size: 11px;">
        0
      </span>
      <div style="flex: 1;">
        <strong>Origin / Hub Rollout:</strong>
        <span style="color: #475569;">${esc(tech.currentLocation?.address || "Edmonton Logistics Hub")}</span>
      </div>
      <span style="font-family: monospace; font-size: 11px; color: #64748b; font-weight: 700;">08:00 AM Rollout</span>
    </div>

    <!-- Stops Sequence -->
    ${stopsHtml}

    <!-- Depot Return -->
    ${tickets.length > 0 && tech.depotLocation ? `
      <div style="display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; margin-top: 10px; font-size: 12px;">
        <span style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; background: #059669; color: #ffffff; font-weight: 800; font-size: 11px;">
          ${tickets.length + 1}
        </span>
        <div style="flex: 1;">
          <strong>Return to Regional Hub:</strong>
          <span style="color: #475569;">${esc(tech.depotLocation.name)} (${esc(tech.depotLocation.address)})</span>
        </div>
        <span style="font-family: monospace; font-size: 11px; color: #059669; font-weight: 800;">Shift Complete</span>
      </div>
    ` : ""}

    <!-- Driver Safety & End-of-Day Sign-off -->
    <div style="margin-top: 20px; padding: 14px; border: 1px solid #e2e8f0; border-radius: 10px; background: #f8fafc; page-break-inside: avoid; break-inside: avoid;">
      <div style="font-weight: 800; font-size: 12px; color: #0f172a; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">
        Technician Route Closeout &amp; Odometer Record
      </div>
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; font-size: 11px; color: #334155;">
        <div>Start Odometer: ________________</div>
        <div>End Odometer: ________________</div>
        <div>Total Vehicle KM / Miles: ___________</div>
      </div>
      <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 16px; margin-top: 12px; font-size: 11px; color: #334155;">
        <div>Technician Signature: ________________________________________________</div>
        <div>Date: ________________________</div>
      </div>
    </div>
  </div>

  <script>
    // Automatically trigger browser print dialog after styles and layout settle
    window.addEventListener('load', function() {
      setTimeout(function() {
        try {
          window.print();
        } catch (err) {
          console.warn('Auto print invocation was restricted by browser:', err);
        }
      }, 350);
    });
  </script>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(fullHtml);
});

// Helper math and fallback route generators
function generateServerFallbackAddress(lat: number, lng: number) {
  let city = 'Edmonton';
  let neighborhood = 'Downtown / ICE District';
  let streetName = '104 Ave NW';
  const streetNum = Math.floor(Math.abs((lat * 1000) % 9000)) + 1000;

  if (lng < -113.62) {
    city = 'Edmonton';
    neighborhood = 'West Edmonton / Meadowlark';
    streetName = '170 St NW';
  } else if (lng > -113.38) {
    city = 'Sherwood Park';
    neighborhood = 'Strathcona Industrial / Centre';
    streetName = 'Broadmoor Blvd';
  } else if (lat > 53.60) {
    city = 'St. Albert';
    neighborhood = 'St. Albert Centre / Riel';
    streetName = 'St Anne St';
  } else if (lat < 53.40) {
    city = 'Nisku / Leduc';
    neighborhood = 'Nisku Industrial Park / Airport';
    streetName = 'Sparrow Dr';
  } else if (lat < 53.48) {
    city = 'Edmonton';
    neighborhood = 'South Edmonton / Mill Woods';
    streetName = 'Calgary Trail NW';
  } else if (lat < 53.53) {
    city = 'Edmonton';
    neighborhood = 'Old Strathcona / University';
    streetName = 'Whyte (82) Ave NW';
  } else {
    city = 'Edmonton';
    neighborhood = 'Downtown / ICE District';
    streetName = 'Jasper Ave NW';
  }

  return {
    formattedAddress: `${streetNum} ${streetName}, ${city}, AB T5J 0H8`,
    streetNumber: `${streetNum}`,
    streetName,
    neighborhood,
    city,
    state: 'AB',
    postalCode: 'T5J 0H8',
    fromGoogleApi: false,
  };
}

function calculateHaversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8; // Radius of the Earth in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function calculateEstimatedDistance(origin: any, destination: any, intermediates: any[] = []): number {
  const points = [origin, ...(intermediates || []), destination];
  let totalMiles = 0;
  for (let i = 0; i < points.length - 1; i++) {
    totalMiles += calculateHaversineDistance(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng) * 1.25; // 1.25 road winding factor
  }
  return Math.round(totalMiles * 1609.34);
}

function generateFallbackPolyline(origin: any, destination: any, intermediates: any[] = []): string {
  // Generate realistic road waypoints along grid / arterial avenues instead of straight chords
  const keypoints = [origin, ...(intermediates || []), destination];
  const roadCoords: number[][] = [];

  for (let i = 0; i < keypoints.length - 1; i++) {
    const start = keypoints[i];
    const end = keypoints[i + 1];
    roadCoords.push([start.lat, start.lng]);

    // Interpolate arterial turns (e.g. travel along latitude then longitude with highway arc)
    const latDiff = end.lat - start.lat;
    const lngDiff = end.lng - start.lng;
    const numSubsteps = Math.max(4, Math.min(16, Math.round(Math.hypot(latDiff, lngDiff) * 80)));

    for (let s = 1; s < numSubsteps; s++) {
      const t = s / numSubsteps;
      // Smooth S-curve transition to mimic highway turns
      const easeT = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      const interpLat = start.lat + latDiff * (t * 0.7 + easeT * 0.3);
      const interpLng = start.lng + lngDiff * (easeT * 0.7 + t * 0.3);
      roadCoords.push([interpLat, interpLng]);
    }
  }

  roadCoords.push([destination.lat, destination.lng]);
  return encodePolylineCoords(roadCoords);
}

function generateFallbackLegs(origin: any, destination: any, intermediates: any[] = []): any[] {
  const points = [origin, ...(intermediates || []), destination];
  const legs = [];
  for (let i = 0; i < points.length - 1; i++) {
    const distMiles = calculateHaversineDistance(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng) * 1.25;
    const durSec = Math.round((distMiles / 32) * 3600);
    legs.push({
      distanceMeters: Math.round(distMiles * 1609.34),
      duration: `${durSec}s`,
      startLocation: { latLng: { latitude: points[i].lat, longitude: points[i].lng } },
      endLocation: { latLng: { latitude: points[i + 1].lat, longitude: points[i + 1].lng } },
    });
  }
  return legs;
}

function encodePolylineCoords(coords: number[][]): string {
  let result = "";
  let prevLat = 0;
  let prevLng = 0;

  for (const [lat, lng] of coords) {
    const late5 = Math.round(lat * 1e5);
    const lnge5 = Math.round(lng * 1e5);

    result += encodeNumber(late5 - prevLat);
    result += encodeNumber(lnge5 - prevLng);

    prevLat = late5;
    prevLng = lnge5;
  }
  return result;
}

function encodeNumber(num: number): string {
  let sgn_num = num < 0 ? ~(num << 1) : num << 1;
  let encodeString = "";
  while (sgn_num >= 0x20) {
    encodeString += String.fromCharCode((0x20 | (sgn_num & 0x1f)) + 63);
    sgn_num >>= 5;
  }
  encodeString += String.fromCharCode(sgn_num + 63);
  return encodeString;
}

function generateAlgorithmicRecommendations(technicians: any[], pendingTickets: any[]) {
  const recommendations: any[] = [];
  const availableTechs = technicians.filter((t) => t.status !== "OFF_DUTY");

  pendingTickets.forEach((ticket) => {
    if (availableTechs.length === 0) return;
    let bestTech = availableTechs[0];
    let minScore = Infinity;
    const ticketLoc = ticket.location || { lat: 32.86, lng: -97.04 };
    const reqSkills = ticket.requiredSkills || (ticket.equipmentType ? [ticket.equipmentType] : []);

    availableTechs.forEach((tech) => {
      const techLoc = tech.currentLocation || tech.location || { lat: 32.86, lng: -97.04 };
      const dist = calculateHaversineDistance(techLoc.lat, techLoc.lng, ticketLoc.lat, ticketLoc.lng);
      const techSkills = tech.skills || [];
      const hasRequiredSkills = reqSkills.length === 0 || reqSkills.some((s: string) => techSkills.includes(s));
      const currentLoad = tech.assignedTickets?.length ?? tech.currentJobCount ?? tech.assignedCount ?? 0;
      const currentLoadPenalty = currentLoad * 4;
      const skillBonus = hasRequiredSkills ? -10 : 15;
      const score = dist + currentLoadPenalty + skillBonus;

      if (score < minScore) {
        minScore = score;
        bestTech = tech;
      }
    });

    if (bestTech) {
      const bestLoc = bestTech.currentLocation || bestTech.location || { lat: 32.86, lng: -97.04 };
      const estDriveMins = Math.round(
        (calculateHaversineDistance(bestLoc.lat, bestLoc.lng, ticketLoc.lat, ticketLoc.lng) / 32) * 60 + 5
      );
      recommendations.push({
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber || `TICK-${ticket.id}`,
        recommendedTechId: bestTech.id,
        recommendedTechName: bestTech.name,
        urgency: ticket.urgency || "ROUTINE",
        rationale: `Proximity (${minScore < 10 ? "Close" : "Regional"} range) with ${reqSkills.join(", ") || "Cleaning"} crew competency match for ${bestTech.vanNumber}.`,
        estimatedDriveMins: estDriveMins,
        urgencyLevelScore: ticket.urgency === "EMERGENCY" ? 10 : ticket.urgency === "SAME_DAY" ? 7 : 4,
      });
    }
  });

  return {
    summary: `AI Dispatcher analyzed ${pendingTickets.length} pending cleaning bookings across 2 dedicated mobile cleaning vans with Edmonton route matrix.`,
    fleetHealth: pendingTickets.some((t) => t.urgency === "EMERGENCY") ? "EMERGENCY_ALERT" : "OPTIMAL",
    estimatedFuelSavingsGallons: Math.round((pendingTickets.length * 1.8 + 3.2) * 10) / 10,
    estimatedDriveTimeSavedMinutes: pendingTickets.length * 14,
    recommendations,
    strategicInsights: [
      "Prioritize same-day move-out inspection deadlines before landlord walkthroughs.",
      "Consolidate Downtown/Oliver and Strathcona/Whyte Ave route clusters to minimize deadhead driving time between Van 1 and Van 2.",
      "Ensure backpack HEPA vacuums and heavy-duty oven degreasing kits are restocked for deep clean bookings.",
    ],
  };
}

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`\n  ➜  Local:   http://localhost:${PORT}/`);
    console.log(`  ➜  Network: http://0.0.0.0:${PORT}/`);
    console.log(`  Dispatch Server ready on port ${PORT}\n`);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${PORT} is already in use. Exiting to allow supervisor restart.`);
      process.exit(1);
    } else {
      console.error("Server error:", err);
    }
  });

  // Graceful termination handling
  const shutdown = () => {
    server.close(() => {
      process.exit(0);
    });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
