"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import {
  AccountSettingsPanel,
  AccountSettingsPanels,
  AccountSettingsShell,
} from "@/components/account/AccountSettingsShell";
import { fetchJson } from "@/lib/apiClient";
import { getPricingPlan } from "@/lib/pricing";
import type {
  BillingAccountSummary,
  StripeBillingDetails,
} from "@/services/billingService";
import type { UsageSnapshot } from "@/services/usageService";

function formatHours(seconds: number): string {
  const hours = seconds / 3600;
  if (hours < 0.1) return `${Math.round(seconds / 60)}m`;
  return `${hours.toFixed(1)}h`;
}

function formatStorageBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function formatLimit(used: string, limit: number | null): string {
  if (limit === null) return `${used} / Unlimited`;
  return `${used} / ${limit}`;
}

function formatMoney(cents: number | null, currency: string | null): string | null {
  if (cents === null) return null;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: (currency ?? "usd").toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

export default function ProfilePage() {
  const router = useRouter();
  const [account, setAccount] = useState<BillingAccountSummary | null>(null);
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const [stripeDetails, setStripeDetails] =
    useState<StripeBillingDetails | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const me = await fetchJson<{ account: BillingAccountSummary | null }>(
          "/api/auth/me"
        );
        if (!me.data.account) {
          router.replace("/login");
          return;
        }
        setAccount(me.data.account);
        posthog.identify(me.data.account.id, {
          email: me.data.account.email,
        });
        setDisplayName(me.data.account.displayName ?? "");
        setEmail(me.data.account.email ?? "");

        const [usageRes, billingRes] = await Promise.all([
          fetchJson<UsageSnapshot>("/api/usage"),
          fetchJson<{
            stripeDetails?: StripeBillingDetails | null;
          }>("/api/billing/status"),
        ]);
        if (usageRes.ok) setUsage(usageRes.data);
        if (billingRes.ok) setStripeDetails(billingRes.data.stripeDetails ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load profile");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [router]);

  async function handleSaveProfile(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const { ok, data } = await fetchJson<{
        account?: BillingAccountSummary;
        error?: string;
      }>("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, email }),
      });
      if (!ok || !data.account) {
        throw new Error(data.error ?? "Failed to save profile");
      }
      setAccount(data.account);
      setDisplayName(data.account.displayName ?? "");
      setEmail(data.account.email ?? "");
      posthog.capture("profile_updated");
      setMessage("Profile saved");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  }

  async function handleManageBilling() {
    setPortalLoading(true);
    setError(null);
    try {
      const { ok, data } = await fetchJson<{ url?: string; error?: string }>(
        "/api/billing/portal",
        { method: "POST" }
      );
      if (!ok || !data.url) {
        throw new Error(data.error ?? "Failed to open billing portal");
      }
      posthog.capture("billing_portal_opened");
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open billing");
      setPortalLoading(false);
    }
  }

  async function handleLogout() {
    posthog.capture("user_signed_out");
    posthog.reset();
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    router.push("/login");
    router.refresh();
  }

  async function handleDeleteAccount() {
    if (
      !window.confirm(
        "Delete your account permanently?\n\nThis removes your sessions, local recordings, and billing access. This cannot be undone."
      )
    ) {
      return;
    }
    if (
      !window.confirm(
        "Final confirmation: delete account and wipe all associated data?"
      )
    ) {
      return;
    }

    setDeleting(true);
    setError(null);
    try {
      const { ok, data } = await fetchJson<{ error?: string }>(
        "/api/auth/account",
        { method: "DELETE" }
      );
      if (!ok) throw new Error(data.error ?? "Failed to delete account");
      posthog.capture("account_deleted");
      posthog.reset();
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete account");
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <AccountSettingsShell
        title="Profile"
        description="Update your details, manage your subscription, and review usage."
      >
        <div className="mt-10 border border-[var(--color-card-border)] bg-[#050805] p-8">
          <p className="text-[var(--color-muted)] animate-pulse">Loading profile…</p>
        </div>
      </AccountSettingsShell>
    );
  }

  if (!account) return null;

  const plan = usage?.plan ?? getPricingPlan(account.plan);
  const periodEnd = account.currentPeriodEnd
    ? new Date(account.currentPeriodEnd).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;
  const lastSignedIn = account.lastSignedInAt
    ? new Date(account.lastSignedInAt).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  const processedLabel = formatHours(usage?.usage.processedSeconds ?? 0);
  const hoursLimit = usage?.entitlements?.processingHoursLimit ?? null;
  const exportsUsed = usage?.usage.renderedExports ?? 0;
  const exportsLimit = usage?.entitlements?.exportsLimit ?? null;
  const uploadsUsed = usage?.usage.videoUploads ?? usage?.usage.streamStarts ?? 0;
  const uploadsLimit = usage?.entitlements?.uploadsLimit ?? null;
  const storageUsed = usage?.usage.storedMediaBytes ?? 0;
  const storageLimit = usage?.entitlements?.storageLimitBytes ?? null;
  const storageLabel =
    storageLimit === null
      ? `${formatStorageBytes(storageUsed)} / Unlimited`
      : `${formatStorageBytes(storageUsed)} / ${formatStorageBytes(storageLimit)}`;
  const nextInvoice = formatMoney(
    stripeDetails?.nextInvoiceAmountCents ?? null,
    stripeDetails?.currency ?? null
  );
  const isCreatorBeta = usage?.plan?.name === "Creator Beta";
  const canUpgrade =
    !account.unlimitedAccess &&
    !isCreatorBeta &&
    (account.plan === "creator" || account.plan === "pro");

  return (
    <AccountSettingsShell
      title="Profile"
      description="Update your details, manage your subscription, and review usage."
      message={message}
      error={error}
    >
      {isCreatorBeta && (
        <div className="mt-7 border-l-2 border-[var(--color-accent)] bg-[#0a1008] px-5 py-4">
          <p className="text-sm font-bold text-[var(--color-accent)]">
            Creator Beta: Active
          </p>
          <div className="mt-3 grid gap-2 text-sm text-white/80 sm:grid-cols-2">
            <p>Renders used this month: {exportsUsed} / 25</p>
            <p>Uploads used this month: {uploadsUsed} / 10</p>
          </div>
        </div>
      )}

      {usage?.nearLimit && canUpgrade && (
        <div className="mt-6 border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-5 py-4">
          <p className="text-sm font-semibold text-[var(--color-accent)]">
            You&apos;re near your plan limits
          </p>
          <p className="mt-1 text-sm text-white/75">
            Upgrade to keep processing and exporting without interruption.
          </p>
          <Link
            href="/#pricing"
            className="mt-3 inline-flex rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-black hover:bg-[var(--color-accent-hover)]"
          >
            Upgrade plan
          </Link>
        </div>
      )}

      <AccountSettingsPanels>
        <AccountSettingsPanel title="Profile">
            <form onSubmit={handleSaveProfile} className="space-y-5">
              <div>
                <label
                  htmlFor="email"
                  className="mb-2 block text-xs font-semibold uppercase text-white/60"
                >
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full rounded-lg border border-[var(--color-card-border)] bg-[#020302] px-4 py-3 text-sm text-white placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="displayName"
                  className="mb-2 block text-xs font-semibold uppercase text-white/60"
                >
                  Name
                </label>
                <input
                  id="displayName"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={80}
                  placeholder="Your name"
                  className="w-full rounded-lg border border-[var(--color-card-border)] bg-[#020302] px-4 py-3 text-sm text-white placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:outline-none"
                />
              </div>
              {lastSignedIn && (
                <p className="text-xs text-[var(--color-muted)]">
                  Last signed in {lastSignedIn}
                </p>
              )}
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-[var(--color-accent)] px-5 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save profile"}
              </button>
            </form>
        </AccountSettingsPanel>

        <AccountSettingsPanel
          title={isCreatorBeta ? "Creator Beta access" : "Subscription"}
        >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase text-white/50">Plan</p>
                <p className="mt-1 text-lg font-semibold text-white">
                  {plan.name}
                  {account.unlimitedAccess && (
                    <span className="ml-2 text-xs font-semibold uppercase text-[var(--color-accent)]">
                      Unlimited
                    </span>
                  )}
                  {isCreatorBeta && !account.unlimitedAccess && (
                    <span className="ml-2 text-xs font-semibold uppercase text-[var(--color-accent)]">
                      Active
                    </span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase text-white/50">Status</p>
                <p className="mt-1 text-lg font-semibold capitalize text-white">
                  {isCreatorBeta ? "Active" : account.status}
                </p>
              </div>
              {periodEnd && (
                <div>
                  <p className="text-xs uppercase text-white/50">
                    {account.cancelAtPeriodEnd ? "Ends" : "Renews"}
                  </p>
                  <p className="mt-1 text-sm text-white/80">
                    {periodEnd}
                    {account.cancelAtPeriodEnd && (
                      <span className="ml-2 text-[#ffb84d]">
                        Cancels at period end
                      </span>
                    )}
                  </p>
                </div>
              )}
              {account.canManageBilling && stripeDetails?.paymentMethodLast4 && (
                <div>
                  <p className="text-xs uppercase text-white/50">Payment</p>
                  <p className="mt-1 text-sm capitalize text-white/80">
                    {stripeDetails.paymentMethodBrand ?? "Card"} ····{" "}
                    {stripeDetails.paymentMethodLast4}
                  </p>
                </div>
              )}
              {account.canManageBilling && nextInvoice && (
                <div className="sm:col-span-2">
                  <p className="text-xs uppercase text-white/50">Next invoice</p>
                  <p className="mt-1 text-sm text-white/80">
                    {nextInvoice}
                    {stripeDetails?.nextInvoiceDate && (
                      <span className="text-[var(--color-muted)]">
                        {" "}
                        on{" "}
                        {new Date(
                          stripeDetails.nextInvoiceDate
                        ).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                    )}
                  </p>
                </div>
              )}
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              {account.canManageBilling ? (
                <button
                  type="button"
                  onClick={() => void handleManageBilling()}
                  disabled={portalLoading}
                  className="rounded-lg bg-[var(--color-accent)] px-5 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
                >
                  {portalLoading ? "Opening…" : "Manage billing"}
                </button>
              ) : account.unlimitedAccess ? (
                <p className="text-sm text-[var(--color-muted)]">
                  Comp access — no Stripe billing to manage.
                </p>
              ) : isCreatorBeta ? (
                <p className="text-sm text-[var(--color-muted)]">
                  Free access during the Creator Beta. No billing method required.
                </p>
              ) : (
                <Link
                  href="/#pricing"
                  className="rounded-lg bg-[var(--color-accent)] px-5 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-[var(--color-accent-hover)]"
                >
                  Choose a plan
                </Link>
              )}
              {canUpgrade && (
                <Link
                  href="/#pricing"
                  className="rounded-lg border border-[var(--color-card-border)] px-5 py-2.5 text-sm text-white/80 transition-colors hover:border-[var(--color-accent)] hover:text-white"
                >
                  Upgrade plan
                </Link>
              )}
            </div>
            {account.canManageBilling && (
              <p className="mt-3 text-xs text-[var(--color-muted)]">
                Cancel, change plan, or update payment method in the Stripe
                customer portal.
              </p>
            )}
        </AccountSettingsPanel>

        <AccountSettingsPanel title="Usage this month">
            {isCreatorBeta ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="border border-[var(--color-card-border)] bg-[#020302] px-4 py-4">
                  <p className="text-xs uppercase text-white/50">Rendered clips</p>
                  <p className="mt-2 text-xl font-semibold text-white">
                    {formatLimit(String(exportsUsed), exportsLimit ?? 25)}
                  </p>
                </div>
                <div className="border border-[var(--color-card-border)] bg-[#020302] px-4 py-4">
                  <p className="text-xs uppercase text-white/50">Video uploads</p>
                  <p className="mt-2 text-xl font-semibold text-white">
                    {formatLimit(String(uploadsUsed), uploadsLimit ?? 10)}
                  </p>
                </div>
              </div>
            ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="border border-[var(--color-card-border)] bg-[#020302] px-4 py-4">
                <p className="text-xs uppercase text-white/50">Processing</p>
                <p className="mt-2 text-xl font-semibold text-white">
                  {hoursLimit === null
                    ? `${processedLabel} / Unlimited`
                    : `${processedLabel} / ${hoursLimit}h`}
                </p>
              </div>
              <div className="border border-[var(--color-card-border)] bg-[#020302] px-4 py-4">
                <p className="text-xs uppercase text-white/50">Exports</p>
                <p className="mt-2 text-xl font-semibold text-white">
                  {formatLimit(String(exportsUsed), exportsLimit)}
                </p>
              </div>
              <div className="border border-[var(--color-card-border)] bg-[#020302] px-4 py-4 sm:col-span-2">
                <p className="text-xs uppercase text-white/50">Storage</p>
                <p className="mt-2 text-xl font-semibold text-white">
                  {storageLabel}
                </p>
              </div>
            </div>
            )}
        </AccountSettingsPanel>

        <AccountSettingsPanel>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Link
              href="/#analyze"
              className="text-sm text-[var(--color-accent)] hover:underline"
            >
              Start clipping
            </Link>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="rounded-lg border border-[var(--color-card-border)] px-4 py-2 text-sm text-[var(--color-muted)] transition-colors hover:border-white/30 hover:text-white"
              >
                Sign out
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteAccount()}
                disabled={deleting}
                className="rounded-lg border border-red-500/40 px-4 py-2 text-sm text-red-400 transition-colors hover:border-red-500 hover:bg-red-500/10 disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete account"}
              </button>
            </div>
          </div>
        </AccountSettingsPanel>
      </AccountSettingsPanels>
    </AccountSettingsShell>
  );
}
