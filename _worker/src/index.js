// GT-Apps contact form Worker: https://forms.gt-apps.co.uk/contact
// Checks the request (origin, size, fields, honeypot, rate limit, Turnstile),
// then sends one email through Microsoft Graph as the send-only sender mailbox,
// to support@ or enquiries@ by subject, with Reply-To set to the visitor.
// Stores nothing. See _docs/contact-form-worker.md.

export const LIMITS = {
  body: 16 * 1024, // bytes of JSON accepted
  name: 100,
  email: 200,
  messageMin: 10,
  message: 4000,
  token: 2048,
};

// The only subjects accepted; anything else is refused. Support goes to
// SUPPORT_TO, everything else to ENQUIRIES_TO (never a client-supplied address).
export const TOPICS = ["General enquiry", "Business or press", "App support"];
const SUPPORT_TOPIC = "App support";

const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

function list(value) {
  return String(value || "").split(",").map((s) => s.trim()).filter(Boolean);
}

function corsHeaders(origin, env) {
  const allowed = list(env.ALLOWED_ORIGINS);
  const headers = { Vary: "Origin" };
  if (origin && allowed.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return headers;
}

function json(status, body, extra) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    },
  });
}

// One line, no control characters: for names and subjects.
function oneLine(s) {
  return String(s).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
}

// Keeps newlines and tabs, drops other control characters.
function multiLine(s) {
  return String(s).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();
}

export function mailConfigured(env) {
  return Boolean(env.GRAPH_TENANT_ID && env.GRAPH_CLIENT_ID && env.GRAPH_CLIENT_SECRET && env.SENDER);
}

// Returns { ok: true, data } or { ok: false, errors: { field: message } }.
export function validate(input) {
  const errors = {};
  const str = (v) => (typeof v === "string" ? v : "");
  const name = oneLine(str(input.name));
  const email = str(input.email).trim();
  const topic = str(input.topic).trim();
  const message = multiLine(str(input.message));
  const turnstile = str(input.turnstile).trim();

  if (!name) errors.name = "required";
  else if (name.length > LIMITS.name) errors.name = "too long";
  if (!email) errors.email = "required";
  else if (email.length > LIMITS.email || !EMAIL.test(email)) errors.email = "invalid";
  if (!TOPICS.includes(topic)) errors.topic = "invalid";
  if (!message) errors.message = "required";
  else if (message.length < LIMITS.messageMin) errors.message = "too short";
  else if (message.length > LIMITS.message) errors.message = "too long";
  if (!turnstile) errors.turnstile = "required";
  else if (turnstile.length > LIMITS.token) errors.turnstile = "invalid";

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, data: { name, email, topic, message, turnstile } };
}

export function recipientFor(topic, env) {
  return topic === SUPPORT_TOPIC ? env.SUPPORT_TO : env.ENQUIRIES_TO;
}

export async function verifyTurnstile(token, ip, env, fetcher = fetch) {
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  let outcome;
  try {
    const res = await fetcher(SITEVERIFY, { method: "POST", body: form });
    outcome = await res.json();
  } catch {
    return { ok: false, reason: "siteverify unreachable" };
  }
  if (!outcome || outcome.success !== true) {
    return { ok: false, reason: "rejected: " + ((outcome && outcome["error-codes"]) || []).join(",") };
  }
  const hosts = list(env.TURNSTILE_HOSTNAMES);
  if (hosts.length && !hosts.includes(outcome.hostname)) {
    return { ok: false, reason: "hostname " + outcome.hostname };
  }
  if (outcome.action && outcome.action !== "contact") {
    return { ok: false, reason: "action " + outcome.action };
  }
  return { ok: true };
}

// App-only Graph token, cached in this isolate until shortly before it expires.
let cachedToken = null;
export function resetTokenCache() { cachedToken = null; }

