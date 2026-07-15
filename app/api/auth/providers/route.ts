import { listConfiguredAuthProviders } from "@/auth.config";
import { jsonResponse } from "@/lib/utils";

export async function GET() {
  const providers = listConfiguredAuthProviders();
  return jsonResponse({
    providers,
    emailEnabled: providers.some((p) => p.id === "resend"),
  });
}
