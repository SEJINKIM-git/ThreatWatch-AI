"""
발표용 데모 시나리오 로더
"""

from __future__ import annotations

import copy
import json
import random
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

SCENARIO_FILE = Path(__file__).resolve().parent / "threatwatch-dashboard" / "public" / "demo-scenarios.json"
_SCENARIO_CACHE: Optional[List[Dict[str, Any]]] = None


def _load_scenario_file() -> List[Dict[str, Any]]:
    with SCENARIO_FILE.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    scenarios = payload.get("scenarios", [])
    if not scenarios:
        raise ValueError("No demo scenarios found in shared scenario file")
    return scenarios


def load_demo_scenarios() -> List[Dict[str, Any]]:
    """공유 시나리오 파일 로드"""
    global _SCENARIO_CACHE

    if _SCENARIO_CACHE is None:
        _SCENARIO_CACHE = _load_scenario_file()

    return copy.deepcopy(_SCENARIO_CACHE)


def list_demo_scenarios() -> List[Dict[str, Any]]:
    """시나리오 목록 반환"""
    return load_demo_scenarios()


def _weighted_choice(scenarios: List[Dict[str, Any]], rng: random.Random) -> Dict[str, Any]:
    total_weight = sum(int(item.get("weight", 1)) for item in scenarios)
    roll = rng.uniform(0, total_weight)

    for scenario in scenarios:
        roll -= int(scenario.get("weight", 1))
        if roll <= 0:
            return scenario

    return scenarios[-1]


def select_demo_scenario(
    risk_level: Optional[str] = None,
    scenario_id: Optional[str] = None,
    seed: Optional[str] = None,
) -> Dict[str, Any]:
    """리스크 레벨이나 시나리오 ID를 기준으로 시나리오 선택"""
    scenarios = load_demo_scenarios()

    if scenario_id:
        filtered = [scenario for scenario in scenarios if scenario.get("id") == scenario_id]
    elif risk_level:
        filtered = [
            scenario
            for scenario in scenarios
            if scenario.get("risk_level") == risk_level
            or scenario.get("expected_output", {}).get("risk_level") == risk_level
        ]
    else:
        filtered = scenarios

    if not filtered:
        raise ValueError(f"Unknown demo scenario selector: risk_level={risk_level!r}, scenario_id={scenario_id!r}")

    rng = random.Random(str(seed) if seed is not None else None)
    selected = copy.deepcopy(_weighted_choice(filtered, rng))
    selected["runtime"] = {
        "selected_at": datetime.now(timezone.utc).isoformat(),
        "seed": str(seed) if seed is not None else None,
    }

    return selected


def get_demo_scenario(
    risk_level: Optional[str] = None,
    scenario_id: Optional[str] = None,
    seed: Optional[str] = None,
) -> Dict[str, Any]:
    """기존 FinalPayload 호환 포맷으로 시나리오 반환"""
    scenario = select_demo_scenario(risk_level=risk_level, scenario_id=scenario_id, seed=seed)
    expected = scenario.get("expected_output", {})
    timestamp = datetime.now(timezone.utc).isoformat()
    risk = expected.get("risk_level") or scenario.get("risk_level", "P2")
    scenario_code = scenario.get("id", "demo").replace("-", "_").upper()
    alert_id = f"{risk}-{scenario_code}-{int(datetime.now(timezone.utc).timestamp())}"

    return {
        "scenario_id": scenario.get("id"),
        "scenario_label": scenario.get("label"),
        "alert_id": alert_id,
        "timestamp": timestamp,
        "risk_level": risk,
        "risk_score": expected.get("risk_score", 50),
        "incident_type": scenario.get("input", {}).get("incident_type", "unknown"),
        "summary": expected.get("summary", "Scenario processed"),
        "missing_data_count": expected.get("missing_data_count", len(expected.get("missing_data_list", []))),
        "confidence": expected.get("confidence", 0.5),
        "rationale": expected.get("rationale", []),
        "recommended_actions": expected.get("recommended_actions", []),
    }
