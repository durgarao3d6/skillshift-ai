import {createHash} from 'node:crypto';
import {parse} from 'csv-parse/sync';
import {z} from 'zod';
export const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_ROWS = 5000;
const columns = ['employee_external_id','role_name','task_external_id','task_description','skill_tags'];
const schema = z.object({
 employee_external_id:z.string().trim().min(1).max(100),
 role_name:z.string().trim().min(1).max(200),
 task_external_id:z.string().trim().min(1).max(100),
 task_description:z.string().trim().min(1).max(4000),
 skill_tags:z.string().trim().max(1000).default(''),
});
export type InventoryRow = Omit<z.infer<typeof schema>,'skill_tags'> & {skill_tags:string[]};
export type Preview = {rows:InventoryRow[]; errors:{row:number;message:string}[];digest:string};
export function previewCsv(csv:string):Preview {
 if(Buffer.byteLength(csv,'utf8')>MAX_BYTES) throw new Error('CSV exceeds 10 MB.');
 const digest=createHash('sha256').update(csv).digest('hex');
 let headers:string[]=[];
 const records=parse(csv,{bom:true,skip_empty_lines:true,columns:(fields:string[])=>{
 headers=fields.map(x=>x.trim());
 if(new Set(headers).size!==headers.length) throw new Error('Duplicate column names.');
 const missing=columns.slice(0,4).filter(x=>!headers.includes(x));
 if(missing.length) throw new Error(`Missing columns: ${missing.join(', ')}`);
 if(headers.some(x=>!columns.includes(x))) throw new Error('Unexpected column. Use the sample CSV headers.');
 return headers;
 },max_record_size:20000}) as Record<string,string>[];
 if(!headers.length || !records.length) throw new Error('CSV must contain headers and at least one row.');
 if(records.length>MAX_ROWS) throw new Error('CSV exceeds 5,000 rows.');
 const rows:InventoryRow[]=[];const errors:Preview['errors']=[];const seen=new Set<string>();
 records.forEach((record,i)=>{
 const result=schema.safeParse(record);
 if(!result.success){ errors.push({row:i+2,message:result.error.issues.map(x=>`${x.path.join('.')}: ${x.message}`).join('; ')});return; }
 const key=JSON.stringify([result.data.employee_external_id,result.data.task_external_id]);
 if(seen.has(key)){errors.push({row:i+2,message:'Duplicate employee/task ID within CSV.'});return;}
 seen.add(key);rows.push({...result.data,skill_tags:[...new Set(result.data.skill_tags.split(';').map(x=>x.trim()).filter(Boolean))]});
 });
 return {rows,errors,digest};
}
