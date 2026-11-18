import Image from "next/image";
import type { CSSProperties } from "react";

const supabaseHost = (() => {
  try { return process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname : null; } catch { return null; }
})();

/** Only Supabase public-storage images are configured for Next's optimiser; anything else stays a plain <img>. */
function optimisable(src: string) {
  try {
    const url = new URL(src);
    return Boolean(supabaseHost) && url.protocol === "https:" && url.hostname === supabaseHost && url.pathname.startsWith("/storage/v1/object/public/");
  } catch { return false; }
}

type Props = {
  src: string;
  alt: string;
  className?: string;
  sizes: string;
  priority?: boolean;
  /** Fill the (positioned) parent, like the existing absolutely-positioned cover images. */
  fill?: boolean;
  width?: number;
  height?: number;
  style?: CSSProperties;
};

export default function RemoteImage({ src, alt, className, sizes, priority, fill, width, height, style }: Props) {
  if (!optimisable(src)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={className} src={src} alt={alt} loading={priority ? "eager" : "lazy"} decoding="async" style={style} />;
  }
  return fill
    ? <Image className={className} src={src} alt={alt} fill sizes={sizes} priority={priority} style={style} />
    : <Image className={className} src={src} alt={alt} width={width ?? 400} height={height ?? 600} sizes={sizes} priority={priority} style={style} />;
}
