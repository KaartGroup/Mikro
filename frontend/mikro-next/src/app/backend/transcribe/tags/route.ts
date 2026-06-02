import { auth0 } from "@/lib/auth0";
import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.FLASK_BACKEND_URL || "http://localhost:5004";

export async function GET(request: NextRequest) {
  try {
    const session = await auth0.getSession(request);
    if (!session?.tokenSet?.accessToken) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const response = await fetch(`${BACKEND_URL}/api/transcribe/tags`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${session.tokenSet.accessToken}`,
      },
    });

    const text = await response.text();
    try {
      return NextResponse.json(JSON.parse(text), { status: response.status });
    } catch {
      return NextResponse.json(
        { error: `Backend error (${response.status}): ${text.slice(0, 300)}` },
        { status: response.status },
      );
    }
  } catch (error) {
    console.error("Transcribe tags proxy error:", error);
    return NextResponse.json(
      {
        error: `Proxy failed: ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 500 },
    );
  }
}
