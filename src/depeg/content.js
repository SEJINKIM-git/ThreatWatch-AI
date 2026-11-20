/**
 * /depeg 화면의 설명 문구와 파이프라인 정의
 *
 * 숫자(점수, 가격)는 여기 두지 않는다. 숫자는 전부
 * public/depeg/replay.json — 실제 엔진을 돌린 결과 — 에서 읽는다.
 * 진행 상태(status)는 사람이 갱신하는 값이므로 바뀌면 여기만 고치면 된다.
 */

export const STATUS_AS_OF = "2026-11-12";

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
    title: { ko: "공시·뉴스 데이터 수집", en: "Reserve filings & news" },
    short: { ko: "Circle 준비금 보고서의 숫자와, 위기 기사 신호를 만듦", en: "Reserve-report numbers plus a crisis-news signal" },
    what: {
      ko: "USDC 발행사 Circle이 매달 내는 '준비금 증명 보고서'에서 현금·국채 비중, 보고서가 얼마나 오래됐는지를 뽑습니다. 뉴스는 기사 제목을 정해진 규칙(뉴스 기준표 v2)으로만 분류해, 그 시점 보고서에 나온 보관 은행·Circle 자체의 위기 기사가 있으면 신호를 켭니다. 2023년 3월 시간별 뉴스 신호는 완료, 평상시 기사 표본은 원준이 정리 중입니다. 보고서와 기사는 공개된 시각 이후에만 써서 그 시점에 몰랐던 정보가 섞이지 않게 합니다.",
      en: "Reads Circle's monthly reserve attestation: cash and T-bill shares, and report age. News headlines are classified by fixed rules only (news rubric v2): a crisis at Circle itself or at a bank named in the report public at that hour turns the signal on. The hourly March 2023 news signal is done; a calm-period sample is in progress (Wonjun). Reports and articles are used only after they were public, so no future information leaks in.",
    },
    input: { ko: "Circle 준비금 보고서 PDF, 기사 제목", en: "Circle attestation PDFs, headlines" },
    output: { ko: "현금 비중, 국채 비중, 보고서 경과 일수, 뉴스 신호(0/1)", en: "Cash share, T-bill share, report age, news flag (0/1)" },
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
    input: { ko: "①의 가격·공시·뉴스 데이터", en: "Signals from ①" },
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
      ko: "ThreatWatch는 보안 경보를 정해진 양식으로만 받습니다. 그 양식에 맞춰 사고 유형(stablecoin_depeg_risk_usdc), 등급, 근거 항목을 채워 보냅니다. 같은 경보가 두 번 가도 한 번만 처리되도록 고유 번호를 붙입니다.",
      en: "ThreatWatch accepts alerts in a fixed format. This fills in the incident type (stablecoin_depeg_risk_usdc), severity and indicators, with a unique id so a resend is processed once.",
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

export const GAPS = [
  {
    ko: "경보는 가격이 무너진 뒤에야 울립니다",
    en: "The alert only fires once price breaks",
    dKo: "가중치 v1에서 실제 데이터는 경보·사람 승인 기준을 모두 넘지만, 첫 돌파는 최저점 직전입니다(시각은 위 리플레이). 뉴스 하나만으로는 70점을 넘지 않게 설계했기 때문이며, 그 전 구간은 '관찰 단계'로 표시합니다.",
    dEn: "With weights v1 real data crosses both lines, but only shortly before the low (hour shown in the replay above). By design, news alone cannot pass 70; the stretch before that is shown as the watch stage.",
    owner: { ko: "재석", en: "Jaeseok" },
  },
  {
    ko: "뉴스는 돌파 시각을 앞당기지 못합니다",
    en: "News does not move the crossing earlier",
    dKo: "뉴스 신호는 가격보다 훨씬 먼저 켜지지만 점수를 관찰 단계까지만 올립니다. 뉴스가 한 일은 가격이 무너진 시각의 단계를 경보에서 사람 승인으로 올린 것입니다. 평상시 4주 화면 값은 아직 가격만 본 값입니다.",
    dEn: "The news signal turns on long before price moves but only lifts the score into the watch stage. What news does is raise the stage at the hour price breaks from alert to human approval. The calm four-week figures on this page are still price-only.",
    owner: { ko: "재석 · 원준", en: "Jaeseok · Wonjun" },
  },
  {
    ko: "엔진이 아직 실제로 경보를 보내지 않습니다",
    en: "The engine does not send alerts yet",
    dKo: "ThreatWatch 쪽 수용(⑤ AI 재채점 건너뛰기, ⑥ 알림 분리)은 운영에 반영됐습니다. 남은 것은 엔진이 만든 경보를 서명해서 실제로 보내는 연결로, ThreatWatch의 기존 전송 코드(send_signed.py)를 재사용합니다.",
    dEn: "ThreatWatch's side (⑤ skip AI re-scoring, ⑥ separate channel) is live. What's left is signing and actually sending the engine's alert, reusing ThreatWatch's existing sender (send_signed.py).",
    owner: { ko: "세진", en: "Sejin" },
  },
];

