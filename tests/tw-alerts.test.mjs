// 경보 전송 프록시의 시연 비밀번호 확인 테스트 (node --test tests/tw-alerts.test.mjs)
// 키는 모두 가짜 값이다. 실제 비밀번호는 저장소에 없다.
import { test } from "node:test";
import assert from "node:assert/strict";

import { checkDemoKey } from "../api/_lib/demo-key.js";
import handler from "../api/tw-alerts.js";

const FAKE = "fake-demo-key-for-tests";

test("키가 설정되지 않으면 503", () => {
  assert.deepEqual(checkDemoKey(undefined, FAKE), { ok: false, status: 503, error: "시연 키가 설정되지 않았습니다" });
  assert.equal(checkDemoKey("", FAKE).status, 503);
});

test("틀리거나 없는 키는 401 (길이가 달라도 예외 없이)", () => {
  assert.equal(checkDemoKey(FAKE, "wrong").status, 401);
  assert.equal(checkDemoKey(FAKE, FAKE.replace(/.$/, "X")).status, 401); // 같은 길이
  assert.equal(checkDemoKey(FAKE, undefined).status, 401);
  assert.equal(checkDemoKey(FAKE, "").status, 401);
});

test("맞는 키는 통과", () => {
  assert.deepEqual(checkDemoKey(FAKE, FAKE), { ok: true });
});

test("결과에 키 값이 들어가지 않는다", () => {
  for (const r of [checkDemoKey(FAKE, "wrong"), checkDemoKey(undefined, FAKE)]) {
    assert.ok(!JSON.stringify(r).includes(FAKE));
  }
});

function fakeRes() {
  return {
    code: null, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

test("핸들러: 키 확인이 서명·전송보다 먼저다 (네트워크 호출 없음)", async () => {
  const saved = { ...process.env };
  const realFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error("must not be called"); };
  try {
    Object.assign(process.env, { TW_API_URL: "https://example.invalid", TW_API_KEY: "k", TW_HMAC_SECRET: "s" });
    delete process.env.DEPEG_DEMO_KEY;
    const body = { incident_type: "ransomware", severity: "critical" };

    let res = fakeRes();
    await handler({ method: "POST", headers: { "x-demo-key": FAKE }, body }, res);
    assert.equal(res.code, 503);

    process.env.DEPEG_DEMO_KEY = FAKE;
    res = fakeRes();
    await handler({ method: "POST", headers: { "x-demo-key": "nope" }, body }, res);
    assert.equal(res.code, 401);
    assert.ok(!JSON.stringify(res.body).includes(FAKE));

    res = fakeRes();
    await handler({ method: "POST", headers: {}, body }, res);
    assert.equal(res.code, 401);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = realFetch;
    process.env = saved;
  }
});
