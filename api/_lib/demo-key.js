import crypto from "node:crypto";

/**
 * 시연 비밀번호 확인 (순수 함수 — 네트워크·환경 변수에 직접 접근하지 않는다)
 *
 * expected: 서버 환경 변수 DEPEG_DEMO_KEY 값 (없으면 빈 문자열/undefined)
 * given:    요청 헤더 x-demo-key 값
 *
 * 반환: { ok: true } 또는 { ok: false, status, error }
 * 키 값은 반환값에 절대 넣지 않는다 (응답·로그로 새지 않게).
 * 폴더 이름이 _ 로 시작하므로 Vercel이 이 파일을 함수로 배포하지 않는다.
 */
export function checkDemoKey(expected, given) {
  if (!expected) {
    return { ok: false, status: 503, error: "시연 키가 설정되지 않았습니다" };
  }
  const a = Buffer.from(String(expected), "utf8");
  const b = Buffer.from(typeof given === "string" ? given : "", "utf8");
  // timingSafeEqual 은 길이가 다르면 예외를 던지므로 먼저 길이부터 본다
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, status: 401, error: "시연 비밀번호가 틀렸거나 없습니다" };
  }
  return { ok: true };
}
