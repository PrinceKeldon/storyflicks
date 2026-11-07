import SignInForm from "./sign-in-form";

function safeRedirectTarget(next?: string) {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return "/library";
  }

  try {
    const destination = new URL(next, "https://storyflicks.live");
    if (destination.origin !== "https://storyflicks.live") return "/library";
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return "/library";
  }
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; mode?: string }> }) {
  const { next, mode } = await searchParams;
  return <SignInForm redirectTo={safeRedirectTarget(next)} initialMode={mode === "signup" ? "signup" : "signin"} />;
}
