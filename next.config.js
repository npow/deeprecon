/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  serverExternalPackages: ['puppeteer', 'puppeteer-core'],
}

module.exports = nextConfig
