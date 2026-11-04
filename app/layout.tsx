import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ИИ-агент",
  description: "Чат с локальным ИИ-агентом",
};

const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem("web-agent-theme");if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t);}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
