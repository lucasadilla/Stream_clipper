/**
 * Provision Stripe subscription products/prices for Managed Payments.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_... npx tsx scripts/provision-stripe-catalog.ts
 *
 * Get keys from https://dashboard.stripe.com/apikeys
 */
import { config } from "dotenv";
import {
  formatProvisionEnvBlock,
  provisionSubscriptionCatalog,
} from "../services/stripeCatalogService";

config();

async function main() {
  if (!process.env.STRIPE_SECRET_KEY?.trim()) {
    console.error(
      "Missing STRIPE_SECRET_KEY. Add it to .env or pass it when running this script."
    );
    process.exit(1);
  }

  console.log("Provisioning Stream Clipper subscription catalog in Stripe...");
  const { plans, envLines } = await provisionSubscriptionCatalog();

  for (const plan of plans) {
    console.log(
      `\n${plan.planId}: product=${plan.productId} monthly=${plan.monthlyPriceId} yearly=${plan.yearlyPriceId}`
    );
  }

  console.log("\nAdd these lines to your .env:\n");
  console.log(formatProvisionEnvBlock(envLines));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
