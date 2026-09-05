"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import * as THREE from "three";
import { publicAsset } from "./lib/public-assets";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  CIRCUIT_VISUAL_THEMES,
  type CircuitVisualTheme,
} from "./lib/circuit-visuals";
import type { DriverProfile, TeamProfile } from "./lib/participants";
import {
  F1_CAR_LENGTH_METERS,
  F1_CAR_WIDTH_METERS,
  FIA_STANDARD_TRACK_WIDTH_METERS,
  GRID_FRONT_OFFSET_METERS,
  GRID_LANE_OFFSET_METERS,
  circuitScaleForPolyline,
  gridSlotOffsetMeters,
  startGridVisualOffsetMeters,
  trackHalfWidthMetersAt,
} from "./lib/race-scene-dimensions";
import type {
  RaceGridCarFrame,
  RaceGridFrame,
} from "./lib/race-grid";
import type { StrategyRaceFrame } from "./lib/strategy-race";
import type { Compound, TrackPresetId } from "./lib/strategy";

export type RaceSceneCamera = "chase" | "cockpit" | "broadcast";
export type FormulaCarForwardAxis = "+z" | "-z" | "+x" | "-x";

export interface FormulaCarAsset {
  readonly url: string;
  readonly targetLengthMeters: number;
  readonly targetWidthMeters: number;
  readonly defaultForwardAxis: FormulaCarForwardAxis;
}

export const FORMULA_CAR_MODEL_ASSET = {
  url: publicAsset("/models/formula-car.glb"),
  targetLengthMeters: F1_CAR_LENGTH_METERS,
  targetWidthMeters: F1_CAR_WIDTH_METERS,
  defaultForwardAxis: "-x" as FormulaCarForwardAxis,
} as const satisfies FormulaCarAsset;

export const PLAYER_FORMULA_CAR_MODEL_ASSET = {
  url: publicAsset("/models/meshy-player-car.glb"),
  targetLengthMeters: F1_CAR_LENGTH_METERS,
  targetWidthMeters: F1_CAR_WIDTH_METERS,
  defaultForwardAxis: "+x" as FormulaCarForwardAxis,
} as const satisfies FormulaCarAsset;

export interface RaceScenePoint {
  readonly x: number;
  readonly y: number;
}

export interface RaceSceneGridVisual {
  readonly id: string;
  readonly color: string;
  readonly secondaryColor: string;
  readonly number: number;
  readonly isPlayer: boolean;
}

export interface RaceSceneTelemetry {
  readonly speedKph: number;
  readonly speed01: number;
  readonly signedTurn: number;
  readonly braking: number;
  readonly overtakePulse: number;
  readonly reducedMotion: boolean;
}

export interface RaceSceneHandle {
  update(
    frame: StrategyRaceFrame,
    camera: RaceSceneCamera,
    gridFrame?: RaceGridFrame,
    telemetry?: RaceSceneTelemetry,
  ): void;
}

interface RaceScene3DProps {
  readonly trackId: TrackPresetId;
  readonly samples: readonly RaceScenePoint[];
  readonly circuitLengthKm: number;
  readonly team: TeamProfile;
  readonly driver: DriverProfile;
  readonly gridVisuals?: readonly RaceSceneGridVisual[];
  readonly modelForwardAxis?: FormulaCarForwardAxis;
  readonly renderingEnabled?: boolean;
  readonly onAvailabilityChange?: (
    available: boolean,
    reason?: string,
  ) => void;
}

interface TrackPose {
  readonly position: THREE.Vector3;
  readonly tangent: THREE.Vector3;
  readonly normal: THREE.Vector3;
}

interface CarModel {
  readonly group: THREE.Group;
  readonly compoundBands: readonly THREE.MeshStandardMaterial[];
  readonly wheelRigs?: readonly FormulaWheelRig[];
  wheelTravelDistance: number;
}

interface FormulaCarBuildOptions {
  readonly primary: number;
  readonly secondary: number;
  readonly isPlayer: boolean;
  readonly ghost?: boolean;
  readonly forwardAxis: FormulaCarForwardAxis;
  readonly compoundBandGeometry: THREE.TorusGeometry;
  readonly targetLengthMeters: number;
  readonly targetWidthMeters: number;
  readonly addWheelCovers?: boolean;
}

interface FormulaWheelRig {
  readonly steeringPivot: THREE.Group;
  readonly spinPivot: THREE.Group;
  readonly isFront: boolean;
  readonly radius: number;
}

interface FormulaWheelCoverResult {
  readonly rigs: readonly FormulaWheelRig[];
  readonly positions: readonly THREE.Vector3[];
  readonly compoundBandScale: number;
}

interface GridCarModel extends CarModel {
  readonly id: string;
  readonly isPlayer: boolean;
}

interface GridCarGeometries {
  readonly chassis: THREE.BoxGeometry;
  readonly nose: THREE.BoxGeometry;
  readonly sidepods: THREE.BoxGeometry;
  readonly frontWing: THREE.BoxGeometry;
  readonly rearWing: THREE.BoxGeometry;
  readonly cockpit: THREE.SphereGeometry;
  readonly wheel: THREE.CylinderGeometry;
  readonly compoundBand: THREE.TorusGeometry;
}

interface GridFocus {
  readonly carFrame: RaceGridCarFrame;
  readonly pose: TrackPose;
}

interface RaceSceneRuntime {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly worldPoints: readonly THREE.Vector3[];
  readonly primaryCar: CarModel;
  readonly referenceCar: CarModel;
  readonly gridCars: ReadonlyMap<string, GridCarModel>;
  readonly playerGridCarId: string | null;
  readonly roadHalfWidth: number;
  readonly circuitLengthMeters: number;
  readonly sun: THREE.DirectionalLight;
  readonly sunTarget: THREE.Object3D;
  readonly sunOffset: THREE.Vector3;
  readonly resizeObserver: ResizeObserver;
  readonly cameraLookAt: THREE.Vector3;
  readonly cameraUp: THREE.Vector3;
  hasRendered: boolean;
  lastCameraMode: RaceSceneCamera | null;
  lastRenderMs: number | null;
  smoothedSpeedKph: number;
  lastFocusPosition: number | null;
  overtakePulse: number;
  lastModelElapsedSeconds: number | null;
}

const COMPOUND_COLORS: Readonly<Record<Compound, number>> = {
  S: 0xff3b45,
  M: 0xffd43b,
  H: 0xe9efec,
};

const TRACK_SAMPLE_STEP = 1;
const MOBILE_BREAKPOINT = 700;
const ROAD_SURFACE_HEIGHT = 0.06;
const PLAYER_GRID_CAR_RIDE_HEIGHT = 0.13;
const OPPONENT_GRID_CAR_RIDE_HEIGHT = ROAD_SURFACE_HEIGHT;
const OPPONENT_GRID_CAR_OPACITY = 0.3;
const OPPONENT_GRID_CAR_DETAIL_OPACITY = 0.36;
const OPPONENT_GRID_CAR_TYRE_OPACITY = 0.42;
const OPPONENT_GRID_CAR_BAND_OPACITY = 0.58;
const EMPTY_GRID_VISUALS: readonly RaceSceneGridVisual[] = [];
const PRIMARY_MATERIAL_PATTERN =
  /(?:body|bodywork|carpaint|chassis|livery|paint|primary)/i;
const SECONDARY_MATERIAL_PATTERN =
  /(?:accent|secondary|stripe|trim)/i;
const COMPOUND_MATERIAL_PATTERN =
  /(?:compound|sidewall.?band|tire.?band|tyre.?band)/i;
const NON_BODY_MATERIAL_PATTERN =
  /(?:brake|carbon|cockpit|driver|glass|halo|rim|rubber|suspension|tire|tyre|wheel|wing)/i;
const MODELVAULT_PRIMARY_MATERIALS = new Set([
  "Material.002",
  "Material.005",
]);
const MODELVAULT_SECONDARY_MATERIALS = new Set([
  "Material.003",
]);
const MODELVAULT_HIDDEN_MATERIALS = new Set([
  "Material.007",
  "Material.009",
]);
const SHARED_FORMULA_GEOMETRIES =
  new WeakSet<THREE.BufferGeometry>();
const formulaCarTemplatePromises = new Map<
  string,
  Promise<THREE.Group>
>();

function loadFormulaCarTemplate(
  asset: FormulaCarAsset,
): Promise<THREE.Group> {
  let templatePromise = formulaCarTemplatePromises.get(asset.url);
  if (!templatePromise) {
    const loader = new GLTFLoader();
    templatePromise = loader
      .loadAsync(asset.url)
      .then((gltf) => {
        let meshCount = 0;
        gltf.scene.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            meshCount += 1;
            if (!object.geometry.getAttribute("normal")) {
              object.geometry.computeVertexNormals();
            }
            SHARED_FORMULA_GEOMETRIES.add(object.geometry);
          }
        });
        if (meshCount === 0) {
          throw new Error("Formula car GLB does not contain a mesh.");
        }
        return gltf.scene;
      });
    formulaCarTemplatePromises.set(asset.url, templatePromise);
  }
  return templatePromise;
}

function hexToNumber(color: string): number {
  return Number.parseInt(color.replace("#", ""), 16);
}

function setGridCarVisibility(
  material: THREE.MeshStandardMaterial,
  isPlayer: boolean,
  opponentOpacity = OPPONENT_GRID_CAR_OPACITY,
): void {
  // Normal alpha blending avoids alphaHash grain without TAA. Keeping
  // depth writes enabled prevents GLB internals from reading as X-ray glass.
  material.opacity = isPlayer ? 1 : opponentOpacity;
  material.transparent = !isPlayer;
  material.depthWrite = true;
  material.depthTest = true;
  material.alphaHash = false;
  material.blending = THREE.NormalBlending;
  material.premultipliedAlpha = !isPlayer;
  material.needsUpdate = true;
}

function normalizeProgress(progress: number): number {
  return ((progress % 1) + 1) % 1;
}

function trackPoseAt(
  points: readonly THREE.Vector3[],
  progress: number,
  lateralOffset = 0,
): TrackPose {
  const normalized = normalizeProgress(progress);
  const scaled = normalized * points.length;
  const index = Math.floor(scaled) % points.length;
  const nextIndex = (index + 1) % points.length;
  const previousIndex =
    (index - 1 + points.length) % points.length;
  const mix = scaled - Math.floor(scaled);
  const position = new THREE.Vector3().lerpVectors(
    points[index],
    points[nextIndex],
    mix,
  );
  const tangent = new THREE.Vector3()
    .subVectors(points[nextIndex], points[previousIndex])
    .setY(0)
    .normalize();
  const normal = new THREE.Vector3(
    -tangent.z,
    0,
    tangent.x,
  ).normalize();
  position.addScaledVector(normal, lateralOffset);
  return { position, tangent, normal };
}

function signedTurnAt(
  points: readonly THREE.Vector3[],
  progress: number,
  span = 4,
): number {
  const epsilon = span / points.length;
  const before = trackPoseAt(points, progress - epsilon).tangent;
  const after = trackPoseAt(points, progress + epsilon).tangent;
  const beforeHeading = Math.atan2(before.x, before.z);
  const afterHeading = Math.atan2(after.x, after.z);
  return Math.atan2(
    Math.sin(afterHeading - beforeHeading),
    Math.cos(afterHeading - beforeHeading),
  );
}

function fallbackTelemetryAt(
  points: readonly THREE.Vector3[],
  progress: number,
): RaceSceneTelemetry {
  const signedTurn = signedTurnAt(points, progress, 3);
  const aheadTurn = signedTurnAt(
    points,
    progress + 6 / points.length,
    4,
  );
  const severity = THREE.MathUtils.clamp(
    Math.max(
      Math.abs(signedTurn),
      Math.abs(aheadTurn) * 0.9,
    ) / 0.48,
    0,
    1,
  );
  const easedSeverity =
    severity * severity * (3 - 2 * severity);
  const speedKph = Math.round(330 - 150 * easedSeverity);
  return {
    speedKph,
    speed01: THREE.MathUtils.clamp(
      (speedKph - 180) / 150,
      0,
      1,
    ),
    signedTurn,
    braking: THREE.MathUtils.clamp(
      (Math.abs(aheadTurn) -
        Math.abs(signedTurn) -
        0.015) /
        0.22,
      0,
      1,
    ),
    overtakePulse: 0,
    reducedMotion: false,
  };
}

