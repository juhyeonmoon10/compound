import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import "./strategy.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.includes("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;

  return {
    metadataBase: new URL(origin),
    title: "compound | 데이터 기반 F1 타이어 전략 알고리즘",
    description:
      "공개 F1 데이터를 분석하고 실제 서킷의 타이어 전략 상위 3개를 계산·비교하는 비공식·비영리 시뮬레이터입니다. 직접 전략 설계와 실험 기록을 제공합니다.",
    applicationName: "compound",
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title: "compound | 타이어 전략 알고리즘",
      description:
        "동적계획법으로 계산한 타이어 전략, 공개 데이터 분석, 직접 전략 설계와 재현 가능한 실험 기록을 한곳에서 비교합니다.",
      type: "website",
      locale: "ko_KR",
      url: origin,
      images: [
        {
          url: `${origin}/og.png`,
          width: 1672,
          height: 941,
          alt: "compound — 데이터 기반 F1 타이어 전략 분석",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "compound | 타이어 전략 알고리즘",
      description:
        "운전 실력 없이 타이어 전략만 바꿔 겨루는 20대 자동 레이스 시뮬레이터",
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
