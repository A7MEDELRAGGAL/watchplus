/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Scraped posters/backdrops can come from any CDN. We proxy every image
  // through /api/img so no host ever has to be whitelisted here.
  images: {
    loader: 'custom',
    loaderFile: './src/lib/image-loader.ts',
    unoptimized: false,
  },

  eslint: {
    dirs: ['src', 'scripts'],
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
