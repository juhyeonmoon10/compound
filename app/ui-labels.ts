/** Display-only translations. Model identifiers and source records are unchanged. */
const LABELS: Readonly<Record<string, string>> = {
  Mercedes: "메르세데스", Ferrari: "페라리", McLaren: "맥라렌",
  "Red Bull Racing": "레드불 레이싱", "Racing Bulls": "레이싱 불스",
  Alpine: "알핀", "Haas F1 Team": "하스 F1 팀", Audi: "아우디",
  Williams: "윌리엄스", "Aston Martin": "애스턴 마틴", Cadillac: "캐딜락",
  George: "조지", Russell: "러셀", Kimi: "키미", Antonelli: "안토넬리",
  Charles: "샤를", Leclerc: "르클레르", Lewis: "루이스", Hamilton: "해밀턴",
  Lando: "랜도", Norris: "노리스", Oscar: "오스카", Piastri: "피아스트리",
  Max: "막스", Verstappen: "베르스타펜", Isack: "아이작", Hadjar: "하자르",
  Liam: "리암", Lawson: "로슨", Arvid: "아르비드", Lindblad: "린드블라드",
  Pierre: "피에르", Gasly: "가슬리", Franco: "프랑코", Colapinto: "콜라핀토",
  Esteban: "에스테반", Ocon: "오콘", Oliver: "올리버", Bearman: "베어먼",
  Nico: "니코", Hulkenberg: "휠켄베르크", Gabriel: "가브리엘", Bortoleto: "보르툴레투",
  Carlos: "카를로스", Sainz: "사인츠", Alexander: "알렉산더", Albon: "알본",
  Fernando: "페르난도", Alonso: "알론소", Lance: "랜스", Stroll: "스트롤",
  Sergio: "세르히오", Perez: "페레스", Valtteri: "발테리", Bottas: "보타스",
  Australia: "호주", China: "중국", Japan: "일본", Bahrain: "바레인",
  "Saudi Arabia": "사우디아라비아", "United States": "미국", Canada: "캐나다",
  Monaco: "모나코", Spain: "스페인", Austria: "오스트리아", "United Kingdom": "영국",
  Belgium: "벨기에", Hungary: "헝가리", Netherlands: "네덜란드", Italy: "이탈리아",
  Azerbaijan: "아제르바이잔", Singapore: "싱가포르", Mexico: "멕시코", Brazil: "브라질",
  Qatar: "카타르", "United Arab Emirates": "아랍에미리트",
  "Albert Park Grand Prix Circuit": "앨버트 파크 서킷",
  "Shanghai International Circuit": "상하이 인터내셔널 서킷",
  "Suzuka International Racing Course": "스즈카 서킷",
  "Bahrain International Circuit": "바레인 인터내셔널 서킷",
  "Jeddah Corniche Circuit": "제다 코니시 서킷", "Miami International Autodrome": "마이애미 서킷",
  "Circuit Gilles-Villeneuve": "질 빌뇌브 서킷", "Circuit de Monaco": "모나코 서킷",
  "Circuit de Barcelona-Catalunya": "바르셀로나 카탈루냐 서킷", "Red Bull Ring": "레드불 링",
  "Silverstone Circuit": "실버스톤 서킷", "Circuit de Spa-Francorchamps": "스파 프랑코샹 서킷",
  Hungaroring: "헝가로링", "Circuit Zandvoort": "잔드보르트 서킷",
  "Autodromo Nazionale di Monza": "몬차 서킷", Monza: "몬차", Madring: "마드링",
  "Baku City Circuit": "바쿠 시티 서킷", "Marina Bay Street Circuit": "마리나 베이 서킷",
  "Circuit of the Americas": "서킷 오브 디 아메리카스",
  "Autodromo Hermanos Rodriguez": "에르마노스 로드리게스 서킷",
  "Autodromo Jose Carlos Pace": "인터라고스 서킷", "Las Vegas Strip Circuit": "라스베이거스 스트립 서킷",
  "Lusail International Circuit": "루사일 인터내셔널 서킷", "Yas Marina Circuit": "야스 마리나 서킷",
  Soft: "소프트", Medium: "미디엄", Hard: "하드", Intermediate: "인터미디엇", Wet: "웨트",
  SOFT: "소프트", MEDIUM: "미디엄", HARD: "하드", INTERMEDIATE: "인터미디엇", WET: "웨트",
  GP: "그랑프리", Race: "결승", RACE: "결승",
};

export function uiLabel(value: string): string {
  const translated = LABELS[value] ?? value.split(" ").map((part) => LABELS[part] ?? part).join(" ");
  return translated
    .replace(/\b(Soft|Medium|Hard|Race|GP)\b/g, (word) => LABELS[word] ?? word)
    .replaceAll("프로젝트값", "가정값")
    .replaceAll("프로젝트 모델", "가정 기반 모델");
}
