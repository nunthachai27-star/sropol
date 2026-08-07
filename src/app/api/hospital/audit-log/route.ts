// Task 17: POST /api/hospital/audit-log — fire-and-forget audit sink
// Browser-side service layer (Tasks 41+) calls this after every BMS write.
// Contract: validate hcode matches the session, insert the row, never block.
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDatabase } from '@/db/connection';
import { tryLogAccess } from '@/services/audit';
import { auditActorFromSession } from '@/lib/audit-actor';

interface AuditLogBody {
  entity?: string;
  op?: string;
  resourceId?: string;
  fieldsTouched?: string[];
  hcode?: string;
  staff?: string;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as AuditLogBody | null;

  if (!body || !body.entity || !body.op || !body.hcode) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  if (body.hcode !== session.user.hospitalCode) {
    return NextResponse.json({ error: 'hcode mismatch' }, { status: 403 });
  }

  // Fire-and-forget contract: never block the caller, never throw. tryLogAccess
  // already swallows insert failures (warn-only); the outer try guards the
  // getDatabase() call itself.
  try {
    const db = await getDatabase();
    await tryLogAccess(db, {
      ...auditActorFromSession(session),
      action: `bms.${body.entity}.${body.op}`,
      resourceType: body.entity,
      resourceId: body.resourceId,
      metadata: {
        fieldsTouched: body.fieldsTouched,
        hcode: body.hcode,
        staff: body.staff,
      },
    });
  } catch {
    // swallow — caller does not retry
  }
  return NextResponse.json({ ok: true });
}
