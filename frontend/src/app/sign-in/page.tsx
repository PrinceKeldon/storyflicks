import SignInForm from "./sign-in-form";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; mode?: string }> }) {
  const { next, mode } = await searchParams;
  const redirectTo = next?.startsWith("/") && !next.startsWith("//") ? next : "/library";
  return <SignInForm redirectTo={redirectTo} initialMode={mode === "signup" ? "signup" : "signin"} />;
}
