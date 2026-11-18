// Remote images (story covers, chapter art) live in the Supabase public storage bucket.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
let supabaseHost = null;
try { supabaseHost = supabaseUrl ? new URL(supabaseUrl).hostname : null; } catch {}

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: supabaseHost
      ? [{ protocol: "https", hostname: supabaseHost, pathname: "/storage/v1/object/public/**" }]
      : [],
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24,
  },
};

export default nextConfig;
