import { apply, decodeCommand, seed, type State } from './model.js';
import { canonical, digest, identifier, integer, ResearchError } from './protocol.js';
import { profile } from './profiles.js';
import { MIGRATION } from './schema.generated.js';
export type SqlResult={results?:Record<string,unknown>[];meta?:{changes?:number}};
export interface Statement {
  bind(...values:unknown[]):Statement;first<T=Record<string,unknown>>():Promise<T|null>;
  all<T=Record<string,unknown>>():Promise<{results:T[]}>;run():Promise<SqlResult>;
}
export interface Database {prepare(sql:string):Statement;batch(statements:Statement[]):Promise<SqlResult[]>;exec(sql:string):Promise<unknown>;}
export type Snapshot={id:string;state:State;stateDigest:string};
type Row={id:string;state_json:string;state_digest:string;version:number;profile_id:string};
export async function bootstrap(db:Database) {await db.exec(MIGRATION);}
export async function readStudy(db:Database,id:unknown):Promise<Snapshot> {
  const key=identifier(id),r=await db.prepare('SELECT * FROM type3_studies WHERE id=?').bind(key).first<Row>();
  if(!r)throw new ResearchError(404,'study_not_found','Research study not found');
  const state=JSON.parse(r.state_json) as State;
  if(state.version!==r.version||state.profile.id!==r.profile_id||await digest(state)!==r.state_digest)throw new ResearchError(503,'integrity_check_failed','Stored snapshot did not match its digest');
  return {id:r.id,state,stateDigest:r.state_digest};
}
export async function createStudy(db:Database,id:unknown,profileId:unknown):Promise<Snapshot> {
  const key=identifier(id),p=profile(profileId),s=seed(p.id),d=await digest(s);
  // A single insert enforces a fixed study budget; duplicate IDs are resolved, not overwritten.
  await db.prepare('INSERT OR IGNORE INTO type3_studies (id,profile_id,model_version,version,state_json,state_digest,commit_token) SELECT ?,?,2,0,?,?,? WHERE (SELECT count(*) FROM type3_studies)<32').bind(key,p.id,canonical(s),d,crypto.randomUUID()).run();
  let result:Snapshot;
  try {result=await readStudy(db,key);}catch(e){if(e instanceof ResearchError&&e.status===404)throw new ResearchError(409,'study_limit','At most 32 studies in this local research database');throw e;}
  if(result.state.profile.id!==p.id)throw new ResearchError(409,'study_id_conflict','The study already has another immutable profile');
  return result;
}
export async function execute(db:Database,id:unknown,input:unknown):Promise<Snapshot> {
  const before=await readStudy(db,id),command=decodeCommand(input),after=apply(before.state,command);
  if(after===before.state)return before;
  const serialized=canonical(after);
  if(new TextEncoder().encode(serialized).byteLength>1_000_000)throw new ResearchError(409,'snapshot_limit','Export this study and start another bounded scenario');
  const hash=await digest(after),token=crypto.randomUUID();
  // Token fences the journal INSERT. A losing CAS cannot append the winner's sequence.
  const results=await db.batch([
    db.prepare('UPDATE type3_studies SET version=?,state_json=?,state_digest=?,commit_token=? WHERE id=? AND version=?')
      .bind(after.version,serialized,hash,token,before.id,before.state.version),
    db.prepare('INSERT INTO type3_commands (study_id,sequence,request_id,command_json,state_digest) SELECT id,?,?,?,? FROM type3_studies WHERE id=? AND commit_token=?')
      .bind(after.version,command.requestId,canonical(command),hash,before.id,token),
  ]);
  if(results[0]?.meta?.changes!==1){
    const current=await readStudy(db,id);
    // A concurrent identical command is a safe replay, not a second application.
    if(current.state.receipts.some(r=>r.requestId===command.requestId)){apply(current.state,command);return current;}
    throw new ResearchError(409,'stale_version','Another command committed; refresh before a new action');
  }
  return {id:before.id,state:after,stateDigest:hash};
}
export async function journal(db:Database,id:unknown,after=0,limit=100) {
  const key=identifier(id);integer(after,0,5000);integer(limit,1,200);
  const {results}=await db.prepare('SELECT sequence,request_id,command_json,state_digest FROM type3_commands WHERE study_id=? AND sequence>? ORDER BY sequence LIMIT ?').bind(key,after,limit).all<{sequence:number;request_id:string;command_json:string;state_digest:string}>();
  return {commands:results.map(r=>({sequence:r.sequence,command:JSON.parse(r.command_json),stateDigest:r.state_digest})),nextAfter:results.at(-1)?.sequence??after};
}
export async function exportStudy(db:Database,id:unknown) {
  // Read a snapshot and only journal entries up to its version: concurrent writes cannot corrupt an export.
  const snap=await readStudy(db,id),entries:Record<string,unknown>[]=[];let cursor=0;
  while(cursor<snap.state.version){const page=await journal(db,id,cursor,200);if(!page.commands.length)throw new ResearchError(503,'journal_gap','Journal incomplete');for(const c of page.commands)if(c.sequence<=snap.state.version)entries.push(c);cursor=page.nextAfter;}
  if(entries.length!==snap.state.version)throw new ResearchError(503,'journal_gap','Journal incomplete');
  return {format:'hospital-fabric-type3-export/v2',...snap,commands:entries,clinicalUseAllowed:false};
}
export async function maintenance(db:Database,at:string) {
  const row=await db.prepare('SELECT count(*) AS n FROM type3_studies').first<{n:number}>();
  await db.prepare("INSERT INTO type3_maintenance (id,checked_at,studies) VALUES ('recovery',?,?) ON CONFLICT(id) DO UPDATE SET checked_at=excluded.checked_at,studies=excluded.studies").bind(at,row?.n??0).run();
  // Maintenance NEVER advances simulated clocks or clinical states.
}
