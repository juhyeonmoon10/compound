export type TeamId =
  | "mercedes"
  | "ferrari"
  | "mclaren"
  | "red-bull"
  | "racing-bulls"
  | "alpine"
  | "haas"
  | "audi"
  | "williams"
  | "aston-martin"
  | "cadillac";

export interface DriverProfile {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly code: string;
  readonly number: number;
  readonly countryCode: string;
  readonly headshotUrl: string;
}

export interface CarImageProfile {
  readonly src: `/cars/${string}`;
  readonly alt: string;
  readonly sourceUrl: string;
}

export interface TeamProfile {
  readonly id: TeamId;
  readonly name: string;
  readonly shortName: string;
  readonly code: string;
  readonly carModel: string;
  readonly carImage: CarImageProfile;
  readonly primary: `#${string}`;
  readonly secondary: `#${string}`;
  readonly onPrimary: `#${string}`;
  readonly drivers: readonly [DriverProfile, DriverProfile];
}

const driverImage = (
  family: string,
  key: string,
): string =>
  `https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/${family}/${key}/${key.split("_")[0].toLowerCase()}.png.transform/1col/image.png`;

const carSource = (team: string): string =>
  `https://media.formula1.com/image/upload/c_lfill%2Cw_3392/q_auto/v1740000001/common/f1/2026/${team}/2026${team}carright.webp`;

/**
 * Official 2026 Formula 1 grid snapshot.
 *
 * Team/driver pairings, race numbers and chassis names follow Formula1.com's
 * 2026 teams and drivers pages (checked 2026-07-30). The official transparent
 * car renders are stored locally for a stable school presentation. Teams and
 * drivers remain presentation context only: every simulated car uses the same
 * base pace so that tyre strategy, not a made-up performance rating, decides
 * the model result.
 */
