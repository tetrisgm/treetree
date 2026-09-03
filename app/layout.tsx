import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Cormorant_Garamond, Plus_Jakarta_Sans, Vazirmatn } from "next/font/google";
import "./globals.css";
import { isRtl, LANG_COOKIE, parseLang } from "../lib/i18n";
import { archiveName, archiveTagline, publicOrigin } from "../lib/archive-config";
import { inlineRegistrarScript } from "../lib/webmcp-descriptors";

const sans = Plus_Jakarta_Sans({ variable: "--font-sans", subsets: ["latin"] });
// Persian needs a face with real Arabic-script coverage; Vazirmatn is the
// standard choice and carries Latin too, so mixed lines stay even.
const persian = Vazirmatn({ variable: "--font-persian", subsets: ["arabic", "latin"], weight: ["400", "500", "600", "700"] });
const serif = Cormorant_Garamond({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["500", "600"],
});

/* viewport-fit=cover is what makes env(safe-area-inset-*) mean anything on a
   phone with a notch and a home indicator; without it iOS letterboxes the
   page and every inset reads as zero. Apple's guidance is to cover the screen
   and then keep content out of those insets yourself, which globals.css does. */
export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" as const };

export function generateMetadata(): Metadata {
  const name = archiveName();
  const tagline = archiveTagline();
  return {
    metadataBase: new URL(publicOrigin()),
    title: `${name} · Our family tree`,
    description: tagline,
    openGraph: {
      title: name,
      description: tagline,
      images: [{ url: "/og.png", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: name,
      description: tagline,
      images: ["/og.png"],
    },
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const lang = parseLang((await cookies()).get(LANG_COOKIE)?.value);
  return (
    <html lang={lang} dir={isRtl(lang) ? "rtl" : "ltr"}>
      {/* demo instance: WebMCP tools exist the moment the document parses,
          before hydration - an agent that enumerates early still finds them */}
      {process.env.WEBMCP_DEMO === "1" && <head><script dangerouslySetInnerHTML={{ __html: inlineRegistrarScript() }} /></head>}
      <body className={`${sans.variable} ${serif.variable} ${persian.variable}`}><div className="grain-overlay" aria-hidden="true" />{children}</body>
    </html>
  );
}
