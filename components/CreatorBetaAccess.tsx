"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { BillingAccountSummary } from "@/services/billingService";

const BENEFITS = [
  "Free access during the beta",
  "AI clip suggestions",
  "Video rendering",
  "Platform-ready exports",
  "Help creating clips for YouTube Shorts, TikTok, Instagram, Facebook, and X",
  "Early access to new features",
];

const LIMITS = [
  "25 rendered clips per month",
  "10 video uploads per month",
  "Maximum source video length: 3 hours",
  "Maximum rendered clip length: 60 seconds",
];

const TERMS = [
  "You can use the product for free during the beta.",
  "You are responsible for having rights to the videos you upload.",
  "Your videos are processed to provide the service.",
  "We will not use your clips for marketing unless you explicitly approve a specific clip.",
  "You can request deletion of uploaded videos or rendered clips.",
  "Beta access can be paused, changed, or ended while the product is being developed.",
];

export function CreatorBetaAccess() {
  const router = useRouter();
  const [account, setAccount] = useState<BillingAccountSummary | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [betaActive, setBetaActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/creator-beta/status", { cache: "no-store" })
      .then((response) => response.json())
      .then((body) => {
        setAccount(body.account ?? null);
        setBetaActive(Boolean(body.active));
        if (body.account?.email) setEmail(body.account.email);
      })
      .finally(() => setChecking(false));
  }, []);

  async function unlock(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/creator-beta/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          email: account ? undefined : email,
          termsAccepted: accepted,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not unlock access");
      setAccount(body.account);
      setBetaActive(true);
      setSuccess(
        "Creator Beta unlocked. You now have access to free beta clip creation."
      );
      router.refresh();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "That code is invalid or expired."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="bg-[#020302] text-white">
      <section className="border-b border-[#20271e]">
        <div className="mx-auto grid max-w-[1440px] gap-12 px-4 py-14 sm:px-7 lg:grid-cols-[1.08fr_0.92fr] lg:items-center lg:py-20">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase text-[#95ff00]">
              Invite-only / Creator Beta
            </p>
            <h1 className="mt-5 max-w-4xl font-[var(--font-display)] text-5xl leading-[0.92] text-white sm:text-7xl lg:text-[6rem]">
              Turn your streams into platform-ready clips with AI.
            </h1>
            <p className="mt-7 max-w-2xl text-base leading-7 text-[#9ba596] sm:text-lg">
              Creator Beta gives selected creators free limited access to AI clip
              creation, video rendering, and platform exports.
            </p>
          </div>

          <div className="border border-[#33402e] bg-[#050705] p-5 sm:p-8">
            <p className="font-mono text-[9px] font-bold uppercase text-[#95ff00]">
              Private access
            </p>
            <h2 className="mt-3 text-3xl font-bold">Unlock Creator Beta Access</h2>
            <p className="mt-3 text-sm leading-6 text-[#929d8d]">
              Enter your private Creator Beta code to start creating AI-powered clips.
            </p>

            {betaActive ? (
              <div className="mt-7 border-l-2 border-[#95ff00] bg-[#0a1008] p-4">
                <p className="font-bold text-[#95ff00]">Creator Beta: Active</p>
                <p className="mt-2 text-sm text-[#c5cec0]">
                  Creator Beta unlocked. You now have access to free beta clip creation.
                </p>
                <Link
                  href="/#analyze"
                  className="mt-5 inline-flex bg-[#95ff00] px-4 py-3 text-xs font-black text-black hover:bg-[#b2ff48]"
                >
                  Start creating clips
                </Link>
              </div>
            ) : (
              <form onSubmit={(event) => void unlock(event)} className="mt-7 space-y-5">
                {!account && !checking && (
                  <label className="block space-y-2">
                    <span className="font-mono text-[9px] font-bold uppercase text-[#7e8978]">
                      Email for sign in
                    </span>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="creator@example.com"
                      className="h-12 w-full border border-[#34402f] bg-[#020302] px-4 text-sm text-white outline-none placeholder:text-[#596253] focus:border-[#95ff00]"
                    />
                  </label>
                )}
                <label className="block space-y-2">
                  <span className="font-mono text-[9px] font-bold uppercase text-[#7e8978]">
                    Access code
                  </span>
                  <input
                    type="text"
                    required
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(event) => setCode(event.target.value.toUpperCase())}
                    placeholder="SCB-XXXX-XXXX-XXXX"
                    className="h-12 w-full border border-[#34402f] bg-[#020302] px-4 font-mono text-sm uppercase text-white outline-none placeholder:text-[#596253] focus:border-[#95ff00]"
                  />
                </label>
                <label className="flex cursor-pointer items-start gap-3 border-t border-[#20271e] pt-5">
                  <input
                    type="checkbox"
                    required
                    checked={accepted}
                    onChange={(event) => setAccepted(event.target.checked)}
                    className="mt-1 h-4 w-4 accent-[#95ff00]"
                  />
                  <span className="text-sm leading-6 text-[#bdc6b8]">
                    I understand and accept the Creator Beta terms.
                  </span>
                </label>

                {error && <p className="text-sm text-[#ff8d84]">{error}</p>}
                {success && <p className="text-sm text-[#95ff00]">{success}</p>}

                <button
                  type="submit"
                  disabled={loading || checking || !accepted}
                  className="h-12 w-full bg-[#95ff00] text-sm font-black text-black hover:bg-[#b2ff48] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {loading ? "Unlocking access..." : "Unlock Access"}
                </button>
                <p className="text-xs leading-5 text-[#6f796a]">
                  Creator Beta is invite-only right now. You need an access code to use beta features.
                </p>
              </form>
            )}
          </div>
        </div>
      </section>

      <section className="border-b border-[#20271e]">
        <div className="mx-auto grid max-w-[1440px] gap-px bg-[#20271e] sm:grid-cols-2 lg:grid-cols-3">
          <div className="bg-[#020302] px-5 py-10 sm:px-7">
            <p className="font-mono text-[9px] font-bold uppercase text-[#95ff00]">What you get</p>
            <ul className="mt-5 space-y-3">
              {BENEFITS.map((item) => <li key={item} className="border-t border-[#20271e] pt-3 text-sm leading-6 text-[#b9c2b4] first:border-t-0 first:pt-0">{item}</li>)}
            </ul>
          </div>
          <div className="bg-[#020302] px-5 py-10 sm:px-7">
            <p className="font-mono text-[9px] font-bold uppercase text-[#95ff00]">Beta limits</p>
            <ul className="mt-5 space-y-3">
              {LIMITS.map((item) => <li key={item} className="border-t border-[#20271e] pt-3 text-sm leading-6 text-[#b9c2b4] first:border-t-0 first:pt-0">{item}</li>)}
            </ul>
          </div>
          <div className="bg-[#020302] px-5 py-10 sm:col-span-2 sm:px-7 lg:col-span-1">
            <p className="font-mono text-[9px] font-bold uppercase text-[#95ff00]">What we ask</p>
            <ul className="mt-5 space-y-3 text-sm leading-6 text-[#b9c2b4]">
              <li>Give feedback when possible.</li>
              <li>Report bugs or issues.</li>
              <li>Only upload videos you have the right to use.</li>
              <li>Understand that beta access can be paused, changed, or ended while the product is being developed.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="border-b border-[#20271e]">
        <div className="mx-auto grid max-w-[1440px] gap-10 px-4 py-12 sm:px-7 lg:grid-cols-[0.7fr_1.3fr] lg:py-16">
          <div>
            <p className="font-mono text-[9px] font-bold uppercase text-[#95ff00]">How it works</p>
            <h2 className="mt-3 font-[var(--font-display)] text-5xl leading-none">One code. One clear beta.</h2>
            <p className="mt-5 text-sm leading-6 text-[#8d9888]">
              If you have a Creator Beta code, enter it to unlock access. Once unlocked, you can start creating clips during the beta for free within the monthly limits.
            </p>
          </div>
          <div className="border-y border-[#2a3327] py-6">
            <p className="text-sm font-bold text-white">By joining the Creator Beta, you understand that:</p>
            <ul className="mt-5 space-y-3">
              {TERMS.map((term) => <li key={term} className="flex gap-3 text-sm leading-6 text-[#aab4a5]"><span className="mt-2 h-1.5 w-1.5 shrink-0 bg-[#95ff00]" />{term}</li>)}
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}
