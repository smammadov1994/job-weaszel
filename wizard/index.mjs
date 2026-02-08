#!/usr/bin/env node

import prompts from "prompts";
import { execSync, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── Helpers ─────────────────────────────────────────────────────────────────

function banner() {
  console.log(`
     ╦╔═╗╔╗   ╦ ╦╔═╗╔═╗╔═╗╔═╗╔═╗╦
     ║║ ║╠╩╗  ║║║║╣ ╠═╣╚═╗╔═╝║╣ ║
    ╚╝╚═╝╚═╝  ╚╩╝╚═╝╩ ╩╚═╝╚═╝╚═╝╩═╝

  Automated Job Application Agent
  ─────────────────────────────────
  `);
}

function abort(msg) {
  console.error(`\n  ERROR: ${msg}\n`);
  process.exit(1);
}

function cmdExists(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function readTemplate(name) {
  return fs.readFileSync(path.join(__dirname, "templates", name), "utf-8");
}

function fillTemplate(tmpl, vars) {
  let out = tmpl;
  for (const [key, val] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, val);
  }
  return out;
}

function onCancel() {
  console.log("\n  Setup cancelled. Run again any time.\n");
  process.exit(0);
}

// ── Phase 0: Pre-flight ─────────────────────────────────────────────────────

async function preflight() {
  console.log("  Checking prerequisites...\n");

  if (!cmdExists("docker")) {
    abort(
      "Docker not found. Install it from https://docs.docker.com/get-docker/"
    );
  }

  // Check for docker compose (v2 plugin or standalone)
  let composeCmd = "docker compose";
  try {
    execSync("docker compose version", { stdio: "ignore" });
  } catch {
    if (cmdExists("docker-compose")) {
      composeCmd = "docker-compose";
    } else {
      abort(
        "Docker Compose not found. Install it from https://docs.docker.com/compose/install/"
      );
    }
  }

  console.log("  ✓ Docker found");
  console.log("  ✓ Docker Compose found");
  console.log();

  return composeCmd;
}

// ── Phase 2: API Keys ───────────────────────────────────────────────────────

async function collectApiKeys() {
  console.log("  ── API Keys ──────────────────────────────\n");

  const answers = await prompts(
    [
      {
        type: "password",
        name: "anthropicKey",
        message: "Anthropic API key (required)",
        validate: (v) =>
          v.startsWith("sk-ant-") ? true : "Must start with sk-ant-",
      },
      {
        type: "password",
        name: "twoCaptchaKey",
        message: "2Captcha API key (optional, press Enter to skip)",
      },
    ],
    { onCancel }
  );

  const gatewayToken = randomBytes(32).toString("hex");

  return {
    anthropicKey: answers.anthropicKey,
    twoCaptchaKey: answers.twoCaptchaKey || "",
    gatewayToken,
  };
}

// ── Phase 3: WhatsApp ───────────────────────────────────────────────────────

async function collectWhatsApp() {
  console.log("\n  ── WhatsApp Notifications ─────────────────\n");

  const { enableWhatsApp } = await prompts(
    {
      type: "confirm",
      name: "enableWhatsApp",
      message: "Enable WhatsApp notifications?",
      initial: true,
    },
    { onCancel }
  );

  if (!enableWhatsApp) return { whatsappEnabled: false, whatsappNumber: "" };

  const { whatsappNumber } = await prompts(
    {
      type: "text",
      name: "whatsappNumber",
      message: "Your phone number (E.164 format, e.g. +15551234567)",
      validate: (v) =>
        /^\+\d{10,15}$/.test(v)
          ? true
          : "Enter a valid E.164 number like +15551234567",
    },
    { onCancel }
  );

  return { whatsappEnabled: true, whatsappNumber };
}

// ── Phase 4: User Profile ───────────────────────────────────────────────────

async function collectProfile() {
  console.log("\n  ── Your Profile ──────────────────────────\n");

  const answers = await prompts(
    [
      {
        type: "text",
        name: "name",
        message: "Full name",
        validate: (v) => (v.length > 0 ? true : "Required"),
      },
      {
        type: "text",
        name: "email",
        message: "Email address",
        validate: (v) => (v.includes("@") ? true : "Enter a valid email"),
      },
      {
        type: "text",
        name: "phone",
        message: "Phone number",
      },
      {
        type: "text",
        name: "location",
        message: "City, State (e.g. Stamford, CT)",
      },
      {
        type: "text",
        name: "linkedin",
        message: "LinkedIn URL (optional)",
      },
      {
        type: "text",
        name: "github",
        message: "GitHub URL (optional)",
      },
      {
        type: "text",
        name: "experienceYears",
        message: "Years of professional experience",
        initial: "5",
      },
      {
        type: "text",
        name: "skillsLanguages",
        message: "Programming languages (comma-separated)",
        initial: "JavaScript, TypeScript, Python",
      },
      {
        type: "text",
        name: "skillsFrontend",
        message: "Frontend skills (comma-separated)",
        initial: "React, HTML/CSS",
      },
      {
        type: "text",
        name: "skillsBackend",
        message: "Backend skills (comma-separated)",
        initial: "Node.js, REST APIs",
      },
      {
        type: "text",
        name: "skillsOther",
        message: "Other skills (comma-separated)",
        initial: "CI/CD, Agile/Scrum",
      },
      {
        type: "text",
        name: "education",
        message: "Education (e.g. BS Computer Science, MIT, 2020)",
      },
      {
        type: "select",
        name: "workAuth",
        message: "US work authorization",
        choices: [
          { title: "Yes, authorized to work", value: "yes" },
          { title: "No, requires sponsorship", value: "no" },
        ],
      },
    ],
    { onCancel }
  );

  return answers;
}

// ── Phase 5: Job Preferences ────────────────────────────────────────────────

async function collectJobPrefs() {
  console.log("\n  ── Job Preferences ───────────────────────\n");

  const answers = await prompts(
    [
      {
        type: "list",
        name: "titles",
        message: "Target job titles (comma-separated)",
        initial:
          "Software Engineer, Senior Software Engineer, Full Stack Engineer",
        separator: ",",
      },
      {
        type: "list",
        name: "locations",
        message: "Target locations (comma-separated)",
        initial: "Remote",
        separator: ",",
      },
      {
        type: "select",
        name: "workMode",
        message: "Work mode preference",
        choices: [
          { title: "Remote only", value: "remote" },
          { title: "Remote or in-person", value: "both" },
          { title: "In-person only", value: "in-person" },
        ],
      },
      {
        type: "multiselect",
        name: "platforms",
        message: "Job platforms to search (space to toggle)",
        choices: [
          { title: "Indeed", value: "indeed", selected: true },
          { title: "LinkedIn", value: "linkedin", selected: false },
          { title: "Glassdoor", value: "glassdoor", selected: false },
          { title: "ZipRecruiter", value: "ziprecruiter", selected: false },
        ],
      },
      {
        type: "number",
        name: "maxAppsPerDay",
        message: "Max applications per platform per day",
        initial: 30,
        min: 1,
        max: 100,
      },
      {
        type: "number",
        name: "salaryMin",
        message: "Minimum salary (USD, annual)",
        initial: 100000,
      },
      {
        type: "list",
        name: "excludeKeywords",
        message: "Exclude job titles containing (comma-separated, or blank)",
        initial: "clearance, principal, director, VP, staff",
        separator: ",",
      },
      {
        type: "list",
        name: "excludeCompanies",
        message: "Exclude companies (comma-separated, or blank)",
        separator: ",",
      },
    ],
    { onCancel }
  );

  return answers;
}

// ── Phase 6: Resume ─────────────────────────────────────────────────────────

async function collectResume() {
  console.log("\n  ── Resume ────────────────────────────────\n");

  const { resumePath } = await prompts(
    {
      type: "text",
      name: "resumePath",
      message: "Path to your resume PDF (or press Enter to skip)",
    },
    { onCancel }
  );

  if (!resumePath) {
    console.log(
      "  → Skipped. You can add data/resume.pdf later before running the agent."
    );
    return;
  }

  const resolved = path.resolve(resumePath);
  if (!fs.existsSync(resolved)) {
    abort(`File not found: ${resolved}`);
  }
  if (!resolved.toLowerCase().endsWith(".pdf")) {
    abort("Resume must be a PDF file");
  }

  const dest = path.join(ROOT, "data", "resume.pdf");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(resolved, dest);
  console.log(`  ✓ Resume copied to data/resume.pdf`);
}

// ── Phase 7: Generate Configs ───────────────────────────────────────────────

function generateConfigs(apiKeys, whatsapp, profile, jobPrefs) {
  console.log("\n  ── Generating Config Files ────────────────\n");

  // .env
  const envContent = [
    `ANTHROPIC_API_KEY=${apiKeys.anthropicKey}`,
    `TWOCAPTCHA_API_KEY=${apiKeys.twoCaptchaKey}`,
    `OPENCLAW_GATEWAY_TOKEN=${apiKeys.gatewayToken}`,
    `WHATSAPP_ALLOW_FROM=${whatsapp.whatsappNumber}`,
  ].join("\n") + "\n";

  fs.writeFileSync(path.join(ROOT, ".env"), envContent, { mode: 0o600 });
  console.log("  ✓ .env");

  // profile.json
  const titles = (jobPrefs.titles || []).map((t) => t.trim()).filter(Boolean);
  const locations = (jobPrefs.locations || []).map((t) => t.trim()).filter(Boolean);
  const excludeKw = (jobPrefs.excludeKeywords || []).map((t) => t.trim()).filter(Boolean);
  const excludeCo = (jobPrefs.excludeCompanies || []).map((t) => t.trim()).filter(Boolean);
  const platforms = jobPrefs.platforms || ["indeed"];

  const profileTmpl = readTemplate("profile.json.tmpl");
  const profileOut = fillTemplate(profileTmpl, {
    TITLES_JSON: JSON.stringify(titles),
    LOCATIONS_JSON: JSON.stringify(locations),
    REMOTE_ONLY: jobPrefs.workMode === "remote" ? "true" : "false",
    SALARY_MIN: String(jobPrefs.salaryMin || 100000),
    LINKEDIN_ENABLED: platforms.includes("linkedin") ? "true" : "false",
    INDEED_ENABLED: platforms.includes("indeed") ? "true" : "false",
    GLASSDOOR_ENABLED: platforms.includes("glassdoor") ? "true" : "false",
    ZIPRECRUITER_ENABLED: platforms.includes("ziprecruiter") ? "true" : "false",
    MAX_APPS_PER_DAY: String(jobPrefs.maxAppsPerDay || 30),
    EXCLUDE_KEYWORDS_JSON: JSON.stringify(excludeKw),
    EXCLUDE_COMPANIES_JSON: JSON.stringify(excludeCo),
    SCHEDULE_TIMES_JSON: JSON.stringify(["09:00", "13:00", "17:00"]),
  });

  fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "data", "profile.json"), profileOut);
  console.log("  ✓ data/profile.json");

  // USER.md
  const workModeLabel =
    jobPrefs.workMode === "remote"
      ? "Remote only"
      : jobPrefs.workMode === "both"
        ? "Remote or in-person"
        : "In-person only";

  const userTmpl = readTemplate("USER.md.tmpl");
  const userOut = fillTemplate(userTmpl, {
    NAME: profile.name || "",
    EMAIL: profile.email || "",
    PHONE: profile.phone || "",
    LOCATION: profile.location || "",
    LINKEDIN: profile.linkedin || "N/A",
    GITHUB: profile.github || "N/A",
    EXPERIENCE_YEARS: `${profile.experienceYears || "5"}+`,
    TITLES: titles.join(", "),
    WORK_MODE: workModeLabel,
    SALARY_MIN: String(jobPrefs.salaryMin || 100000),
    SKILLS_LANGUAGES: profile.skillsLanguages || "",
    SKILLS_FRONTEND: profile.skillsFrontend || "",
    SKILLS_BACKEND: profile.skillsBackend || "",
    SKILLS_OTHER: profile.skillsOther || "",
    EXPERIENCE_DETAILS: "- (Add your experience details here)",
    EDUCATION: profile.education || "(Add your education here)",
    WORK_AUTH: profile.workAuth === "yes" ? "Yes" : "No",
    SPONSORSHIP: profile.workAuth === "yes" ? "No" : "Yes",
  });

  fs.mkdirSync(path.join(ROOT, "openclaw", "workspace"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "openclaw", "workspace", "USER.md"), userOut);
  console.log("  ✓ openclaw/workspace/USER.md");

  // openclaw.json (container version with env var placeholders)
  const openclawTmpl = readTemplate("openclaw.json.tmpl");
  const openclawOut = openclawTmpl.replace(
    `"enabled": {{WHATSAPP_ENABLED}}`,
    `"enabled": ${whatsapp.whatsappEnabled ? "true" : "false"}`
  );

  fs.writeFileSync(
    path.join(ROOT, "openclaw", "openclaw.json"),
    openclawOut
  );
  console.log("  ✓ openclaw/openclaw.json");

  console.log();
}

