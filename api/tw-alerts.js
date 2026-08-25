import crypto from "node:crypto";

/**
 * 알림 전송 프록시
 *
 * HMAC 서명을 서버에서 생성합니다. 시크릿을 브라우저 번들에 넣으면
 * 누구나 읽을 수 있으므로 인증 자체가 무의미해집니다.
 *
 * 필요한 환경변수 (Vercel 대시보드에서 설정, VITE_ 접두사 금지):
 *   TW_API_URL     API Gateway 베이스 URL (스테이지까지, 끝 슬래시 없이)
 *   TW_API_KEY     API 키
 *   TW_HMAC_SECRET 공유 시크릿
 */

const REQUIRED_FIELDS = ["incident_type", "severity"];
const VALID_SEVERITY = ["low", "medium", "high", "critical"];

function signHeaders(secret, apiKey) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(16).toString("hex");

  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${nonce}`)
    .digest("hex");

  return {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "x-tw-timestamp": timestamp,
    "x-tw-nonce": nonce,
    "x-tw-signature": signature,
  };
}

function validate(payload) {
  if (!payload || typeof payload !== "object") {
    return "Request body must be a JSON object";
  }

  const missing = REQUIRED_FIELDS.filter((f) => !payload[f]);
  if (missing.length) {
    return `Missing required fields: ${missing.join(", ")}`;
  }

  if (!VALID_SEVERITY.includes(payload.severity)) {
    return `severity must be one of ${VALID_SEVERITY.join(", ")}`;
  }

  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const baseUrl = process.env.TW_API_URL;
  const apiKey = process.env.TW_API_KEY;
  const secret = process.env.TW_HMAC_SECRET;

  if (!baseUrl || !apiKey || !secret) {
    return res.status(503).json({
      error: "Live mode is not configured on this deployment",
    });
  }

  const payload = req.body || {};

  // 게이트웨이가 어차피 스키마를 검증하지만, 여기서 먼저 걸러내면
  // 사용자에게 더 구체적인 메시지를 줄 수 있고 불필요한 호출도 줄어듭니다.
  const invalid = validate(payload);
  if (invalid) {
    return res.status(400).json({ error: invalid });
  }

  try {
    const response = await fetch(`${baseUrl}/alerts`, {
      method: "POST",
      headers: signHeaders(secret, apiKey),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text.slice(0, 500) };
    }

    if (!response.ok) {
      // 상태 코드는 그대로 전달하되, 게이트웨이 응답에 담긴
      // 내부 정보가 새어나가지 않도록 메시지를 정리합니다.
      const message =
        response.status === 400
          ? "Alert payload rejected by schema validation"
          : response.status === 403
            ? "Request rejected by the gateway"
            : `Upstream returned HTTP ${response.status}`;

      return res.status(response.status).json({ error: message });
    }

    return res.status(202).json({
      ...data,
      alert_id: payload.alert_id ?? null,
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      return res.status(504).json({ error: "Upstream request timed out" });
    }

    return res.status(502).json({ error: "Failed to reach the pipeline" });
  }
}
