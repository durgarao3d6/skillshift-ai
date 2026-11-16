import {Pool} from 'pg';
const globalDb=globalThis as unknown as {skillshiftPool?:Pool};
export function database(){
 if(!process.env.DATABASE_URL) throw new Error('Database is not configured.');
 return globalDb.skillshiftPool ??=new Pool({connectionString:process.env.DATABASE_URL,max:3,connectionTimeoutMillis:5000,idleTimeoutMillis:10000});
}
export const developmentTenant='11111111-1111-4111-8111-111111111111';
// Deliberately fail closed: this milestone has no production identity or tenant authorisation.
export function demoEnabled(){return process.env.SKILLSHIFT_DEMO_MODE==='true';}
