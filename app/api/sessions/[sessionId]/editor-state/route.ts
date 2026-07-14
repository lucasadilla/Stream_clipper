import { prisma } from "@/lib/db";
import { errorResponse, jsonResponse } from "@/lib/utils";
import {
  readEditorState,
  writeEditorState,
} from "@/services/editorStateService";

async function sessionExists(sessionId: string): Promise<boolean> {
  return Boolean(
    await prisma.streamSession.findUnique({
      where: { id: sessionId },
      select: { id: true },
    })
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    if (!(await sessionExists(sessionId))) return errorResponse("Session not found", 404);
    return jsonResponse({ state: await readEditorState(sessionId) });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load editor state",
      500
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    if (!(await sessionExists(sessionId))) return errorResponse("Session not found", 404);
    const body = await request.json();
    return jsonResponse({ state: await writeEditorState(sessionId, body.state) });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to save editor state",
      500
    );
  }
}
