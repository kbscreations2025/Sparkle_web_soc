import type { Metadata } from "next";
import { headers } from "next/headers";
import { Inter, Playfair_Display } from "next/font/google";
import { AuthProvider } from "@/lib/auth-context";
import { USER_HEADER, decodeUser } from "@/lib/session-header";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sparkle — Brilliance... Made effortless",
  description: "Transform raw jewellery photos into ultra-premium AI visuals.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Set by the proxy, which has already verified the session — so the app can
  // render signed-in on first paint instead of asking the backend again.
  const initialUser = decodeUser((await headers()).get(USER_HEADER));

  return (
    <html lang="en" data-theme="light" className={`${inter.variable} ${playfair.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-void text-cream font-sans">
        <AuthProvider initialUser={initialUser}>{children}</AuthProvider>
      </body>
    </html>
  );
}