// =============================================================
// 발표 대본 (ScriptCard.jsx 가 장면 1·2 아래와 장면 3 다음에 보여준다)
//
// 문구는 여기서만 고친다.
//  - [대괄호] 는 발표자 행동 지시 (어디를 가리킬지, 어디서 멈출지). 화면에서 다른 스타일로 보인다.
//  - {이름} 은 replay.json 값으로 채워지는 자리다 (아래 scriptValues). 숫자를 문장에 직접 쓰지 않는다.
//    쓸 수 있는 이름: lead_hours, watch_ratio, cross_time, peak, price_peak, calm_max, calm_false
// =============================================================
export const SCRIPT = {
  live: {
    ko: [
      "[점수 카드를 가리키며] 지금 보시는 건 오늘 데이터입니다. 가격, 최근 공시, 최근 24시간 기사를 매번 새로 불러와서 같은 엔진으로 점수를 냅니다.",
      "오늘 USDC는 1달러 근처에 있고, 점수도 경보 기준 70점에 한참 못 미칩니다. 평소에는 이렇게 조용해야 정상입니다.",
      "점수가 올라가도 투자자에게 바로 나가는 건 없습니다. 70점이면 운영자에게 알리고, 85점이면 사람이 승인해야 그다음으로 넘어갑니다.",
    ],
    en: [
      "[Point to the score card] What you're looking at is today's data. Every time the page loads, it pulls the price, the latest reserve filing and the last 24 hours of news, and scores them with the same engine.",
      "Today USDC is sitting right around one dollar, and the score is far below the alert line of 70. On a normal day, this quiet is exactly what we want.",
      "Even when the score rises, nothing goes straight to investors. At 70 the operator is notified, and at 85 a person has to approve before anything moves to the next step.",
    ],
  },
  replay: {
    ko: [
      "2023년 3월, 실리콘밸리은행이 무너지면서 USDC는 하루 만에 87센트까지 떨어졌습니다. 이 5일을 그 시각에 공개돼 있던 정보만으로 다시 돌려 봤습니다.",
      "[재생 → 뉴스 신호 시작 표시에서 멈춤] 최저점 {lead_hours}시간 전, 은행 위기 기사가 잡히면서 점수가 평소의 {watch_ratio}배로 올라갑니다. 저희는 이걸 관찰 단계라고 부릅니다.",
      "관찰 단계는 경보가 아닙니다. 기사 한 건만으로 경보를 울리면 평소에 잘못된 경보가 쏟아지기 때문에, 뉴스만으로는 70점을 넘지 못하게 설계했습니다.",
      "[재생 → {cross_time}에서 멈춤] 가격이 무너진 바로 그 시각, 점수는 {peak}점. 경보와 사람 승인 기준을 한 번에 넘습니다. 가격만 봤다면 {price_peak}점, 경보에서 멈췄을 겁니다.",
      "같은 엔진으로 평상시 4주를 돌렸을 때는 최고 {calm_max}점, 잘못 울린 경보 {calm_false}회였습니다.",
    ],
    en: [
      "In March 2023, Silicon Valley Bank collapsed and USDC fell to 87 cents within a day. We replayed those five days using only the information that was public at each hour.",
      "[Play → stop at the news-signal start marker] {lead_hours} hours before the low, bank-crisis coverage is picked up and the score rises to {watch_ratio} times its usual level. We call this the watch stage.",
      "The watch stage is not an alert. If a single article could trigger an alert, false alarms would pour in on ordinary days, so we designed the score so that news alone cannot pass 70.",
      "[Play → stop at {cross_time}] At the very hour the price breaks, the score is {peak}. It crosses the alert line and the human-approval line at once. On price alone it would have been {price_peak}, stopping at the alert.",
      "When we ran the same engine over four calm weeks, the peak was {calm_max} and the number of false alarms was {calm_false}.",
    ],
  },
  closing: {
    ko: [
      "방금 메일로 보신 것이 전체 흐름입니다. 점수가 85점을 넘으면 경보는 기존 ThreatWatch로 넘어가고, AI가 다시 채점하지 않고 등급만 그대로 옮겨 받습니다.",
      "승인자에게는 가격 변동과 투자자·발행사 권고안이 담긴 메일이 갑니다. 승인하면 권고안이 나가고, 반려하면 오탐으로 기록되고 감시는 계속됩니다.",
      "60분 안에 답이 없으면 아무것도 나가지 않고 책임자에게 알립니다.",
      "정리하면, 기계는 먼저 보고 빠르게 알리고, 무엇을 할지는 사람이 결정합니다.",
    ],
    en: [
      "What you just saw in the email is the whole flow. Once the score passes 85, the alert is handed to the existing ThreatWatch, which does not re-score it with AI. It simply carries the severity over.",
      "The approver receives an email with the price move and an advisory for investors and the issuer. If they approve, the advisory goes out. If they reject, it is recorded as a false alarm and monitoring continues.",
      "If no one answers within 60 minutes, nothing is sent and the person in charge is notified.",
      "In short: the machine sees it first and raises the flag quickly, and a person decides what to do.",
    ],
  },
};

