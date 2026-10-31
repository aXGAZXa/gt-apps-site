// Run: node --test _worker/test/*.test.js   (Node 20+, no dependencies)
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { handle, validate, recipientFor, buildMessage, resetTokenCache, LIMITS } from "../src/index.js";

const ORIGIN = "https://gt-apps.co.uk";

function env(extra = {}) {
  return {
    ALLOWED_ORIGINS: "https://gt-apps.co.uk,https://www.gt-apps.co.uk",
    TURNSTILE_HOSTNAMES: "gt-apps.co.uk,www.gt-apps.co.uk",
    SUPPORT_TO: "support@gt-apps.co.uk",
    ENQUIRIES_TO: "enquiries@gt-apps.co.uk",
    SENDER: "forms@gt-apps.co.uk",
    TURNSTILE_SECRET: "ts-secret",
    GRAPH_TENANT_ID: "tenant",
    GRAPH_CLIENT_ID: "client",
    GRAPH_CLIENT_SECRET: "secret",
    ...extra,
  };
}

const good = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  topic: "General enquiry",
  message: "Hello there, I would like to ask about your games.",
  website: "",
  turnstile: "tok",
};

function post(body, headers = {}) {
  return new Request("https://forms.gt-apps.co.uk/contact", {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.9", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// A fake fetch that records calls and answers siteverify, token and sendMail.
function fakeFetch({ turnstile = { success: true, hostname: "gt-apps.co.uk", action: "contact" }, sendStatus = 202 } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("siteverify")) return Response.json(turnstile);
    if (String(url).includes("oauth2")) return Response.json({ access_token: "AT", expires_in: 3600 });
    if (String(url).includes("sendMail")) return new Response(sendStatus === 202 ? null : "err", { status: sendStatus });
    throw new Error("unexpected " + url);
  };
  fn.calls = calls;
  return fn;
}

beforeEach(() => resetTokenCache());

test("a valid enquiry is verified and sent to enquiries@ with Reply-To the visitor", async () => {
  const f = fakeFetch();
  const res = await handle(post(good), env(), {}, f);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  const send = f.calls.find((c) => c.url.includes("sendMail"));
  assert.ok(send.url.endsWith("/users/forms%40gt-apps.co.uk/sendMail"));
  const msg = JSON.parse(send.init.body).message;
  assert.equal(msg.toRecipients[0].emailAddress.address, "enquiries@gt-apps.co.uk");
  assert.equal(msg.replyTo[0].emailAddress.address, "ada@example.com");
  assert.match(msg.subject, /General enquiry from Ada Lovelace/);
  const verify = f.calls.find((c) => c.url.includes("siteverify"));
  assert.equal(verify.init.body.get("remoteip"), "203.0.113.9");
  assert.equal(verify.init.body.get("secret"), "ts-secret");
});

test("app support goes to support@; other subjects go to enquiries@", () => {
  assert.equal(recipientFor("App support", env()), "support@gt-apps.co.uk");
  assert.equal(recipientFor("Business or press", env()), "enquiries@gt-apps.co.uk");
  assert.equal(recipientFor("General enquiry", env()), "enquiries@gt-apps.co.uk");
});

test("the recipient can't be chosen by the client", async () => {
  const f = fakeFetch();
  const res = await handle(post({ ...good, to: "victim@example.com", topic: "Anything" }), env(), {}, f);
  assert.equal(res.status, 422);
  assert.equal(f.calls.length, 0);
});

test("honeypot filled: looks successful, nothing verified or sent", async () => {
  const f = fakeFetch();
  const res = await handle(post({ ...good, website: "http://spam" }), env(), {}, f);
  assert.equal(res.status, 200);
  assert.equal(f.calls.length, 0);
});

test("validation rejects missing, short, long and malformed fields", () => {
  assert.deepEqual(validate({}).errors, { name: "required", email: "required", topic: "invalid", message: "required", turnstile: "required" });
  assert.equal(validate({ ...good, email: "not-an-email" }).errors.email, "invalid");
  assert.equal(validate({ ...good, email: "a@b.com>, x@y.com" }).errors.email, "invalid");
  assert.equal(validate({ ...good, message: "short" }).errors.message, "too short");
  assert.equal(validate({ ...good, message: "x".repeat(LIMITS.message + 1) }).errors.message, "too long");
  assert.equal(validate({ ...good, name: "n".repeat(LIMITS.name + 1) }).errors.name, "too long");
  assert.equal(validate({ ...good, name: 42 }).errors.name, "required");
});

test("names are flattened to one line", () => {
  const v = validate({ ...good, name: "Ada\r\nBcc: x@y.com" });
  assert.equal(v.data.name, "Ada Bcc: x@y.com");
  assert.ok(!buildMessage(v.data, env()).subject.includes("\n"));
});

test("bodies over the size limit are refused with 413", async () => {
  const big = JSON.stringify({ ...good, message: "x".repeat(LIMITS.body) });
  const res = await handle(post(big), env(), {}, fakeFetch());
  assert.equal(res.status, 413);
});

test("unknown origins, wrong methods and content types are refused", async () => {
  assert.equal((await handle(post(good, { Origin: "https://evil.example" }), env(), {}, fakeFetch())).status, 403);
  assert.equal((await handle(post(good, { "Content-Type": "text/plain" }), env(), {}, fakeFetch())).status, 415);
  const get = new Request("https://forms.gt-apps.co.uk/contact", { headers: { Origin: ORIGIN } });
  assert.equal((await handle(get, env(), {}, fakeFetch())).status, 405);
  assert.equal((await handle(new Request("https://forms.gt-apps.co.uk/other"), env())).status, 404);
  assert.equal((await handle(post("{not json"), env(), {}, fakeFetch())).status, 400);
});

test("CORS preflight is answered only for the site's origins", async () => {
  const pre = (origin) => new Request("https://forms.gt-apps.co.uk/contact", { method: "OPTIONS", headers: { Origin: origin } });
  const ok = await handle(pre(ORIGIN), env());
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");
  assert.equal((await handle(pre("https://evil.example"), env())).status, 403);
});

test("a failed or foreign Turnstile token is refused and nothing is sent", async () => {
  for (const turnstile of [
    { success: false, "error-codes": ["invalid-input-response"] },
    { success: true, hostname: "evil.example", action: "contact" },
    { success: true, hostname: "gt-apps.co.uk", action: "login" },
  ]) {
    const f = fakeFetch({ turnstile });
    const res = await handle(post(good), env(), {}, f);
    assert.equal(res.status, 403);
    assert.ok(!f.calls.some((c) => c.url.includes("sendMail")));
  }
});

test("rate limit: over the limit gets 429 before anything else is done", async () => {
  const f = fakeFetch();
  const res = await handle(post(good), env({ RATE_LIMITER: { limit: async () => ({ success: false }) } }), {}, f);
  assert.equal(res.status, 429);
  assert.equal(f.calls.length, 0);
});

test("mail not configured yet: 503 after Turnstile passes, so the site falls back to mailto", async () => {
  const f = fakeFetch();
  const res = await handle(post(good), env({ GRAPH_CLIENT_SECRET: "" }), {}, f);
  assert.equal(res.status, 503);
  assert.ok(!f.calls.some((c) => c.url.includes("sendMail")));
});

test("Graph refusing the send gives 502", async () => {
  const res = await handle(post(good), env(), {}, fakeFetch({ sendStatus: 403 }));
  assert.equal(res.status, 502);
});

test("the Graph token is reused between sends", async () => {
  const f = fakeFetch();
  await handle(post(good), env(), {}, f);
  await handle(post(good), env(), {}, f);
  assert.equal(f.calls.filter((c) => c.url.includes("oauth2")).length, 1);
});

test("health reports whether mail is configured, without secrets", async () => {
  const res = await handle(new Request("https://forms.gt-apps.co.uk/health"), env({ GRAPH_CLIENT_ID: "" }));
  assert.deepEqual(await res.json(), { ok: true, mail: false });
});