function createAsphaltTexture(
  maximumAnisotropy: number,
  circuitLengthMeters: number,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (context) {
    const image = context.createImageData(
      canvas.width,
      canvas.height,
    );
    for (let index = 0; index < image.data.length; index += 4) {
      const pixelIndex = index / 4;
      const x = pixelIndex % canvas.width;
      const y = Math.floor(pixelIndex / canvas.width);
      const hash =
        Math.imul(x + 17, 374761393) ^
        Math.imul(y + 31, 668265263);
      const value = 224 + ((hash ^ (hash >>> 13)) & 23);
      image.data[index] = value;
      image.data[index + 1] = value;
      image.data[index + 2] = Math.min(255, value + 1);
      image.data[index + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    context.lineCap = "round";
    for (let index = 0; index < 14; index += 1) {
      const x = 18 + ((index * 53) % 220);
      const y = (index * 97) % 256;
      context.strokeStyle =
        index % 3 === 0
          ? "rgba(35, 38, 40, .11)"
          : "rgba(255, 255, 255, .08)";
      context.lineWidth = index % 4 === 0 ? 2 : 1;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(
        x + ((index * 7) % 9) - 4,
        Math.min(256, y + 34 + (index % 4) * 12),
      );
      context.stroke();
    }
    context.fillStyle = "rgba(28, 31, 33, .07)";
    context.fillRect(82, 0, 2, 256);
    context.fillRect(173, 0, 2, 256);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    1.5,
    Math.max(56, circuitLengthMeters / 12),
  );
  texture.anisotropy = Math.min(4, maximumAnisotropy);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function createBrakingBoardTexture(
  label: string,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 144;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#f7f7f2";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#111418";
    context.lineWidth = 8;
    context.strokeRect(5, 5, canvas.width - 10, canvas.height - 10);
    context.fillStyle = "#111418";
    context.font = "900 55px Arial, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label, canvas.width / 2, canvas.height / 2 + 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

type TrackHalfWidth =
  | number
  | ((progress: number) => number);

function resolveTrackHalfWidth(
  halfWidth: TrackHalfWidth,
  progress: number,
): number {
  return typeof halfWidth === "function"
    ? halfWidth(progress)
    : halfWidth;
}

function createRoadGeometry(
  points: readonly THREE.Vector3[],
  halfWidth: TrackHalfWidth,
  height = ROAD_SURFACE_HEIGHT,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let index = 0; index < points.length; index += 1) {
    const progress = index / points.length;
    const pose = trackPoseAt(points, progress);
    const currentHalfWidth = resolveTrackHalfWidth(
      halfWidth,
      progress,
    );
    const left = pose.position
      .clone()
      .addScaledVector(pose.normal, currentHalfWidth);
    const right = pose.position
      .clone()
      .addScaledVector(pose.normal, -currentHalfWidth);
    positions.push(left.x, height, left.z, right.x, height, right.z);
    uvs.push(0, index / points.length, 1, index / points.length);
  }

  for (let index = 0; index < points.length; index += 1) {
    const next = (index + 1) % points.length;
    const left = index * 2;
    const right = left + 1;
    const nextLeft = next * 2;
    const nextRight = nextLeft + 1;
    indices.push(
      left,
      nextLeft,
      right,
      right,
      nextLeft,
      nextRight,
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute(
    "uv",
    new THREE.Float32BufferAttribute(uvs, 2),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createKerbGeometry(
  points: readonly THREE.Vector3[],
  halfWidth: TrackHalfWidth,
  firstColor: number,
  secondColor: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const colorA = new THREE.Color(firstColor);
  const colorB = new THREE.Color(secondColor);
  let cumulativeDistance = 0;

  for (let index = 0; index < points.length; index += 1) {
    const nextIndex = (index + 1) % points.length;
    const currentPose = trackPoseAt(points, index / points.length);
    const nextPose = trackPoseAt(
      points,
      nextIndex / points.length,
    );
    const currentHalfWidth = resolveTrackHalfWidth(
      halfWidth,
      index / points.length,
    );
    const nextHalfWidth = resolveTrackHalfWidth(
      halfWidth,
      nextIndex / points.length,
    );
    const kerbColor =
      Math.floor(cumulativeDistance / 4.5) % 2 === 0
        ? colorA
        : colorB;

    for (const side of [-1, 1] as const) {
      const innerCurrent = currentPose.position
        .clone()
        .addScaledVector(
          currentPose.normal,
          currentHalfWidth * side,
        );
      const outerCurrent = currentPose.position
        .clone()
        .addScaledVector(
          currentPose.normal,
          (currentHalfWidth + 0.82) * side,
        );
      const innerNext = nextPose.position
        .clone()
        .addScaledVector(
          nextPose.normal,
          nextHalfWidth * side,
        );
      const outerNext = nextPose.position
        .clone()
        .addScaledVector(
          nextPose.normal,
          (nextHalfWidth + 0.82) * side,
        );
      const baseIndex = positions.length / 3;

      for (const point of [
        innerCurrent,
        outerCurrent,
        innerNext,
        outerNext,
      ]) {
        positions.push(point.x, 0.095, point.z);
        colors.push(kerbColor.r, kerbColor.g, kerbColor.b);
      }
      if (side === 1) {
        indices.push(
          baseIndex,
          baseIndex + 1,
          baseIndex + 2,
          baseIndex + 1,
          baseIndex + 3,
          baseIndex + 2,
        );
      } else {
        indices.push(
          baseIndex,
          baseIndex + 2,
          baseIndex + 1,
          baseIndex + 1,
          baseIndex + 2,
          baseIndex + 3,
        );
      }
    }
    cumulativeDistance += currentPose.position.distanceTo(
      nextPose.position,
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(colors, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createTrackEdgeGeometry(
  points: readonly THREE.Vector3[],
  innerOffset: TrackHalfWidth,
  outerOffset: TrackHalfWidth,
  height: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];

  for (let index = 0; index < points.length; index += 1) {
    const nextIndex = (index + 1) % points.length;
    const currentPose = trackPoseAt(points, index / points.length);
    const nextPose = trackPoseAt(
      points,
      nextIndex / points.length,
    );
    const currentProgress = index / points.length;
    const nextProgress = nextIndex / points.length;
    const currentInnerOffset = resolveTrackHalfWidth(
      innerOffset,
      currentProgress,
    );
    const currentOuterOffset = resolveTrackHalfWidth(
      outerOffset,
      currentProgress,
    );
    const nextInnerOffset = resolveTrackHalfWidth(
      innerOffset,
      nextProgress,
    );
    const nextOuterOffset = resolveTrackHalfWidth(
      outerOffset,
      nextProgress,
    );

    for (const side of [-1, 1] as const) {
      const innerCurrent = currentPose.position
        .clone()
        .addScaledVector(
          currentPose.normal,
          currentInnerOffset * side,
        );
      const outerCurrent = currentPose.position
        .clone()
        .addScaledVector(
          currentPose.normal,
          currentOuterOffset * side,
        );
      const innerNext = nextPose.position
        .clone()
        .addScaledVector(
          nextPose.normal,
          nextInnerOffset * side,
        );
      const outerNext = nextPose.position
        .clone()
        .addScaledVector(
          nextPose.normal,
          nextOuterOffset * side,
        );
      const baseIndex = positions.length / 3;
      positions.push(
        innerCurrent.x,
        height,
        innerCurrent.z,
        outerCurrent.x,
        height,
        outerCurrent.z,
        innerNext.x,
        height,
        innerNext.z,
        outerNext.x,
        height,
        outerNext.z,
      );
      if (side === 1) {
        indices.push(
          baseIndex,
          baseIndex + 1,
          baseIndex + 2,
          baseIndex + 1,
          baseIndex + 3,
          baseIndex + 2,
        );
      } else {
        indices.push(
          baseIndex,
          baseIndex + 2,
          baseIndex + 1,
          baseIndex + 1,
          baseIndex + 2,
          baseIndex + 3,
        );
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function addBox(
  group: THREE.Group,
  geometry: THREE.BoxGeometry,
  material: THREE.Material,
  position: [number, number, number],
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function addSceneryMesh(
  group: THREE.Group,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number],
  castShadow = false,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function tracksidePose(
  points: readonly THREE.Vector3[],
  progress: number,
  side: -1 | 1,
  offset: number,
): { readonly position: THREE.Vector3; readonly yaw: number } {
  const pose = trackPoseAt(points, progress);
  return {
    position: pose.position
      .clone()
      .addScaledVector(pose.normal, side * offset),
    yaw: Math.atan2(pose.tangent.x, pose.tangent.z),
  };
}

function createGrandstands(
  points: readonly THREE.Vector3[],
  roadHalfWidth: number,
  theme: CircuitVisualTheme,
): THREE.Group {
  const root = new THREE.Group();
  const anchorCount = theme.grandstandAnchors.length;
  const seatGeometry = new THREE.BoxGeometry(2.7, 0.82, 17);
  const crowdGeometry = new THREE.BoxGeometry(0.42, 0.5, 15.2);
  const canopyGeometry = new THREE.BoxGeometry(7.3, 0.34, 19);
  const seatMaterial = new THREE.MeshStandardMaterial({
    color: theme.grandstand,
    roughness: 0.88,
  });
  const crowdMaterial = new THREE.MeshStandardMaterial({
    color: theme.accent,
    emissive: theme.lighting === "night" ? theme.accent : 0x000000,
    emissiveIntensity: theme.lighting === "night" ? 0.16 : 0,
    roughness: 0.95,
  });
  const canopyMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(theme.grandstand)
      .offsetHSL(0, -0.08, 0.1),
    roughness: 0.62,
    metalness: 0.24,
  });
  const seats = new THREE.InstancedMesh(
    seatGeometry,
    seatMaterial,
    anchorCount * 3,
  );
  const crowds = new THREE.InstancedMesh(
    crowdGeometry,
    crowdMaterial,
    anchorCount * 3,
  );
  const canopies = new THREE.InstancedMesh(
    canopyGeometry,
    canopyMaterial,
    anchorCount,
  );
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const crowdPosition = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const rotationAxis = new THREE.Vector3(0, 1, 0);
  const scale = new THREE.Vector3();
  let seatIndex = 0;

  theme.grandstandAnchors.forEach(
    ([progress, side, anchorScale], anchorIndex) => {
      const pose = trackPoseAt(points, progress);
      quaternion.setFromAxisAngle(
        rotationAxis,
        Math.atan2(pose.tangent.x, pose.tangent.z),
      );
      for (let step = 0; step < 3; step += 1) {
        position
          .copy(pose.position)
          .addScaledVector(
            pose.normal,
            side *
              (roadHalfWidth + 7.1 + step * 1.75),
          );
        position.y = 0.52 + step * 0.82;
        scale.set(
          anchorScale,
          anchorScale,
          anchorScale,
        );
        matrix.compose(position, quaternion, scale);
        seats.setMatrixAt(seatIndex, matrix);

        crowdPosition
          .copy(position)
          .addScaledVector(pose.normal, -side * 0.75);
        crowdPosition.y += 0.66 * anchorScale;
        matrix.compose(crowdPosition, quaternion, scale);
        crowds.setMatrixAt(seatIndex, matrix);
        seatIndex += 1;
      }

      position
        .copy(pose.position)
        .addScaledVector(
          pose.normal,
          side * (roadHalfWidth + 10.35),
        );
      position.y = 4.25 * anchorScale;
      scale.set(anchorScale, anchorScale, anchorScale);
      matrix.compose(position, quaternion, scale);
      canopies.setMatrixAt(anchorIndex, matrix);
    },
  );

  seats.instanceMatrix.needsUpdate = true;
  crowds.instanceMatrix.needsUpdate = true;
  canopies.instanceMatrix.needsUpdate = true;
  seats.receiveShadow = true;
  canopies.receiveShadow = true;
  root.add(seats, crowds, canopies);
  return root;
}

function createVenueBuildings(
  points: readonly THREE.Vector3[],
  roadHalfWidth: number,
  theme: CircuitVisualTheme,
): THREE.Group {
  const root = new THREE.Group();
  const showSkyline =
    theme.setting === "street" ||
    theme.setting === "marina" ||
    theme.setting === "stadium" ||
    theme.landmark === "sphere" ||
    theme.landmark === "city-walls" ||
    theme.landmark === "hotel";
  if (!showSkyline) return root;

  const step = 24;
  const count = Math.ceil(points.length / step);
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const roofGeometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({
    color: theme.building,
    emissive:
      theme.lighting === "night" ? theme.building : 0x000000,
    emissiveIntensity: theme.lighting === "night" ? 0.12 : 0,
    roughness: 0.78,
    metalness: 0.08,
  });
  const roofMaterial = new THREE.MeshStandardMaterial({
    color: theme.accent,
    emissive: theme.accent,
    emissiveIntensity: theme.lighting === "night" ? 0.7 : 0.08,
    roughness: 0.58,
  });
  const buildings = new THREE.InstancedMesh(
    geometry,
    material,
    count,
  );
  const roofs = new THREE.InstancedMesh(
    roofGeometry,
    roofMaterial,
    count,
  );
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const rotationAxis = new THREE.Vector3(0, 1, 0);
  const scale = new THREE.Vector3();
  let buildingIndex = 0;

  for (let index = 0; index < points.length; index += step) {
    const pose = trackPoseAt(points, index / points.length);
    const side = buildingIndex % 2 === 0 ? 1 : -1;
    const width = 6 + (buildingIndex % 4) * 2.2;
    const depth = 7 + (buildingIndex % 3) * 3.1;
    const height =
      9 + ((buildingIndex * 7) % 19);
    position
      .copy(pose.position)
      .addScaledVector(
        pose.normal,
        side *
          (roadHalfWidth + 24 + ((buildingIndex * 5) % 15)),
      );
    position.y = height / 2;
    quaternion.setFromAxisAngle(
      rotationAxis,
      Math.atan2(pose.tangent.x, pose.tangent.z),
    );
    scale.set(width, height, depth);
    matrix.compose(position, quaternion, scale);
    buildings.setMatrixAt(buildingIndex, matrix);

    position.y = height + 0.22;
    scale.set(width * 1.04, 0.35, depth * 1.04);
    matrix.compose(position, quaternion, scale);
    roofs.setMatrixAt(buildingIndex, matrix);
    buildingIndex += 1;
  }

  buildings.count = buildingIndex;
  roofs.count = buildingIndex;
  buildings.instanceMatrix.needsUpdate = true;
  roofs.instanceMatrix.needsUpdate = true;
  buildings.receiveShadow = true;
  root.add(buildings, roofs);
  return root;
}

function createPitComplex(
  points: readonly THREE.Vector3[],
  roadHalfWidth: number,
  theme: CircuitVisualTheme,
): THREE.Group {
  const pose = trackPoseAt(points, 0.018);
  const root = new THREE.Group();
  root.position.copy(pose.position);
  root.rotation.y = Math.atan2(
    pose.tangent.x,
    pose.tangent.z,
  );

  const buildingMaterial = new THREE.MeshStandardMaterial({
    color: theme.building,
    emissive:
      theme.lighting === "night" ? theme.building : 0x000000,
    emissiveIntensity: theme.lighting === "night" ? 0.1 : 0,
    roughness: 0.72,
    metalness: 0.12,
  });
  const roofMaterial = new THREE.MeshStandardMaterial({
    color: theme.grandstand,
    roughness: 0.62,
    metalness: 0.32,
  });
  const garageMaterial = new THREE.MeshStandardMaterial({
    color: 0x20262b,
    emissive: theme.accent,
    emissiveIntensity: theme.lighting === "night" ? 0.22 : 0.03,
    roughness: 0.55,
    metalness: 0.24,
  });
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: theme.barrier,
    roughness: 0.76,
  });
  const buildingX = roadHalfWidth + 8.1;

  addSceneryMesh(
    root,
    new THREE.BoxGeometry(7.2, 5.4, 34),
    buildingMaterial,
    [buildingX, 2.7, 5],
    true,
  );
  addSceneryMesh(
    root,
    new THREE.BoxGeometry(8.2, 0.38, 35),
    roofMaterial,
    [buildingX, 5.55, 5],
  );
  addSceneryMesh(
    root,
    new THREE.BoxGeometry(0.38, 1.05, 37),
    wallMaterial,
    [roadHalfWidth + 1.2, 0.54, 4],
  );
  addSceneryMesh(
    root,
    new THREE.BoxGeometry(3.8, 8.2, 4.8),
    buildingMaterial,
    [buildingX + 0.7, 4.1, -13],
  );

  const garageGeometry = new THREE.BoxGeometry(0.14, 2.35, 3.5);
  const garages = new THREE.InstancedMesh(
    garageGeometry,
    garageMaterial,
    8,
  );
  const matrix = new THREE.Matrix4();
  for (let index = 0; index < 8; index += 1) {
    matrix.makeTranslation(
      roadHalfWidth + 4.48,
      1.25,
      -8.5 + index * 3.85,
    );
    garages.setMatrixAt(index, matrix);
  }
  garages.instanceMatrix.needsUpdate = true;
  root.add(garages);
  return root;
}

function createFloodlights(
  points: readonly THREE.Vector3[],
  roadHalfWidth: number,
  theme: CircuitVisualTheme,
): THREE.Group {
  const root = new THREE.Group();
  if (theme.lighting !== "night") return root;

  const step = 18;
  const count = Math.ceil(points.length / step);
  const mastGeometry = new THREE.CylinderGeometry(
    0.12,
    0.18,
    7.5,
    6,
  );
  const lampGeometry = new THREE.BoxGeometry(1.35, 0.28, 0.48);
  const mastMaterial = new THREE.MeshStandardMaterial({
    color: 0x606c72,
    roughness: 0.48,
    metalness: 0.7,
  });
  const lampMaterial = new THREE.MeshStandardMaterial({
    color: 0xf7f2d9,
    emissive: 0xfff4cd,
    emissiveIntensity: 2.8,
    roughness: 0.4,
  });
  const masts = new THREE.InstancedMesh(
    mastGeometry,
    mastMaterial,
    count,
  );
  const lamps = new THREE.InstancedMesh(
    lampGeometry,
    lampMaterial,
    count,
  );
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const rotationAxis = new THREE.Vector3(0, 1, 0);
  const scale = new THREE.Vector3(1, 1, 1);
  let lightIndex = 0;

  for (let index = 0; index < points.length; index += step) {
    const pose = trackPoseAt(points, index / points.length);
    const side = lightIndex % 2 === 0 ? 1 : -1;
    position
      .copy(pose.position)
      .addScaledVector(
        pose.normal,
        side * (roadHalfWidth + 5.7),
      );
    position.y = 3.75;
    matrix.compose(
      position,
      new THREE.Quaternion(),
      scale,
    );
    masts.setMatrixAt(lightIndex, matrix);

    position.y = 7.55;
    quaternion.setFromAxisAngle(
      rotationAxis,
      Math.atan2(pose.tangent.x, pose.tangent.z),
    );
    matrix.compose(position, quaternion, scale);
    lamps.setMatrixAt(lightIndex, matrix);
    lightIndex += 1;
  }

  masts.count = lightIndex;
  lamps.count = lightIndex;
  masts.instanceMatrix.needsUpdate = true;
  lamps.instanceMatrix.needsUpdate = true;
  root.add(masts, lamps);
  return root;
}

function createBrakingBoards(
  points: readonly THREE.Vector3[],
  roadHalfWidth: number,
  theme: CircuitVisualTheme,
): THREE.Group {
  const root = new THREE.Group();
  const progressMarks = [0.16, 0.18, 0.2, 0.49, 0.51, 0.53];
  const labels = ["150", "100", "50", "150", "100", "50"];
  const panelGeometry = new THREE.BoxGeometry(1.05, 1.25, 0.12);
  const labelGeometry = new THREE.PlaneGeometry(0.9, 1.06);
  const postGeometry = new THREE.CylinderGeometry(
    0.06,
    0.08,
    1.9,
    5,
  );
  const panelMaterial = new THREE.MeshStandardMaterial({
    color: 0xf4f4ef,
    emissive: theme.lighting === "night" ? 0xffffff : 0x000000,
    emissiveIntensity: theme.lighting === "night" ? 0.25 : 0,
    roughness: 0.72,
  });
  const postMaterial = new THREE.MeshStandardMaterial({
    color: 0x292f33,
    roughness: 0.65,
    metalness: 0.4,
  });
  const labelTextures = ["150", "100", "50"].map(
    createBrakingBoardTexture,
  );
  const labelMaterials = labelTextures.map(
    (texture) =>
      new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
  );
  const panels = new THREE.InstancedMesh(
    panelGeometry,
    panelMaterial,
    progressMarks.length,
  );
  const posts = new THREE.InstancedMesh(
    postGeometry,
    postMaterial,
    progressMarks.length,
  );
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const rotationAxis = new THREE.Vector3(0, 1, 0);
  const scale = new THREE.Vector3(1, 1, 1);
  const boardOffset =
    roadHalfWidth +
    (theme.setting === "street" || theme.setting === "marina"
      ? 2.05
      : 4.8);

  progressMarks.forEach((progress, index) => {
    const pose = trackPoseAt(points, progress);
    const side = index < 3 ? 1 : -1;
    position
      .copy(pose.position)
      .addScaledVector(
        pose.normal,
        side * boardOffset,
      );
    position.y = 1.72;
    quaternion.setFromAxisAngle(
      rotationAxis,
      Math.atan2(pose.tangent.x, pose.tangent.z),
    );
    matrix.compose(position, quaternion, scale);
    panels.setMatrixAt(index, matrix);

    const label = new THREE.Mesh(
      labelGeometry,
      labelMaterials[
        labels[index] === "150"
          ? 0
          : labels[index] === "100"
            ? 1
            : 2
      ],
    );
    label.position
      .copy(position)
      .addScaledVector(pose.tangent, -0.066);
    label.quaternion.copy(quaternion);
    label.renderOrder = 2;
    root.add(label);

    position.y = 0.95;
    matrix.compose(
      position,
      new THREE.Quaternion(),
      scale,
    );
    posts.setMatrixAt(index, matrix);
  });

  panels.instanceMatrix.needsUpdate = true;
  posts.instanceMatrix.needsUpdate = true;
  root.userData.ownedTextures = labelTextures;
  root.add(panels, posts);
  return root;
}

function createCircuitLandmark(
  points: readonly THREE.Vector3[],
  roadHalfWidth: number,
  theme: CircuitVisualTheme,
): THREE.Group {
  const root = new THREE.Group();
  if (theme.landmark === "none") return root;

  const landmarkPose = tracksidePose(
    points,
    0.58,
    -1,
    roadHalfWidth + 30,
  );
  root.position.copy(landmarkPose.position);
  root.rotation.y = landmarkPose.yaw;

  const structureMaterial = new THREE.MeshStandardMaterial({
    color: theme.building,
    emissive:
      theme.lighting === "night" ? theme.building : 0x000000,
    emissiveIntensity: theme.lighting === "night" ? 0.15 : 0,
    roughness: 0.68,
    metalness: 0.12,
  });
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: theme.accent,
    emissive: theme.accent,
    emissiveIntensity: theme.lighting === "night" ? 1.1 : 0.12,
    roughness: 0.5,
    metalness: 0.18,
  });
  const hasWater =
    theme.landmark === "lake" ||
    theme.landmark === "marina" ||
    theme.landmark === "hotel";
  const waterMaterial = hasWater
    ? new THREE.MeshStandardMaterial({
        color: 0x176a82,
        emissive:
          theme.lighting === "night" ? 0x0b3245 : 0x000000,
        emissiveIntensity: 0.18,
        roughness: 0.32,
        metalness: 0.18,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      })
    : null;

  if (
    waterMaterial &&
    (theme.landmark === "lake" ||
      theme.landmark === "marina")
  ) {
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(48, 28),
      waterMaterial,
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.015;
    root.add(water);
  }

  switch (theme.landmark) {
    case "lake": {
      addSceneryMesh(
        root,
        new THREE.BoxGeometry(12, 4.5, 7),
        structureMaterial,
        [6, 2.25, -4],
      );
      break;
    }
    case "marina": {
      const hullGeometry = new THREE.BoxGeometry(1.4, 0.5, 4.6);
      const mastGeometry = new THREE.CylinderGeometry(
        0.05,
        0.08,
        3.8,
        5,
      );
      for (let index = 0; index < 4; index += 1) {
        const hull = addSceneryMesh(
          root,
          hullGeometry,
          structureMaterial,
          [-10 + index * 6.2, 0.35, -5 + (index % 2) * 8],
        );
        hull.rotation.y = index % 2 === 0 ? 0.2 : -0.25;
        addSceneryMesh(
          root,
          mastGeometry,
          accentMaterial,
          [-10 + index * 6.2, 2.2, -5 + (index % 2) * 8],
        );
      }
      break;
    }
    case "ferris-wheel": {
      const wheel = new THREE.Mesh(
        new THREE.TorusGeometry(8, 0.32, 8, 32),
        accentMaterial,
      );
      wheel.position.y = 9.2;
      root.add(wheel);
      const spokeGeometry = new THREE.BoxGeometry(0.13, 15.2, 0.13);
      for (let index = 0; index < 4; index += 1) {
        const spoke = addSceneryMesh(
          root,
          spokeGeometry,
          structureMaterial,
          [0, 9.2, 0],
        );
        spoke.rotation.z = index * (Math.PI / 4);
      }
      const leftSupport = addSceneryMesh(
        root,
        new THREE.BoxGeometry(0.42, 8.8, 0.42),
        structureMaterial,
        [-3.1, 3.8, 0],
      );
      leftSupport.rotation.z = -0.28;
      const rightSupport = addSceneryMesh(
        root,
        new THREE.BoxGeometry(0.42, 8.8, 0.42),
        structureMaterial,
        [3.1, 3.8, 0],
      );
      rightSupport.rotation.z = 0.28;
      break;
    }
    case "tower": {
      const tower = addSceneryMesh(
        root,
        new THREE.CylinderGeometry(1.1, 1.7, 18, 7),
        structureMaterial,
        [0, 9, 0],
      );
      tower.rotation.z = -0.06;
      const blade = addSceneryMesh(
        root,
        new THREE.BoxGeometry(1.3, 19, 0.7),
        accentMaterial,
        [2.8, 10.5, 0],
      );
      blade.rotation.z = -0.2;
      addSceneryMesh(
        root,
        new THREE.BoxGeometry(8.5, 1.1, 4.8),
        structureMaterial,
        [0, 17.5, 0],
      );
      break;
    }
    case "stadium": {
      for (let step = 0; step < 4; step += 1) {
        addSceneryMesh(
          root,
          new THREE.BoxGeometry(3.2, 1, 30 - step * 2),
          step % 2 === 0 ? structureMaterial : accentMaterial,
          [step * 2.1, 0.55 + step * 0.85, 0],
        );
      }
      addSceneryMesh(
        root,
        new THREE.BoxGeometry(10, 0.5, 33),
        structureMaterial,
        [7.2, 5.5, 0],
      );
      break;
    }
    case "sphere": {
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(8.4, 18, 14),
        accentMaterial,
      );
      sphere.position.y = 9;
      root.add(sphere);
      addSceneryMesh(
        root,
        new THREE.CylinderGeometry(5.5, 6.5, 2.5, 16),
        structureMaterial,
        [0, 1.25, 0],
      );
      break;
    }
    case "city-walls": {
      addSceneryMesh(
        root,
        new THREE.BoxGeometry(4.2, 7.5, 32),
        structureMaterial,
        [0, 3.75, 0],
      );
      for (const z of [-13, 0, 13]) {
        addSceneryMesh(
          root,
          new THREE.CylinderGeometry(3.2, 3.7, 11, 8),
          structureMaterial,
          [0, 5.5, z],
        );
      }
      break;
    }
    case "mountains": {
      const mountainMaterial = new THREE.MeshStandardMaterial({
        color: new THREE.Color(theme.ground)
          .offsetHSL(0, -0.04, -0.08),
        roughness: 1,
      });
      for (let index = 0; index < 5; index += 1) {
        const height = 22 + (index % 3) * 8;
        addSceneryMesh(
          root,
          new THREE.ConeGeometry(
            15 + (index % 2) * 5,
            height,
            7,
          ),
          mountainMaterial,
          [
            35 + (index % 2) * 10,
            height / 2 - 0.2,
            -46 + index * 23,
          ],
        );
      }
      break;
    }
    case "hotel": {
      if (!waterMaterial) break;
      const water = new THREE.Mesh(
        new THREE.PlaneGeometry(45, 26),
        waterMaterial,
      );
      water.rotation.x = -Math.PI / 2;
      water.position.y = 0.015;
      root.add(water);
      addSceneryMesh(
        root,
        new THREE.BoxGeometry(5.5, 15, 8),
        structureMaterial,
        [-8, 7.5, 0],
      );
      addSceneryMesh(
        root,
        new THREE.BoxGeometry(5.5, 15, 8),
        structureMaterial,
        [8, 7.5, 0],
      );
      addSceneryMesh(
        root,
        new THREE.BoxGeometry(12, 3.2, 8),
        accentMaterial,
        [0, 10.5, 0],
      );
      break;
    }
  }

  return root;
}

function normalizeCarFootprint(
  group: THREE.Group,
  targetLengthMeters: number,
  targetWidthMeters: number,
): number {
  group.updateMatrixWorld(true);
  const rawBounds = new THREE.Box3().setFromObject(group);
  const rawSize = rawBounds.getSize(new THREE.Vector3());
  if (
    rawBounds.isEmpty() ||
    !Number.isFinite(rawSize.x) ||
    !Number.isFinite(rawSize.z) ||
    rawSize.x <= 0.01 ||
    rawSize.z <= 0.01
  ) {
    throw new Error("Formula car geometry has invalid bounds.");
  }

  const uniformScale = targetLengthMeters / rawSize.z;
  group.scale.setScalar(uniformScale);
  group.updateMatrixWorld(true);
  const scaledWidth = new THREE.Box3()
    .setFromObject(group)
    .getSize(new THREE.Vector3()).x;
  group.scale.x *= targetWidthMeters / scaledWidth;
  group.updateMatrixWorld(true);
  return uniformScale;
}

function normalizeCarWidth(
  group: THREE.Group,
  targetWidthMeters: number,
): void {
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group);
  const width = bounds.getSize(new THREE.Vector3()).x;
  if (
    bounds.isEmpty() ||
    !Number.isFinite(width) ||
    width <= 0.01
  ) {
    throw new Error("Formula car geometry has invalid width.");
  }
  group.scale.x *= targetWidthMeters / width;
  group.updateMatrixWorld(true);
}

function createF1Car(
  primary: number,
  secondary: number,
  ghost = false,
): CarModel {
  const group = new THREE.Group();
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: primary,
    roughness: 0.48,
    metalness: 0.22,
    transparent: ghost,
    opacity: ghost ? 0.74 : 1,
  });
  const secondaryMaterial = new THREE.MeshStandardMaterial({
    color: secondary,
    roughness: 0.52,
    metalness: 0.18,
    transparent: ghost,
    opacity: ghost ? 0.68 : 1,
  });
  const carbonMaterial = new THREE.MeshStandardMaterial({
    color: ghost ? 0x173d3a : 0x080a0b,
    roughness: 0.72,
    metalness: 0.1,
    transparent: ghost,
    opacity: ghost ? 0.7 : 1,
  });
  if (ghost) {
    setGridCarVisibility(bodyMaterial, false);
    setGridCarVisibility(secondaryMaterial, false);
    setGridCarVisibility(
      carbonMaterial,
      false,
      OPPONENT_GRID_CAR_DETAIL_OPACITY,
    );
  }

  addBox(
    group,
    new THREE.BoxGeometry(1.5, 0.52, 3.8),
    bodyMaterial,
    [0, 0.64, 0],
  );
  addBox(
    group,
    new THREE.BoxGeometry(0.58, 0.3, 2.7),
    bodyMaterial,
    [0, 0.53, 2.85],
  );
  addBox(
    group,
    new THREE.BoxGeometry(2.65, 0.5, 1.75),
    secondaryMaterial,
    [0, 0.56, -0.35],
  );
  addBox(
    group,
    new THREE.BoxGeometry(3.45, 0.13, 0.58),
    carbonMaterial,
    [0, 0.35, 4.05],
  );
  addBox(
    group,
    new THREE.BoxGeometry(2.5, 0.18, 0.52),
    carbonMaterial,
    [0, 1.45, -2.15],
  );
  addBox(
    group,
    new THREE.BoxGeometry(0.16, 1.05, 0.45),
    carbonMaterial,
    [-1, 0.95, -2.15],
  );
  addBox(
    group,
    new THREE.BoxGeometry(0.16, 1.05, 0.45),
    carbonMaterial,
    [1, 0.95, -2.15],
  );

  const cockpit = new THREE.Mesh(
    new THREE.SphereGeometry(0.52, 14, 8),
    carbonMaterial,
  );
  cockpit.scale.set(0.8, 0.65, 1.25);
  cockpit.position.set(0, 1.02, 0.05);
  cockpit.castShadow = true;
  group.add(cockpit);

  const wheelGeometry = new THREE.CylinderGeometry(
    0.57,
    0.57,
    0.44,
    18,
  );
  const tyreMaterial = new THREE.MeshStandardMaterial({
    color: 0x090a0b,
    roughness: 0.94,
  });
  if (ghost) {
    setGridCarVisibility(
      tyreMaterial,
      false,
      OPPONENT_GRID_CAR_TYRE_OPACITY,
    );
  }
  const compoundBands: THREE.MeshStandardMaterial[] = [];
  const wheelRigs: FormulaWheelRig[] = [];

  for (const z of [-1.35, 1.55]) {
    for (const x of [-1.38, 1.38]) {
      const steeringPivot = new THREE.Group();
      steeringPivot.position.set(x, 0.54, z);
      const spinPivot = new THREE.Group();
      const wheel = new THREE.Mesh(wheelGeometry, tyreMaterial);
      wheel.rotation.z = Math.PI / 2;
      wheel.castShadow = true;
      spinPivot.add(wheel);

      const bandMaterial = new THREE.MeshStandardMaterial({
        color: COMPOUND_COLORS.M,
        emissive: COMPOUND_COLORS.M,
        emissiveIntensity: ghost ? 0.24 : 0.12,
        roughness: 0.65,
        transparent: ghost,
        opacity: ghost ? 0.76 : 1,
      });
      if (ghost) {
        setGridCarVisibility(
          bandMaterial,
          false,
          OPPONENT_GRID_CAR_BAND_OPACITY,
        );
      }
      const band = new THREE.Mesh(
        new THREE.TorusGeometry(0.41, 0.055, 8, 20),
        bandMaterial,
      );
      band.rotation.y = Math.PI / 2;
      band.position.x = x > 0 ? 0.235 : -0.235;
      spinPivot.add(band);
      steeringPivot.add(spinPivot);
      group.add(steeringPivot);
      wheelRigs.push({
        steeringPivot,
        spinPivot,
        isFront: z > 0,
        radius: 0.57,
      });
      compoundBands.push(bandMaterial);
    }
  }

  const uniformScale = normalizeCarFootprint(
    group,
    F1_CAR_LENGTH_METERS,
    F1_CAR_WIDTH_METERS,
  );

  if (ghost) {
    const labelCanvas = document.createElement("canvas");
    labelCanvas.width = 128;
    labelCanvas.height = 64;
    const labelContext = labelCanvas.getContext("2d");
    if (labelContext) {
      labelContext.fillStyle = "rgba(18, 49, 47, .92)";
      labelContext.fillRect(3, 3, 122, 58);
      labelContext.strokeStyle = "#73f1e0";
      labelContext.lineWidth = 4;
      labelContext.strokeRect(3, 3, 122, 58);
      labelContext.fillStyle = "#ffffff";
      labelContext.font = "900 34px Arial";
      labelContext.textAlign = "center";
      labelContext.textBaseline = "middle";
      labelContext.fillText("BEST", 64, 34);
    }
    const labelTexture = new THREE.CanvasTexture(labelCanvas);
    labelTexture.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: labelTexture,
        transparent: true,
        depthWrite: false,
      }),
    );
    label.position.set(0, 2.55, 0);
    label.scale.set(3.4, 1.7, 1);
    group.add(label);
  }

  return {
    group,
    compoundBands,
    wheelRigs: wheelRigs.map((wheel) => ({
      ...wheel,
      radius: wheel.radius * uniformScale,
    })),
    wheelTravelDistance: 0,
  };
}

function createGridCarGeometries(): GridCarGeometries {
  return {
    chassis: new THREE.BoxGeometry(1.22, 0.4, 3.15),
    nose: new THREE.BoxGeometry(0.42, 0.22, 2.05),
    sidepods: new THREE.BoxGeometry(0.64, 0.34, 1.38),
    frontWing: new THREE.BoxGeometry(2.78, 0.1, 0.42),
    rearWing: new THREE.BoxGeometry(2.08, 0.14, 0.42),
    cockpit: new THREE.SphereGeometry(0.4, 8, 5),
    wheel: new THREE.CylinderGeometry(0.43, 0.43, 0.3, 10),
    compoundBand: new THREE.TorusGeometry(0.31, 0.045, 5, 10),
  };
}

function addGridPart(
  group: THREE.Group,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number],
  desktopShadow: boolean,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.castShadow = desktopShadow;
  mesh.receiveShadow = true;
  mesh.userData.desktopShadow = desktopShadow;
  group.add(mesh);
  return mesh;
}

function createGridCar(
  visual: RaceSceneGridVisual,
  geometries: GridCarGeometries,
): GridCarModel {
  const group = new THREE.Group();
  const primary = hexToNumber(visual.color);
  const secondary = hexToNumber(visual.secondaryColor);
  const playerGlow = visual.isPlayer ? 0.1 : 0.025;
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: primary,
    emissive: primary,
    emissiveIntensity: playerGlow,
    roughness: 0.48,
    metalness: 0.2,
  });
  const secondaryMaterial = new THREE.MeshStandardMaterial({
    color: secondary,
    emissive: secondary,
    emissiveIntensity: playerGlow * 0.7,
    roughness: 0.54,
    metalness: 0.16,
  });
  const carbonMaterial = new THREE.MeshStandardMaterial({
    color: 0x080a0b,
    roughness: 0.76,
    metalness: 0.08,
  });

  addGridPart(
    group,
    geometries.chassis,
    bodyMaterial,
    [0, 0.54, 0],
    visual.isPlayer,
  );
  addGridPart(
    group,
    geometries.nose,
    bodyMaterial,
    [0, 0.46, 2.42],
    visual.isPlayer,
  );
  addGridPart(
    group,
    geometries.sidepods,
    secondaryMaterial,
    [-0.72, 0.5, -0.22],
    visual.isPlayer,
  );
  addGridPart(
    group,
    geometries.sidepods,
    secondaryMaterial,
    [0.72, 0.5, -0.22],
    visual.isPlayer,
  );
  addGridPart(
    group,
    geometries.frontWing,
    carbonMaterial,
    [0, 0.3, 3.25],
    visual.isPlayer,
  );
  addGridPart(
    group,
    geometries.rearWing,
    carbonMaterial,
    [0, 1.08, -1.72],
    visual.isPlayer,
  );

  const cockpit = addGridPart(
    group,
    geometries.cockpit,
    carbonMaterial,
    [0, 0.86, 0.12],
    visual.isPlayer,
  );
  cockpit.scale.set(0.76, 0.62, 1.2);

  const tyreMaterial = new THREE.MeshStandardMaterial({
    color: 0x08090a,
    roughness: 0.96,
  });
  const bandMaterial = new THREE.MeshStandardMaterial({
    color: COMPOUND_COLORS.M,
    emissive: COMPOUND_COLORS.M,
    emissiveIntensity: visual.isPlayer ? 0.2 : 0.1,
    roughness: 0.66,
  });
  setGridCarVisibility(bodyMaterial, visual.isPlayer);
  setGridCarVisibility(secondaryMaterial, visual.isPlayer);
  setGridCarVisibility(
    carbonMaterial,
    visual.isPlayer,
    OPPONENT_GRID_CAR_DETAIL_OPACITY,
  );
  setGridCarVisibility(
    tyreMaterial,
    visual.isPlayer,
    OPPONENT_GRID_CAR_TYRE_OPACITY,
  );
  setGridCarVisibility(
    bandMaterial,
    visual.isPlayer,
    OPPONENT_GRID_CAR_BAND_OPACITY,
  );
  const wheelRigs: FormulaWheelRig[] = [];
  let wheelIndex = 0;
  for (const z of [-1.08, 1.25]) {
    for (const x of [-1.06, 1.06]) {
      const steeringPivot = new THREE.Group();
      steeringPivot.name = [
        "wheel-rl",
        "wheel-rr",
        "wheel-fl",
        "wheel-fr",
      ][wheelIndex];
      steeringPivot.position.set(x, 0.45, z);
      const spinPivot = new THREE.Group();
      const wheel = new THREE.Mesh(
        geometries.wheel,
        tyreMaterial,
      );
      wheel.rotation.z = Math.PI / 2;
      wheel.castShadow = visual.isPlayer;
      wheel.receiveShadow = true;
      wheel.userData.desktopShadow = visual.isPlayer;
      spinPivot.add(wheel);

      const band = new THREE.Mesh(
        geometries.compoundBand,
        bandMaterial,
      );
      band.rotation.y = Math.PI / 2;
      band.position.x = x > 0 ? 0.16 : -0.16;
      band.castShadow = false;
      band.receiveShadow = true;
      band.userData.desktopShadow = false;
      spinPivot.add(band);
      steeringPivot.add(spinPivot);
      group.add(steeringPivot);
      wheelRigs.push({
        steeringPivot,
        spinPivot,
        isFront: z > 0,
        radius: 0.43,
      });
      wheelIndex += 1;
    }
  }

  const uniformScale = normalizeCarFootprint(
    group,
    F1_CAR_LENGTH_METERS,
    F1_CAR_WIDTH_METERS,
  );
  return {
    id: visual.id,
    isPlayer: visual.isPlayer,
    group,
    compoundBands: [bandMaterial],
    wheelRigs: wheelRigs.map((wheel) => ({
      ...wheel,
      radius: wheel.radius * uniformScale,
    })),
    wheelTravelDistance: 0,
  };
}