// ── Phase 8: Build & Launch ─────────────────────────────────────────────────

async function buildAndLaunch(composeCmd) {
  console.log("  ── Building & Launching Container ────────\n");

  console.log("  Building Docker image (this may take a few minutes)...\n");

  try {
    execSync(`${composeCmd} build`, {
      cwd: ROOT,
      stdio: "inherit",
    });
    console.log("\n  ✓ Image built successfully\n");
  } catch {
    abort("Docker build failed. Check the output above for errors.");
  }

  console.log("  Starting container...\n");

  try {
    execSync(`${composeCmd} up -d`, {
      cwd: ROOT,
      stdio: "inherit",
    });
  } catch {
    abort("Failed to start container. Check docker compose logs.");
  }

  // Poll healthcheck
  console.log("  Waiting for services to start...");
  let healthy = false;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const status = execSync(
        `docker inspect --format='{{.State.Health.Status}}' job-weaszel`,
        { encoding: "utf-8" }
      ).trim();
      if (status === "healthy") {
        healthy = true;
        break;
      }
      process.stdout.write(".");
    } catch {
      process.stdout.write(".");
    }
  }

  console.log();
  if (healthy) {
    console.log("  ✓ Container is healthy and all services are running!\n");
  } else {
    console.log(
      "  ⚠ Container is running but healthcheck hasn't passed yet."
    );
    console.log("    Check logs with: docker compose logs -f\n");
  }
}

