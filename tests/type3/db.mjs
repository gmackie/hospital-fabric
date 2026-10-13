import {DatabaseSync} from 'node:sqlite';
/** Real SQLite, minimal D1 facade. No claim this substitutes for workerd/celld qualification. */
export class TestDB {
 constructor(path=':memory:'){this.raw=new DatabaseSync(path);this.raw.exec('PRAGMA foreign_keys=ON');this.failBatchAt=-1;this.tail=Promise.resolve();}
 prepare(sql){const db=this;let values=[];return {bind(...xs){values=xs;return this;},async first(){return db.raw.prepare(sql).get(...values)??null;},async all(){return {results:db.raw.prepare(sql).all(...values)};},async run(){const r=db.raw.prepare(sql).run(...values);return {meta:{changes:Number(r.changes)}};}};}
 async exec(sql){this.raw.exec(sql);}
 batch(statements){const task=this.tail.then(()=>this.transaction(statements));this.tail=task.catch(()=>{});return task;}
 async transaction(statements){this.raw.exec('BEGIN IMMEDIATE');try{const results=[];for(let i=0;i<statements.length;i++){if(i===this.failBatchAt)throw new Error('Injected atomic batch failure');results.push(await statements[i].run());}this.raw.exec('COMMIT');return results;}catch(e){this.raw.exec('ROLLBACK');throw e;}}
 close(){this.raw.close();}
}
