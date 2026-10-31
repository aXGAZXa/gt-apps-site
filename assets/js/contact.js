// GT-Apps contact form: validation, then a POST to the GT-Apps Worker
// (data-endpoint on the form) after a Cloudflare Turnstile check, falling back
// to the visitor's own email app (mailto) if the Worker or Turnstile fails, or
// if data-endpoint is empty. No cookies of our own, no tracking.
(function () {
  "use strict";

  var form = document.getElementById("contact-form");
  if (!form) return;
  form.noValidate = true; // our messages replace the browser's; without JS the browser validates

  var status = form.querySelector(".form-status");
  var button = form.querySelector("button[type=submit]");
  var MAILTO_LIMIT = 1800; // long mailto links get cut off by some email apps
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  var checks = {
    name: function (v) { return v ? "" : "Please enter your name."; },
    email: function (v) {
      if (!v) return "Please enter your email address, so we can reply.";
      return EMAIL.test(v) ? "" : "That email address doesn’t look right.";
    },
    message: function (v) {
      if (!v) return "Please write a message.";
      return v.length < 10 ? "Please write a little more (at least 10 characters)." : "";
    }
  };

  function field(name) { return form.elements[name]; }
  function value(name) { return field(name).value.trim(); }

  function showError(name, text) {
    var input = field(name);
    var slot = document.getElementById(input.id + "-err");
    slot.textContent = text;
    if (text) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  }

  function validate() {
    var first = null;
    Object.keys(checks).forEach(function (name) {
      var text = checks[name](value(name));
      showError(name, text);
      if (text && !first) first = field(name);
    });
    return first;
  }

  // Re-check a field as it's corrected, once it has been flagged.
  Object.keys(checks).forEach(function (name) {
    field(name).addEventListener("input", function () {
      if (field(name).getAttribute("aria-invalid")) showError(name, checks[name](value(name)));
    });
  });

  function recipient() {
    var option = field("topic").selectedOptions[0];
    return (option && option.dataset.to) || form.dataset.to;
  }

  function sendByMail() {
    var to = recipient();
    var subject = value("topic") + " from " + value("name");
    var body = value("message") + "\n\n" + value("name") + "\n" + value("email");
    var href = "mailto:" + to + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
    var note = "Your email app should now open with your message ready to send. If it doesn’t, email " + to + " directly.";
    if (href.length > MAILTO_LIMIT) {
      href = "mailto:" + to + "?subject=" + encodeURIComponent(subject) +
        "&body=" + encodeURIComponent("(Paste your message here.)\n\n" + value("name") + "\n" + value("email"));
      if (navigator.clipboard) {
        navigator.clipboard.writeText(value("message")).catch(function () {});
        note = "Your message is long, so we’ve copied it: paste it into the email that opens, addressed to " + to + ".";
      } else {
        note = "Your message is long: please copy it into the email that opens, addressed to " + to + ".";
      }
    }
    window.location.href = href;
    status.textContent = note;
  }

  // Turnstile (Cloudflare's spam check) loads only once the visitor starts on
  // the form, and only when there is an endpoint to send to. If it can't load,
  // the form falls back to mailto.
  var sitekey = form.dataset.turnstileSitekey;
  var slot = document.getElementById("cf-turnstile");
  var fallback = form.querySelector(".form-fallback");
  var TOKEN_WAIT_MS = 15000;
  var ts = { state: "idle", widget: null, token: "", waiting: null };

  function loadTurnstile() {
    if (!form.dataset.endpoint || !sitekey || !slot || ts.state !== "idle") return;
    ts.state = "loading";
    var script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = function () {
      try {
        ts.widget = window.turnstile.render(slot, {
          sitekey: sitekey,
          action: "contact",
          theme: "dark",
          size: "flexible",
          callback: function (token) { ts.token = token; if (ts.waiting) ts.waiting(); },
          "expired-callback": function () { ts.token = ""; },
          // Turnstile retries by itself; a send waiting on it gets the mailto option now.
          "error-callback": function () { ts.token = ""; if (ts.waiting) ts.waiting(); return true; }
        });
        ts.state = "ready";
      } catch (e) { ts.state = "failed"; }
      if (ts.state === "failed" && ts.waiting) ts.waiting();
    };
    script.onerror = function () { ts.state = "failed"; if (ts.waiting) ts.waiting(); };
    document.head.appendChild(script);
  }
  form.addEventListener("focusin", loadTurnstile);
  form.addEventListener("pointerdown", loadTurnstile);

  function resetTurnstile() {
    ts.token = "";
    if (ts.widget !== null && window.turnstile) { try { window.turnstile.reset(ts.widget); } catch (e) {} }
  }

  // Calls back with a token, or with "" if Turnstile failed or took too long.
  function whenToken(done) {
    if (ts.token) return done(ts.token);
    if (ts.state === "failed") return done("");
    var timer = setTimeout(finish, TOKEN_WAIT_MS);
    function finish() { clearTimeout(timer); ts.waiting = null; done(ts.state === "failed" ? "" : ts.token); }
    ts.waiting = finish;
    loadTurnstile();
  }

  function offerMail(text) {
    status.textContent = text;
    if (fallback) fallback.hidden = false;
  }
  if (fallback) fallback.querySelector("button").addEventListener("click", function () {
    fallback.hidden = true;
    if (validate()) return;
    sendByMail();
  });

  function sendByPost() {
    button.disabled = true;
    status.textContent = "Sending…";
    whenToken(function (token) {
      if (!token) {
        button.disabled = false;
        resetTurnstile();
        offerMail("We couldn’t run our spam check, so the form can’t send directly. You can send it with your email app instead, or email " + recipient() + ".");
        return;
      }
      var data = {
        name: value("name"), email: value("email"), topic: value("topic"),
        message: value("message"), website: field("website").value, turnstile: token
      };
      fetch(form.dataset.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      }).then(function (res) {
        if (res.ok) {
          form.reset();
          status.textContent = "Thank you. Your message has been sent, and we’ll reply by email.";
          return;
        }
        if (res.status === 429) {
          offerMail("You’ve sent a few messages in a short time. Please wait a minute and try again, or send it with your email app.");
          return;
        }
        throw new Error(String(res.status));
      }).catch(function () {
        offerMail("Sorry, that didn’t send. Please try again, send it with your email app instead, or email " + recipient() + ".");
      }).then(function () { button.disabled = false; resetTurnstile(); });
    });
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    status.textContent = "";
    if (fallback) fallback.hidden = true;
    var invalid = validate();
    if (invalid) { invalid.focus(); return; }
    if (field("website").value) { status.textContent = "Thank you."; return; } // honeypot: a bot filled it
    if (form.dataset.endpoint) sendByPost(); else sendByMail();
  });
})();
