import { useEffect, useRef, useState } from "react";

/**
 * /depeg 화면 차트
 *
 * 기존 WorkspaceCharts.jsx와 같은 방식으로 라이브러리 없이 SVG를 직접 그린다.
 * 축은 항상 하나(이중 축 금지). 가격과 점수는 서로 다른 차트로 위아래에 둔다.
 */

export const SERIES = {
  price: "#3987e5",
  scorePrice: "#3987e5",
  scoreFull: "#199e70",
};

export const INK = {
  text: "#edf3ff",
  dim: "rgba(237, 243, 255, 0.64)",
  faint: "rgba(237, 243, 255, 0.40)",
  grid: "rgba(150, 175, 220, 0.10)",
  warn: "#f5b13d",
  bad: "#ff5c6c",
};

/** 컨테이너 폭을 따라가는 훅 — 글자가 늘어나지 않게 viewBox 대신 실제 폭으로 그린다. */
export function useWidth(initial = 640) {
  const ref = useRef(null);
  const [w, setW] = useState(initial);
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/**
 * 시계열 라인 차트
 *
 * series: [{ key, label, color, values }]
 * refLines: [{ y, label, color }]
 * hoverIdx / onHover: 위아래 차트가 같은 시각을 가리키도록 부모가 상태를 가진다.
 */
export function LineChart({
  series, times, yMin, yMax, yTicks, formatY, refLines = [], markers = [],
  height = 220, hoverIdx, onHover, ariaLabel, compact = false, upto,
}) {
  // upto: 재생 중일 때 여기까지만 선을 그린다 (x축 눈금은 전체 기간 그대로 — 화면이 늘어나지 않게)
  const shown = (vals) => (upto == null ? vals : vals.slice(0, upto + 1));
  const [ref, width] = useWidth();
  const pad = compact
    ? { l: 50, r: 12, t: 10, b: 20 }
    : { l: 52, r: 16, t: 14, b: 28 };
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const n = times.length;

  const x = (i) => pad.l + (n <= 1 ? 0 : (i / (n - 1)) * iw);
  const y = (v) => pad.t + (1 - (v - yMin) / (yMax - yMin)) * ih;

  const path = (vals) =>
    vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");

  // 하루 시작(00:00Z)마다 눈금
  const dayTicks = [];
  times.forEach((t, i) => {
    if (t.slice(11, 13) === "00") dayTicks.push({ i, label: `${+t.slice(5, 7)}/${+t.slice(8, 10)}` });
  });
  const tickEvery = Math.max(1, Math.ceil(dayTicks.length / Math.max(2, Math.floor(iw / 70))));

  function handleMove(e) {
    if (!onHover) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - pad.l;
    const i = Math.round((px / iw) * (n - 1));
    onHover(Math.min(n - 1, Math.max(0, i)));
  }

  const hx = hoverIdx != null ? x(hoverIdx) : null;

  return (
    <div ref={ref} style={{ width: "100%" }}>
      <svg width={width} height={height} role="img" aria-label={ariaLabel}
           style={{ display: "block", touchAction: "pan-y" }}>
        {/* 격자 + y축 눈금 */}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} stroke={INK.grid} />
            <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" className="dp-axis">
              {formatY(v)}
            </text>
          </g>
        ))}

        {/* x축 날짜 눈금 */}
        {dayTicks.filter((_, k) => k % tickEvery === 0).map((d) => (
          <text key={d.i} x={x(d.i)} y={height - 8} textAnchor="middle" className="dp-axis">
            {d.label}
          </text>
        ))}

        {/* 기준선 (상태색 + 글자 라벨 — 색만으로 의미를 전달하지 않음) */}
        {refLines.map((r) => (
          <g key={r.label}>
            <line x1={pad.l} x2={width - pad.r} y1={y(r.y)} y2={y(r.y)}
                  stroke={r.color} strokeWidth="1.5" strokeDasharray="5 5" opacity="0.85" />
            <text x={width - pad.r} y={y(r.y) - 6} textAnchor="end"
                  className="dp-axis" style={{ fill: r.color }}>
              {r.label}
            </text>
          </g>
        ))}

        {/* 선 */}
        {series.map((s) => (
          <path key={s.key} d={path(shown(s.values))} fill="none" stroke={s.color}
                strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        ))}

        {/* 데이터에서 나온 표시점 */}
        {markers.filter((m) => upto == null || m.i <= upto).map((m) => (
          <g key={m.label}>
            <circle cx={x(m.i)} cy={y(m.v)} r="5" fill={m.color}
                    stroke="#0e1523" strokeWidth="2" />
            <text x={x(m.i) + (m.anchor === "end" ? -10 : 10)} y={y(m.v) + (m.dy ?? 4)}
                  textAnchor={m.anchor || "start"} className="dp-mark">
              {m.label}
            </text>
          </g>
        ))}

        {/* 크로스헤어 */}
        {hx != null && (
          <g pointerEvents="none">
            <line x1={hx} x2={hx} y1={pad.t} y2={pad.t + ih}
                  stroke="rgba(237,243,255,0.35)" strokeWidth="1" />
            {series.map((s) => (
              <circle key={s.key} cx={hx} cy={y(s.values[hoverIdx])} r="4.5"
                      fill={s.color} stroke="#0e1523" strokeWidth="2" />
            ))}
          </g>
        )}

        {/* 마우스 영역은 선보다 넓게 */}
        {onHover && (
          <rect x={pad.l} y={0} width={iw} height={height} fill="transparent"
                onPointerMove={handleMove} onPointerDown={handleMove}
                style={{ cursor: "crosshair" }} />
        )}
      </svg>
    </div>
  );
}

/** 점수 기여도 가로 막대 */
export function FactorBars({ factors, labelOf }) {
  if (!factors?.length) return null;
  const max = 0.5; // 가장 큰 가중치 — 막대 길이를 가중치 상한 기준으로 맞춘다
  return (
    <div style={{ display: "grid", gap: "10px" }}>
      {factors.map((f) => (
        <div key={f.metric}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", marginBottom: "5px" }}>
            <span className="dp-small">{labelOf(f.metric)}</span>
            <span className="dp-num dp-small">+{(f.contribution * 100).toFixed(1)}</span>
          </div>
          <svg width="100%" height="6" style={{ display: "block" }}>
            <rect width="100%" height="6" rx="3" fill="rgba(150,175,220,0.12)" />
            <rect width={`${Math.min(100, (f.contribution / max) * 100)}%`} height="6" rx="3"
                  fill={SERIES.scoreFull} />
          </svg>
        </div>
      ))}
    </div>
  );
}
