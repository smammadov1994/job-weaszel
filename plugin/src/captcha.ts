import https from "https";
import { addLog } from "./db";

const TWOCAPTCHA_API_KEY = process.env.TWOCAPTCHA_API_KEY || "";

const IN_URL = "https://2captcha.com/in.php";
const RES_URL = "https://2captcha.com/res.php";

const POLL_INTERVALS = [5000, 10000, 15000, 15000, 15000, 15000, 15000, 15000];
const MAX_TIMEOUT = 120_000;

interface CaptchaResult {
  success: boolean;
  token?: string;
  error?: string;
}

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      })
      .on("error", reject);
  });
}

async function submitCaptcha(params: Record<string, string>): Promise<string> {
  const qs = new URLSearchParams({
    key: TWOCAPTCHA_API_KEY,
    json: "1",
    ...params,
  });
  const url = `${IN_URL}?${qs.toString()}`;
  const response = await httpGet(url);
  const parsed = JSON.parse(response);

  if (parsed.status !== 1) {
    throw new Error(`2Captcha submit error: ${parsed.request}`);
  }

  return parsed.request; // task ID
}

async function pollResult(taskId: string): Promise<string> {
  const startTime = Date.now();

  for (const interval of POLL_INTERVALS) {
    await new Promise((resolve) => setTimeout(resolve, interval));

    if (Date.now() - startTime > MAX_TIMEOUT) {
      throw new Error("CAPTCHA solving timed out after 120 seconds");
    }

    const qs = new URLSearchParams({
      key: TWOCAPTCHA_API_KEY,
      action: "get",
      id: taskId,
      json: "1",
    });
    const url = `${RES_URL}?${qs.toString()}`;
    const response = await httpGet(url);
    const parsed = JSON.parse(response);

    if (parsed.status === 1) {
      return parsed.request; // solution token
    }

    if (parsed.request !== "CAPCHA_NOT_READY") {
      throw new Error(`2Captcha poll error: ${parsed.request}`);
    }
  }

  // Continue polling at 15s intervals until timeout
  while (Date.now() - startTime < MAX_TIMEOUT) {
    await new Promise((resolve) => setTimeout(resolve, 15000));

    const qs = new URLSearchParams({
      key: TWOCAPTCHA_API_KEY,
      action: "get",
      id: taskId,
      json: "1",
    });
    const url = `${RES_URL}?${qs.toString()}`;
    const response = await httpGet(url);
    const parsed = JSON.parse(response);

    if (parsed.status === 1) {
      return parsed.request;
    }

    if (parsed.request !== "CAPCHA_NOT_READY") {
      throw new Error(`2Captcha poll error: ${parsed.request}`);
    }
  }

  throw new Error("CAPTCHA solving timed out after 120 seconds");
}

export async function solveCaptcha(params: {
  type: "recaptcha_v2" | "hcaptcha";
  siteKey: string;
  pageUrl: string;
}): Promise<CaptchaResult> {
  if (!TWOCAPTCHA_API_KEY) {
    return {
      success: false,
      error: "TWOCAPTCHA_API_KEY not configured",
    };
  }

  addLog("info", `Attempting to solve ${params.type} CAPTCHA`, {
    siteKey: params.siteKey,
    pageUrl: params.pageUrl,
  });

  try {
    let submitParams: Record<string, string>;

    if (params.type === "recaptcha_v2") {
      submitParams = {
        method: "userrecaptcha",
        googlekey: params.siteKey,
        pageurl: params.pageUrl,
      };
    } else if (params.type === "hcaptcha") {
      submitParams = {
        method: "hcaptcha",
        sitekey: params.siteKey,
        pageurl: params.pageUrl,
      };
    } else {
      return { success: false, error: `Unsupported CAPTCHA type: ${params.type}` };
    }

    const taskId = await submitCaptcha(submitParams);
    addLog("info", `CAPTCHA submitted to 2Captcha, task ID: ${taskId}`);

    const token = await pollResult(taskId);
    addLog("info", "CAPTCHA solved successfully");

    return { success: true, token };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addLog("error", `CAPTCHA solving failed: ${message}`);
    return { success: false, error: message };
  }
}
