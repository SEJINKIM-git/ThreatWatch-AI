/**
 * /depeg 화면의 설명 문구와 파이프라인 정의
 *
 * 숫자(점수, 가격)는 여기 두지 않는다. 숫자는 전부
 * public/depeg/replay.json — 실제 엔진을 돌린 결과 — 에서 읽는다.
 * 진행 상태(status)는 사람이 갱신하는 값이므로 바뀌면 여기만 고치면 된다.
 */

export const STATUS_AS_OF = "2026-11-11";

// done: 완료 · live: 운영 중(기존) · built: 구현됨(main 반영 전)
// wip: 진행 중 · draft: 초안/임시 · todo: 시작 전 · decide: 회의 결정 대기
export const STATUS = {
  done: { ko: "완료", en: "Done", tone: "good" },
  live: { ko: "운영 중", en: "Live", tone: "good" },
  built: { ko: "구현됨 · 반영 전", en: "Built · not merged", tone: "info" },
  wip: { ko: "진행 중", en: "In progress", tone: "info" },
  draft: { ko: "임시 버전", en: "Baseline only", tone: "warn" },
  todo: { ko: "시작 전", en: "Not started", tone: "bad" },
  decide: { ko: "결정 대기", en: "Awaiting decision", tone: "warn" },
};

export const LANES = [
  {
    key: "engine",
    ko: "디페그 엔진", en: "Depeg engine",
    subKo: "새로 만드는 부분 · depeg-early-warning",
    subEn: "New · depeg-early-warning repo",
  },
  {
    key: "tw",
    ko: "ThreatWatch", en: "ThreatWatch",
    subKo: "이미 있는 시스템에 두 군데만 수정",
    subEn: "Existing system, two small changes",
  },
];

