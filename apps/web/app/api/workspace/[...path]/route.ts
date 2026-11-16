import { z } from 'zod';
import {
  handle,
  withActor,
  roles,
  body,
  HttpError,
  demoMode,
  audit,
} from '../../../../lib/server/core';
import * as domain from '../../../../lib/server/domain';
import { submitEvidence, reviewEvidence, downloadEvidence } from '../../../../lib/server/evidence';
import { privacyExport, requestDeletion } from '../../../../lib/server/privacy';
import { runBatch } from '../../../../lib/server/worker';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
type Context = { params: Promise<{ path: string[] }> };
export async function GET(req: Request, context: Context) {
  return handle(async () => {
    const path = (await context.params).path;
    return withActor(req, async (db, actor) => {
      const route = path.join('/');
      const query = new URL(req.url).searchParams;
      if (route === 'state')
        return Response.json({
          ...(await domain.workspace(db, actor, query.get('employeeId') || undefined)),
          developmentMode: demoMode(),
        });
      if (route === 'inventory') return Response.json(await domain.inventory(db, actor, query));
      if (route === 'export')
        return new Response(await domain.exportInventory(db, actor), {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="skillshift-inventory.csv"',
          },
        });
      if (route === 'report') return Response.json(await domain.report(db, actor));
      if (path[0] === 'evidence' && path.length === 2) return downloadEvidence(db, actor, path[1]);
      if (route === 'privacy/export')
        return Response.json(
          await privacyExport(
            db,
            actor,
            domain.employee.parse(query.get('employeeId') || actor.employeeId),
          ),
          {
            headers: {
              'Content-Disposition': 'attachment; filename="skillshift-personal-data.json"',
            },
          },
        );
      if (route === 'members') {
        roles(actor, 'admin', 'hr');
        return Response.json(
          (
            await db.query(
              'SELECT u.id,u.display_name,m.role,m.employee_external_id FROM app_users u JOIN memberships m ON m.user_id=u.id AND m.tenant_id=u.tenant_id WHERE m.active ORDER BY u.display_name',
            )
          ).rows,
        );
      }
      throw new HttpError(404, 'Workspace endpoint not found.');
    });
  });
}
export async function POST(req: Request, context: Context) {
  return handle(async () => {
    const route = (await context.params).path.join('/');
    if (route === 'jobs/run') {
      const actor = await withActor(req, async (_db, a) => {
        roles(a, 'hr', 'admin');
        if (!demoMode())
          throw new HttpError(409, 'Use the background worker in deployed environments.');
        return a;
      });
      return Response.json({ processed: await runBatch(actor.tenantId, 10) });
    }
    const input = await body(
      req,
      route === 'evidence/submit'
        ? 8 * 1024 * 1024
        : route === 'imports'
          ? 12 * 1024 * 1024
          : 1024 * 1024,
    );
    return withActor(req, async (db, a) => {
      const actions: Record<string, () => Promise<unknown>> = {
        imports: () => domain.importInventory(db, a, input),
        'tasks/correct': () => domain.correctTask(db, a, input),
        'tasks/review': () => domain.reviewTask(db, a, input),
        'assessments/request': () => domain.requestAssessment(db, a, input),
        'assessments/review': () => domain.reviewAssessment(db, a, input),
        'skills/self-report': () => domain.selfReport(db, a, input),
        'skills/targets': () => domain.setTarget(db, a, input),
        'plans/generate': () => domain.generatePlan(db, a, input),
        'plans/approve': () => domain.approvePlan(db, a, input),
        'plans/withdraw': () => domain.withdraw(db, a, input),
        'activities/complete': () => domain.completeActivity(db, a, input),
        'evidence/submit': () => submitEvidence(db, a, input),
        'evidence/review': () => reviewEvidence(db, a, input),
        'privacy/delete': () => requestDeletion(db, a, input),
        'managers/assign': () => domain.assignManager(db, a, input),
      };
      if (actions[route]) return Response.json(await actions[route]());
      if (route === 'jobs/retry' || route === 'jobs/cancel') {
        roles(a, 'admin', 'hr');
        const b = z.object({ jobId: z.uuid() }).parse(input);
        const j = (await db.query('SELECT * FROM jobs WHERE id=$1 FOR UPDATE', [b.jobId])).rows[0];
        if (!j) throw new HttpError(404, 'Job not found.');
        if (route === 'jobs/retry') {
          if (!['failed', 'cancelled'].includes(j.status))
            throw new HttpError(409, 'Only failed or cancelled jobs can be retried.');
          await db.query(
            "UPDATE jobs SET status='queued',attempts=0,available_at=now(),last_error=NULL,lease_token=NULL WHERE id=$1",
            [j.id],
          );
        } else {
          if (['succeeded', 'failed'].includes(j.status))
            throw new HttpError(409, 'This job is already finished.');
          await db.query(
            "UPDATE jobs SET status='cancelled',lease_token=NULL,lease_until=NULL WHERE id=$1",
            [j.id],
          );
        }
        await audit(db, a, a.tenantId, route.replace('/', '.'), j.id);
        return Response.json({ ok: true });
      }
      if (route === 'policy') {
        roles(a, 'admin');
        const b = z
          .object({
            evidenceRetentionDays: z.number().int().min(1).max(3650),
            legalHold: z.boolean(),
            confirmation: z.literal('POLICY APPROVED'),
          })
          .parse(input);
        await db.query(
          'INSERT INTO tenant_policies(tenant_id,legal_hold,evidence_retention_days,policy_approved_at) VALUES($1,$2,$3,now()) ON CONFLICT(tenant_id) DO UPDATE SET legal_hold=EXCLUDED.legal_hold,evidence_retention_days=EXCLUDED.evidence_retention_days,policy_approved_at=now()',
          [a.tenantId, b.legalHold, b.evidenceRetentionDays],
        );
        await audit(db, a, a.tenantId, 'policy.configured', a.tenantId);
        return Response.json({ ok: true });
      }
      throw new HttpError(404, 'Workspace action not found.');
    });
  });
}