function formulaCarYaw(forwardAxis: FormulaCarForwardAxis): number {
  if (forwardAxis === "-z") return Math.PI;
  if (forwardAxis === "+x") return -Math.PI / 2;
  if (forwardAxis === "-x") return Math.PI / 2;
  return 0;
}

function applyTeamColor(
  material: THREE.MeshStandardMaterial,
  color: number,
  emissiveIntensity: number,
): void {
  material.color.setHex(color);
  material.emissive.setHex(color);
  material.emissiveIntensity = emissiveIntensity;
  material.needsUpdate = true;
}

function cloneAndPrepareFormulaMaterials(
  source: THREE.Group,
  options: FormulaCarBuildOptions,
): readonly THREE.MeshStandardMaterial[] {
  const clones = new Map<THREE.Material, THREE.Material>();
  const allMaterials = new Set<THREE.Material>();
  const primaryMaterials = new Set<THREE.MeshStandardMaterial>();
  const secondaryMaterials = new Set<THREE.MeshStandardMaterial>();
  const compoundMaterials = new Set<THREE.MeshStandardMaterial>();
  const fallbackColorMaterials = new Set<THREE.MeshStandardMaterial>();

  const cloneMaterial = (material: THREE.Material) => {
    const existing = clones.get(material);
    if (existing) return existing;
    const cloned = material.clone();
    clones.set(material, cloned);
    allMaterials.add(cloned);
    return cloned;
  };

  source.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;

    const originalMaterials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    const nextMaterials = originalMaterials.map(cloneMaterial);
    object.material = Array.isArray(object.material)
      ? nextMaterials
      : nextMaterials[0];
    object.receiveShadow = true;
    const desktopShadow = options.isPlayer;
    object.castShadow = desktopShadow;
    object.userData.desktopShadow = desktopShadow;

    for (const material of nextMaterials) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      const materialKey = `${object.name} ${material.name}`;
      if (MODELVAULT_HIDDEN_MATERIALS.has(material.name)) {
        material.visible = false;
        material.needsUpdate = true;
      } else if (MODELVAULT_PRIMARY_MATERIALS.has(material.name)) {
        primaryMaterials.add(material);
      } else if (
        MODELVAULT_SECONDARY_MATERIALS.has(material.name)
      ) {
        secondaryMaterials.add(material);
      } else if (COMPOUND_MATERIAL_PATTERN.test(materialKey)) {
        compoundMaterials.add(material);
      } else if (
        !NON_BODY_MATERIAL_PATTERN.test(materialKey) &&
        SECONDARY_MATERIAL_PATTERN.test(materialKey)
      ) {
        secondaryMaterials.add(material);
      } else if (
        !NON_BODY_MATERIAL_PATTERN.test(materialKey) &&
        PRIMARY_MATERIAL_PATTERN.test(materialKey)
      ) {
        primaryMaterials.add(material);
      } else if (!NON_BODY_MATERIAL_PATTERN.test(materialKey)) {
        fallbackColorMaterials.add(material);
      }
    }
  });

  if (primaryMaterials.size === 0) {
    const firstFallback = fallbackColorMaterials.values().next().value;
    if (firstFallback) primaryMaterials.add(firstFallback);
  }
  if (secondaryMaterials.size === 0) {
    for (const fallback of fallbackColorMaterials) {
      if (!primaryMaterials.has(fallback)) {
        secondaryMaterials.add(fallback);
        break;
      }
    }
  }

  const glow = options.isPlayer ? 0.07 : 0.018;
  for (const material of primaryMaterials) {
    applyTeamColor(material, options.primary, glow);
  }
  for (const material of secondaryMaterials) {
    applyTeamColor(material, options.secondary, glow * 0.65);
  }
  for (const material of compoundMaterials) {
    applyTeamColor(
      material,
      COMPOUND_COLORS.M,
      options.isPlayer ? 0.16 : 0.08,
    );
  }

  if (!options.ghost) {
    for (const material of allMaterials) {
      if (material instanceof THREE.MeshStandardMaterial) {
        const opponentOpacity = compoundMaterials.has(material)
          ? OPPONENT_GRID_CAR_BAND_OPACITY
          : primaryMaterials.has(material) ||
              secondaryMaterials.has(material) ||
              fallbackColorMaterials.has(material)
            ? OPPONENT_GRID_CAR_OPACITY
            : OPPONENT_GRID_CAR_DETAIL_OPACITY;
        setGridCarVisibility(
          material,
          options.isPlayer,
          opponentOpacity,
        );
      }
    }
  }

  if (options.ghost) {
    for (const material of allMaterials) {
      material.transparent = true;
      material.opacity *= 0.62;
      material.depthWrite = true;
      material.depthTest = true;
      material.alphaHash = false;
      material.blending = THREE.NormalBlending;
      material.premultipliedAlpha = true;
      material.needsUpdate = true;
    }
  }

  return [...compoundMaterials];
}

