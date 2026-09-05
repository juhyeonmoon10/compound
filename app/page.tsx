import StrategyLab from "./StrategyLab";
import {
  TRACK_PRESET_IDS,
  type TrackPresetId,
} from "./lib/strategy";

type HomeProps = {
  searchParams?: Promise<{
    circuit?: string | string[];
  }>;
};

function isTrackPresetId(value: string): value is TrackPresetId {
  return (TRACK_PRESET_IDS as readonly string[]).includes(value);
}

export default async function Home({ searchParams }: HomeProps) {
  const params = searchParams ? await searchParams : {};
  const requestedCircuit = Array.isArray(params.circuit)
    ? params.circuit[0]
    : params.circuit;
  const initialTrackId =
    requestedCircuit && isTrackPresetId(requestedCircuit)
      ? requestedCircuit
      : "melbourne";

  return <StrategyLab initialTrackId={initialTrackId} />;
}
