import {NextResponse} from 'next/server';
import {database,developmentTenant,demoEnabled} from '../../../lib/db';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(){
 if(!demoEnabled()) return NextResponse.json({error:'Development inventory is disabled.'},{status:403});
 try{
 const db=database();
 const [tasks,counts]=await Promise.all([
 db.query('SELECT employee_external_id,role_name,task_external_id,task_description,skill_tags FROM inventory_tasks WHERE tenant_id=$1 ORDER BY created_at DESC,id LIMIT 100',[developmentTenant]),
 db.query('SELECT count(*)::int AS tasks,count(DISTINCT employee_external_id)::int AS employees,count(DISTINCT role_name)::int AS roles FROM inventory_tasks WHERE tenant_id=$1',[developmentTenant])]);
 return NextResponse.json({rows:tasks.rows,counts:counts.rows[0]},{headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'Connect PostgreSQL and apply the migration to load the inventory.'},{status:503});}
}