function normalizedWheelName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function formulaWheelSlot(
  name: string,
): "fl" | "fr" | "rl" | "rr" | null {
  const normalized = normalizedWheelName(name);
  if (!/(?:wheel|tire|tyre)/.test(normalized)) return null;
  if (/(?:frontleft|leftfront|wheelfl|tirefl|tyrefl)/.test(normalized)) {
    return "fl";
  }
  if (/(?:frontright|rightfront|wheelfr|tirefr|tyrefr)/.test(normalized)) {
    return "fr";
  }
  if (/(?:rearleft|leftrear|wheelrl|tirerl|tyrerl)/.test(normalized)) {
    return "rl";
  }
  if (/(?:rearright|rightrear|wheelrr|tirerr|tyrerr)/.test(normalized)) {
    return "rr";
  }
  return null;
}

function formulaWheelPositions(
  group: THREE.Group,
  bounds: THREE.Box3,
): readonly THREE.Vector3[] {
  const wheelPositions = new Map<string, THREE.Vector3>();
  group.updateMatrixWorld(true);
  group.traverse((object) => {
    const slot = formulaWheelSlot(object.name);
    if (!slot || wheelPositions.has(slot)) return;
    wheelPositions.set(slot, object.getWorldPosition(new THREE.Vector3()));
  });
  if (wheelPositions.size === 4) {
    return ["fl", "fr", "rl", "rr"].map(
      (slot) => wheelPositions.get(slot) as THREE.Vector3,
    );
  }

  const size = bounds.getSize(new THREE.Vector3());
  const radius = THREE.MathUtils.clamp(size.y * 0.3, 0.3, 0.42);
  const wheelX = THREE.MathUtils.clamp(size.x * 0.42, 0.72, 1.02);
  const frontZ = size.z * 0.285;
  const rearZ = -size.z * 0.275;
  return [
    new THREE.Vector3(-wheelX, radius, frontZ),
    new THREE.Vector3(wheelX, radius, frontZ),
    new THREE.Vector3(-wheelX, radius, rearZ),
    new THREE.Vector3(wheelX, radius, rearZ),
  ];
}

