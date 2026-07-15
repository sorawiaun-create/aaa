/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Enables instrumentation.ts so the automation scheduler boots with the server.
    instrumentationHook: true,
  },
};

module.exports = nextConfig;
