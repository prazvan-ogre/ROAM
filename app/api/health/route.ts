import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    env: process.env.NEXT_PUBLIC_APP_ENV ?? "unknown",
    timestamp: new Date().toISOString(),
  });
}