async function graphToken(env, fetcher) {
  const now = Date.now();
  if (cachedToken && cachedToken.expires > now + 60_000) return cachedToken.value;
  const body = new URLSearchParams({
    client_id: env.GRAPH_CLIENT_ID,
    client_secret: env.GRAPH_CLIENT_SECRET,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const res = await fetcher(
    "https://login.microsoftonline.com/" + encodeURIComponent(env.GRAPH_TENANT_ID) + "/oauth2/v2.0/token",
    { method: "POST", body },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error("token " + res.status + " " + (data.error || ""));
  cachedToken = { value: data.access_token, expires: now + (Number(data.expires_in) || 3000) * 1000 };
  return cachedToken.value;
}

export function buildMessage(data, env, meta = {}) {
  const lines = [
    data.message,
    "",
    "-- ",
    "From: " + data.name + " <" + data.email + ">",
    "Subject: " + data.topic,
    "Sent from the contact form on gt-apps.co.uk" + (meta.when ? " at " + meta.when : "") + ".",
    "Reply to this email to answer them directly.",
  ];
  return {
    subject: "[gt-apps.co.uk] " + data.topic + " from " + data.name,
    body: { contentType: "Text", content: lines.join("\n") },
    toRecipients: [{ emailAddress: { address: recipientFor(data.topic, env) } }],
    replyTo: [{ emailAddress: { address: data.email, name: data.name } }],
  };
}

export async function sendMail(data, env, fetcher = fetch, meta = {}) {
  const token = await graphToken(env, fetcher);
  const res = await fetcher(
    "https://graph.microsoft.com/v1.0/users/" + encodeURIComponent(env.SENDER) + "/sendMail",
    {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ message: buildMessage(data, env, meta), saveToSentItems: false }),
    },
  );
  if (res.status !== 202) {
    const text = await res.text().catch(() => "");
    if (res.status === 401) resetTokenCache();
    throw new Error("sendMail " + res.status + " " + text.slice(0, 200));
  }
}

async function readBody(request) {
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > LIMITS.body) return { tooLarge: true };
  if (!request.body) return { text: "" };
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > LIMITS.body) { await reader.cancel(); return { tooLarge: true }; }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return { text: new TextDecoder().decode(all) };
}

export async function handle(request, env, ctx = {}, fetcher = fetch) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  const cors = corsHeaders(origin, env);
  const reply = (status, body) => json(status, body, cors);

  if (url.pathname === "/health" && request.method === "GET") {
    return reply(200, { ok: true, mail: mailConfigured(env) });
  }
  if (url.pathname !== "/contact") return reply(404, { ok: false, error: "not_found" });
  if (request.method === "OPTIONS") {
    return new Response(null, { status: cors["Access-Control-Allow-Origin"] ? 204 : 403, headers: cors });
  }
  if (request.method !== "POST") return json(405, { ok: false, error: "method" }, { ...cors, Allow: "POST, OPTIONS" });
  if (!cors["Access-Control-Allow-Origin"]) return reply(403, { ok: false, error: "origin" });
  if (!(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) {
    return reply(415, { ok: false, error: "content_type" });
  }

  const ip = request.headers.get("CF-Connecting-IP") || "";
  if (env.RATE_LIMITER) {
    const { success } = await env.RATE_LIMITER.limit({ key: "contact:" + ip });
    if (!success) return reply(429, { ok: false, error: "rate_limited" });
  }

  const raw = await readBody(request);
  if (raw.tooLarge) return reply(413, { ok: false, error: "too_large" });
  let input;
  try { input = JSON.parse(raw.text); } catch { return reply(400, { ok: false, error: "bad_json" }); }
  if (!input || typeof input !== "object" || Array.isArray(input)) return reply(400, { ok: false, error: "bad_json" });

  // Honeypot: a bot filled the hidden field. Look successful, send nothing.
  if (typeof input.website === "string" && input.website.trim()) return reply(200, { ok: true });

  const checked = validate(input);
  if (!checked.ok) return reply(422, { ok: false, error: "invalid", fields: checked.errors });

  if (!env.TURNSTILE_SECRET) return reply(503, { ok: false, error: "not_configured" });
  const human = await verifyTurnstile(checked.data.turnstile, ip, env, fetcher);
  if (!human.ok) {
    console.log("turnstile failed: " + human.reason);
    return reply(403, { ok: false, error: "turnstile" });
  }

  if (!mailConfigured(env)) return reply(503, { ok: false, error: "not_configured" });
  try {
    await sendMail(checked.data, env, fetcher, { when: new Date().toISOString() });
  } catch (err) {
    console.log("send failed: " + err.message);
    return reply(502, { ok: false, error: "send_failed" });
  }
  return reply(200, { ok: true });
}

export default {
  fetch(request, env, ctx) {
    return handle(request, env, ctx);
  },
};
