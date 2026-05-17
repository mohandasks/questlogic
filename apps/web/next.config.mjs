/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { allowedOrigins: ["localhost:3000"] },
  },
  transpilePackages: ["@questlogic/shared"],
};

export default nextConfig;