function addFormulaCompoundBands(
  group: THREE.Group,
  bounds: THREE.Box3,
  options: FormulaCarBuildOptions,
  wheelPositions?: readonly THREE.Vector3[],
  bandScaleOverride?: number,
): THREE.MeshStandardMaterial {
  const size = bounds.getSize(new THREE.Vector3());
  const radius = THREE.MathUtils.clamp(size.y * 0.3, 0.3, 0.42);
  const material = new THREE.MeshStandardMaterial({
    color: COMPOUND_COLORS.M,
    emissive: COMPOUND_COLORS.M,
    emissiveIntensity: options.isPlayer ? 0.18 : 0.08,
    roughness: 0.66,
    transparent: options.ghost === true,
    opacity: options.ghost ? 0.72 : 1,
    depthWrite: true,
    premultipliedAlpha: options.ghost === true,
  });
  if (!options.ghost) {
    setGridCarVisibility(material, options.isPlayer);
  }
  const bands = new THREE.InstancedMesh(
    options.compoundBandGeometry,
    material,
    4,
  );
  const quaternion = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    Math.PI / 2,
  );
  const matrix = new THREE.Matrix4();
  const bandScale = bandScaleOverride ?? radius;
  const scale = new THREE.Vector3(
    bandScale,
    bandScale,
    bandScale,
  );
  (wheelPositions ?? formulaWheelPositions(group, bounds)).forEach(
    (position, index) => {
    matrix.compose(position, quaternion, scale);
    bands.setMatrixAt(index, matrix);
    },
  );
  bands.instanceMatrix.needsUpdate = true;
  bands.castShadow = false;
  bands.receiveShadow = true;
  bands.userData.desktopShadow = false;
  group.add(bands);
  return material;
}

function addFormulaWheelCovers(
  group: THREE.Group,
  bounds: THREE.Box3,
  secondaryColor: number,
  detailed: boolean,
): FormulaWheelCoverResult {
  const size = bounds.getSize(new THREE.Vector3());
  const radius = THREE.MathUtils.clamp(
    size.y * 0.33,
    0.35,
    0.4,
  );
  const width = THREE.MathUtils.clamp(
    size.x * 0.18,
    0.32,
    0.38,
  );
  const wheelX = THREE.MathUtils.clamp(
    size.x * 0.429,
    0.82,
    0.9,
  );
  const frontZ = size.z * 0.333;
  const rearZ = -size.z * 0.363;
  const positions = [
    new THREE.Vector3(-wheelX, radius, frontZ),
    new THREE.Vector3(wheelX, radius, frontZ),
    new THREE.Vector3(-wheelX, radius, rearZ),
    new THREE.Vector3(wheelX, radius, rearZ),
  ];

  const tyreGeometry = new THREE.TorusGeometry(
    radius * 0.77,
    radius * 0.23,
    detailed ? 10 : 6,
    detailed ? 24 : 12,
  );
  const rimGeometry = new THREE.CylinderGeometry(
    radius * 0.54,
    radius * 0.54,
    width * 1.04,
    detailed ? 20 : 10,
  );
  const spokeGeometry = new THREE.BoxGeometry(
    width * 1.08,
    radius * 0.92,
    0.045,
  );
  const tyreMaterial = new THREE.MeshStandardMaterial({
    color: 0x050607,
    roughness: 0.96,
    metalness: 0.02,
  });
  const rimMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(secondaryColor)
      .lerp(new THREE.Color(0x24282e), 0.76),
    roughness: 0.34,
    metalness: 0.72,
  });
  if (!detailed) {
    setGridCarVisibility(
      tyreMaterial,
      false,
      OPPONENT_GRID_CAR_TYRE_OPACITY,
    );
    setGridCarVisibility(
      rimMaterial,
      false,
      OPPONENT_GRID_CAR_DETAIL_OPACITY,
    );
  }
  const rigs: FormulaWheelRig[] = [];

  positions.forEach((position, index) => {
    const isFront = index < 2;
    const steeringPivot = new THREE.Group();
    steeringPivot.name = [
      "wheel-fl",
      "wheel-fr",
      "wheel-rl",
      "wheel-rr",
    ][index];
    steeringPivot.position.copy(position);

    const spinPivot = new THREE.Group();
    const tyre = new THREE.Mesh(tyreGeometry, tyreMaterial);
    tyre.rotation.y = Math.PI / 2;
    tyre.scale.z = width / (radius * 0.46);
    tyre.castShadow = true;
    tyre.receiveShadow = true;
    tyre.userData.desktopShadow = true;
    spinPivot.add(tyre);

    const rim = new THREE.Mesh(rimGeometry, rimMaterial);
    rim.rotation.z = Math.PI / 2;
    rim.castShadow = true;
    rim.receiveShadow = true;
    rim.userData.desktopShadow = true;
    spinPivot.add(rim);

    const spokeCount = detailed ? 5 : 0;
    for (
      let spokeIndex = 0;
      spokeIndex < spokeCount;
      spokeIndex += 1
    ) {
      const spoke = new THREE.Mesh(spokeGeometry, rimMaterial);
      spoke.rotation.x = (spokeIndex / 5) * Math.PI;
      spoke.castShadow = false;
      spoke.receiveShadow = true;
      spoke.userData.desktopShadow = false;
      spinPivot.add(spoke);
    }

    steeringPivot.add(spinPivot);
    group.add(steeringPivot);
    rigs.push({
      steeringPivot,
      spinPivot,
      isFront,
      radius,
    });
  });

  return {
    rigs,
    positions,
    compoundBandScale: radius / 1.11,
  };
}

function addFormulaReferenceLabel(
  group: THREE.Group,
  bounds: THREE.Box3,
  borderColor: number,
): void {
  const labelCanvas = document.createElement("canvas");
  labelCanvas.width = 96;
  labelCanvas.height = 64;
  const labelContext = labelCanvas.getContext("2d");
  if (labelContext) {
    labelContext.fillStyle = "rgba(18, 49, 47, .9)";
    labelContext.fillRect(4, 5, 88, 54);
    labelContext.strokeStyle = `#${borderColor
      .toString(16)
      .padStart(6, "0")}`;
    labelContext.lineWidth = 4;
    labelContext.strokeRect(4, 5, 88, 54);
    labelContext.fillStyle = "#ffffff";
    labelContext.font = "900 34px Arial";
    labelContext.textAlign = "center";
    labelContext.textBaseline = "middle";
    labelContext.fillText("BEST", 48, 33);
  }
  const labelTexture = new THREE.CanvasTexture(labelCanvas);
  labelTexture.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: labelTexture,
      transparent: true,
      depthWrite: false,
    }),
  );
  label.position.set(0, bounds.max.y + 0.7, 0);
  label.scale.set(1.8, 1.2, 1);
  group.add(label);
}

function createFormulaCar(
  template: THREE.Group,
  options: FormulaCarBuildOptions,
): CarModel {
  const source = template.clone(true);
  const compoundMaterials = cloneAndPrepareFormulaMaterials(
    source,
    options,
  );
  const orientation = new THREE.Group();
  orientation.rotation.y = formulaCarYaw(options.forwardAxis);
  orientation.add(source);

  const group = new THREE.Group();
  group.add(orientation);
  group.updateMatrixWorld(true);
  const unscaledBounds = new THREE.Box3().setFromObject(orientation);
  const unscaledSize = unscaledBounds.getSize(new THREE.Vector3());
  if (
    unscaledBounds.isEmpty() ||
    !Number.isFinite(unscaledSize.z) ||
    unscaledSize.z <= 0.01
  ) {
    throw new Error("Formula car GLB has invalid bounds.");
  }

  orientation.scale.setScalar(
    options.targetLengthMeters / unscaledSize.z,
  );
  group.updateMatrixWorld(true);
  const scaledBounds = new THREE.Box3().setFromObject(orientation);
  const scaledCenter = scaledBounds.getCenter(new THREE.Vector3());
  orientation.position.set(
    -scaledCenter.x,
    -scaledBounds.min.y,
    -scaledCenter.z,
  );
  group.updateMatrixWorld(true);
  const normalizedBounds = new THREE.Box3().setFromObject(group);
  const wheelCovers = options.addWheelCovers
    ? addFormulaWheelCovers(
        group,
        normalizedBounds,
        options.secondary,
        options.isPlayer,
      )
    : null;
  const overlayBand = addFormulaCompoundBands(
    group,
    normalizedBounds,
    options,
    wheelCovers?.positions,
    wheelCovers?.compoundBandScale,
  );
  normalizeCarWidth(group, options.targetWidthMeters);
  const fittedBounds = new THREE.Box3().setFromObject(group);
  if (options.ghost) {
    addFormulaReferenceLabel(
      group,
      fittedBounds,
      options.primary,
    );
  }

  return {
    group,
    compoundBands: [...compoundMaterials, overlayBand],
    wheelRigs: wheelCovers?.rigs,
    wheelTravelDistance: 0,
  };
}

function createFormulaGridCar(
  template: THREE.Group,
  visual: RaceSceneGridVisual,
  compoundBandGeometry: THREE.TorusGeometry,
  forwardAxis: FormulaCarForwardAxis,
  targetLengthMeters = FORMULA_CAR_MODEL_ASSET.targetLengthMeters,
  addWheelCovers = false,
): GridCarModel {
  const car = createFormulaCar(template, {
    primary: hexToNumber(visual.color),
    secondary: hexToNumber(visual.secondaryColor),
    isPlayer: visual.isPlayer,
    forwardAxis,
    compoundBandGeometry,
    targetLengthMeters,
    targetWidthMeters: FORMULA_CAR_MODEL_ASSET.targetWidthMeters,
    addWheelCovers,
  });
  return {
    ...car,
    id: visual.id,
    isPlayer: visual.isPlayer,
  };
}

function setCompound(
  car: CarModel,
  compound: Compound,
): void {
  const color = COMPOUND_COLORS[compound];
  for (const material of car.compoundBands) {
    material.color.setHex(color);
    material.emissive.setHex(color);
  }
}

function animateFormulaWheels(
  car: CarModel,
  points: readonly THREE.Vector3[],
  progressLaps: number,
  displaySpeedKph: number,
  realDeltaSeconds: number,
): void {
  if (!car.wheelRigs || car.wheelRigs.length === 0) return;

  const currentTangent = trackPoseAt(
    points,
    progressLaps,
  ).tangent;
  const lookAheadTangent = trackPoseAt(
    points,
    progressLaps + 3 / points.length,
  ).tangent;
  const currentHeading = Math.atan2(
    currentTangent.x,
    currentTangent.z,
  );
  const lookAheadHeading = Math.atan2(
    lookAheadTangent.x,
    lookAheadTangent.z,
  );
  const headingDelta = Math.atan2(
    Math.sin(lookAheadHeading - currentHeading),
    Math.cos(lookAheadHeading - currentHeading),
  );
  const steeringAngle = THREE.MathUtils.clamp(
    headingDelta * 1.8,
    -0.38,
    0.38,
  );
  const visualDistanceMeters =
    (THREE.MathUtils.clamp(displaySpeedKph, 0, 330) / 3.6) *
    THREE.MathUtils.clamp(realDeltaSeconds, 0, 0.05);
  car.wheelTravelDistance =
    (car.wheelTravelDistance + visualDistanceMeters) % 100_000;

  for (const wheel of car.wheelRigs) {
    wheel.spinPivot.rotation.x =
      -car.wheelTravelDistance / wheel.radius;
    wheel.steeringPivot.rotation.y = wheel.isFront
      ? steeringAngle
      : 0;
  }
}

function positionCar(
  car: CarModel,
  points: readonly THREE.Vector3[],
  progress: number,
  laneOffset: number,
  displaySpeedKph: number,
  realDeltaSeconds: number,
): TrackPose {
  const pose = trackPoseAt(points, progress, laneOffset);
  car.group.position.copy(pose.position);
  car.group.position.y = 0.12;
  car.group.rotation.y = Math.atan2(
    pose.tangent.x,
    pose.tangent.z,
  );
  animateFormulaWheels(
    car,
    points,
    progress,
    displaySpeedKph,
    realDeltaSeconds,
  );
  return pose;
}

function setGridCarShadowMode(
  car: GridCarModel,
  mobile: boolean,
): void {
  car.group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const desktopShadow = object.userData.desktopShadow === true;
    object.castShadow =
      desktopShadow && (!mobile || car.isPlayer);
  });
}

function setFallbackCarShadowMode(
  car: CarModel,
  enabled: boolean,
): void {
  car.group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = enabled;
    }
  });
}

