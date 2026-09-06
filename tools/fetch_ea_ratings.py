"""Fetch an attributed EA F1 ratings snapshot, without inventing missing values.

Run: python tools/fetch_ea_ratings.py
Regenerate: python tools/fetch_ea_ratings.py --output app/data/ea-ratings.json
Offline parsing: python tools/fetch_ea_ratings.py --html path/to/ratings.html

EA game ratings are not measured Formula 1 driver abilities. Only the ratings
belong to EA's iteration; current team assignments/numbers belong to the local
official-grid snapshot and are deliberately kept separate.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
import unicodedata
from urllib.request import Request, urlopen


SOURCE_URL = "https://www.ea.com/games/f1/ratings"
PROJECT_ROOT = Path(__file__).resolve().parents[1]
GRID_SOURCE_URL = (
    "https://www.formula1.com/en/latest/article/"
    "who-are-the-2026-formula-1-drivers.3mVj9UTWK7Puz2QuScnzuz."
    "3mVj9UTWK7Puz2QuScnzuz"
)
NUMBER_SOURCE_URL = (
    "https://www.formula1.com/en/latest/article/"
    "all-the-2026-f1-driver-numbers-confirmed-in-full.5rh7o9mPntG7NerzVk9onc"
)
EA_TEAM_IDS = {
    "Red Bull": "red-bull",
    "Ferrari": "ferrari",
    "Mercedes-AMG Petronas": "mercedes",
    "McLaren": "mclaren",
    "Aston Martin": "aston-martin",
    "Alpine": "alpine",
    "Williams": "williams",
    "Audi Revolut": "audi",
    "KICK Sauber": "audi",
    "Cadillac": "cadillac",
    "Visa Cash App RB": "racing-bulls",
    "Haas": "haas",
}
STAT_KEYS = {
    "OVR": "overall", "EXP": "experience", "RAC": "racecraft",
    "AWA": "awareness", "PAC": "pace",
}


class NextDataParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.capture = False
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "script" and dict(attrs).get("id") == "__NEXT_DATA__":
            self.capture = True

    def handle_data(self, data: str) -> None:
        if self.capture:
            self.parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "script":
            self.capture = False


def driver_key(first_name: str, last_name: str) -> str:
    name = unicodedata.normalize("NFKD", f"{first_name}-{last_name}")
    return re.sub(r"[^a-z0-9]+", "-", name.encode("ascii", "ignore").decode().lower()).strip("-")


def read_project_grid(path: Path) -> dict[str, dict]:
    source = path.read_text(encoding="utf-8")
    grid = {}
    for team_match in re.finditer(r'^  \{\s*id: "([^"]+)"([\s\S]*?)(?=^  \{|^\];)', source, re.M):
        team_id, block = team_match.groups()
        for driver in re.finditer(
            r'id: "([^"]+)",\s*firstName: "([^"]+)",\s*lastName: "([^"]+)",'
            r'\s*code: "([^"]+)",\s*number: (\d+)', block
        ):
            driver_id, first_name, last_name, code, number = driver.groups()
            key = driver_key(first_name, last_name)
            if key in grid:
                raise ValueError(f"Duplicate project driver: {key}")
            grid[key] = {"driverId": driver_id, "teamId": team_id, "number": int(number), "code": code}
    if not grid:
        raise ValueError("No drivers found in participants.ts; update the parser before fetching")
    return grid


def build_snapshot(html: str, project_grid: dict[str, dict], checked_at: str) -> dict:
    parser = NextDataParser()
    parser.feed(html)
    if not parser.parts:
        raise ValueError("EA page has no __NEXT_DATA__; no snapshot was written")
    page = json.loads("".join(parser.parts))["props"]["pageProps"]
    details = page["ratingDetails"]
    items = details["items"]
    if not items or len(items) != details["totalItems"]:
        raise ValueError("EA payload is empty or paginated/incomplete; refusing a partial snapshot")
    iterations = {(item["iteration"]["id"], item["iteration"]["label"]) for item in items}
    if len(iterations) != 1:
        raise ValueError("EA payload mixes rating iterations; refusing to combine editions")
    iteration_id, iteration_label = next(iter(iterations))
    rows, discrepancies, unexpected = [], [], []
    seen: set[str] = set()
    for item in items:
        key = driver_key(item["firstName"], item["lastName"])
        if key in seen:
            raise ValueError(f"Duplicate EA driver: {key}")
        seen.add(key)
        project = project_grid.get(key)
        values = {}
        for label, stat_key in STAT_KEYS.items():
            value = item["stats"][stat_key]["value"]
            if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 100:
                raise ValueError(f"Missing/invalid {label} for {key}: {value!r}")
            values[label] = value
        if values["OVR"] != item["overallRating"]:
            raise ValueError(f"EA overall fields disagree for {key}")
        if project is None:
            unexpected.append(key)
        else:
            if EA_TEAM_IDS.get(item["team"]["label"]) != project["teamId"]:
                discrepancies.append({
                    "driverId": project["driverId"], "field": "team",
                    "eaValue": item["team"]["label"], "projectValue": project["teamId"],
                })
            if item.get("carNum") != project["number"]:
                discrepancies.append({
                    "driverId": project["driverId"], "field": "carNumber",
                    "eaValue": item.get("carNum"), "projectValue": project["number"],
                })
        rows.append({
            "driverId": project["driverId"] if project else key,
            "eaId": item["id"],
            "name": f'{item["firstName"]} {item["lastName"]}',
            "ratings": values,
            "eaMetadata": {"teamName": item["team"]["label"], "carNumber": item.get("carNum")},
            "projectMetadata": project,
        })
    missing = sorted(project["driverId"] for key, project in project_grid.items() if key not in seen)
    return {
        "schemaVersion": 1,
        "source": {
            "publisher": "EA SPORTS", "url": SOURCE_URL,
            "jsonPath": "props.pageProps.ratingDetails.items",
            "type": "official-game-ratings-not-measured-driver-performance",
        },
        "iteration": {"id": iteration_id, "label": iteration_label},
        "checkedAt": checked_at,
        "coverage": {
            "expectedDriverCount": len(project_grid), "sourceDriverCount": len(rows),
            "matchedDriverCount": len(project_grid) - len(missing),
            "missingDriverIds": missing, "unexpectedSourceDriverIds": sorted(unexpected),
        },
        "lineupSources": [GRID_SOURCE_URL, NUMBER_SOURCE_URL],
        "metadataDiscrepancies": discrepancies,
        "notes": [
            "EA game ratings are edition-specific judgement values, not measured real-world abilities.",
            "Use ratings only; team assignments and race numbers follow participants.ts, not EA metadata.",
            "No missing rating is substituted. Unmatched drivers remain explicitly listed in coverage.",
            "The checked date is the retrieval date, not the rating iteration's release date.",
        ],
        "drivers": rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--html", type=Path, help="Parse a saved official-page HTML file without network")
    parser.add_argument("--output", type=Path, help="Write JSON; default is stdout")
    args = parser.parse_args()
    if args.html:
        html = args.html.read_text(encoding="utf-8")
    else:
        request = Request(SOURCE_URL, headers={"User-Agent": "Mozilla/5.0 (compatible; CompoundSchoolResearch/1.0)"})
        with urlopen(request, timeout=30) as response:
            html = response.read().decode("utf-8")
    checked_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    data = build_snapshot(html, read_project_grid(PROJECT_ROOT / "app/lib/participants.ts"), checked_at)
    content = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(content, encoding="utf-8")
        print(f'Saved {len(data["drivers"])} drivers; missing {data["coverage"]["missingDriverIds"]}', file=sys.stderr)
    else:
        print(content, end="")


if __name__ == "__main__":
    main()
