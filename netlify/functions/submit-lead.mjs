// Netlify Function: receives the form, verifies it server-side, and forwards it to Google Apps Script.
// Secrets live in Netlify environment variables — never in the browser:
//   RECAPTCHA_SECRET_KEY   reCAPTCHA v3 secret key
//   APPS_SCRIPT_URL        the Apps Script web app URL (ends in /exec)
//   SHARED_SECRET          long random string, must match SHARED_SECRET in Apps Script properties
//   ALLOWED_ORIGINS        comma-separated, e.g. https://vehicle-service-contract.com,https://www.vehicle-service-contract.com
//   RECAPTCHA_MIN_SCORE    optional, default 0.5

const MAX_BODY_BYTES = 4096;
const NAME_RE = /^[A-Za-zÀ-ÖØ-öø-ÿ' .-]{1,50}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
const MODELS = new Set([
  "A3","S3","RS 3","A4","S4","A5","S5","RS 5","A6","S6","RS 6 Avant","A7","S7","RS 7","A8","S8",
  "Q3","Q5","SQ5","Q5 Sportback","Q7","SQ7","Q8","SQ8","RS Q8",
  "Q4 e-tron","Q4 Sportback e-tron","Q6 e-tron","Q8 e-tron","e-tron GT","RS e-tron GT",
  "TT","R8","Other"
]);

const TRANSLIT = { A:1,B:2,C:3,D:4,E:5,F:6,G:7,H:8,J:1,K:2,L:3,M:4,N:5,P:7,R:9,S:2,T:3,U:4,V:5,W:6,X:7,Y:8,Z:9 };
const WEIGHTS = [8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2];
export function vinIsValid(vin) {
  if (!VIN_RE.test(vin)) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const c = vin[i];
    sum += (/\d/.test(c) ? Number(c) : TRANSLIT[c]) * WEIGHTS[i];
  }
  const r = sum % 11;
  return vin[8] === (r === 10 ? "X" : String(r));
}

// Best-effort per-instance throttle (Apps Script enforces a second, shared limit)
const hits = new Map();
function throttled(ip) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const list = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > 5;
}

function json(status, body, origin) {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (origin) { headers["Access-Control-Allow-Origin"] = origin; headers["Vary"] = "Origin"; }
  return new Response(JSON.stringify(body), { status, headers });
}

export function validate(d) {
  const errors = [];
  if (typeof d !== "object" || d === null) return ["Invalid request."];
  const s = (v) => (typeof v === "string" ? v.trim() : "");
  const clean = {
    firstName: s(d.firstName),
    lastName: s(d.lastName),
    email: s(d.email).toLowerCase(),
    phone: s(d.phone).replace(/[^\d+()\- .]/g, "").slice(0, 20),
    vin: s(d.vin).toUpperCase(),
    model: s(d.model),
    mileage: s(String(d.mileage ?? "")).replace(/\D/g, ""),
    consent: d.consent === true
  };
  if (!NAME_RE.test(clean.firstName)) errors.push("first name");
  if (!NAME_RE.test(clean.lastName)) errors.push("last name");
  if (!EMAIL_RE.test(clean.email) || clean.email.length > 254) errors.push("email");
  if (clean.phone && clean.phone.replace(/\D/g, "").length < 10) errors.push("phone");
  if (!vinIsValid(clean.vin)) errors.push("VIN");
  if (!MODELS.has(clean.model)) errors.push("model");
  const miles = Number(clean.mileage);
  if (!clean.mileage || !Number.isFinite(miles) || miles > 300000) errors.push("mileage");
  if (!clean.consent) errors.push("consent");
  return errors.length ? errors : clean;
}

export default async (req, context) => {
  const allowed = (process.env.ALLOWED_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean);
  const origin = req.headers.get("origin") || "";
  const okOrigin = allowed.includes(origin) ? origin : null;

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: okOrigin ? 204 : 403,
      headers: okOrigin ? {
        "Access-Control-Allow-Origin": okOrigin,
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Content-Type",
        "Vary": "Origin"
      } : {}
    });
  }
  if (req.method !== "POST") return json(405, { ok: false, error: "Method not allowed." });
  if (!okOrigin) return json(403, { ok: false, error: "Request not allowed." });

  const { RECAPTCHA_SECRET_KEY, APPS_SCRIPT_URL, SHARED_SECRET } = process.env;
  if (!RECAPTCHA_SECRET_KEY || !APPS_SCRIPT_URL || !SHARED_SECRET) {
    console.error("Missing environment variables");
    return json(500, { ok: false, error: "Form is not configured yet." }, okOrigin);
  }

  const ip = context?.ip || req.headers.get("x-nf-client-connection-ip") || "unknown";
  if (throttled(ip)) return json(429, { ok: false, error: "Too many requests. Please wait a few minutes." }, okOrigin);

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json(413, { ok: false, error: "Request too large." }, okOrigin);

  let body;
  try { body = JSON.parse(raw); } catch { return json(400, { ok: false, error: "Invalid request." }, okOrigin); }

  // Honeypot: pretend success so bots don't learn anything
  if (body.company) return json(200, { ok: true }, okOrigin);

  const result = validate(body);
  if (Array.isArray(result)) {
    return json(400, { ok: false, error: `Please check: ${result.join(", ")}.` }, okOrigin);
  }

  // Verify reCAPTCHA v3 server-side
  try {
    const params = new URLSearchParams({ secret: RECAPTCHA_SECRET_KEY, response: String(body.recaptchaToken || "") });
    if (ip !== "unknown") params.set("remoteip", ip);
    const r = await fetch("https://www.google.com/recaptcha/api/siteverify", { method: "POST", body: params });
    const v = await r.json();
    const minScore = Number(process.env.RECAPTCHA_MIN_SCORE || 0.5);
    const allowedHosts = allowed.map((o) => new URL(o).hostname);
    if (!v.success || v.action !== "submit_lead" || (v.score ?? 0) < minScore ||
        (allowedHosts.length && !allowedHosts.includes(v.hostname))) {
      console.warn("reCAPTCHA rejected", { score: v.score, action: v.action, host: v.hostname, errors: v["error-codes"] });
      return json(403, { ok: false, error: "We couldn't verify your submission." }, okOrigin);
    }
  } catch (err) {
    console.error("reCAPTCHA verify failed", err);
    return json(502, { ok: false, error: "Verification service unavailable." }, okOrigin);
  }

  // Forward to Apps Script (which writes to the Google Sheet in Drive)
  try {
    const r = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ secret: SHARED_SECRET, ip, lead: result }),
      redirect: "follow"
    });
    const out = await r.json().catch(() => ({}));
    if (!out.ok) {
      console.error("Apps Script error", out);
      const msg = out.error === "rate_limited" ? "Too many requests. Please wait a few minutes." : "We couldn't save your request.";
      return json(out.error === "rate_limited" ? 429 : 502, { ok: false, error: msg }, okOrigin);
    }
  } catch (err) {
    console.error("Apps Script call failed", err);
    return json(502, { ok: false, error: "We couldn't save your request." }, okOrigin);
  }

  return json(200, { ok: true }, okOrigin);
};
