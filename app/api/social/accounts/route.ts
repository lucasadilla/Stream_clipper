import { NextRequest } from "next/server";
import { jsonResponse } from "@/lib/utils";
import {
  requireAuthUserId,
  SessionAccessError,
} from "@/services/social/socialAccessService";
import {
  disconnectAccount,
  getConnectedAccountsOverview,
  setDefaultAccount,
} from "@/services/social/socialConnectionService";

export async function GET() {
  try {
    const userId = await requireAuthUserId();
    const overview = await getConnectedAccountsOverview(userId);
    return jsonResponse(overview);
  } catch (error) {
    if (error instanceof SessionAccessError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Failed to list accounts" },
      500
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const userId = await requireAuthUserId();
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get("accountId");
    if (!accountId) {
      return jsonResponse({ error: "accountId required" }, 400);
    }
    await disconnectAccount(userId, accountId);
    return jsonResponse({ ok: true });
  } catch (error) {
    if (error instanceof SessionAccessError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Disconnect failed" },
      400
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const userId = await requireAuthUserId();
    const body = (await request.json()) as { accountId?: string; action?: string };
    if (!body.accountId) {
      return jsonResponse({ error: "accountId required" }, 400);
    }
    if (body.action === "set-default") {
      await setDefaultAccount(userId, body.accountId);
      return jsonResponse({ ok: true });
    }
    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (error) {
    if (error instanceof SessionAccessError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Update failed" },
      400
    );
  }
}
