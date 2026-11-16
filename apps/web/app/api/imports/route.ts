import {NextRequest,NextResponse} from 'next/server';
import {randomUUID} from 'node:crypto';
import {database,developmentTenant,demoEnabled} from '../../../lib/db';
import {previewCsv,MAX_BYTES} from '../../../lib/inventory';
export const runtime='nodejs';
export async function POST(req:NextRequest){
 if(!demoEnabled()) return NextResponse.json({error:'Development import is disabled. Production identity is not implemented.'},{status:403});
 // Browser-origin validation is defence in depth; protect hosted demos with deployment authentication.
 if(req.headers.get('origin')!==req.nextUrl.origin) return NextResponse.json({error:'Invalid request origin.'},{status:403});
 if(Number(req.headers.get('content-length')||0)>MAX_BYTES+1024) return NextResponse.json({error:'Request too large.'},{status:413});
 let body:{csv?:unknown;confirm?:unknown;digest?:unknown};
 try {
 const reader=req.body?.getReader();if(!reader) throw new Error('Missing body');
 const chunks:Uint8Array[]=[];let length=0;
 while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>MAX_BYTES+1024){await reader.cancel();return NextResponse.json({error:'Request too large.'},{status:413});}chunks.push(value);}
 body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 }catch{return NextResponse.json({error:'Invalid JSON request.'},{status:400});}
 if(!body || typeof body.csv!=='string') return NextResponse.json({error:'csv must be a string.'},{status:400});
 let preview;try{preview=previewCsv(body.csv);}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Invalid CSV.'},{status:422});}
 if(body.confirm!==true) return NextResponse.json({...preview,rows:preview.rows.slice(0,50),rowCount:preview.rows.length});
 if(preview.errors.length || body.digest!==preview.digest) return NextResponse.json({error:'Fix validation errors and preview the current file before confirming.'},{status:422});
 let client;
 try{client=await database().connect();}catch{return NextResponse.json({error:'Database unavailable. Configure PostgreSQL and apply the migration.'},{status:503});}
 try{
 await client.query('BEGIN');
 const batch=await client.query('INSERT INTO import_batches(id,tenant_id,digest,row_count) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,digest) DO NOTHING RETURNING id',[randomUUID(),developmentTenant,preview.digest,preview.rows.length]);
 if(!batch.rowCount){await client.query('COMMIT');return NextResponse.json({imported:0,duplicate:true});}
 // A single transaction gives all-or-nothing import. Conflicting existing IDs retain their original values.
 let imported=0;
 for(const row of preview.rows){const result=await client.query('INSERT INTO inventory_tasks(id,tenant_id,employee_external_id,role_name,task_external_id,task_description,skill_tags) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tenant_id,employee_external_id,task_external_id) DO NOTHING',[randomUUID(),developmentTenant,row.employee_external_id,row.role_name,row.task_external_id,row.task_description,row.skill_tags]);imported+=result.rowCount||0;}
 await client.query('COMMIT');return NextResponse.json({imported,skipped:preview.rows.length-imported,duplicate:false});
 }catch{await client.query('ROLLBACK');return NextResponse.json({error:'Import failed. No rows were committed.'},{status:503});}finally{client.release();}
}
