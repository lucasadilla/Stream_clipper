/** Legacy invite-code login is closed. Auth.js owns all customer sign-in. */
export async function POST() {
  return Response.json(
    { error: "Use Google or email and password to sign in." },
    { status: 410 }
  );
}
