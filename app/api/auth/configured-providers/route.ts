import { listConfiguredAuthProviders } from "@/auth.config";
import { jsonResponse } from "@/lib/utils";

/** App-owned provider list (does not collide with Auth.js GET /api/auth/providers). */
export async function GET() {
  const providers = listConfiguredAuthProviders();
  return jsonResponse({
    providers,
    emailEnabled: providers.some((p) => p.id === "resend"),
  });
}