// ── Phase 9: Manual Login ───────────────────────────────────────────────────

async function manualLogin() {
  console.log("  ── Log Into Job Platforms ─────────────────\n");
  console.log("  Open noVNC in your browser to see the Chrome desktop:");
  console.log("  → http://localhost:6080/vnc.html\n");
  console.log("  Log into each job platform you enabled (e.g. indeed.com).");
  console.log("  Your login sessions are saved in a persistent Chrome profile.\n");

  await prompts(
    {
      type: "confirm",
      name: "done",
      message: "Done logging into job platforms?",
      initial: true,
    },
    { onCancel }
  );
}

// ── Phase 10: Completion ────────────────────────────────────────────────────

function showCompletion() {
  console.log(`
  ── Setup Complete! ───────────────────────

  Your Job Weaszel agent is running. Here are some useful commands:

  View logs:
    docker compose logs -f

  Dashboard:
    http://localhost:18789/plugins/job-dashboard/

  noVNC (Chrome desktop):
    http://localhost:6080/vnc.html

  Stop the agent:
    docker compose down

  Restart the agent:
    docker compose up -d

  Rebuild after changes:
    docker compose build && docker compose up -d

  Shell into the container:
    docker exec -it job-weaszel bash

  ────────────────────────────────────────
  `);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  banner();

  console.log(
    "  This wizard will set up your personal Job Weaszel agent.\n"
  );
  console.log(
    "  It collects your info, generates config files, builds a Docker\n" +
    "  container, and guides you through logging into job platforms.\n"
  );

  const { ready } = await prompts(
    {
      type: "confirm",
      name: "ready",
      message: "Ready to begin?",
      initial: true,
    },
    { onCancel }
  );

  if (!ready) {
    onCancel();
    return;
  }

  // Phase 0: Pre-flight
  const composeCmd = await preflight();

  // Phase 2: API Keys
  const apiKeys = await collectApiKeys();

  // Phase 3: WhatsApp
  const whatsapp = await collectWhatsApp();

  // Phase 4: User Profile
  const profile = await collectProfile();

  // Phase 5: Job Preferences
  const jobPrefs = await collectJobPrefs();

  // Phase 6: Resume
  await collectResume();

  // Phase 7: Generate Configs
  generateConfigs(apiKeys, whatsapp, profile, jobPrefs);

  // Phase 8: Build & Launch
  const { shouldBuild } = await prompts(
    {
      type: "confirm",
      name: "shouldBuild",
      message: "Build and launch the Docker container now?",
      initial: true,
    },
    { onCancel }
  );

  if (shouldBuild) {
    await buildAndLaunch(composeCmd);

    // Phase 9: Manual Login
    await manualLogin();
  } else {
    console.log(
      "\n  Configs generated. When you're ready, run:\n" +
      "    docker compose build && docker compose up -d\n"
    );
  }

  // Phase 10: Completion
  showCompletion();
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
