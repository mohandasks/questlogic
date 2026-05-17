import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QuestLogic AI",
  description: "Level up your learning. Subjects as skill trees, sessions as quests.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