export const STEPS = [
  {
    key: "market", lane: "engine", num: "①", status: "done",
    owner: { ko: "원준", en: "Wonjun" },
    title: { ko: "시장 가격 수집", en: "Market price feed" },
    short: { ko: "거래소에서 USDC 가격을 1시간마다 받아 옴", en: "Pulls the hourly USDC price from an exchange" },
    what: {
      ko: "Bitstamp 거래소에서 USDC 1개가 몇 달러에 거래됐는지를 1시간 단위로 받아 옵니다. 1달러에서 얼마나 벗어났는지(이탈폭)도 함께 계산합니다.",
      en: "Fetches what one USDC traded for on Bitstamp every hour, and how far that is from $1 (the deviation).",
    },
    input: { ko: "거래소 공개 가격", en: "Public exchange prices" },
    output: { ko: "가격, 1달러 대비 이탈폭(bps)", en: "Price, deviation from $1 (bps)" },
    code: "src/collectors/onchain.py",
  },
  {
    key: "filing", lane: "engine", num: "①", status: "wip",
    owner: { ko: "세진 (주완 인계)", en: "Sejin (from Juwan)" },
    title: { ko: "공시 데이터 수집", en: "Reserve filings" },
    short: { ko: "Circle의 월간 준비금 보고서에서 숫자를 뽑음", en: "Extracts numbers from Circle's monthly reserve report" },
    what: {
      ko: "USDC 발행사 Circle이 매달 내는 '준비금 증명 보고서'에서 현금·국채 비중, 보고서가 얼마나 오래됐는지를 뽑습니다. 보고서는 발행일 이후에만 쓰도록 해서, 그 시점에 몰랐던 정보가 섞이지 않게 합니다.",
      en: "Reads Circle's monthly reserve attestation: cash and T-bill shares, and how old the latest report is. A report is only used after its publish date, so no future information leaks in.",
    },
    input: { ko: "Circle 준비금 보고서 PDF", en: "Circle attestation PDFs" },
    output: { ko: "현금 비중, 국채 비중, 보고서 경과 일수", en: "Cash share, T-bill share, report age" },
    code: "src/intelligence/attestation_parser.py",
  },
  {
    key: "score", lane: "engine", num: "②", status: "draft",
    owner: { ko: "재석", en: "Jaeseok" },
    title: { ko: "위험 점수 계산", en: "Risk score" },
    short: { ko: "모인 데이터로 0~100점 위험도를 매김", en: "Turns the signals into a 0–100 risk score" },
    what: {
      ko: "들어온 데이터마다 '얼마나 위험한가'를 0~1로 바꾼 뒤 가중치를 곱해 더합니다. 지금은 임시 공식이라, 과거 데이터로 검증하며 가중치를 고치는 작업(백테스트)이 남아 있습니다.",
      en: "Converts each signal to a 0–1 risk, weights and sums them. The formula is a placeholder; calibrating it on historical data (backtest) is still to do.",
    },
    input: { ko: "①의 가격·공시 데이터", en: "Signals from ①" },
    output: { ko: "위험 점수, 점수에 가장 크게 기여한 항목", en: "Score and the top contributing factors" },
    code: "src/engine/risk_score.py",
  },
  {
    key: "gate", lane: "engine", num: "③", status: "decide",
    owner: { ko: "팀 결정", en: "Team decision" },
    title: { ko: "기준 판단", en: "Threshold gate" },
    short: { ko: "70점 넘으면 경보, 85점 넘으면 사람 승인", en: "70+ raises an alert, 85+ needs a human" },
    what: {
      ko: "점수가 70 이상이면 경보를 만들고, 85 이상이면 '높음'으로 표시해 사람이 승인해야 다음 조치가 실행되게 합니다. 이 두 숫자의 근거는 백테스트 결과로 만들어 팀이 확정합니다.",
      en: "A score of 70+ creates an alert; 85+ marks it high so a person must approve the response. Both numbers are confirmed by the team from backtest evidence.",
    },
    input: { ko: "위험 점수", en: "Risk score" },
    output: { ko: "경보 여부, 등급(보통/높음)", en: "Alert or not, severity (medium/high)" },
    code: "src/engine/risk_score.py · src/adapters/",
  },
  {
    key: "adapter", lane: "engine", num: "→", status: "draft",
    owner: { ko: "재석", en: "Jaeseok" },
    title: { ko: "경보 변환", en: "Alert adapter" },
    short: { ko: "점수를 ThreatWatch가 읽는 경보 양식으로 바꿈", en: "Reshapes the score into ThreatWatch's alert format" },
    what: {
      ko: "ThreatWatch는 보안 경보를 정해진 양식으로만 받습니다. 그 양식에 맞춰 사고 유형(stablecoin_depeg_usdc), 등급, 근거 항목을 채워 보냅니다. 같은 경보가 두 번 가도 한 번만 처리되도록 고유 번호를 붙입니다.",
      en: "ThreatWatch accepts alerts in a fixed format. This fills in the incident type (stablecoin_depeg_usdc), severity and indicators, with a unique id so a resend is processed once.",
    },
    input: { ko: "기준을 넘은 점수", en: "A score over the threshold" },
    output: { ko: "ThreatWatch 경보 (POST /alerts)", en: "ThreatWatch alert (POST /alerts)" },
    code: "src/adapters/threatwatch_sender.py",
  },
  {
    key: "intake", lane: "tw", num: "④", status: "live",
    owner: { ko: "세진", en: "Sejin" },
    title: { ko: "접수·검증", en: "Intake & checks" },
    short: { ko: "서명·양식 확인 후 대기열에 넣음", en: "Verifies signature and format, then queues" },
    what: {
      ko: "보안 경보와 똑같은 입구로 들어옵니다. 보낸 쪽이 진짜인지(서명), 양식이 맞는지 확인하고 대기열에 넣습니다. 이 부분은 바꾼 게 없습니다.",
      en: "Enters through the same door as security alerts: signature and schema are checked, then the alert is queued. Unchanged.",
    },
    input: { ko: "경보", en: "Alert" },
    output: { ko: "검증된 경보", en: "Validated alert" },
    code: "API Gateway → SQS",
  },
  {
    key: "triage", lane: "tw", num: "⑤", status: "live",
    owner: { ko: "세진", en: "Sejin" },
    title: { ko: "AI 재채점 건너뛰기", en: "Skip AI re-scoring" },
    short: { ko: "디페그 경보는 AI가 다시 채점하지 않음", en: "Depeg alerts are not re-scored by the LLM" },
    what: {
      ko: "보안 경보는 AI가 위험도를 매기지만, 디페그 경보는 이미 엔진이 점수를 매겼습니다. AI가 다시 매기면 판단 출처가 둘이 되어 어느 쪽이 맞는지 알 수 없으므로, 등급을 정해진 표대로만 옮깁니다.",
      en: "Security alerts are scored by the LLM, but depeg alerts arrive already scored. Re-scoring would create two sources of truth, so the severity is mapped by a fixed table instead.",
    },
    input: { ko: "등급(보통/높음)", en: "Severity (medium/high)" },
    output: { ko: "내부 등급 P2 / P1", en: "Internal level P2 / P1" },
    code: "modules/external_scored.py",
  },
  {
    key: "route", lane: "tw", num: "⑥", status: "live",
    owner: { ko: "세진", en: "Sejin" },
    title: { ko: "기록·알림 분리", en: "Store & route" },
    short: { ko: "사건 기록 후 디페그 전용 채널로 알림", en: "Stores the case, notifies a depeg-only channel" },
    what: {
      ko: "사건을 기록하고 알림을 보냅니다. 보안 담당자와 자금 담당자는 받는 사람이 다르기 때문에, 디페그 경보는 별도 알림 채널로 갑니다.",
      en: "Stores the case and notifies. Security and treasury have different recipients, so depeg alerts go to their own channel.",
    },
    input: { ko: "등급이 정해진 사건", en: "Leveled case" },
    output: { ko: "기록 + 디페그 전용 알림", en: "Case record + depeg notification" },
    code: "topic_router.py · DynamoDB · SNS",
  },
  {
    key: "approve", lane: "tw", num: "⑦", status: "live",
    owner: { ko: "세진", en: "Sejin" },
    title: { ko: "사람 승인 대기", en: "Human approval" },
    short: { ko: "P1이면 승인자가 결정할 때까지 멈춤", en: "P1 waits for an approver" },
    what: {
      ko: "P1(85점 이상)은 자동으로 조치하지 않고 승인자에게 요청을 보낸 뒤 기다립니다. 응답이 없으면 재알림하고, 끝까지 없으면 '만료'로 기록합니다.",
      en: "P1 (85+) does not act automatically: it asks an approver and waits, re-notifies on silence, and records an expiry if nobody answers.",
    },
    input: { ko: "P1 사건", en: "P1 case" },
    output: { ko: "승인 요청", en: "Approval request" },
    code: "Step Functions · approval_request.py",
  },
  {
    key: "outcome", lane: "tw", num: "⑧", status: "decide",
    owner: { ko: "세진 (대응표)", en: "Sejin (response matrix)" },
    title: { ko: "세 가지 결과", en: "Three outcomes" },
    short: { ko: "승인 · 반려 · 만료(무응답)", en: "Approve · reject · expire" },
    what: {
      ko: "승인되면 대응을 실행하고, 반려되면 기록만 남기고, 아무도 답하지 않으면 '무응답'도 하나의 결과로 기록해 상급자에게 알립니다. 결과별 세부 규칙은 대응표 v1에 정리돼 있고 팀 확정을 기다립니다.",
      en: "Approve runs the response, reject records the reason, and no answer is recorded as an outcome and escalated. Details are in response matrix v1, awaiting team sign-off.",
    },
    input: { ko: "승인자 결정 또는 시간 초과", en: "Decision or timeout" },
    output: { ko: "대응 실행 / 기록 / 상급자 통지", en: "Response / record / escalation" },
    code: "approval_finalize.py · src/response/response_matrix.md",
  },
];

