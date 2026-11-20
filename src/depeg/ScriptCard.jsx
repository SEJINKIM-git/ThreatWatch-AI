import { SCRIPT, fill, spokenSeconds } from "./content.js";

/**
 * 발표 대본 카드
 *
 * 문구는 content.js 의 SCRIPT 한 곳에 있다. {lead_hours} 같은 자리는 replay.json 값으로 채운다 (values).
 * [대괄호] 부분은 발표자 행동 지시라 본문과 다른 스타일로 보인다.
 * 숨김 상태는 페이지(DepegPage)가 갖고 있어 세 카드가 함께 숨고 보인다.
 */

const SCENE = {
  live: { ko: "장면 1", en: "Scene 1" },
  replay: { ko: "장면 2", en: "Scene 2" },
  closing: { ko: "마무리", en: "Closing" },
};

function duration(seconds, lang) {
  const s = Math.max(5, Math.round(seconds / 5) * 5);
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (lang === "ko") return `약 ${m ? `${m}분${r ? ` ${r}초` : ""}` : `${r}초`}`;
  return `about ${m ? `${m} min${r ? ` ${r} s` : ""}` : `${r} s`}`;
}

export default function ScriptCard({ part, lang, values, visible, onToggle }) {
  const L = (ko, en) => (lang === "ko" ? ko : en);
  const toggle = (
    <button type="button" className="dp-secondary dp-script-toggle" onClick={onToggle} aria-pressed={visible}
            title={L("S 키로도 전환", "Also toggled with the S key")}>
      {visible ? L("대본 숨기기", "Hide script") : L("대본 보이기", "Show script")}
      <kbd>S</kbd>
    </button>
  );

  if (!visible) return <div className="dp-script-hidden">{toggle}</div>;

  let paragraphs;
  let problem = null;
  try {
    paragraphs = SCRIPT[part][lang].map((text) => fill(text, values));
  } catch (e) {
    // 채우지 못한 자리를 {…} 그대로 내보내지 않는다 — 무엇이 비었는지 드러낸다
    paragraphs = [];
    problem = e.message;
  }

  return (
    <aside className="dp-script" aria-label={L("발표 대본", "Presenter script")}>
      <div className="dp-row" style={{ alignItems: "center", flexWrap: "wrap" }}>
        <p className="dp-label">
          {L("발표 대본", "Presenter script")} · {SCENE[part][lang]}
          {!problem && <span className="dp-script-time">{duration(spokenSeconds(paragraphs, lang), lang)}</span>}
        </p>
        {toggle}
      </div>
      {problem && <p className="dp-small" style={{ color: "var(--bad)", margin: "14px 0 0" }}>{problem}</p>}
      {paragraphs.map((text, i) => (
        <p key={i} className="dp-script-p">
          {text.split(/(\[[^\]]+\])/).filter(Boolean).map((chunk, k) => (
            chunk.startsWith("[")
              ? <span key={k} className="dp-script-cue">{chunk.slice(1, -1)}</span>
              : <span key={k}>{chunk}</span>
          ))}
        </p>
      ))}
    </aside>
  );
}
