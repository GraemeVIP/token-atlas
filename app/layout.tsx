import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Token Atlas — Claude Code & Codex usage",
  description:
    "Where your Claude Code and Codex tokens actually go: by model, reasoning effort, lane, project and tool.",
};

/**
 * Stamps the saved theme before first paint. Without this the page paints
 * once under the OS scheme and then swaps, which both flashes and leaves
 * some `var()`-driven backgrounds resolved against the old scheme.
 */
const THEME_INIT = `(function(){try{var t=localStorage.getItem('ta-theme');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.setAttribute('data-theme',t)}catch(e){document.documentElement.setAttribute('data-theme','light')}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
