import { C, RISK_COLOR, BODY_FONT, MONO_FONT, label } from "./workspaceLib.js";

/**
 * 위험도 분포 도넛
 *
 * 차트 라이브러리 대신 SVG를 직접 그립니다.
 * 세그먼트가 3개뿐이라 stroke-dasharray로 충분합니다.
 */
export function RiskDonut({ counts, total }) {
  const R = 54;
  const CIRC = 2 * Math.PI * R;

  let offset = 0;
  const segments = ["P1", "P2", "P3"]
    .filter((k) => counts[k] > 0)
    .map((k) => {
      const portion = counts[k] / total;
      const seg = {
        key: k,
        color: RISK_COLOR[k],
        dash: portion * CIRC,
        gap: CIRC - portion * CIRC,
        offset: -offset * CIRC,
      };
      offset += portion;
      return seg;
    });

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "22px" }}>
      <svg width="132" height="132" viewBox="0 0 132 132" role="img"
           aria-label={`Risk distribution: ${total} cases`}>
        <circle cx="66" cy="66" r={R} fill="none"
                stroke="rgba(96,132,190,0.16)" strokeWidth="14" />
        {segments.map((s) => (
          <circle
            key={s.key}
            cx="66" cy="66" r={R}
            fill="none"
            stroke={s.color}
            strokeWidth="14"
            strokeDasharray={`${s.dash} ${s.gap}`}
            strokeDashoffset={s.offset}
            // 12시 방향에서 시작하도록 회전시킵니다.
            transform="rotate(-90 66 66)"
            strokeLinecap="butt"
          />
        ))}
        <text x="66" y="62" textAnchor="middle"
              style={{ fontFamily: MONO_FONT, fontSize: "26px", fontWeight: 700, fill: C.text }}>
          {total}
        </text>
        <text x="66" y="80" textAnchor="middle"
              style={{ fontFamily: BODY_FONT, fontSize: "9px", letterSpacing: "0.12em", fill: C.textFaint }}>
          CASES
        </text>
      </svg>

      <div style={{ display: "grid", gap: "10px", flex: 1 }}>
        {["P1", "P2", "P3"].map((k) => (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{
              width: "8px", height: "8px", borderRadius: "2px",
              background: RISK_COLOR[k], flexShrink: 0,
            }} />
            <span style={{
              fontFamily: BODY_FONT, fontSize: "12px",
              color: C.textDim, flex: 1,
            }}>
              {k}
            </span>
            <span style={{
              fontFamily: MONO_FONT, fontSize: "13px",
              fontWeight: 600, color: C.text,
            }}>
              {counts[k] || 0}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 사고 유형별 가로 막대 */
export function TypeBars({ items }) {
  if (!items.length) {
    return <p style={{ ...label(), color: C.textFaint }}>No data yet</p>;
  }

  const max = Math.max(...items.map((i) => i.count));

  return (
    <div style={{ display: "grid", gap: "12px" }}>
      {items.map((item) => (
        <div key={item.type}>
          <div style={{
            display: "flex", justifyContent: "space-between",
            marginBottom: "5px", gap: "12px",
          }}>
            <span style={{
              fontFamily: BODY_FONT, fontSize: "12px", color: C.textDim,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {item.type.replace(/_/g, " ")}
            </span>
            <span style={{
              fontFamily: MONO_FONT, fontSize: "12px",
              color: C.textDim, flexShrink: 0,
            }}>
              {item.count}
            </span>
          </div>
          <svg width="100%" height="6" style={{ display: "block" }}>
            <rect x="0" y="0" width="100%" height="6" rx="3"
                  fill="rgba(96,132,190,0.14)" />
            <rect x="0" y="0" width={`${(item.count / max) * 100}%`} height="6" rx="3"
                  fill={item.color} />
          </svg>
        </div>
      ))}
    </div>
  );
}

/**
 * 파이프라인 진행 표시기
 *
 * status: "idle" | "active" | "done" | "error"
 */
export function StageTracker({ stages, state }) {
  return (
    <div style={{ display: "grid", gap: "2px" }}>
      {stages.map((stage, idx) => {
        const status = state[stage.key] || "idle";

        const dotColor =
          status === "done" ? C.teal
            : status === "active" ? C.accent
              : status === "error" ? C.p1
                : "rgba(96,132,190,0.3)";

        return (
          <div key={stage.key} style={{ display: "flex", gap: "14px" }}>
            {/* 좌측 커넥터 */}
            <div style={{
              display: "flex", flexDirection: "column",
              alignItems: "center", width: "12px", flexShrink: 0,
            }}>
              <svg width="12" height="12" style={{ marginTop: "4px" }}>
                <circle cx="6" cy="6" r="5" fill="none"
                        stroke={dotColor} strokeWidth="2" />
                {status === "done" && <circle cx="6" cy="6" r="2.5" fill={dotColor} />}
                {status === "active" && (
                  <circle cx="6" cy="6" r="2.5" fill={dotColor}>
                    <animate attributeName="opacity" values="1;0.25;1"
                             dur="1.2s" repeatCount="indefinite" />
                  </circle>
                )}
              </svg>
              {idx < stages.length - 1 && (
                <div style={{
                  width: "2px", flex: 1, minHeight: "18px",
                  background: status === "done"
                    ? "rgba(61,219,182,0.4)"
                    : "rgba(96,132,190,0.2)",
                }} />
              )}
            </div>

            <div style={{ paddingBottom: "14px", minWidth: 0 }}>
              <div style={{
                fontFamily: BODY_FONT, fontSize: "13px", fontWeight: 500,
                color: status === "idle" ? C.textFaint : C.text,
              }}>
                {stage.label}
              </div>
              <div style={{
                fontFamily: MONO_FONT, fontSize: "11px",
                color: C.textFaint, marginTop: "2px",
              }}>
                {stage.detail}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 위험도 배지 */
export function RiskBadge({ level, score }) {
  const color = RISK_COLOR[level] || C.textDim;

  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "6px",
      padding: "3px 9px", borderRadius: "5px",
      border: `1px solid ${color}55`,
      background: `${color}14`,
      fontFamily: MONO_FONT, fontSize: "11px",
      fontWeight: 700, color,
    }}>
      {level}
      {score != null && (
        <span style={{ opacity: 0.75, fontWeight: 500 }}>{score}</span>
      )}
    </span>
  );
}

/** 상단 KPI 카드 */
export function StatCard({ title, value, sub, accent }) {
  return (
    <div style={{
      background: C.panel,
      border: `1px solid ${C.border}`,
      borderRadius: "12px",
      padding: "16px 18px",
      // 위험도별 색상을 좌측 라인으로 표현합니다.
      borderLeft: accent ? `3px solid ${accent}` : `1px solid ${C.border}`,
    }}>
      <p style={label()}>{title}</p>
      <p style={{
        margin: "10px 0 0", fontFamily: MONO_FONT,
        fontSize: "30px", fontWeight: 700, lineHeight: 1,
        color: accent || C.text,
      }}>
        {value}
      </p>
      {sub && (
        <p style={{
          margin: "7px 0 0", fontFamily: BODY_FONT,
          fontSize: "12px", color: C.textFaint,
        }}>
          {sub}
        </p>
      )}
    </div>
  );
}
