import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "石化盲板管理系统 | BPMS",
  description: "石化装置盲板抽堵作业全流程数字化管控：作业需求、现场勘察、JSA分析、隔离方案、工艺处置、作业票、作业执行与验收、盲板台账",
  keywords: ["盲板管理", "盲板抽堵", "特殊作业", "JSA分析", "作业票", "石化", "HSE"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