function positionGridCar(
  car: GridCarModel,
  points: readonly THREE.Vector3[],
  roadHalfWidth: number,
  circuitLengthMeters: number,
  frame: RaceGridCarFrame,
  displaySpeedKph: number,
  realDeltaSeconds: number,
): TrackPose {
  const onPitLane = frame.pitState === "pit" || frame.isPitting;
  const startLane =
    frame.gridPosition % 2 === 0
      ? -GRID_LANE_OFFSET_METERS
      : GRID_LANE_OFFSET_METERS;
  const raceLane = frame.gridPosition % 2 === 0 ? -1.08 : 1.08;
  const fullGridOffset =
    GRID_FRONT_OFFSET_METERS +
    gridSlotOffsetMeters(frame.gridPosition);
  const startGridOffset = startGridVisualOffsetMeters(
    frame.gridPosition,
    frame.progressLaps,
    circuitLengthMeters,
  );
  const startGridBlend =
    fullGridOffset > 0 ? startGridOffset / fullGridOffset : 0;
  const gridLane = THREE.MathUtils.lerp(
    raceLane,
    startLane,
    startGridBlend,
  );
  const laneOffset = onPitLane
    ? -roadHalfWidth - 3.15
    : gridLane;
  const visualProgress =
    frame.progressLaps -
    startGridOffset / circuitLengthMeters;
  const pose = trackPoseAt(
    points,
    normalizeProgress(visualProgress),
    laneOffset,
  );
  if (frame.pitState === "finished") {
    pose.position.addScaledVector(
      pose.tangent,
      -(frame.position - 1) * 1.75,
    );
  }
  car.group.position.copy(pose.position);
  car.group.position.y = car.isPlayer
    ? PLAYER_GRID_CAR_RIDE_HEIGHT
    : OPPONENT_GRID_CAR_RIDE_HEIGHT;
  car.group.rotation.y = Math.atan2(
    pose.tangent.x,
    pose.tangent.z,
  );
  animateFormulaWheels(
    car,
    points,
    frame.progressLaps,
    displaySpeedKph,
    realDeltaSeconds,
  );
  setCompound(car, frame.compound);
  return pose;
}

function updateGridCars(
  runtime: RaceSceneRuntime,
  gridFrame: RaceGridFrame,
  playerDisplaySpeedKph: number,
  realDeltaSeconds: number,
): GridFocus | null {
  const framesById = new Map(
    gridFrame.cars.map((carFrame) => [carFrame.id, carFrame]),
  );
  let focus: GridFocus | null = null;
  let firstVisible: GridFocus | null = null;

  for (const [id, car] of runtime.gridCars) {
    const carFrame = framesById.get(id);
    car.group.visible = carFrame !== undefined;
    if (!carFrame) continue;
    const displaySpeedKph =
      id === runtime.playerGridCarId || car.isPlayer
        ? playerDisplaySpeedKph
        : carFrame.isPitting
          ? 80
          : fallbackTelemetryAt(
              runtime.worldPoints,
              carFrame.progressLaps,
            ).speedKph;

    const pose = positionGridCar(
      car,
      runtime.worldPoints,
      runtime.roadHalfWidth,
      runtime.circuitLengthMeters,
      carFrame,
      displaySpeedKph,
      realDeltaSeconds,
    );
    const candidate = { carFrame, pose };
    firstVisible ??= candidate;
    if (id === runtime.playerGridCarId || car.isPlayer) {
      focus = candidate;
    }
  }

  return focus ?? firstVisible;
}

function renderFrame(
  runtime: RaceSceneRuntime,
  frame: StrategyRaceFrame,
  cameraMode: RaceSceneCamera,
  gridFrame?: RaceGridFrame,
  telemetry?: RaceSceneTelemetry,
): void {
  const now = performance.now();
  const realDeltaSeconds =
    runtime.lastRenderMs === null
      ? 1 / 60
      : THREE.MathUtils.clamp(
          (now - runtime.lastRenderMs) / 1000,
          1 / 240,
          0.05,
        );
  runtime.lastRenderMs = now;

  const gridEnabled = gridFrame !== undefined;
  runtime.primaryCar.group.visible = !gridEnabled;
  runtime.referenceCar.group.visible = !gridEnabled;
  const wheelFocusFrame =
    gridFrame?.cars.find(
      (car) => car.id === runtime.playerGridCarId,
    ) ?? gridFrame?.cars[0];
  const wheelFocusProgress =
    wheelFocusFrame?.progressLaps ?? frame.primary.trackProgress;
  const wheelTelemetry =
    telemetry ??
    fallbackTelemetryAt(
      runtime.worldPoints,
      wheelFocusProgress,
    );
  const playerDisplaySpeedKph = Number.isFinite(
    wheelTelemetry.speedKph,
  )
    ? THREE.MathUtils.clamp(wheelTelemetry.speedKph, 0, 330)
    : 0;

  let focusProgress = frame.primary.trackProgress;
  let focusCarFrame: RaceGridCarFrame | undefined;
  let primaryPose: TrackPose;
  if (gridFrame) {
    const gridFocus = updateGridCars(
      runtime,
      gridFrame,
      playerDisplaySpeedKph,
      realDeltaSeconds,
    );
    if (gridFocus) {
      primaryPose = gridFocus.pose;
      focusProgress = gridFocus.carFrame.progressLaps;
      focusCarFrame = gridFocus.carFrame;
    } else {
      primaryPose = trackPoseAt(
        runtime.worldPoints,
        focusProgress,
        -0.72,
      );
    }
  } else {
    for (const car of runtime.gridCars.values()) {
      car.group.visible = false;
    }
    const primaryLane = frame.primary.isPitting
      ? -runtime.roadHalfWidth - 3.15
      : -0.72;
    primaryPose = positionCar(
      runtime.primaryCar,
      runtime.worldPoints,
      frame.primary.trackProgress,
      primaryLane,
      playerDisplaySpeedKph,
      realDeltaSeconds,
    );
    positionCar(
      runtime.referenceCar,
      runtime.worldPoints,
      frame.reference.trackProgress,
      0.72,
      fallbackTelemetryAt(
        runtime.worldPoints,
        frame.reference.trackProgress,
      ).speedKph,
      realDeltaSeconds,
    );
    setCompound(runtime.primaryCar, frame.primary.compound);
    setCompound(runtime.referenceCar, frame.reference.compound);
  }

  runtime.sunTarget.position.copy(primaryPose.position);
  runtime.sun.position
    .copy(primaryPose.position)
    .add(runtime.sunOffset);
  runtime.sunTarget.updateMatrixWorld();
  runtime.sun.updateMatrixWorld();

  const modelElapsedSeconds =
    gridFrame?.elapsedSeconds ?? frame.elapsedSeconds;
  const modelDeltaSeconds =
    runtime.lastModelElapsedSeconds === null
      ? 0
      : modelElapsedSeconds - runtime.lastModelElapsedSeconds;
  const positionChanged =
    focusCarFrame !== undefined &&
    runtime.lastFocusPosition !== null &&
    focusCarFrame.position !== runtime.lastFocusPosition &&
    modelDeltaSeconds > 0 &&
    modelDeltaSeconds <= 5;
  const fallbackTelemetry = fallbackTelemetryAt(
    runtime.worldPoints,
    focusProgress,
  );
  const sourceTelemetry = telemetry ?? fallbackTelemetry;
  const reducedMotion = sourceTelemetry.reducedMotion;
  const externalPulse = reducedMotion
    ? 0
    : THREE.MathUtils.clamp(
        sourceTelemetry.overtakePulse,
        0,
        1,
      );
  runtime.overtakePulse = reducedMotion
    ? 0
    : Math.max(
        externalPulse,
        positionChanged
          ? 1
          : Math.max(
              0,
              runtime.overtakePulse -
                realDeltaSeconds * 1.35,
            ),
      );
  runtime.lastFocusPosition =
    focusCarFrame?.position ?? runtime.lastFocusPosition;
  runtime.lastModelElapsedSeconds = modelElapsedSeconds;

  const requestedSpeedKph = Number.isFinite(
    sourceTelemetry.speedKph,
  )
    ? THREE.MathUtils.clamp(sourceTelemetry.speedKph, 0, 330)
    : fallbackTelemetry.speedKph;
  if (!runtime.hasRendered) {
    runtime.smoothedSpeedKph = requestedSpeedKph;
  } else {
    runtime.smoothedSpeedKph = THREE.MathUtils.damp(
      runtime.smoothedSpeedKph,
      requestedSpeedKph,
      requestedSpeedKph < runtime.smoothedSpeedKph ? 9 : 3.8,
      realDeltaSeconds,
    );
  }
  const speed01 = THREE.MathUtils.clamp(
    (runtime.smoothedSpeedKph - 180) / 150,
    0,
    1,
  );
  const signedTurn = Number.isFinite(sourceTelemetry.signedTurn)
    ? THREE.MathUtils.clamp(
        sourceTelemetry.signedTurn,
        -1,
        1,
      )
    : fallbackTelemetry.signedTurn;
  const braking = reducedMotion
    ? 0
    : THREE.MathUtils.clamp(sourceTelemetry.braking, 0, 1);
  const motionScale = reducedMotion ? 0 : 1;

  const desiredPosition = new THREE.Vector3();
  const lookAt = primaryPose.position.clone();
  let targetFov = 55;

  if (cameraMode === "cockpit") {
    desiredPosition
      .copy(primaryPose.position)
      .addScaledVector(
        primaryPose.tangent,
        1.35 + braking * 0.1,
      )
      .add(
        new THREE.Vector3(
          0,
          1.48 - braking * 0.04,
          0,
        ),
      );
    lookAt
      .addScaledVector(primaryPose.tangent, 20)
      .add(
        new THREE.Vector3(
          0,
          0.85 - braking * 0.18,
          0,
        ),
      );
    targetFov = THREE.MathUtils.clamp(
      55 + 15 * speed01,
      55,
      70,
    );
  } else if (cameraMode === "broadcast") {
    const cameraSector =
      Math.floor(normalizeProgress(focusProgress) * 12) /
      12;
    const cameraPose = trackPoseAt(
      runtime.worldPoints,
      cameraSector + 0.035,
      runtime.roadHalfWidth + 16,
    );
    desiredPosition
      .copy(cameraPose.position)
      .add(new THREE.Vector3(0, 7.5, 0));
    lookAt.add(new THREE.Vector3(0, 0.9, 0));
    targetFov = 44;
  } else {
    const backDistance =
      5.75 +
      0.65 * speed01 +
      0.45 * runtime.overtakePulse -
      0.4 * braking;
    const cameraHeight =
      2.65 +
      0.25 * speed01 +
      0.1 * runtime.overtakePulse -
      0.08 * braking;
    desiredPosition
      .copy(primaryPose.position)
      .addScaledVector(primaryPose.tangent, -backDistance)
      .add(new THREE.Vector3(0, cameraHeight, 0));
    lookAt
      .addScaledVector(
        primaryPose.tangent,
        1.45 + 0.65 * speed01 - 0.35 * braking,
      )
      .add(
        new THREE.Vector3(
          0,
          0.62 - 0.1 * braking,
          0,
        ),
      );
    targetFov = THREE.MathUtils.clamp(
      55 +
        15 * speed01 +
        1.5 * runtime.overtakePulse,
      55,
      70,
    );
  }

  if (cameraMode !== "broadcast" && motionScale > 0) {
    const shakeAmplitude =
      (0.006 + 0.018 * speed01) *
      (cameraMode === "cockpit" ? 0.55 : 1);
    desiredPosition.addScaledVector(
      primaryPose.normal,
      Math.sin(now * 0.017) * shakeAmplitude,
    );
    desiredPosition.y +=
      Math.sin(now * 0.023 + 1.7) *
      shakeAmplitude *
      0.45;
  }

  const modeChanged =
    !runtime.hasRendered ||
    runtime.lastCameraMode !== cameraMode;
  runtime.camera.fov = modeChanged
    ? targetFov
    : THREE.MathUtils.damp(
        runtime.camera.fov,
        targetFov,
        6,
        realDeltaSeconds,
      );
  runtime.camera.updateProjectionMatrix();
  const playbackScale =
    modelDeltaSeconds > 0
      ? THREE.MathUtils.clamp(
          modelDeltaSeconds / realDeltaSeconds,
          1,
          60,
        )
      : 1;
  const followScale = Math.sqrt(playbackScale);
  const positionBlend = modeChanged
    ? 1
    : 1 -
      Math.exp(
        -(cameraMode === "broadcast" ? 3.2 : 7.5) *
          followScale *
          realDeltaSeconds,
      );
  const lookBlend = modeChanged
    ? 1
    : 1 -
      Math.exp(
        -(cameraMode === "broadcast" ? 4.5 : 9) *
          followScale *
          realDeltaSeconds,
      );
  runtime.camera.position.lerp(
    desiredPosition,
    positionBlend,
  );
  if (modeChanged) {
    runtime.cameraLookAt.copy(lookAt);
  } else {
    runtime.cameraLookAt.lerp(lookAt, lookBlend);
  }

  const roll =
    cameraMode === "broadcast" || reducedMotion
      ? 0
      : THREE.MathUtils.clamp(
          -signedTurn * 0.16,
          -0.055,
          0.055,
        );
  const targetUp = new THREE.Vector3(
    0,
    Math.cos(roll),
    0,
  )
    .addScaledVector(primaryPose.normal, Math.sin(roll))
    .normalize();
  const upBlend = modeChanged
    ? 1
    : 1 - Math.exp(-8 * realDeltaSeconds);
  runtime.cameraUp.lerp(targetUp, upBlend).normalize();
  runtime.camera.up.copy(runtime.cameraUp);
  runtime.camera.lookAt(runtime.cameraLookAt);
  runtime.renderer.render(runtime.scene, runtime.camera);
  runtime.hasRendered = true;
  runtime.lastCameraMode = cameraMode;
}

function disposeObjectRoots(
  roots: readonly THREE.Object3D[],
): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  for (const root of roots) {
    root.traverse((object) => {
      const ownedTextures = object.userData.ownedTextures;
      if (Array.isArray(ownedTextures)) {
        for (const texture of ownedTextures) {
          if (texture instanceof THREE.Texture) {
            textures.add(texture);
          }
        }
      }
      if (object instanceof THREE.Mesh) {
        if (!SHARED_FORMULA_GEOMETRIES.has(object.geometry)) {
          geometries.add(object.geometry);
        }
        const objectMaterials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        for (const material of objectMaterials) {
          if (material instanceof THREE.SpriteMaterial) {
            if (material.map) textures.add(material.map);
          }
          materials.add(material);
        }
      }
      if (object instanceof THREE.Sprite) {
        if (object.material.map) textures.add(object.material.map);
        materials.add(object.material);
      }
    });
  }

  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}

function disposeScene(scene: THREE.Scene): void {
  disposeObjectRoots([scene]);
}

