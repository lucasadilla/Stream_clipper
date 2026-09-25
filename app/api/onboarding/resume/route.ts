import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { toJsonValue } from "@/lib/utils";
import { ensureBillingAccountForAuthUser } from "@/services/authAccountService";
import { hasAppAccess } from "@/services/billingService";
import { readOnboardingIntent, clearOnboardingIntentCookie } from "@/services/onboardingIntentService";
import { createStreamSession } from "@/services/youtubeService";
import {
  replacePriorSessionsForAccount,
  withAccountSessionLock,
} from "@/services/sessionCleanupService";
import { canCreateStreamSession } from "@/services/usageService";
import { getPostHogClient } from "@/lib/posthog-server";

export const runtime = "nodejs";

function onboardingKey(accountId: string, createdAt: number, workflow: string) {
  return createHash("sha256")
    .update(`${accountId}:${createdAt}:${workflow}`)
    .digest("hex");
}

export async function POST(request: NextRequest) {
  const authSession = await auth();
  if (!authSession?.user?.id) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const account = await ensureBillingAccountForAuthUser({
    userId: authSession.user.id,
    email: authSession.user.email,
    name: authSession.user.name,
    provider: "session",
    providerAccountId: authSession.user.id,
  });
  if (!hasAppAccess(account)) {
    return NextResponse.json(
      { error: "Your subscription is not active yet", pending: true },
      { status: 402 }
    );
  }

  const intent = readOnboardingIntent(request);
  if (!intent) {
    return NextResponse.json({ destination: "/#analyze" });
  }
  if (intent.workflow === "autopilot") {
    return NextResponse.json({ destination: "/settings/autopilot?onboarding=1" });
  }
  if (!intent.streamUrl) {
    const response = NextResponse.json({ destination: "/#analyze" });
    clearOnboardingIntentCookie(response);
    return response;
  }

  const sessionMode = intent.workflow;
  const key = onboardingKey(account.id, intent.createdAt, intent.workflow);
  const result = await withAccountSessionLock(account.id, async () => {
    const recent = await prisma.streamSession.findMany({
      where: { billingAccountId: account.id },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, metadataJson: true },
    });
    const existing = recent.find((session) => {
      const metadata = session.metadataJson;
      return (
        metadata &&
        typeof metadata === "object" &&
        (metadata as Record<string, unknown>).onboardingKey === key
      );
    });
    if (existing) {
      return { kind: "reused" as const, sessionId: existing.id };
    }

    const gate = await canCreateStreamSession(account.id);
    if (!gate.allowed) {
      return {
        kind: "blocked" as const,
        message: gate.message ?? "Plan limit reached",
        status: gate.status ?? 402,
      };
    }

    const streamSession = await createStreamSession(
      intent.streamUrl!,
      account.id,
      gate.snapshot.entitlements?.maxSourceDurationSeconds,
      sessionMode
    );
    const metadata =
      streamSession.metadataJson && typeof streamSession.metadataJson === "object"
        ? { ...(streamSession.metadataJson as Record<string, unknown>) }
        : {};
    await prisma.streamSession.update({
      where: { id: streamSession.id },
      data: {
        metadataJson: toJsonValue({
          ...metadata,
          onboardingKey: key,
          onboardingAgentPrompt:
            intent.workflow === "agent" ? intent.requestedAction : null,
        }),
      },
    });
    await replacePriorSessionsForAccount(account.id, streamSession.id);
    return { kind: "created" as const, streamSession };
  });

  if (result.kind === "blocked") {
    return NextResponse.json(
      { error: result.message },
      { status: result.status }
    );
  }
  if (result.kind === "reused") {
    const response = NextResponse.json({
      destination: `/sessions/${result.sessionId}`,
      sessionId: result.sessionId,
      reused: true,
    });
    clearOnboardingIntentCookie(response);
    return response;
  }

  const created = result.streamSession;

  getPostHogClient().capture({
    distinctId: account.id,
    event: "onboarding_completed",
    properties: {
      workflow: intent.workflow,
      platform: created.platform,
      has_requested_action: Boolean(intent.requestedAction),
      ...intent.attribution,
    },
  });

  const response = NextResponse.json({
    destination: `/sessions/${created.id}`,
    sessionId: created.id,
    reused: false,
  });
  clearOnboardingIntentCookie(response);
  return response;
}
