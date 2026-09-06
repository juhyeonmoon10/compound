import recent from "../data/recent-team-evidence.json" with { type: "json" };
import official from "../data/official-team-pace.json" with { type: "json" };
import { MODEL_PARAMS } from "../model/params.ts";

export const RECENT_TEAM_EVIDENCE = recent;
export const OFFICIAL_TEAM_PACE_EVIDENCE = official;

export interface RecentTeamRow {
  readonly eventId: string;
  readonly season: number;
  readonly team: string;
  readonly teamId: string | null;
  readonly compound: string;
  readonly laps: number;
  readonly stints: number;
  readonly paceDeltaSeconds: number | null;
  readonly paceStatus: string;
  readonly degradationSecondsPerLap: number | null;
  readonly degradationCI95: readonly number[] | null;
  readonly referencePositiveTeamSlopeMedian: number | null;
}

const finite = (value: number | null): value is number => value !== null && Number.isFinite(value);
const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

/** First pool matching-compound deltas within each event; then equal-weight events.
 * No raw lap times or seasons are pooled. Invalid/null values never become zero.
 */
function eventMeans(rows: readonly RecentTeamRow[], value: (row: RecentTeamRow) => number) {
  const ids = [...new Set(rows.map(row => row.eventId))];
  return ids.map(eventId => {
    const eventRows = rows.filter(row => row.eventId === eventId);
    const laps = eventRows.reduce((sum, row) => sum + row.laps, 0);
    return { eventId, laps, value: eventRows.reduce((sum, row) => sum + value(row) * row.laps, 0) / laps };
  });
}

export function getRecentTeamPerformance(
  teamId: string,
  season = recent.selection.currentSeason,
  sourceRows: readonly RecentTeamRow[] = recent.teams,
) {
  const P = MODEL_PARAMS.performance;
  const H = MODEL_PARAMS.historical;
  const rows = sourceRows.filter(row => row.teamId === teamId && row.season === season && row.laps > 0 && Number.isFinite(row.laps));
  const paceRows = rows.filter(row => row.paceStatus === "observational-proxy" && finite(row.paceDeltaSeconds) &&
    row.laps >= recent.methodology.thresholds.minimumTeamLaps.value && row.stints >= recent.methodology.thresholds.minimumPaceStints.value);
  const paceEvents = eventMeans(paceRows, row => row.paceDeltaSeconds!);
  const paceAvailable = paceEvents.length >= H.minTeamEvents;
  const observedPaceSeconds = paceAvailable ? mean(paceEvents.map(event => event.value)) : null;
  const degradationRows = rows.filter(row => row.laps >= recent.methodology.thresholds.minimumTeamLaps.value &&
    row.stints >= recent.methodology.thresholds.minimumDegradationStints.value && finite(row.degradationSecondsPerLap) && row.degradationSecondsPerLap > 0 &&
    row.degradationCI95?.length === 2 && row.degradationCI95.every(Number.isFinite) &&
    row.degradationCI95[0] > 0 && row.degradationCI95[0] <= row.degradationSecondsPerLap &&
    row.degradationCI95[1] >= row.degradationSecondsPerLap &&
    finite(row.referencePositiveTeamSlopeMedian) && row.referencePositiveTeamSlopeMedian > 0);
  const degradationEvents = eventMeans(degradationRows, row => row.degradationSecondsPerLap! / row.referencePositiveTeamSlopeMedian!);
  const observedDegRatio = paceAvailable && degradationEvents.length >= H.minTeamEvents ? mean(degradationEvents.map(event => event.value)) : null;
  const paceSeconds = observedPaceSeconds === null ? P.neutralPaceSeconds : Math.min(H.maxTeamPaceSeconds, Math.max(-H.maxTeamPaceSeconds, observedPaceSeconds * H.teamPaceShrink));
  const degMultiplier = observedDegRatio === null ? P.neutralDeg : Math.min(P.teamDegMax, Math.max(P.teamDegMin, P.neutralDeg + (observedDegRatio - P.neutralDeg) * H.teamDegShrink));
  const laps = paceEvents.reduce((sum, event) => sum + event.laps, 0);
  return {
    id: teamId, paceSeconds, degMultiplier, pitCrewDeltaSeconds: P.neutralPitDeltaSeconds,
    observedPaceSeconds, observedDegRatio, pitStationarySeconds: null,
    source: {
      kind: paceAvailable ? "recent-observational" as const : "unavailable" as const,
      seasons: rows.length ? [season] : [], sourceTeamNames: [...new Set(rows.map(row => row.team))],
      events: paceEvents.length, laps, retainedLaps: rows.reduce((sum, row) => sum + row.laps, 0),
      currentSeasonCollected: season === recent.selection.currentSeason && rows.length > 0,
      stationaryPitCollected: false as const,
      eventIds: paceEvents.map(event => event.eventId), degradationEvents: degradationEvents.length,
      officialChartAvailable: false as const,
      aggregation: "event-equal-weight-after-within-event-lap-weighting" as const,
    },
    explanation: paceAvailable
      ? `${season}년 동컴파운드 관측 ${paceEvents.length}경기·${laps.toLocaleString("ko-KR")}유효랩을 경기별로 동등 가중한 뒤 프로젝트 축소율을 적용합니다. 선수·교통·운영 차이가 남습니다. 열화는 ${observedDegRatio === null ? `별도 ${H.minTeamEvents}경기 신뢰 기준 미달로 ${P.neutralDeg}배 중립` : `양의 신뢰구간과 ${H.minTeamEvents}경기 기준을 통과한 관측 비율에 프로젝트 축소·상한 적용`}입니다. 정차 교체 시간은 미분리이므로 피트크루 보정은 ${P.neutralPitDeltaSeconds}초입니다.`
      : `${season}년의 페이스 유효 관측 ${paceEvents.length}경기가 최소 ${H.minTeamEvents}경기 기준에 미달합니다. 페이스 0초·열화 1배·피트크루 0초 중립값을 사용하며 다른 연도나 공식 차트의 결측값을 섞지 않습니다.`,
  };
}

/** A displayed null is never replaced by the consumer's neutral runtime fallback. */
export function officialTeamPaceCoverage(teamId: string) {
  const observations = official.events.map(event => ({
    eventId: event.id, label: event.label, raceDate: event.raceDate,
    sourceUrl: event.source.url, status: event.availability,
    value: (event.teamPaceSeconds as Readonly<Record<string, number | null>>)[teamId] ?? null,
  }));
  return { observations, verifiedValues: observations.filter(row => finite(row.value)).length, requestedEvents: official.selection.requestedRaceCount };
}
