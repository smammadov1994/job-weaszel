import initSqlJs, { Database as SqlJsDatabase } from "sql.js";
import path from "path";
import fs from "fs";

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "applications.db");

let db: SqlJsDatabase | null = null;

export async function getDb(): Promise<SqlJsDatabase> {
  if (db) return db;

  fs.mkdirSync(DATA_DIR, { recursive: true });

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  initSchema();
  return db;
}

function saveDb(): void {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

function initSchema(): void {
  if (!db) return;
  db.run(`
    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      company TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL,
      notes TEXT,
      cover_letter TEXT,
      screenshot_path TEXT,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS daily_stats (
      date TEXT PRIMARY KEY,
      total_attempted INTEGER DEFAULT 0,
      total_applied INTEGER DEFAULT 0,
      total_failed INTEGER DEFAULT 0,
      total_skipped INTEGER DEFAULT 0
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      details TEXT
    );
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_applications_platform ON applications(platform);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_applications_applied_at ON applications(applied_at);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_activity_log_timestamp ON activity_log(timestamp);`);
  saveDb();
}

// ── Application queries ─────────────────────────────────────────────────────

export interface Application {
  id: number;
  platform: string;
  company: string;
  title: string;
  url: string;
  status: string;
  notes: string | null;
  cover_letter: string | null;
  screenshot_path: string | null;
  applied_at: string;
}

function rowToApplication(row: unknown[]): Application {
  return {
    id: row[0] as number,
    platform: row[1] as string,
    company: row[2] as string,
    title: row[3] as string,
    url: row[4] as string,
    status: row[5] as string,
    notes: row[6] as string | null,
    cover_letter: row[7] as string | null,
    screenshot_path: row[8] as string | null,
    applied_at: row[9] as string,
  };
}

export function logApplication(data: {
  platform: string;
  company: string;
  title: string;
  url: string;
  status: string;
  notes?: string;
  coverLetter?: string;
  screenshotPath?: string;
}): Application | null {
  if (!db) return null;
  const today = new Date().toISOString().split("T")[0];

  db.run(
    `INSERT INTO applications (platform, company, title, url, status, notes, cover_letter, screenshot_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.platform,
      data.company,
      data.title,
      data.url,
      data.status,
      data.notes || null,
      data.coverLetter || null,
      data.screenshotPath || null,
    ]
  );

  const isApplied = data.status === "applied" ? 1 : 0;
  const isFailed = data.status === "failed" || data.status === "captcha_blocked" ? 1 : 0;
  const isSkipped = data.status === "skipped" ? 1 : 0;

  db.run(
    `INSERT INTO daily_stats (date, total_attempted, total_applied, total_failed, total_skipped)
     VALUES (?, 1, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       total_attempted = total_attempted + 1,
       total_applied = total_applied + ?,
       total_failed = total_failed + ?,
       total_skipped = total_skipped + ?`,
    [today, isApplied, isFailed, isSkipped, isApplied, isFailed, isSkipped]
  );

  addLog("info", `Application ${data.status}: ${data.company} - ${data.title}`, {
    platform: data.platform,
    url: data.url,
    status: data.status,
  });

  saveDb();

  // Get the inserted row
  const result = db.exec(
    "SELECT * FROM applications WHERE id = last_insert_rowid()"
  );
  if (result.length > 0 && result[0].values.length > 0) {
    return rowToApplication(result[0].values[0]);
  }
  return null;
}

export function checkApplied(params: {
  url?: string;
  company?: string;
  title?: string;
}): boolean {
  if (!db) return false;

  if (params.url) {
    const result = db.exec("SELECT 1 FROM applications WHERE url = ?", [params.url]);
    return result.length > 0 && result[0].values.length > 0;
  }

  if (params.company && params.title) {
    const result = db.exec(
      "SELECT 1 FROM applications WHERE company = ? AND title = ? AND status != 'skipped'",
      [params.company, params.title]
    );
    return result.length > 0 && result[0].values.length > 0;
  }

  return false;
}

export function getApplicationById(id: number): Application | undefined {
  if (!db) return undefined;
  const result = db.exec("SELECT * FROM applications WHERE id = ?", [id]);
  if (result.length > 0 && result[0].values.length > 0) {
    return rowToApplication(result[0].values[0]);
  }
  return undefined;
}

export function getApplications(params: {
  platform?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): { applications: Application[]; total: number } {
  if (!db) return { applications: [], total: 0 };

  const conditions: string[] = [];
  const values: (string | number)[] = [];

  if (params.platform) {
    conditions.push("platform = ?");
    values.push(params.platform);
  }
  if (params.status) {
    conditions.push("status = ?");
    values.push(params.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countResult = db.exec(
    `SELECT COUNT(*) as count FROM applications ${where}`,
    values
  );
  const total =
    countResult.length > 0 && countResult[0].values.length > 0
      ? (countResult[0].values[0][0] as number)
      : 0;

  const limit = params.limit || 50;
  const offset = params.offset || 0;

  const result = db.exec(
    `SELECT * FROM applications ${where} ORDER BY applied_at DESC LIMIT ? OFFSET ?`,
    [...values, limit, offset]
  );

  const applications: Application[] = [];
  if (result.length > 0) {
    for (const row of result[0].values) {
      applications.push(rowToApplication(row));
    }
  }

  return { applications, total };
}

// ── Stats queries ───────────────────────────────────────────────────────────

export interface DailyStatsRow {
  date: string;
  total_attempted: number;
  total_applied: number;
  total_failed: number;
  total_skipped: number;
}

function rowToDailyStats(row: unknown[]): DailyStatsRow {
  return {
    date: row[0] as string,
    total_attempted: row[1] as number,
    total_applied: row[2] as number,
    total_failed: row[3] as number,
    total_skipped: row[4] as number,
  };
}

export function getDailyStats(): DailyStatsRow | null {
  if (!db) return null;
  const today = new Date().toISOString().split("T")[0];
  const result = db.exec("SELECT * FROM daily_stats WHERE date = ?", [today]);
  if (result.length > 0 && result[0].values.length > 0) {
    return rowToDailyStats(result[0].values[0]);
  }
  return null;
}

export function getStatsRange(days: number = 30): DailyStatsRow[] {
  if (!db) return [];
  const result = db.exec(
    "SELECT * FROM daily_stats ORDER BY date DESC LIMIT ?",
    [days]
  );
  if (result.length === 0) return [];
  return result[0].values.map(rowToDailyStats);
}

export function getSummaryStats(): {
  today: DailyStatsRow | null;
  thisWeek: { applied: number; failed: number; skipped: number };
  total: { applied: number; failed: number; skipped: number };
  byPlatform: { platform: string; count: number }[];
} {
  if (!db) {
    return {
      today: null,
      thisWeek: { applied: 0, failed: 0, skipped: 0 },
      total: { applied: 0, failed: 0, skipped: 0 },
      byPlatform: [],
    };
  }

  const today = getDailyStats();

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekStr = weekAgo.toISOString().split("T")[0];

  const weekResult = db.exec(
    `SELECT
       COALESCE(SUM(total_applied), 0),
       COALESCE(SUM(total_failed), 0),
       COALESCE(SUM(total_skipped), 0)
     FROM daily_stats WHERE date >= ?`,
    [weekStr]
  );
  const thisWeek =
    weekResult.length > 0 && weekResult[0].values.length > 0
      ? {
          applied: weekResult[0].values[0][0] as number,
          failed: weekResult[0].values[0][1] as number,
          skipped: weekResult[0].values[0][2] as number,
        }
      : { applied: 0, failed: 0, skipped: 0 };

  const totalResult = db.exec(
    `SELECT
       COALESCE(SUM(total_applied), 0),
       COALESCE(SUM(total_failed), 0),
       COALESCE(SUM(total_skipped), 0)
     FROM daily_stats`
  );
  const total =
    totalResult.length > 0 && totalResult[0].values.length > 0
      ? {
          applied: totalResult[0].values[0][0] as number,
          failed: totalResult[0].values[0][1] as number,
          skipped: totalResult[0].values[0][2] as number,
        }
      : { applied: 0, failed: 0, skipped: 0 };

  const platResult = db.exec(
    `SELECT platform, COUNT(*) as count FROM applications
     WHERE status = 'applied' GROUP BY platform ORDER BY count DESC`
  );
  const byPlatform: { platform: string; count: number }[] = [];
  if (platResult.length > 0) {
    for (const row of platResult[0].values) {
      byPlatform.push({ platform: row[0] as string, count: row[1] as number });
    }
  }

  return { today, thisWeek, total, byPlatform };
}

// ── Activity log ────────────────────────────────────────────────────────────

export interface LogEntry {
  id: number;
  timestamp: string;
  level: string;
  message: string;
  details: string | null;
}

function rowToLogEntry(row: unknown[]): LogEntry {
  return {
    id: row[0] as number,
    timestamp: row[1] as string,
    level: row[2] as string,
    message: row[3] as string,
    details: row[4] as string | null,
  };
}

export function addLog(
  level: string,
  message: string,
  details?: Record<string, unknown>
): void {
  if (!db) return;
  db.run(
    "INSERT INTO activity_log (level, message, details) VALUES (?, ?, ?)",
    [level, message, details ? JSON.stringify(details) : null]
  );
  saveDb();
}

export function getLogs(limit: number = 100, offset: number = 0): LogEntry[] {
  if (!db) return [];
  const result = db.exec(
    "SELECT * FROM activity_log ORDER BY timestamp DESC LIMIT ? OFFSET ?",
    [limit, offset]
  );
  if (result.length === 0) return [];
  return result[0].values.map(rowToLogEntry);
}
