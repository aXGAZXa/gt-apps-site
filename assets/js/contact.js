// GT-Apps contact form: validation, then either a POST to the approved
// endpoint (data-endpoint on the form) or, while that is empty, the visitor's
// own email app via mailto. No cookies, no tracking, no third parties.
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

  function sendByPost() {
    button.disabled = true;
    status.textContent = "Sending…";
    var data = {
      name: value("name"), email: value("email"), topic: value("topic"),
      message: value("message"), website: field("website").value
    };
    var token = form.querySelector("[name='cf-turnstile-response']");
    if (token) data.turnstile = token.value;
    fetch(form.dataset.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    }).then(function (res) {
      if (!res.ok) throw new Error(String(res.status));
      form.reset();
      status.textContent = "Thank you. Your message has been sent, and we’ll reply by email.";
    }).catch(function () {
      status.textContent = "Sorry, that didn’t send. Please try again, or email " + recipient() + " directly.";
    }).then(function () { button.disabled = false; });
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    status.textContent = "";
    var invalid = validate();
    if (invalid) { invalid.focus(); return; }
    if (field("website").value) { status.textContent = "Thank you."; return; } // honeypot: a bot filled it
    if (form.dataset.endpoint) sendByPost(); else sendByMail();
  });
})();