const RaceScene3D = forwardRef<RaceSceneHandle, RaceScene3DProps>(
  function RaceScene3D(
    {
      trackId,
      samples,
      circuitLengthKm,
      team,
      driver,
      gridVisuals = EMPTY_GRID_VISUALS,
      modelForwardAxis =
        FORMULA_CAR_MODEL_ASSET.defaultForwardAxis,
      renderingEnabled = true,
      onAvailabilityChange,
    },
    ref,
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const runtimeRef = useRef<RaceSceneRuntime | null>(null);
    const renderingEnabledRef = useRef(renderingEnabled);
    const contextLostRef = useRef(false);
    const resizeRef = useRef<(() => void) | null>(null);
    const latestFrameRef = useRef<StrategyRaceFrame | null>(null);
    const latestCameraRef = useRef<RaceSceneCamera>("chase");
    const latestGridFrameRef = useRef<RaceGridFrame | undefined>(
      undefined,
    );
    const latestTelemetryRef = useRef<
      RaceSceneTelemetry | undefined
    >(undefined);

    useImperativeHandle(
      ref,
      () => ({
        update(frame, camera, gridFrame, telemetry) {
          latestFrameRef.current = frame;
          latestCameraRef.current = camera;
          latestGridFrameRef.current = gridFrame;
          latestTelemetryRef.current = telemetry;
          if (
            runtimeRef.current &&
            renderingEnabledRef.current &&
            !contextLostRef.current &&
            !document.hidden
          ) {
            renderFrame(
              runtimeRef.current,
              frame,
              camera,
              gridFrame,
              telemetry,
            );
          }
        },
      }),
      [],
    );

    useEffect(() => {
      renderingEnabledRef.current = renderingEnabled;
      if (renderingEnabled && !contextLostRef.current) {
        if (runtimeRef.current) runtimeRef.current.lastRenderMs = null;
        resizeRef.current?.();
      }
    }, [renderingEnabled]);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas || samples.length < 8) return;

      let disposed = false;
      let runtime: RaceSceneRuntime | null = null;
      let createdRenderer: THREE.WebGLRenderer | null = null;
      let createdScene: THREE.Scene | null = null;
      contextLostRef.current = false;

      try {
        const theme = CIRCUIT_VISUAL_THEMES[trackId];
        const isNightRace = theme.lighting === "night";
        const isGoldenRace = theme.lighting === "golden";
        const renderer = new THREE.WebGLRenderer({
          canvas,
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
        });
        createdRenderer = renderer;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = isNightRace
          ? 0.92
          : isGoldenRace
            ? 1.08
            : 1.02;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFShadowMap;

        const scene = new THREE.Scene();
        createdScene = scene;
        scene.background = new THREE.Color(theme.sky);
        scene.fog = new THREE.Fog(
          theme.fog,
          isNightRace ? 78 : 95,
          isNightRace ? 275 : 310,
        );

        const camera = new THREE.PerspectiveCamera(57, 16 / 9, 0.1, 700);
        camera.up.set(0, 1, 0);

        const sampledPoints = samples.filter(
          (_, index) => index % TRACK_SAMPLE_STEP === 0,
        );
        const minimumX = Math.min(...sampledPoints.map((point) => point.x));
        const maximumX = Math.max(...sampledPoints.map((point) => point.x));
        const minimumY = Math.min(...sampledPoints.map((point) => point.y));
        const maximumY = Math.max(...sampledPoints.map((point) => point.y));
        const centerX = (minimumX + maximumX) / 2;
        const centerY = (minimumY + maximumY) / 2;
        const circuitLengthMeters = circuitLengthKm * 1_000;
        const scale = circuitScaleForPolyline(
          sampledPoints,
          circuitLengthKm,
        );
        const worldPoints = sampledPoints.map(
          (point) =>
            new THREE.Vector3(
              (point.x - centerX) * scale,
              0,
              (point.y - centerY) * scale,
            ),
        );
        const roadHalfWidth =
          FIA_STANDARD_TRACK_WIDTH_METERS / 2;
        const roadHalfWidthAt = (progress: number) =>
          trackHalfWidthMetersAt(
            progress,
            circuitLengthMeters,
          );
        const runoffWidth =
          theme.setting === "desert"
            ? 4.4
            : theme.setting === "street" ||
                theme.setting === "marina"
              ? 1.25
              : theme.setting === "park"
                ? 2.1
                : 2.8;

        const worldBounds = new THREE.Box3().setFromPoints(
          worldPoints,
        );
        const worldSize = worldBounds.getSize(new THREE.Vector3());
        const ground = new THREE.Mesh(
          new THREE.PlaneGeometry(
            Math.max(540, worldSize.x + 400),
            Math.max(540, worldSize.z + 400),
          ),
          new THREE.MeshStandardMaterial({
            color: theme.ground,
            roughness: 1,
          }),
        );
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -0.08;
        ground.receiveShadow = true;
        scene.add(ground);

        const runoff = new THREE.Mesh(
          createRoadGeometry(
            worldPoints,
            (progress) =>
              roadHalfWidthAt(progress) + runoffWidth,
            0.025,
          ),
          new THREE.MeshStandardMaterial({
            color: theme.runoff,
            roughness: 0.98,
          }),
        );
        runoff.receiveShadow = true;
        scene.add(runoff);

        const asphaltTexture = createAsphaltTexture(
          renderer.capabilities.getMaxAnisotropy(),
          circuitLengthMeters,
        );
        const road = new THREE.Mesh(
          createRoadGeometry(worldPoints, roadHalfWidthAt),
          new THREE.MeshStandardMaterial({
            color: theme.asphalt,
            map: asphaltTexture,
            roughness: 0.91,
            metalness: 0.01,
          }),
        );
        road.receiveShadow = true;
        road.userData.ownedTextures = [asphaltTexture];
        scene.add(road);

        const racingLineColor = new THREE.Color(
          theme.asphalt,
        ).offsetHSL(0, 0, -0.055);
        const racingLine = new THREE.Mesh(
          createRoadGeometry(worldPoints, 0.72, 0.071),
          new THREE.MeshStandardMaterial({
            color: racingLineColor,
            roughness: 0.78,
            transparent: true,
            opacity: 0.62,
            depthWrite: false,
          }),
        );
        scene.add(racingLine);

        const edgeLines = new THREE.Mesh(
          createTrackEdgeGeometry(
            worldPoints,
            (progress) => roadHalfWidthAt(progress) - 0.13,
            roadHalfWidthAt,
            0.084,
          ),
          new THREE.MeshStandardMaterial({
            color: 0xf2f2ec,
            roughness: 0.82,
          }),
        );
        scene.add(edgeLines);

        const kerbs = new THREE.Mesh(
          createKerbGeometry(
            worldPoints,
            roadHalfWidthAt,
            theme.kerbA,
            theme.kerbB,
          ),
          new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.82,
          }),
        );
        kerbs.receiveShadow = true;
        scene.add(kerbs);

        const hemisphere = new THREE.HemisphereLight(
          isNightRace ? 0x7893b2 : 0xd7eef7,
          theme.ground,
          isNightRace ? 0.85 : isGoldenRace ? 1.8 : 2.35,
        );
        scene.add(hemisphere);
        const sun = new THREE.DirectionalLight(
          isNightRace ? 0x8faad2 : isGoldenRace ? 0xffc98f : 0xfff4db,
          isNightRace ? 0.62 : isGoldenRace ? 2.55 : 3.1,
        );
        sun.position.set(
          isGoldenRace ? -105 : -70,
          isGoldenRace ? 62 : 115,
          isGoldenRace ? 88 : 45,
        );
        const sunOffset = sun.position.clone();
        const sunTarget = new THREE.Object3D();
        sun.target = sunTarget;
        sun.castShadow = true;
        sun.shadow.mapSize.set(1024, 1024);
        sun.shadow.camera.left = -130;
        sun.shadow.camera.right = 130;
        sun.shadow.camera.top = 130;
        sun.shadow.camera.bottom = -130;
        sun.shadow.camera.near = 5;
        sun.shadow.camera.far = 280;
        scene.add(sun, sunTarget);

        const closeBarriers =
          theme.setting === "street" ||
          theme.setting === "marina";
        const barrierHeight = closeBarriers ? 1.18 : 0.78;
        const barrierMargin =
          theme.setting === "desert"
            ? 5
            : closeBarriers
              ? 1.55
              : 3.45;
        const trackPointSpacing =
          circuitLengthMeters / worldPoints.length;
        const railGeometry = new THREE.BoxGeometry(
          0.28,
          barrierHeight,
          trackPointSpacing * 1.08,
        );
        const railMaterial = new THREE.MeshStandardMaterial({
          color: theme.barrier,
          roughness: 0.62,
          metalness: 0.55,
        });
        const fenceMaterial = new THREE.MeshStandardMaterial({
          color: 0x758188,
          roughness: 0.6,
          metalness: 0.62,
        });
        const railCapacity = worldPoints.length * 2;
        const rails = new THREE.InstancedMesh(
          railGeometry,
          railMaterial,
          railCapacity,
        );
        rails.castShadow = true;
        const fencePosts = new THREE.InstancedMesh(
          new THREE.BoxGeometry(0.09, 2.25, 0.09),
          fenceMaterial,
          railCapacity,
        );
        const fenceTops = new THREE.InstancedMesh(
          new THREE.BoxGeometry(
            0.08,
            0.08,
            trackPointSpacing * 1.08,
          ),
          fenceMaterial,
          railCapacity,
        );
        const railMatrix = new THREE.Matrix4();
        const railPosition = new THREE.Vector3();
        const fencePosition = new THREE.Vector3();
        const railQuaternion = new THREE.Quaternion();
        const railRotationAxis = new THREE.Vector3(0, 1, 0);
        const railScale = new THREE.Vector3(1, 1, 1);
        const populateRails = (step: number) => {
          let railIndex = 0;
          for (
            let index = 0;
            index < worldPoints.length;
            index += step
          ) {
            const pose = trackPoseAt(
              worldPoints,
              index / worldPoints.length,
            );
            const barrierDistance =
              roadHalfWidthAt(index / worldPoints.length) +
              barrierMargin;
            for (const side of [-1, 1] as const) {
              railPosition
                .copy(pose.position)
                .addScaledVector(
                  pose.normal,
                  side * barrierDistance,
                );
              railPosition.y = barrierHeight / 2 + 0.04;
              railQuaternion.setFromAxisAngle(
                railRotationAxis,
                Math.atan2(pose.tangent.x, pose.tangent.z),
              );
              railMatrix.compose(
                railPosition,
                railQuaternion,
                railScale,
              );
              rails.setMatrixAt(railIndex, railMatrix);

              fencePosition.copy(railPosition);
              fencePosition.y = barrierHeight + 1.12;
              railMatrix.compose(
                fencePosition,
                railQuaternion,
                railScale,
              );
              fencePosts.setMatrixAt(railIndex, railMatrix);

              fencePosition.y = barrierHeight + 2.23;
              railMatrix.compose(
                fencePosition,
                railQuaternion,
                railScale,
              );
              fenceTops.setMatrixAt(railIndex, railMatrix);
              railIndex += 1;
            }
          }
          rails.count = railIndex;
          fencePosts.count = railIndex;
          fenceTops.count = railIndex;
          rails.instanceMatrix.needsUpdate = true;
          fencePosts.instanceMatrix.needsUpdate = true;
          fenceTops.instanceMatrix.needsUpdate = true;
        };
        populateRails(1);
        scene.add(rails, fencePosts, fenceTops);

        const treeGeometry =
          theme.vegetation === "palm"
            ? new THREE.ConeGeometry(2.65, 1.35, 7)
            : new THREE.DodecahedronGeometry(2.25, 0);
        const treeColor =
          theme.vegetation === "cherry"
            ? 0xe3a5ba
            : theme.vegetation === "palm"
              ? 0x2d7748
              : theme.vegetation === "sparse"
                ? 0x587044
                : 0x1c5b31;
        const treeMaterial = new THREE.MeshStandardMaterial({
          color: treeColor,
          roughness: 1,
        });
        const trunkGeometry = new THREE.CylinderGeometry(
          0.22,
          0.34,
          theme.vegetation === "palm" ? 5.2 : 3.8,
          6,
        );
        const trunkMaterial = new THREE.MeshStandardMaterial({
          color: theme.vegetation === "palm" ? 0x82684b : 0x5f4934,
          roughness: 1,
        });
        const treeCapacity = Math.ceil(worldPoints.length / 10);
        const trees = new THREE.InstancedMesh(
          treeGeometry,
          treeMaterial,
          treeCapacity,
        );
        const treeTrunks = new THREE.InstancedMesh(
          trunkGeometry,
          trunkMaterial,
          treeCapacity,
        );
        trees.castShadow = true;
        const treeMatrix = new THREE.Matrix4();
        const treePosition = new THREE.Vector3();
        const trunkPosition = new THREE.Vector3();
        const treeRotationAxis = new THREE.Vector3(0, 1, 0);
        const treeQuaternion = new THREE.Quaternion();
        const treeScale = new THREE.Vector3();
        const trunkScale = new THREE.Vector3(1, 1, 1);
        const populateTrees = (step: number) => {
          if (theme.vegetation === "none") {
            trees.count = 0;
            treeTrunks.count = 0;
            return;
          }
          let treeIndex = 0;
          for (
            let index = 0;
            index < worldPoints.length;
            index += step
          ) {
            const pose = trackPoseAt(
              worldPoints,
              index / worldPoints.length,
            );
            const side = treeIndex % 2 === 0 ? 1 : -1;
            treePosition
              .copy(pose.position)
              .addScaledVector(
                pose.normal,
                side * (17 + ((index * 7) % 12)),
              );
            trunkPosition.copy(treePosition);
            trunkPosition.y =
              theme.vegetation === "palm" ? 2.6 : 1.9;
            treePosition.y =
              theme.vegetation === "palm" ? 5.55 : 4.55;
            treeQuaternion.setFromAxisAngle(
              treeRotationAxis,
              (index * 0.37) % Math.PI,
            );
            treeScale.set(
              0.78 + (index % 3) * 0.11,
              theme.vegetation === "palm"
                ? 0.72
                : 0.82 + (index % 4) * 0.08,
              0.78 + (index % 3) * 0.11,
            );
            treeMatrix.compose(
              treePosition,
              treeQuaternion,
              treeScale,
            );
            trees.setMatrixAt(treeIndex, treeMatrix);
            treeMatrix.compose(
              trunkPosition,
              treeQuaternion,
              trunkScale,
            );
            treeTrunks.setMatrixAt(treeIndex, treeMatrix);
            treeIndex += 1;
          }
          trees.count = treeIndex;
          treeTrunks.count = treeIndex;
          trees.instanceMatrix.needsUpdate = true;
          treeTrunks.instanceMatrix.needsUpdate = true;
        };
        const desktopVegetationStep =
          theme.vegetation === "lush"
            ? 12
            : theme.vegetation === "cherry"
              ? 13
              : theme.vegetation === "palm"
                ? 18
                : 22;
        populateTrees(desktopVegetationStep);
        scene.add(trees, treeTrunks);

        const startRoadHalfWidth = roadHalfWidthAt(0);
        const grandstands = createGrandstands(
          worldPoints,
          roadHalfWidth,
          theme,
        );
        const venueBuildings = createVenueBuildings(
          worldPoints,
          roadHalfWidth,
          theme,
        );
        const pitComplex = createPitComplex(
          worldPoints,
          startRoadHalfWidth,
          theme,
        );
        const floodlights = createFloodlights(
          worldPoints,
          roadHalfWidth,
          theme,
        );
        const brakingBoards = createBrakingBoards(
          worldPoints,
          roadHalfWidth,
          theme,
        );
        const landmark = createCircuitLandmark(
          worldPoints,
          roadHalfWidth,
          theme,
        );
        scene.add(
          grandstands,
          venueBuildings,
          pitComplex,
          floodlights,
          brakingBoards,
          landmark,
        );

        const startPose = trackPoseAt(worldPoints, 0);
        const startGroup = new THREE.Group();
        startGroup.position.copy(startPose.position);
        startGroup.rotation.y = Math.atan2(
          startPose.tangent.x,
          startPose.tangent.z,
        );
        const startMaterial = new THREE.MeshStandardMaterial({
          color: theme.accent,
          emissive: isNightRace ? theme.accent : 0x000000,
          emissiveIntensity: isNightRace ? 0.2 : 0,
          roughness: 0.55,
          metalness: 0.2,
        });
        const whiteMaterial = new THREE.MeshStandardMaterial({
          color: 0xf2f3f0,
          roughness: 0.7,
        });
        addBox(
          startGroup,
          new THREE.BoxGeometry(0.28, 6.8, 0.28),
          startMaterial,
          [-startRoadHalfWidth - 2.2, 3.4, 0],
        );
        addBox(
          startGroup,
          new THREE.BoxGeometry(0.28, 6.8, 0.28),
          startMaterial,
          [startRoadHalfWidth + 2.2, 3.4, 0],
        );
        addBox(
          startGroup,
          new THREE.BoxGeometry(
            startRoadHalfWidth * 2 + 4.7,
            0.5,
            0.45,
          ),
          startMaterial,
          [0, 6.55, 0],
        );
        addBox(
          startGroup,
          new THREE.BoxGeometry(
            startRoadHalfWidth * 2,
            0.05,
            0.72,
          ),
          whiteMaterial,
          [0, 0.11, 0],
        );
        const startLightHousing = new THREE.MeshStandardMaterial({
          color: 0x11171b,
          roughness: 0.62,
          metalness: 0.34,
        });
        const startLightMaterial = new THREE.MeshStandardMaterial({
          color: 0x5b1117,
          emissive: 0xd51f2f,
          emissiveIntensity: isNightRace ? 0.55 : 0.2,
          roughness: 0.5,
        });
        addSceneryMesh(
          startGroup,
          new THREE.BoxGeometry(5.5, 0.78, 0.34),
          startLightHousing,
          [0, 6.05, 0.22],
        );
        const startLightGeometry = new THREE.SphereGeometry(
          0.19,
          10,
          7,
        );
        for (let index = 0; index < 5; index += 1) {
          addSceneryMesh(
            startGroup,
            startLightGeometry,
            startLightMaterial,
            [-1.65 + index * 0.82, 6.05, 0.43],
          );
        }
        const gridBoxGeometry = new THREE.BoxGeometry(
          1.55,
          0.025,
          0.14,
        );
        const gridBoxes = new THREE.InstancedMesh(
          gridBoxGeometry,
          whiteMaterial,
          20,
        );
        const gridBoxMatrix = new THREE.Matrix4();
        const gridBoxPosition = new THREE.Vector3();
        const gridBoxQuaternion = new THREE.Quaternion();
        const gridBoxScale = new THREE.Vector3(1, 1, 1);
        const gridBoxRotationAxis = new THREE.Vector3(0, 1, 0);
        for (let index = 0; index < 20; index += 1) {
          const gridPosition = index + 1;
          const laneOffset =
            gridPosition % 2 === 0
              ? -GRID_LANE_OFFSET_METERS
              : GRID_LANE_OFFSET_METERS;
          const gridProgress =
            -(
              GRID_FRONT_OFFSET_METERS +
              gridSlotOffsetMeters(gridPosition)
            ) / circuitLengthMeters;
          const gridPose = trackPoseAt(
            worldPoints,
            gridProgress,
            laneOffset,
          );
          gridBoxPosition.copy(gridPose.position);
          gridBoxPosition.y = 0.09;
          gridBoxQuaternion.setFromAxisAngle(
            gridBoxRotationAxis,
            Math.atan2(gridPose.tangent.x, gridPose.tangent.z),
          );
          gridBoxMatrix.compose(
            gridBoxPosition,
            gridBoxQuaternion,
            gridBoxScale,
          );
          gridBoxes.setMatrixAt(index, gridBoxMatrix);
        }
        gridBoxes.instanceMatrix.needsUpdate = true;
        scene.add(startGroup, gridBoxes);

        const primaryCar = createF1Car(
          hexToNumber(team.primary),
          hexToNumber(team.secondary),
        );
        const referenceCar = createF1Car(
          0x73f1e0,
          0x1f7f76,
          true,
        );
        scene.add(primaryCar.group, referenceCar.group);

        const gridCarGeometries = createGridCarGeometries();
        const gridCars = new Map<string, GridCarModel>();
        let playerGridCarId: string | null = null;
        for (const visual of gridVisuals) {
          if (gridCars.has(visual.id)) continue;
          const gridCar = createGridCar(
            visual,
            gridCarGeometries,
          );
          gridCar.group.visible = false;
          gridCars.set(visual.id, gridCar);
          scene.add(gridCar.group);
          if (playerGridCarId === null && visual.isPlayer) {
            playerGridCarId = visual.id;
          }
        }

        let mobileMode: boolean | null = null;
        const resize = () => {
          if (
            disposed ||
            !renderingEnabledRef.current ||
            contextLostRef.current ||
            document.hidden
          ) return;
          const bounds = canvas.getBoundingClientRect();
          if (bounds.width < 20 || bounds.height < 20) return;
          const mobile = bounds.width < MOBILE_BREAKPOINT;
          if (mobileMode !== mobile) {
            mobileMode = mobile;
            populateRails(mobile ? 2 : 1);
            populateTrees(
              mobile
                ? desktopVegetationStep * 2
                : desktopVegetationStep,
            );
            rails.castShadow = !mobile;
            trees.castShadow = !mobile;
            treeTrunks.castShadow = !mobile;
            const activePrimaryCar =
              runtime?.primaryCar ?? primaryCar;
            const activeReferenceCar =
              runtime?.referenceCar ?? referenceCar;
            const activeGridCars = runtime?.gridCars ?? gridCars;
            setFallbackCarShadowMode(activePrimaryCar, true);
            setFallbackCarShadowMode(activeReferenceCar, false);
            for (const car of activeGridCars.values()) {
              setGridCarShadowMode(car, mobile);
            }
          }
          const pixelRatio =
            mobile
              ? Math.min(window.devicePixelRatio || 1, 1.25)
              : Math.min(window.devicePixelRatio || 1, 2);
          renderer.setPixelRatio(pixelRatio);
          renderer.setSize(bounds.width, bounds.height, false);
          camera.aspect = bounds.width / bounds.height;
          camera.updateProjectionMatrix();
          if (runtime && latestFrameRef.current) {
            renderFrame(
              runtime,
              latestFrameRef.current,
              latestCameraRef.current,
              latestGridFrameRef.current,
              latestTelemetryRef.current,
            );
          }
        };
        const resizeObserver = new ResizeObserver(resize);
        resizeRef.current = resize;
        resizeObserver.observe(canvas);

        runtime = {
          renderer,
          scene,
          camera,
          worldPoints,
          primaryCar,
          referenceCar,
          gridCars,
          playerGridCarId,
          roadHalfWidth,
          circuitLengthMeters,
          sun,
          sunTarget,
          sunOffset,
          resizeObserver,
          cameraLookAt: new THREE.Vector3(),
          cameraUp: new THREE.Vector3(0, 1, 0),
          hasRendered: false,
          lastCameraMode: null,
          lastRenderMs: null,
          smoothedSpeedKph: 0,
          lastFocusPosition: null,
          overtakePulse: 0,
          lastModelElapsedSeconds: null,
        };
        runtimeRef.current = runtime;
        resize();
        if (
          latestFrameRef.current &&
          renderingEnabledRef.current &&
          !document.hidden
        ) {
          renderFrame(
            runtime,
            latestFrameRef.current,
            latestCameraRef.current,
            latestGridFrameRef.current,
            latestTelemetryRef.current,
          );
        }
        onAvailabilityChange?.(true);

        void Promise.all([
          loadFormulaCarTemplate(FORMULA_CAR_MODEL_ASSET),
          loadFormulaCarTemplate(
            PLAYER_FORMULA_CAR_MODEL_ASSET,
          ).catch(() => null),
        ])
          .then(([template, loadedPlayerTemplate]) => {
            if (disposed || !runtime) return;
            const playerTemplate =
              loadedPlayerTemplate ?? template;
            const playerForwardAxis = loadedPlayerTemplate
              ? PLAYER_FORMULA_CAR_MODEL_ASSET.defaultForwardAxis
              : modelForwardAxis;
            const playerTargetLength = loadedPlayerTemplate
              ? PLAYER_FORMULA_CAR_MODEL_ASSET.targetLengthMeters
              : FORMULA_CAR_MODEL_ASSET.targetLengthMeters;
            const playerTargetWidth = loadedPlayerTemplate
              ? PLAYER_FORMULA_CAR_MODEL_ASSET.targetWidthMeters
              : FORMULA_CAR_MODEL_ASSET.targetWidthMeters;
            const fallbackRuntime = runtime;
            const formulaBandGeometry = new THREE.TorusGeometry(
              1,
              0.11,
              7,
              20,
            );
            const replacementRoots: THREE.Group[] = [];

            try {
              const modelPrimaryCar = createFormulaCar(
                playerTemplate,
                {
                  primary: hexToNumber(team.primary),
                  secondary: hexToNumber(team.secondary),
                  isPlayer: true,
                  forwardAxis: playerForwardAxis,
                  compoundBandGeometry: formulaBandGeometry,
                  targetLengthMeters: playerTargetLength,
                  targetWidthMeters: playerTargetWidth,
                  addWheelCovers: true,
                },
              );
              replacementRoots.push(modelPrimaryCar.group);
              const modelReferenceCar = createFormulaCar(template, {
                primary: 0x73f1e0,
                secondary: 0x1f7f76,
                isPlayer: false,
                ghost: true,
                forwardAxis: modelForwardAxis,
                compoundBandGeometry: formulaBandGeometry,
                targetLengthMeters:
                  FORMULA_CAR_MODEL_ASSET.targetLengthMeters,
                targetWidthMeters:
                  FORMULA_CAR_MODEL_ASSET.targetWidthMeters,
                addWheelCovers: true,
              });
              replacementRoots.push(modelReferenceCar.group);

              const modelGridCars = new Map<string, GridCarModel>();
              for (const visual of gridVisuals) {
                if (modelGridCars.has(visual.id)) continue;
                const modelGridCar = createFormulaGridCar(
                  visual.isPlayer ? playerTemplate : template,
                  visual,
                  formulaBandGeometry,
                  visual.isPlayer
                    ? playerForwardAxis
                    : modelForwardAxis,
                  visual.isPlayer
                    ? playerTargetLength
                    : FORMULA_CAR_MODEL_ASSET.targetLengthMeters,
                  true,
                );
                modelGridCars.set(visual.id, modelGridCar);
                replacementRoots.push(modelGridCar.group);
              }

              modelPrimaryCar.group.visible =
                fallbackRuntime.primaryCar.group.visible;
              modelReferenceCar.group.visible =
                fallbackRuntime.referenceCar.group.visible;
              for (const [id, modelCar] of modelGridCars) {
                modelCar.group.visible =
                  fallbackRuntime.gridCars.get(id)?.group.visible ??
                  false;
              }

              scene.add(...replacementRoots);
              const fallbackRoots = [
                fallbackRuntime.primaryCar.group,
                fallbackRuntime.referenceCar.group,
                ...[...fallbackRuntime.gridCars.values()].map(
                  (car) => car.group,
                ),
              ];
              for (const root of fallbackRoots) scene.remove(root);
              disposeObjectRoots(fallbackRoots);

              runtime = {
                ...fallbackRuntime,
                primaryCar: modelPrimaryCar,
                referenceCar: modelReferenceCar,
                gridCars: modelGridCars,
              };
              runtimeRef.current = runtime;
              const mobile = mobileMode === true;
              setFallbackCarShadowMode(modelPrimaryCar, true);
              setFallbackCarShadowMode(
                modelReferenceCar,
                !mobile,
              );
              for (const car of modelGridCars.values()) {
                setGridCarShadowMode(car, mobile);
              }
              if (
                latestFrameRef.current &&
                renderingEnabledRef.current &&
                !contextLostRef.current &&
                !document.hidden
              ) {
                renderFrame(
                  runtime,
                  latestFrameRef.current,
                  latestCameraRef.current,
                  latestGridFrameRef.current,
                  latestTelemetryRef.current,
                );
              }
            } catch {
              disposeObjectRoots(replacementRoots);
              if (replacementRoots.length === 0) {
                formulaBandGeometry.dispose();
              }
            }
          })
          .catch(() => {
            // The primitive cars remain active when the optional GLB is absent
            // or malformed, so WebGL replay availability is unaffected.
          });
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : "WebGL 초기화 실패";
        onAvailabilityChange?.(false, reason);
      }

      const handleContextLost = (event: Event) => {
        event.preventDefault();
        contextLostRef.current = true;
        onAvailabilityChange?.(
          false,
          `${trackId} WebGL context lost`,
        );
      };
      const handleContextRestored = () => {
        if (disposed || !runtime) return;
        contextLostRef.current = false;
        runtime.lastRenderMs = null;
        resizeRef.current?.();
        onAvailabilityChange?.(true);
      };
      canvas.addEventListener("webglcontextlost", handleContextLost);
      canvas.addEventListener("webglcontextrestored", handleContextRestored);

      return () => {
        disposed = true;
        canvas.removeEventListener(
          "webglcontextlost",
          handleContextLost,
        );
        canvas.removeEventListener("webglcontextrestored", handleContextRestored);
        resizeRef.current = null;
        runtime?.resizeObserver.disconnect();
        if (createdScene) disposeScene(createdScene);
        createdRenderer?.dispose();
        if (runtimeRef.current === runtime) {
          runtimeRef.current = null;
        }
      };
    }, [
      circuitLengthKm,
      driver.number,
      gridVisuals,
      modelForwardAxis,
      onAvailabilityChange,
      samples,
      team.primary,
      team.secondary,
      trackId,
    ]);

    return (
      <canvas
        ref={canvasRef}
        className="race-replay__webgl"
        aria-hidden="true"
      />
    );
  },
);

export default RaceScene3D;
