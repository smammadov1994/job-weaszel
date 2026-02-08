import {
  logApplication,
  checkApplied,
  getDailyStats,
  addLog,
  getDb,
} from "./db";
import { solveCaptcha } from "./captcha";
import { getRoutes } from "./dashboard/routes";

// ── Plugin registration ─────────────────────────────────────────────────────

export async function activate(context: {
  registerTool: (tool: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    handler: (params: Record<string, unknown>) => Promise<unknown>;
  }) => void;
  registerHttpRoutes: (routes: {
    method: string;
    path: string;
    handler: (req: unknown, res: unknown, params: Record<string, string>) => void;
  }[]) => void;
}) {
  // Initialize database on activation (async for sql.js WASM init)
  await getDb();
  addLog("info", "Job Dashboard plugin activated");

  // ── Tool: log_application ───────────────────────────────────────────────
  context.registerTool({
    name: "log_application",
    description:
      "Log a job application attempt (success, failure, or skip). Call this after every application attempt.",
    parameters: {
      type: "object",
      properties: {
        platform: {
          type: "string",
          enum: ["linkedin", "indeed", "glassdoor", "ziprecruiter"],
          description: "The job platform",
        },
        company: {
          type: "string",
          description: "Company name",
        },
        title: {
          type: "string",
          description: "Job title",
        },
        url: {
          type: "string",
          description: "URL of the job posting",
        },
        status: {
          type: "string",
          enum: ["applied", "failed", "skipped", "captcha_blocked"],
          description: "Result of the application attempt",
        },
        notes: {
          type: "string",
          description: "Optional notes about the attempt",
        },
        coverLetter: {
          type: "string",
          description: "Generated cover letter text, if any",
        },
        screenshotPath: {
          type: "string",
          description: "Path to the submission screenshot",
        },
      },
      required: ["platform", "company", "title", "url", "status"],
    },
    handler: async (params) => {
      const result = logApplication({
        platform: params.platform as string,
        company: params.company as string,
        title: params.title as string,
        url: params.url as string,
        status: params.status as string,
        notes: params.notes as string | undefined,
        coverLetter: params.coverLetter as string | undefined,
        screenshotPath: params.screenshotPath as string | undefined,
      });
      return {
        success: true,
        application: result,
        message: result
          ? `Logged: ${result.status} — ${result.company} - ${result.title}`
          : "Failed to log application",
      };
    },
  });

  // ── Tool: check_applied ─────────────────────────────────────────────────
  context.registerTool({
    name: "check_applied",
    description:
      "Check if a job has already been applied to. Use before applying to avoid duplicates.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL of the job posting to check",
        },
        company: {
          type: "string",
          description: "Company name (used with title for fuzzy matching)",
        },
        title: {
          type: "string",
          description: "Job title (used with company for fuzzy matching)",
        },
      },
    },
    handler: async (params) => {
      const alreadyApplied = checkApplied({
        url: params.url as string | undefined,
        company: params.company as string | undefined,
        title: params.title as string | undefined,
      });
      return {
        alreadyApplied,
        message: alreadyApplied
          ? "Already applied to this job. Skip it."
          : "Not yet applied. Proceed with application.",
      };
    },
  });

  // ── Tool: solve_captcha ─────────────────────────────────────────────────
  context.registerTool({
    name: "solve_captcha",
    description:
      "Send a CAPTCHA to the 2Captcha solving service. Returns a solution token to inject into the page.",
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["recaptcha_v2", "hcaptcha"],
          description: "Type of CAPTCHA",
        },
        siteKey: {
          type: "string",
          description: "The CAPTCHA site key (from data-sitekey attribute)",
        },
        pageUrl: {
          type: "string",
          description: "The URL of the page with the CAPTCHA",
        },
      },
      required: ["type", "siteKey", "pageUrl"],
    },
    handler: async (params) => {
      return solveCaptcha({
        type: params.type as "recaptcha_v2" | "hcaptcha",
        siteKey: params.siteKey as string,
        pageUrl: params.pageUrl as string,
      });
    },
  });

  // ── Tool: get_daily_stats ───────────────────────────────────────────────
  context.registerTool({
    name: "get_daily_stats",
    description:
      "Get today's application statistics: total attempted, applied, failed, and skipped counts.",
    parameters: {
      type: "object",
      properties: {},
    },
    handler: async () => {
      const stats = getDailyStats();
      if (!stats) {
        return {
          date: new Date().toISOString().split("T")[0],
          total_attempted: 0,
          total_applied: 0,
          total_failed: 0,
          total_skipped: 0,
          message: "No applications today yet.",
        };
      }
      return {
        ...stats,
        message: `Today: ${stats.total_applied} applied, ${stats.total_failed} failed, ${stats.total_skipped} skipped (${stats.total_attempted} total attempts)`,
      };
    },
  });

  // ── HTTP Routes for Dashboard ───────────────────────────────────────────
  const routes = getRoutes();
  context.registerHttpRoutes(routes as Parameters<typeof context.registerHttpRoutes>[0]);

  addLog("info", "All tools and routes registered");
}
