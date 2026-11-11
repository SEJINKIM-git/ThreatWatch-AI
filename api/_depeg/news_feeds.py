"""뉴스 출처 응답을 공통 기사 형식({title, url, domain, seen})으로 바꾼다. 순수 함수."""

from __future__ import annotations

import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from datetime import timezone


def parse_google_news_rss(xml_text: str) -> list[dict]:
    root = ET.fromstring(xml_text)
    out = []
    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()
        src = item.find("source")
        publisher = (src.text or "").strip() if src is not None else ""
        # Google News 제목은 "기사 제목 - 언론사" 형식이다. 언론사 꼬리를 떼어 기준표가 제목만 보게 한다.
        if publisher and title.endswith(f" - {publisher}"):
            title = title[: -len(publisher) - 3].rstrip()
        seen = ""
        pub = item.findtext("pubDate")
        if pub:
            try:
                seen = parsedate_to_datetime(pub).astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            except (TypeError, ValueError):
                seen = ""
        domain = ""
        if src is not None and src.get("url"):
            domain = src.get("url").split("//", 1)[-1].split("/", 1)[0]
        out.append({
            "title": title,
            "url": (item.findtext("link") or "").strip(),
            "domain": publisher or domain,
            "seen": seen,
        })
    return out