export const TEAM_PROFILES: readonly TeamProfile[] = [
  {
    id: "mercedes",
    name: "Mercedes",
    shortName: "MERCEDES",
    code: "MER",
    carModel: "W17",
    carImage: {
      src: "/cars/mercedes-w17.webp",
      alt: "투명 배경의 2026 Mercedes W17 공식 차량 렌더",
      sourceUrl: carSource("mercedes"),
    },
    primary: "#27F4D2",
    secondary: "#111416",
    onPrimary: "#07110F",
    drivers: [
      {
        id: "george-russell",
        firstName: "George",
        lastName: "Russell",
        code: "RUS",
        number: 63,
        countryCode: "GBR",
        headshotUrl: driverImage(
          "G/GEORUS01_George_Russell",
          "GEORUS01_George_Russell",
        ),
      },
      {
        id: "kimi-antonelli",
        firstName: "Kimi",
        lastName: "Antonelli",
        code: "ANT",
        number: 12,
        countryCode: "ITA",
        headshotUrl: driverImage(
          "K/KIMANT01_Kimi_Antonelli",
          "KIMANT01_Kimi_Antonelli",
        ),
      },
    ],
  },
  {
    id: "ferrari",
    name: "Ferrari",
    shortName: "FERRARI",
    code: "FER",
    carModel: "SF-26",
    carImage: {
      src: "/cars/ferrari-sf26.webp",
      alt: "투명 배경의 2026 Ferrari SF-26 공식 차량 렌더",
      sourceUrl: carSource("ferrari"),
    },
    primary: "#E8002D",
    secondary: "#FFEB00",
    onPrimary: "#FFFFFF",
    drivers: [
      {
        id: "charles-leclerc",
        firstName: "Charles",
        lastName: "Leclerc",
        code: "LEC",
        number: 16,
        countryCode: "MON",
        headshotUrl: driverImage(
          "C/CHALEC01_Charles_Leclerc",
          "CHALEC01_Charles_Leclerc",
        ),
      },
      {
        id: "lewis-hamilton",
        firstName: "Lewis",
        lastName: "Hamilton",
        code: "HAM",
        number: 44,
        countryCode: "GBR",
        headshotUrl: driverImage(
          "L/LEWHAM01_Lewis_Hamilton",
          "LEWHAM01_Lewis_Hamilton",
        ),
      },
    ],
  },
  {
    id: "mclaren",
    name: "McLaren",
    shortName: "McLAREN",
    code: "MCL",
    carModel: "MCL40",
    carImage: {
      src: "/cars/mclaren-mcl40.webp",
      alt: "투명 배경의 2026 McLaren MCL40 공식 차량 렌더",
      sourceUrl: carSource("mclaren"),
    },
    primary: "#FF8000",
    secondary: "#47C7FC",
    onPrimary: "#160A00",
    drivers: [
      {
        id: "lando-norris",
        firstName: "Lando",
        lastName: "Norris",
        code: "NOR",
        number: 1,
        countryCode: "GBR",
        headshotUrl: driverImage(
          "L/LANNOR01_Lando_Norris",
          "LANNOR01_Lando_Norris",
        ),
      },
      {
        id: "oscar-piastri",
        firstName: "Oscar",
        lastName: "Piastri",
        code: "PIA",
        number: 81,
        countryCode: "AUS",
        headshotUrl: driverImage(
          "O/OSCPIA01_Oscar_Piastri",
          "OSCPIA01_Oscar_Piastri",
        ),
      },
    ],
  },
  {
    id: "red-bull",
    name: "Red Bull Racing",
    shortName: "RED BULL",
    code: "RBR",
    carModel: "RB22",
    carImage: {
      src: "/cars/red-bull-rb22.webp",
      alt: "투명 배경의 2026 Red Bull Racing RB22 공식 차량 렌더",
      sourceUrl: carSource("redbullracing"),
    },
    primary: "#3671C6",
    secondary: "#FCD700",
    onPrimary: "#FFFFFF",
    drivers: [
      {
        id: "max-verstappen",
        firstName: "Max",
        lastName: "Verstappen",
        code: "VER",
        number: 3,
        countryCode: "NED",
        headshotUrl: driverImage(
          "M/MAXVER01_Max_Verstappen",
          "MAXVER01_Max_Verstappen",
        ),
      },
      {
        id: "isack-hadjar",
        firstName: "Isack",
        lastName: "Hadjar",
        code: "HAD",
        number: 6,
        countryCode: "FRA",
        headshotUrl: driverImage(
          "I/ISAHAD01_Isack_Hadjar",
          "ISAHAD01_Isack_Hadjar",
        ),
      },
    ],
  },
  {
    id: "racing-bulls",
    name: "Racing Bulls",
    shortName: "RACING BULLS",
    code: "RBU",
    carModel: "VCARB 03",
    carImage: {
      src: "/cars/racing-bulls-vcarb03.webp",
      alt: "투명 배경의 2026 Racing Bulls VCARB 03 공식 차량 렌더",
      sourceUrl: carSource("racingbulls"),
    },
    primary: "#6692FF",
    secondary: "#F4F6F8",
    onPrimary: "#07102A",
    drivers: [
      {
        id: "liam-lawson",
        firstName: "Liam",
        lastName: "Lawson",
        code: "LAW",
        number: 30,
        countryCode: "NZL",
        headshotUrl: driverImage(
          "L/LIALAW01_Liam_Lawson",
          "LIALAW01_Liam_Lawson",
        ),
      },
      {
        id: "arvid-lindblad",
        firstName: "Arvid",
        lastName: "Lindblad",
        code: "LIN",
        number: 41,
        countryCode: "GBR",
        headshotUrl: driverImage(
          "A/ARVLIN01_Arvid_Lindblad",
          "ARVLIN01_Arvid_Lindblad",
        ),
      },
    ],
  },
  {
    id: "alpine",
    name: "Alpine",
    shortName: "ALPINE",
    code: "ALP",
    carModel: "A526",
    carImage: {
      src: "/cars/alpine-a526.webp",
      alt: "투명 배경의 2026 Alpine A526 공식 차량 렌더",
      sourceUrl: carSource("alpine"),
    },
    primary: "#FF87BC",
    secondary: "#0093CC",
    onPrimary: "#170610",
    drivers: [
      {
        id: "pierre-gasly",
        firstName: "Pierre",
        lastName: "Gasly",
        code: "GAS",
        number: 10,
        countryCode: "FRA",
        headshotUrl: driverImage(
          "P/PIEGAS01_Pierre_Gasly",
          "PIEGAS01_Pierre_Gasly",
        ),
      },
      {
        id: "franco-colapinto",
        firstName: "Franco",
        lastName: "Colapinto",
        code: "COL",
        number: 43,
        countryCode: "ARG",
        headshotUrl: driverImage(
          "F/FRACOL01_Franco_Colapinto",
          "FRACOL01_Franco_Colapinto",
        ),
      },
    ],
  },
  {
    id: "haas",
    name: "Haas F1 Team",
    shortName: "HAAS",
    code: "HAS",
    carModel: "VF-26",
    carImage: {
      src: "/cars/haas-vf26.webp",
      alt: "투명 배경의 2026 Haas VF-26 공식 차량 렌더",
      sourceUrl: carSource("haas"),
    },
    primary: "#B6BABD",
    secondary: "#E6002D",
    onPrimary: "#0D0F10",
    drivers: [
      {
        id: "esteban-ocon",
        firstName: "Esteban",
        lastName: "Ocon",
        code: "OCO",
        number: 31,
        countryCode: "FRA",
        headshotUrl: driverImage(
          "E/ESTOCO01_Esteban_Ocon",
          "ESTOCO01_Esteban_Ocon",
        ),
      },
      {
        id: "oliver-bearman",
        firstName: "Oliver",
        lastName: "Bearman",
        code: "BEA",
        number: 87,
        countryCode: "GBR",
        headshotUrl: driverImage(
          "O/OLIBEA01_Oliver_Bearman",
          "OLIBEA01_Oliver_Bearman",
        ),
      },
    ],
  },
  {
    id: "audi",
    name: "Audi",
    shortName: "AUDI",
    code: "AUD",
    carModel: "R26",
    carImage: {
      src: "/cars/audi-r26.webp",
      alt: "투명 배경의 2026 Audi R26 공식 차량 렌더",
      sourceUrl: carSource("audi"),
    },
    primary: "#F50537",
    secondary: "#0B0D0F",
    onPrimary: "#FFFFFF",
    drivers: [
      {
        id: "nico-hulkenberg",
        firstName: "Nico",
        lastName: "Hulkenberg",
        code: "HUL",
        number: 27,
        countryCode: "GER",
        headshotUrl: driverImage(
          "N/NICHUL01_Nico_Hulkenberg",
          "NICHUL01_Nico_Hulkenberg",
        ),
      },
      {
        id: "gabriel-bortoleto",
        firstName: "Gabriel",
        lastName: "Bortoleto",
        code: "BOR",
        number: 5,
        countryCode: "BRA",
        headshotUrl: driverImage(
          "G/GABBOR01_Gabriel_Bortoleto",
          "GABBOR01_Gabriel_Bortoleto",
        ),
      },
    ],
  },
  {
    id: "williams",
    name: "Williams",
    shortName: "WILLIAMS",
    code: "WIL",
    carModel: "FW48",
    carImage: {
      src: "/cars/williams-fw48.webp",
      alt: "투명 배경의 2026 Williams FW48 공식 차량 렌더",
      sourceUrl: carSource("williams"),
    },
    primary: "#64C4FF",
    secondary: "#041E42",
    onPrimary: "#04111B",
    drivers: [
      {
        id: "carlos-sainz",
        firstName: "Carlos",
        lastName: "Sainz",
        code: "SAI",
        number: 55,
        countryCode: "ESP",
        headshotUrl: driverImage(
          "C/CARSAI01_Carlos_Sainz",
          "CARSAI01_Carlos_Sainz",
        ),
      },
      {
        id: "alexander-albon",
        firstName: "Alexander",
        lastName: "Albon",
        code: "ALB",
        number: 23,
        countryCode: "THA",
        headshotUrl: driverImage(
          "A/ALEALB01_Alexander_Albon",
          "ALEALB01_Alexander_Albon",
        ),
      },
    ],
  },
  {
    id: "aston-martin",
    name: "Aston Martin",
    shortName: "ASTON MARTIN",
    code: "AMR",
    carModel: "AMR26",
    carImage: {
      src: "/cars/aston-martin-amr26.webp",
      alt: "투명 배경의 2026 Aston Martin AMR26 공식 차량 렌더",
      sourceUrl: carSource("astonmartin"),
    },
    primary: "#229971",
    secondary: "#CEDC00",
    onPrimary: "#06110D",
    drivers: [
      {
        id: "fernando-alonso",
        firstName: "Fernando",
        lastName: "Alonso",
        code: "ALO",
        number: 14,
        countryCode: "ESP",
        headshotUrl: driverImage(
          "F/FERALO01_Fernando_Alonso",
          "FERALO01_Fernando_Alonso",
        ),
      },
      {
        id: "lance-stroll",
        firstName: "Lance",
        lastName: "Stroll",
        code: "STR",
        number: 18,
        countryCode: "CAN",
        headshotUrl: driverImage(
          "L/LANSTR01_Lance_Stroll",
          "LANSTR01_Lance_Stroll",
        ),
      },
    ],
  },
  {
    id: "cadillac",
    name: "Cadillac",
    shortName: "CADILLAC",
    code: "CAD",
    carModel: "MAC-26",
    carImage: {
      src: "/cars/cadillac-mac26.webp",
      alt: "투명 배경의 2026 Cadillac MAC-26 공식 차량 렌더",
      sourceUrl: carSource("cadillac"),
    },
    primary: "#D7D9DB",
    secondary: "#111315",
    onPrimary: "#08090A",
    drivers: [
      {
        id: "sergio-perez",
        firstName: "Sergio",
        lastName: "Perez",
        code: "PER",
        number: 11,
        countryCode: "MEX",
        headshotUrl: driverImage(
          "S/SERPER01_Sergio_Perez",
          "SERPER01_Sergio_Perez",
        ),
      },
      {
        id: "valtteri-bottas",
        firstName: "Valtteri",
        lastName: "Bottas",
        code: "BOT",
        number: 77,
        countryCode: "FIN",
        headshotUrl: driverImage(
          "V/VALBOT01_Valtteri_Bottas",
          "VALBOT01_Valtteri_Bottas",
        ),
      },
    ],
  },
];

export const DEFAULT_TEAM_ID: TeamId = "red-bull";

export function findTeamProfile(teamId: TeamId): TeamProfile {
  return (
    TEAM_PROFILES.find((team) => team.id === teamId) ??
    TEAM_PROFILES[0]
  );
}
