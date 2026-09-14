import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // pdfkit 内部通过 fs 加载字体文件，需排除出打包（Task 54 主数据体检 PDF）
  serverExternalPackages: ["pdfkit"],
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
