/** Creator codes are no longer part of the paid-first onboarding flow. */
export async function POST() {
  return Response.json(
    { error: "Creator access codes are no longer accepted." },
    { status: 410 }
  );
}
