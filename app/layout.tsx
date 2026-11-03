import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ИИ-агент",
  description: "Чат с локальным ИИ-агентом",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
