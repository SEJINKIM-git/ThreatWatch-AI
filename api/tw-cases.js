/**
 * 케이스 조회 프록시
 *
 * GET /api/tw-cases                     최근 케이스 목록
 * GET /api/tw-cases?risk_level=P1       위험도 필터
 * GET /api/tw-cases?id=A-2026-0001      단건 상세
 *
 * 조회는 상태를 바꾸지 않으므로 HMAC 서명이 필요하지 않습니다.
 * API 키만 붙여 전달합니다.
 */

const VALID_LEVELS = ["P1", "P2", "P3"];
const MAX_LIMIT = 100;

function buildTargetUrl(baseUrl, query) {
  const { id, risk_level: riskLevel, limit } = query;

  if (id) {
    // 경로 파라미터로 들어가므로 인코딩이 필요합니다.
    return `${baseUrl}/cases/${encodeURIComponent(id)}`;
  }

  const params = new URLSearchParams();

  if (riskLevel) {
    params.set("risk_level", riskLevel);
  }

  if (limit) {
    const n = Number.parseInt(limit, 10);
    if (Number.isFinite(n)) {
      params.set("limit", String(Math.max(1, Math.min(n, MAX_LIMIT))));
    }
  }

  const qs = params.toString();
  return qs ? `${baseUrl}/cases?${qs}` : `${baseUrl}/cases`;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const baseUrl = process.env.TW_API_URL;
  const apiKey = process.env.TW_API_KEY;

  if (!baseUrl || !apiKey) {
    return res.status(503).json({
      error: "Live mode is not configured on this deployment",
    });
  }

  const query = req.query || {};

  if (query.risk_level && !VALID_LEVELS.includes(query.risk_level)) {
    return res.status(400).json({
      error: `risk_level must be one of ${VALID_LEVELS.join(", ")}`,
    });
  }

  try {
    const response = await fetch(buildTargetUrl(baseUrl, query), {
      method: "GET",
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(8000),
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text.slice(0, 500) };
    }

    if (!response.ok) {
      const message =
        response.status === 404
          ? "Case not found"
          : `Upstream returned HTTP ${response.status}`;
      return res.status(response.status).json({ error: message });
    }

    // 폴링으로 반복 호출되므로 캐시를 막습니다.
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(data);
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      return res.status(504).json({ error: "Upstream request timed out" });
    }

    return res.status(502).json({ error: "Failed to reach the pipeline" });
  }
}
