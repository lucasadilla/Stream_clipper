import { getPublicPricingPlans } from "@/services/publicPricingService";

export async function GET() {
  return Response.json({ plans: await getPublicPricingPlans() });
}
