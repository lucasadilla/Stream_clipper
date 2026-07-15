"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn, signOut } from "next-auth/react";
import posthog from "posthog-js";
import { fetchJson } from "@/lib/apiClient";
import { cn } from "@/lib/cn";
import type { BillingAccountSummary } from "@/services/billingService";

type ProviderInfo = { id: string; name: string };

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [creatorCode, setCreatorCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [account, setAccount] = useState<BillingAccountSummary | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [emailEnabled, setEmailEnabled] = useState(false);

  const authError = searchParams.get("error");

  useEffect(() => {
    void fetchJson<{
      providers: ProviderInfo[];
      emailEnabled: boolean;
    }>("/api/auth/providers").then(({ data }) => {
      setProviders(data.providers ?? []);
      setEmailEnabled(Boolean(data.emailEnabled));
    });

    void fetchJson<{ account: BillingAccountSummary | null }>("/api/auth/me").then(
      ({ data }) => {
        if (data.account) {
          setAccount(data.account);
          posthog.identify(data.account.id, { email: data.account.email });
        }
      }
    );
  }, []);

  useEffect(() => {
    if (!authError) return;
    setError(
      authError === "OAuthAccountNotLinked"
        ? "That email is already linked to another sign-in method. Use the original provider."
        : "Sign-in failed. Try another provider or email magic link."
    );
  }, [authError]);

  const oauthProviders = useMemo(
    () => providers.filter((p) => p.id !== "resend"),
    [providers]
  );

  async function stashCreatorCode() {
    await fetch("/api/auth/pending-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ code: creatorCode.trim() || null }),
    });
  }

  async function handleOAuth(providerId: string) {
    setLoading(true);
    setError(null);
    try {
      await stashCreatorCode();
      await signIn(providerId, { callbackUrl: "/welcome" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
      setLoading(false);
    }
  }

  async function handleEmail(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setEmailSent(false);
    try {
      await stashCreatorCode();
      if (emailEnabled) {
        const result = await signIn("resend", {
          email,
          redirect: false,
          callbackUrl: "/welcome",
        });
        if (result?.error) throw new Error(result.error);
        setEmailSent(true);
        return;
      }

      const { ok, data } = await fetchJson<{
        account?: BillingAccountSummary;
        error?: string;
      }>("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          inviteCode: creatorCode.trim() || undefined,
        }),
      });
      if (!ok || !data.account) {
        throw new Error(
          data.error ??
            "Email magic link is not configured. Use Google, Twitch, or Kick — or set AUTH_RESEND_KEY."
        );
      }
      posthog.identify(data.account.id, { email: data.account.email });
      posthog.capture("user_signed_in", {
        unlimited_access: data.account.unlimitedAccess ?? false,
      });
      setAccount(data.account);
      router.push("/welcome");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    posthog.capture("user_signed_out");
    posthog.reset();
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    await signOut({ redirect: false });
    setAccount(null);
    router.refresh();
  }

  return (
    <section className="relative isolate min-h-[calc(100svh-3.5rem)] overflow-hidden border-b border-[var(--color-card-border)] bg-[#020302]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(149,255,0,0.08),transparent_42%),radial-gradient(circle_at_bottom_right,rgba(149,255,0,0.05),transparent_36%)]" />

      <div className="relative mx-auto grid max-w-[1440px] gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1fr_0.92fr] lg:items-center lg:gap-16 lg:px-8 lg:py-20">
        <div className="max-w-xl">
          <p className="text-xs font-semibold uppercase text-[var(--color-accent)] sm:text-sm">
            Clipper / account
          </p>
          <h1 className="marketing-display-title mt-4 font-semibold text-white">
            Sign in securely
          </h1>
          <p className="mt-5 text-lg leading-8 text-white/74 sm:text-xl sm:leading-9">
            Use Google, Twitch, Kick, or a magic-link email. Optionally enter a
            Creator Program code during signup, then subscribe if you need a paid
            plan.
          </p>
          <ul className="mt-8 space-y-3 text-sm leading-6 text-[var(--color-muted)]">
            <li>OAuth sign-in — no shared passwords stored by Clipper</li>
            <li>Creator codes unlock beta seats for select creators</li>
            <li>After sign-in you can subscribe to Creator, Pro, or Studio</li>
          </ul>
        </div>

        <div className="border border-[var(--color-card-border)] bg-[#050805] p-6 sm:p-8">
          {account ? (
            <div className="space-y-5">
              <div>
                <p className="text-xs font-semibold uppercase text-[var(--color-muted)]">
                  Signed in
                </p>
                <p className="mt-3 text-2xl font-semibold text-white">
                  {account.displayName || account.email}
                </p>
                <p className="mt-1 text-sm text-[var(--color-muted)]">
                  {account.email}
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Link
                  href="/welcome"
                  className="inline-flex h-12 items-center justify-center bg-[var(--color-accent)] px-4 text-sm font-semibold text-black hover:bg-[var(--color-accent-hover)]"
                >
                  Continue
                </Link>
                <button
                  type="button"
                  onClick={() => void handleLogout()}
                  className="inline-flex h-12 items-center justify-center border border-[var(--color-card-border)] px-4 text-sm font-semibold text-white/80 hover:border-[var(--color-accent)] hover:text-white"
                >
                  Sign out
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <p className="text-xs font-semibold uppercase text-[var(--color-muted)]">
                  Continue with
                </p>
              </div>

              <div className="grid gap-2">
                {oauthProviders.length === 0 && !emailEnabled && (
                  <p className="text-sm text-[var(--color-danger)]">
                    No OAuth providers configured. Add AUTH_GOOGLE_*,
                    AUTH_TWITCH_*, AUTH_KICK_*, and/or AUTH_RESEND_KEY.
                  </p>
                )}
                {oauthProviders.map((provider) => (
                  <button
                    key={provider.id}
                    type="button"
                    disabled={loading}
                    onClick={() => void handleOAuth(provider.id)}
                    className="inline-flex h-12 items-center justify-center border border-[var(--color-card-border)] px-4 text-sm font-semibold text-white transition-colors hover:border-[var(--color-accent)] disabled:opacity-50"
                  >
                    Continue with {provider.name}
                  </button>
                ))}
              </div>

              <div className="relative py-1 text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-[#5f6b5c]">
                or email
              </div>

              <form onSubmit={(e) => void handleEmail(e)} className="space-y-4">
                <label className="block space-y-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                    Email
                  </span>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className={cn(
                      "h-12 w-full border border-[var(--color-card-border)] bg-[#020302]/92 px-4 text-sm text-white",
                      "placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:outline-none"
                    )}
                  />
                </label>

                <label className="block space-y-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                    Creator program code (optional)
                  </span>
                  <input
                    type="text"
                    value={creatorCode}
                    onChange={(e) => setCreatorCode(e.target.value)}
                    placeholder="SCB-XXXX-XXXX-XXXX"
                    className={cn(
                      "h-12 w-full border border-[var(--color-card-border)] bg-[#020302]/92 px-4 font-mono text-sm uppercase text-white",
                      "placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:outline-none"
                    )}
                  />
                </label>

                {emailSent && (
                  <p className="text-sm text-[var(--color-accent)]">
                    Check your inbox for a magic sign-in link.
                  </p>
                )}
                {error && (
                  <p className="text-sm text-[var(--color-danger)]">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="h-12 w-full bg-[var(--color-accent)] text-sm font-semibold text-black hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
                >
                  {loading
                    ? "Working…"
                    : emailEnabled
                      ? "Email me a magic link"
                      : "Sign in with email"}
                </button>
              </form>

              <p className="text-xs leading-5 text-[var(--color-muted)]">
                Prefer plans first?{" "}
                <Link
                  href="/#pricing"
                  className="text-[var(--color-accent)] hover:underline"
                >
                  See pricing
                </Link>
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center text-sm text-[var(--color-muted)]">
          Loading…
        </div>
      }
    >
      <LoginPageInner />
    </Suspense>
  );
}
