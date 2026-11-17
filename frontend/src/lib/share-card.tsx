import { ImageResponse } from "next/og";

const YELLOW = "#ffd60a";
const TURQUOISE = "#19e3c8";
const RED = "#ff4136";

export type ShareCardInput = {
  title: string;
  author?: string | null;
  tagline?: string | null;
  genres?: string[];
  coverUrl?: string | null;
};

// Satori (behind ImageResponse) draws PNG and JPEG, not WebP. Fetch the cover ourselves with a short
// timeout so a slow or unsupported image can never break the card; without it the poster block is used.
async function coverDataUri(url: string | null | undefined): Promise<string | null> {
  if (!url || !/^https:\/\//i.test(url)) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000), cache: "force-cache" });
    const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!response.ok || !["image/png", "image/jpeg"].includes(type)) return null;
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 3_000_000) return null;
    return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return null;
  }
}

function clip(value: string | null | undefined, max: number): string {
  const text = (value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max - 1).replace(/[\s,.;:!-]+$/, "") + "…" : text;
}

export async function renderShareCard(input?: ShareCardInput): Promise<ImageResponse> {
  const cover = input ? await coverDataUri(input.coverUrl) : null;
  const title = clip(input?.title, 64).toUpperCase();
  const long = title.length > 40;
  const titleSize = long ? 46 : title.length > 22 ? 72 : 92;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#000000", color: "#f4f0e6" }}>
        <div style={{ width: 420, height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: RED }}>
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover} alt="" width={420} height={630} style={{ width: 420, height: 630, objectFit: "cover" }} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", color: "#000" }}>
              <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: 4 }}>STORYFLICKS</div>
              <div style={{ width: 120, height: 6, background: "#000", marginTop: 18 }} />
            </div>
          )}
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "56px 64px" }}>
          <div style={{ display: "flex", fontSize: 30, fontWeight: 700, letterSpacing: 3 }}>
            STORYFLICKS<span style={{ color: YELLOW }}>.</span>
          </div>
          {input ? (
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: titleSize, fontWeight: 800, lineHeight: 1.05, color: "#ffffff" }}>{title}</div>
              {input.author ? <div style={{ marginTop: 18, fontSize: 32, color: TURQUOISE }}>{`by ${clip(input.author, 30)}`}</div> : null}
              {input.tagline ? <div style={{ marginTop: 18, fontSize: long ? 26 : 30, lineHeight: 1.3, color: "#b3b3b3" }}>{clip(input.tagline, long ? 90 : 120)}</div> : null}
            </div>
          ) : (
            <div style={{ display: "flex", fontSize: 84, fontWeight: 800, lineHeight: 1.05, color: "#ffffff" }}>
              Stories worth staying for.
            </div>
          )}
          <div style={{ display: "flex", gap: 12 }}>
            {(input?.genres || []).slice(0, 3).map(genre => (
              <div key={genre} style={{ display: "flex", padding: "8px 20px", borderRadius: 999, background: YELLOW, color: "#000", fontSize: 24, fontWeight: 700 }}>
                {clip(genre, 24)}
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