/**
 * 대본의 자리를 채울 값. 전부 replay.json 에서 온다.
 * fmtTime(t) 은 화면의 다른 곳과 같은 시각 표기 함수 (KO 는 KST, EN 은 UTC).
 */
export function scriptValues(data, fmtTime) {
  const s = data.summary;
  const cross = s.lines.score_news.alert.first_at;
  return {
    lead_hours: s.news.lead_conservative?.hours_before_low,
    watch_ratio: s.watch?.ratio_vs_baseline,
    cross_time: cross ? fmtTime(cross) : null,
    peak: s.lines.score_news.max,
    price_peak: s.lines.score_price.max,
    calm_max: s.calm_max_score,
    calm_false: s.calm_hours_breached,
  };
}

/** text 의 {이름} 을 values 로 바꾼다. 순수 함수. 모르는 이름이나 비어 있는 값은 조용히 넘기지 않고 오류로 드러낸다. */
export function fill(text, values) {
  return text.replace(/\{(\w+)\}/g, (_, key) => {
    const v = values?.[key];
    if (v === undefined || v === null || v === "" || (typeof v === "number" && !Number.isFinite(v))) {
      throw new Error(`발표 대본의 {${key}} 자리를 채울 값이 없습니다`);
    }
    return String(v);
  });
}

/** 예상 발표 길이(초). [행동 지시] 는 말하지 않으므로 뺀다. 한국어는 분당 300자, 영어는 분당 150단어. */
export function spokenSeconds(paragraphs, lang) {
  const spoken = paragraphs.join(" ").replace(/\[[^\]]+\]/g, " ");
  if (lang === "ko") return (spoken.replace(/\s/g, "").length / 300) * 60;
  return (spoken.split(/\s+/).filter(Boolean).length / 150) * 60;
}
