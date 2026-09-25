export async function POST() {
  return Response.json(
    {
      error:
        "Creator Beta access is closed. Choose a paid plan to use Clipper.",
    },
    { status: 410 }
  );
}
