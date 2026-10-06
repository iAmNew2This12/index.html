// reCAPTCHA v3 SITE key (public). Must match the one in index.html.
var RECAPTCHA_SITE_KEY = "YOUR_RECAPTCHA_SITE_KEY";

(function () {
  "use strict";

  var form = document.getElementById("lead-form");
  var btn = document.getElementById("submit-btn");
  var errorBox = document.getElementById("form-error");
  var success = document.getElementById("success");
  document.getElementById("yr").textContent = new Date().getFullYear();

  var vinEl = document.getElementById("vin");
  var mileageEl = document.getElementById("mileage");

  // Keep VIN uppercase and strip characters that never appear in a VIN (I, O, Q, symbols)
  vinEl.addEventListener("input", function () {
    vinEl.value = vinEl.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "").slice(0, 17);
  });
  // Mileage: digits only, shown with commas
  mileageEl.addEventListener("input", function () {
    var digits = mileageEl.value.replace(/\D/g, "").slice(0, 6);
    mileageEl.value = digits ? Number(digits).toLocaleString("en-US") : "";
  });

  // ---- VIN check-digit validation (North American VINs) ----
  var TRANSLIT = { A:1,B:2,C:3,D:4,E:5,F:6,G:7,H:8,J:1,K:2,L:3,M:4,N:5,P:7,R:9,S:2,T:3,U:4,V:5,W:6,X:7,Y:8,Z:9 };
  var WEIGHTS = [8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2];
  function vinIsValid(vin) {
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return false;
    var sum = 0;
    for (var i = 0; i < 17; i++) {
      var c = vin[i];
      var v = /\d/.test(c) ? Number(c) : TRANSLIT[c];
      sum += v * WEIGHTS[i];
    }
    var check = sum % 11;
    var expected = check === 10 ? "X" : String(check);
    return vin[8] === expected;
  }

  function setFieldError(el, msg) {
    el.classList.add("invalid");
    el.setAttribute("aria-invalid", "true");
    var holder = el.closest(".field") || el.parentNode;
    var m = holder.querySelector(".field-msg");
    if (!m) { m = document.createElement("div"); m.className = "field-msg"; holder.appendChild(m); }
    m.textContent = msg;
  }
  function clearErrors() {
    errorBox.hidden = true;
    form.querySelectorAll(".invalid").forEach(function (el) { el.classList.remove("invalid"); el.removeAttribute("aria-invalid"); });
    form.querySelectorAll(".field-msg").forEach(function (m) { m.remove(); });
  }

  function validate(data) {
    var ok = true;
    var namePattern = /^[A-Za-zÀ-ÖØ-öø-ÿ' .-]{1,50}$/;
    if (!namePattern.test(data.firstName)) { setFieldError(form.firstName, "Please enter your first name."); ok = false; }
    if (!namePattern.test(data.lastName)) { setFieldError(form.lastName, "Please enter your last name."); ok = false; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email)) { setFieldError(form.email, "Please enter a valid email."); ok = false; }
    if (data.phone && data.phone.replace(/\D/g, "").length < 10) { setFieldError(form.phone, "Please enter a 10-digit phone number or leave blank."); ok = false; }
    if (!vinIsValid(data.vin)) { setFieldError(form.vin, "That VIN doesn't look right. Please double-check all 17 characters."); ok = false; }
    if (!data.model) { setFieldError(form.model, "Please choose your model."); ok = false; }
    var miles = Number(data.mileage);
    if (!data.mileage || isNaN(miles) || miles < 0 || miles > 300000) { setFieldError(form.mileage, "Please enter your current mileage."); ok = false; }
    if (!data.consent) { errorBox.textContent = "Please check the box to agree to be contacted."; errorBox.hidden = false; ok = false; }
    return ok;
  }

  function getToken() {
    return new Promise(function (resolve, reject) {
      if (!window.grecaptcha) return reject(new Error("reCAPTCHA did not load"));
      grecaptcha.ready(function () {
        grecaptcha.execute(RECAPTCHA_SITE_KEY, { action: "submit_lead" }).then(resolve, reject);
      });
    });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    clearErrors();

    var data = {
      firstName: form.firstName.value.trim(),
      lastName: form.lastName.value.trim(),
      email: form.email.value.trim(),
      phone: form.phone.value.trim(),
      vin: form.vin.value.trim().toUpperCase(),
      model: form.model.value,
      mileage: form.mileage.value.replace(/\D/g, ""),
      consent: form.consent.checked,
      company: form.company.value // honeypot
    };

    if (!validate(data)) {
      var first = form.querySelector(".invalid");
      if (first) first.focus();
      return;
    }

    btn.disabled = true;
    btn.textContent = "Sending…";

    getToken()
      .then(function (token) {
        data.recaptchaToken = token;
        return fetch("/.netlify/functions/submit-lead", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data)
        });
      })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (!res.ok || !body.ok) throw new Error(body.error || "Something went wrong.");
        });
      })
      .then(function () {
        form.hidden = true;
        success.hidden = false;
        success.focus();
      })
      .catch(function (err) {
        errorBox.textContent = err.message + " Please try again, or call us directly.";
        errorBox.hidden = false;
        btn.disabled = false;
        btn.textContent = "Get my quote";
      });
  });
})();
