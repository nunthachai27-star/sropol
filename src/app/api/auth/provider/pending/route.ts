import { NextResponse, type NextRequest } from 'next/server';
import { getProviderPendingSummary } from '@/lib/provider-id-session-store';

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.json({ error: 'token required' }, { status: 400 });
  }

  const summary = getProviderPendingSummary(token);
  if (!summary) {
    return NextResponse.json({ error: 'session not found or expired' }, { status: 404 });
  }

  return NextResponse.json(summary);
}
