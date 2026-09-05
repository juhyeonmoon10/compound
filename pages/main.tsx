import { createRoot } from "react-dom/client";
import "../app/globals.css";
import "../app/strategy.css";
import StrategyLab from "../app/StrategyLab";
import { TRACK_PRESET_IDS, type TrackPresetId } from "../app/lib/strategy";

const requestedCircuit = new URLSearchParams(window.location.search).get("circuit");
const initialTrackId: TrackPresetId = requestedCircuit &&
  (TRACK_PRESET_IDS as readonly string[]).includes(requestedCircuit)
  ? requestedCircuit as TrackPresetId
  : "melbourne";

createRoot(document.getElementById("root")!).render(
  <StrategyLab initialTrackId={initialTrackId} />,
);
