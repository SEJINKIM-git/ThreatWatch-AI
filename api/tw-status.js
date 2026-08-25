/**
 * Live 모드 가용성 확인
 *
 * 프론트엔드가 시작할 때 이 값을 보고 Live 토글을 활성화할지 결정합니다.
 * 환경변수가 없는 배포(로컬 개발, 포크된 저장소)에서는 Scenario 모드만 노출됩니다.
 *
 * 시크릿 값 자체는 절대 반환하지 않습니다. 설정 여부만 알려줍니다.
 */

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const configured = Boolean(
    process.env.TW_API_URL &&
    process.env.TW_API_KEY &&
    process.env.TW_HMAC_SECRET
  );

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    live_mode: configured,
    region: process.env.TW_REGION || "ap-northeast-2",
  });
}
