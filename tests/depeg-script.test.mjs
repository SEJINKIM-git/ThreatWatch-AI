// 발표 대본(content.js SCRIPT) — {자리}가 replay.json 값으로 전부 채워지는지, 모르는 자리는 오류로 드러나는지
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { SCRIPT, fill, scriptValues, spokenSeconds } from "../src/depeg/content.js";

const data = JSON.parse(readFileSync(new URL("../public/depeg/replay.json", import.meta.url), "utf8"));
const values = scriptValues(data, (t) => `<${t}>`);

test("모든 대본 문단의 자리가 채워진다 (KO·EN)", () => {
  assert.deepEqual(Object.keys(SCRIPT), ["live", "replay", "closing"]);
  for (const [part, byLang] of Object.entries(SCRIPT)) {
    assert.equal(byLang.ko.length, byLang.en.length, `${part}: KO·EN 문단 수가 같아야 한다`);
    for (const lang of ["ko", "en"]) {
      for (const text of byLang[lang]) {
        const out = fill(text, values);
        assert.ok(!/[{}]/.test(out), `${part}/${lang}: 채워지지 않은 자리 — ${out}`);
        assert.ok(!out.includes("undefined") && !out.includes("null") && !out.includes("NaN"), out);
      }
    }
  }
});

test("값은 replay.json 에서 온다", () => {
  const s = data.summary;
  assert.equal(values.lead_hours, s.news.lead_conservative.hours_before_low);
  assert.equal(values.watch_ratio, s.watch.ratio_vs_baseline);
  assert.equal(values.cross_time, `<${s.lines.score_news.alert.first_at}>`);
  assert.equal(values.peak, s.lines.score_news.max);
  assert.equal(values.price_peak, s.lines.score_price.max);
  assert.equal(values.calm_max, s.calm_max_score);
  assert.equal(values.calm_false, s.calm_hours_breached);
  const said = SCRIPT.replay.ko.map((t) => fill(t, values)).join(" ");
  for (const v of Object.values(values)) assert.ok(said.includes(String(v)), `대본에 ${v} 가 쓰여야 한다`);
});

test("모르는 자리와 빈 값은 오류로 드러난다", () => {
  assert.throws(() => fill("점수 {no_such_key}점", values), /no_such_key/);
  assert.throws(() => fill("{peak}점", { peak: null }), /peak/);
  assert.throws(() => fill("{peak}점", { peak: NaN }), /peak/);
  assert.throws(() => fill("{peak}점", undefined), /peak/);
  assert.equal(fill("{calm_false}회", { calm_false: 0 }), "0회"); // 0 은 값이다
  assert.equal(fill("자리 없는 문장", {}), "자리 없는 문장");
});

test("기준선을 넘지 못한 데이터면 cross_time 자리가 오류가 된다", () => {
  const none = structuredClone(data);
  none.summary.lines.score_news.alert.first_at = null;
  const v = scriptValues(none, (t) => t);
  assert.equal(v.cross_time, null);
  assert.throws(() => SCRIPT.replay.ko.map((t) => fill(t, v)), /cross_time/);
});

test("예상 길이는 [행동 지시]를 빼고 센다", () => {
  assert.equal(spokenSeconds(["[가리키며] " + "가".repeat(300)], "ko"), 60);
  assert.equal(spokenSeconds([Array(150).fill("word").join(" ") + " [pause here]"], "en"), 60);
});
