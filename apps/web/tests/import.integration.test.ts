import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {NextRequest} from 'next/server';
import {POST} from '../app/api/imports/route';
import {GET} from '../app/api/inventory/route';
import {database,developmentTenant} from '../lib/db';
import {previewCsv} from '../lib/inventory';
test('PostgreSQL import: preview, atomic rejection, confirm, duplicate and conflict handling', {skip:process.env.RUN_DB_TESTS!=='true'},async()=>{
 process.env.SKILLSHIFT_DEMO_MODE='true';
 const id='test-'+randomUUID();const header='employee_external_id,role_name,task_external_id,task_description,skill_tags\n';
 const csv=header+`${id},Engineer,t1,Write tests,Testing`;
 const changed=header+`${id},Engineer,t1,Changed description,Testing`;
 const invalid=csv+'\n'+`${id},,t2,Invalid role,`;
 const request=(body:unknown,origin='http://localhost:3000')=>new NextRequest('http://localhost:3000/api/imports',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
 const pool=database();
 try{
 assert.equal((await POST(request({csv},'https://other.example'))).status,403);
 let response=await POST(request({csv}));assert.equal(response.status,200);
 const preview=await response.json();assert.equal(preview.rowCount,1);
 response=await POST(request({csv:invalid,confirm:true,digest:previewCsv(invalid).digest}));assert.equal(response.status,422);
 let count=await pool.query('SELECT count(*)::int AS n FROM inventory_tasks WHERE employee_external_id=$1',[id]);assert.equal(count.rows[0].n,0);
 response=await POST(request({csv,confirm:true,digest:'stale'}));assert.equal(response.status,422);
 const responses=await Promise.all([POST(request({csv,confirm:true,digest:preview.digest})),POST(request({csv,confirm:true,digest:preview.digest}))]);
 const results=await Promise.all(responses.map(r=>r.json()));assert.equal(results.filter(r=>r.duplicate).length,1);assert.equal(results.reduce((n,r)=>n+r.imported,0),1);
 response=await POST(request({csv:changed,confirm:true,digest:previewCsv(changed).digest}));assert.equal((await response.json()).skipped,1);
 const saved=await pool.query('SELECT task_description FROM inventory_tasks WHERE employee_external_id=$1',[id]);assert.equal(saved.rows[0].task_description,'Write tests');
 assert.equal((await GET()).status,200);
 process.env.SKILLSHIFT_DEMO_MODE='false';assert.equal((await GET()).status,403);assert.equal((await POST(request({csv}))).status,403);
 }finally{
 await pool.query('DELETE FROM inventory_tasks WHERE tenant_id=$1 AND employee_external_id=$2',[developmentTenant,id]);
 await pool.query('DELETE FROM import_batches WHERE tenant_id=$1 AND digest=ANY($2::text[])',[developmentTenant,[previewCsv(csv).digest,previewCsv(changed).digest]]);
 await pool.end();
 }
});
