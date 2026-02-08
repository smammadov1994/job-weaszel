---
name: captcha-solve
description: Detect and resolve CAPTCHAs during job applications
user-invocable: false
disable-model-invocation: false
---

# CAPTCHA Solving Skill

Detect and resolve CAPTCHAs that appear during the job application process.

## Detection

Watch for these CAPTCHA indicators on any page:

1. **reCAPTCHA v2** — Look for:
   - An iframe with `src` containing `google.com/recaptcha`
   - A div with class `g-recaptcha`
   - The "I'm not a robot" checkbox
   - `data-sitekey` attribute on the recaptcha element

2. **hCaptcha** — Look for:
   - An iframe with `src` containing `hcaptcha.com`
   - A div with class `h-captcha`
   - `data-sitekey` attribute

3. **Cloudflare Challenge** — Look for:
   - Page with "Checking your browser..." or "Just a moment..."
   - Cloudflare Turnstile widget
   - URL containing `/cdn-cgi/challenge-platform/`

4. **DataDome** — Look for:
   - A modal/overlay with CAPTCHA challenge
   - Geo-verification or slider challenges

## Resolution Flow

### Step 1: Auto-Solve via 2Captcha

1. Identify the CAPTCHA type and extract the site key:
   - For reCAPTCHA: Find `data-sitekey` attribute value
   - For hCaptcha: Find `data-sitekey` attribute value
2. Get the current page URL
3. Call the `solve_captcha` tool:
   ```
   solve_captcha({
     type: "recaptcha_v2" | "hcaptcha",
     siteKey: "<the data-sitekey value>",
     pageUrl: "<current page URL>"
   })
   ```
4. If successful, inject the solution token:
   - For reCAPTCHA: Set `document.getElementById('g-recaptcha-response').value = token` and call the callback
   - For hCaptcha: Set the response textarea value and trigger the callback
5. Submit the form / click continue

### Step 2: Manual Fallback via WhatsApp

If auto-solve fails (2Captcha returns error or times out):

1. Take a screenshot of the CAPTCHA
2. Send the screenshot to the user via WhatsApp with the message:
   ```
   CAPTCHA Help Needed

   I encountered a CAPTCHA I couldn't auto-solve while applying to [Company] - [Job Title].

   Platform: [platform]
   URL: [current URL]
   CAPTCHA type: [type]

   Please solve this CAPTCHA and send me back the solution, or reply "skip" to skip this application.
   ```
3. Wait for the user's response (up to 5 minutes)
4. If user sends a solution: inject it and continue
5. If user sends "skip": skip this application and log it

### Step 3: Give Up

If both auto-solve and manual fallback fail:
1. Log the application as `captcha_blocked`
2. Include notes about the CAPTCHA type and what was tried
3. Move on to the next job
4. If you encounter 3 CAPTCHAs in a row on the same platform, stop that platform and notify the user — the platform may be detecting automation

## Injecting Solutions

### reCAPTCHA v2 Token Injection
```javascript
// Set the response token
document.getElementById('g-recaptcha-response').value = '<TOKEN>';

// Make the textarea visible (some forms check this)
document.getElementById('g-recaptcha-response').style.display = 'block';

// Trigger the callback if it exists
if (typeof ___grecaptcha_cfg !== 'undefined') {
  // Find and call the callback
  Object.keys(___grecaptcha_cfg.clients).forEach(key => {
    const client = ___grecaptcha_cfg.clients[key];
    // Navigate the object to find the callback function
    const callback = findCallback(client);
    if (callback) callback('<TOKEN>');
  });
}
```

### hCaptcha Token Injection
```javascript
// Set response
document.querySelector('[name="h-captcha-response"]').value = '<TOKEN>';
document.querySelector('[name="g-recaptcha-response"]').value = '<TOKEN>';

// Trigger callback
const iframe = document.querySelector('iframe[src*="hcaptcha"]');
if (iframe) {
  // hCaptcha uses postMessage
  window.postMessage({ type: 'hcaptcha-response', response: '<TOKEN>' }, '*');
}
```

## Important Notes

- Never attempt to solve CAPTCHAs by brute force or automated clicking
- The 2Captcha API has costs — only call it when a CAPTCHA is actually present
- If a Cloudflare challenge page appears, wait 10 seconds first — it often resolves on its own
- Some CAPTCHAs are invisible (reCAPTCHA v3) — these usually don't need manual solving; if the page works normally, there's no CAPTCHA to solve
