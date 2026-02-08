import {
  getApplications,
  getApplicationById,
  getSummaryStats,
  getStatsRange,
  getLogs,
} from "../db";
import fs from "fs";
import path from "path";
import type { IncomingMessage, ServerResponse } from "http";

const UI_PATH = path.join(__dirname, "..", "..", "src", "dashboard", "ui", "index.html");

export interface RouteHandler {
  method: string;
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => void;
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function parseQuery(url: string): Record<string, string> {
  const params: Record<string, string> = {};
  const idx = url.indexOf("?");
  if (idx === -1) return params;
  const qs = url.slice(idx + 1);
  for (const pair of qs.split("&")) {
    const [key, val] = pair.split("=");
    if (key) params[decodeURIComponent(key)] = decodeURIComponent(val || "");
  }
  return params;
}

export function getRoutes(): RouteHandler[] {
  return [
    // Dashboard UI
    {
      method: "GET",
      path: "/plugins/job-dashboard/",
      handler: (_req, res) => {
        try {
          const html = fs.readFileSync(UI_PATH, "utf-8");
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(html);
        } catch {
          res.writeHead(404);
          res.end("Dashboard UI not found");
        }
      },
    },

    // List applications
    {
      method: "GET",
      path: "/plugins/job-dashboard/api/applications",
      handler: (req, res) => {
        const query = parseQuery(req.url || "");
        const result = getApplications({
          platform: query.platform || undefined,
          status: query.status || undefined,
          limit: parseInt(query.limit || "50", 10),
          offset: parseInt(query.offset || "0", 10),
        });
        json(res, result);
      },
    },

    // Single application
    {
      method: "GET",
      path: "/plugins/job-dashboard/api/applications/",
      handler: (req, res) => {
        const url = req.url || "";
        const match = url.match(/\/api\/applications\/(\d+)/);
        if (!match) {
          json(res, { error: "Invalid application ID" }, 400);
          return;
        }
        const app = getApplicationById(parseInt(match[1], 10));
        if (!app) {
          json(res, { error: "Application not found" }, 404);
          return;
        }
        json(res, app);
      },
    },

    // Summary stats
    {
      method: "GET",
      path: "/plugins/job-dashboard/api/stats",
      handler: (_req, res) => {
        const stats = getSummaryStats();
        json(res, stats);
      },
    },

    // Daily stats chart data
    {
      method: "GET",
      path: "/plugins/job-dashboard/api/stats/daily",
      handler: (req, res) => {
        const query = parseQuery(req.url || "");
        const days = parseInt(query.days || "30", 10);
        const data = getStatsRange(days);
        json(res, data);
      },
    },

    // Activity logs
    {
      method: "GET",
      path: "/plugins/job-dashboard/api/logs",
      handler: (req, res) => {
        const query = parseQuery(req.url || "");
        const limit = parseInt(query.limit || "100", 10);
        const offset = parseInt(query.offset || "0", 10);
        const logs = getLogs(limit, offset);
        json(res, logs);
      },
    },

    // Serve screenshot images
    {
      method: "GET",
      path: "/plugins/job-dashboard/api/screenshots/",
      handler: (req, res) => {
        const url = req.url || "";
        const match = url.match(/\/api\/screenshots\/(\d+)/);
        if (!match) {
          json(res, { error: "Invalid application ID" }, 400);
          return;
        }
        const app = getApplicationById(parseInt(match[1], 10));
        if (!app || !app.screenshot_path) {
          json(res, { error: "Screenshot not found" }, 404);
          return;
        }
        try {
          const img = fs.readFileSync(app.screenshot_path);
          const ext = path.extname(app.screenshot_path).toLowerCase();
          const contentType =
            ext === ".png"
              ? "image/png"
              : ext === ".jpg" || ext === ".jpeg"
                ? "image/jpeg"
                : "application/octet-stream";
          res.writeHead(200, { "Content-Type": contentType });
          res.end(img);
        } catch {
          json(res, { error: "Screenshot file not found on disk" }, 404);
        }
      },
    },
  ];
}