// 대응표 v1 [제안] 값. 팀 확정 전이므로 화면에도 '제안'으로 표시한다.
export const APPROVAL_TIMELINE = [
  { at: "T0", ko: "승인 요청", en: "Approval request" },
  { at: "+10분", atEn: "+10m", ko: "재알림 1", en: "Reminder 1" },
  { at: "+20분", atEn: "+20m", ko: "백업 승인자 합류", en: "Backup approver added" },
  { at: "+40분", atEn: "+40m", ko: "최후 통보", en: "Final notice" },
  { at: "+60분", atEn: "+60m", ko: "만료 → 랩장 통지", en: "Expire → escalate" },
];

export const OUTCOMES = [
  {
    key: "approve", tone: "good",
    ko: "승인", en: "Approve",
    dKo: "대응 실행: 사용자 안내 1회, 자금팀 노출 축소 검토, 상황실 유지",
    dEn: "Run the response: one user notice, treasury exposure review, war room",
  },
  {
    key: "reject", tone: "neutral",
    ko: "반려", en: "Reject",
    dKo: "사유와 함께 기록. 오탐이면 엔진 담당에게 데이터 전달",
    dEn: "Recorded with a reason; false positives go back to the engine owner",
  },
  {
    key: "expire", tone: "bad",
    ko: "만료 (무응답)", en: "Expire (no answer)",
    dKo: "무응답도 결과로 기록. 내부 보수 조치만, 사용자 안내는 보내지 않음",
    dEn: "Silence is recorded as an outcome; internal safeguards only, no user notice",
  },
];

export const GAPS = [
  {
    ko: "실제 데이터로는 경보가 울리지 않습니다",
    en: "Real data never crosses the alert line",
    dKo: "가격 항목의 가중치가 0.5라 가격만으로는 최대 50점입니다. 공시를 더해도 54.5점으로 기준 70점에 못 미칩니다. 계산 방식을 바꿀지, 데이터를 더 받을지 정해야 합니다.",
    dEn: "Price carries a 0.5 weight, so price alone caps at 50. With filings it reaches 54.5 — still under 70. Either the formula or the inputs must change.",
    owner: { ko: "재석", en: "Jaeseok" },
  },
  {
    ko: "공시 데이터는 경보를 앞당기지 못합니다",
    en: "Filings cannot move the alert earlier",
    dKo: "폭락 주간에 공개돼 있던 공시는 1월 보고서 하나뿐이라 그 주 내내 값이 고정입니다. 시간을 앞당기려면 가격보다 먼저 움직이는 데이터(뉴스, 대량 상환)가 필요합니다.",
    dEn: "Only the January report was public that week, so the value is flat. Earlier warning needs signals that move before price (news, redemptions).",
    owner: { ko: "원준 · 세진", en: "Wonjun · Sejin" },
  },
  {
    ko: "엔진이 아직 실제로 경보를 보내지 않습니다",
    en: "The engine does not send alerts yet",
    dKo: "ThreatWatch 쪽 수용(⑤ AI 재채점 건너뛰기, ⑥ 알림 분리)은 운영에 반영됐습니다. 남은 것은 엔진이 만든 경보를 서명해서 실제로 보내는 연결로, ThreatWatch의 기존 전송 코드(send_signed.py)를 재사용합니다.",
    dEn: "ThreatWatch's side (⑤ skip AI re-scoring, ⑥ separate channel) is live. What's left is signing and actually sending the engine's alert, reusing ThreatWatch's existing sender (send_signed.py).",
    owner: { ko: "세진", en: "Sejin" },
  },
];
