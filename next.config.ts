import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const staticExport = process.env.STATIC_EXPORT === "1";

const nextConfig: NextConfig = staticExport
  ? {
      output: "export",
      images: {
        unoptimized: true,
      },
    }
  : {
      outputFileTracingIncludes: {
        "/api/*": ["./data/agent.json"],
      },
    };

export default withNextIntl(nextConfig);
