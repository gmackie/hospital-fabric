import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

type Order = { operation_id: string; operation_state: string; patient_id: string; test_code: string; attempt_count: number; updated_at: number };
type Operation = { id: string; idempotency_key: string; state: string; attempt_count: number; last_error: string | null; target_resource: string | null };
type Event = { id: string; event_type: string; details_json: string; occurred_at: number };
type ChartResult = { source_report_id: string; test_code: string; result_text: string; unit_code: string };
type Detail = { operation: Operation; events: Event[]; results: ChartResult[] };
type Draft = { patientId: string; requestId: string; operationId?: string };
const stateLabel = (state: string) => ({outcome_unknown:'Unknown outcome',needs_review:'Manual review',review:'Manual review',queued:'Queued',accepted:'Accepted',completed:'Completed',retry:'Retry pending',dispatching:'Dispatching'}[state] ?? state);
const date = (at: number) => new Date(at).toLocaleString();
class ApiFailure extends Error { constructor(message: string, readonly status: number) { super(message); } }

function App() {
  const token = useRef('');
  const session = useRef(0);
  const lock = useRef(false);
  const controllers = useRef(new Set<AbortController>());
  const [tokenInput,setTokenInput] = useState('');
  const [connected,setConnected] = useState(false);
  const [busy,setBusy] = useState('');
  const [notice,setNotice] = useState('');
  const [error,setError] = useState('');
  const [orders,setOrders] = useState<Order[]>([]);
  const [selected,setSelected] = useState('');
  const [detail,setDetail] = useState<Detail | null>(null);
  const [patient,setPatient] = useState<{id:string;label:string} | null>(null);
  const [draft,setDraft] = useState<Draft | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const valid = (epoch: number) => session.current === epoch && !!token.current;
  function disconnect() {
    session.current++;
    for (const controller of controllers.current) controller.abort();
    controllers.current.clear(); token.current=''; lock.current=false;
    setConnected(false); setTokenInput(''); setBusy(''); setNotice('Disconnected. In-memory console state cleared. Server-side demo records remain.'); setError('');
    setOrders([]); setSelected(''); setDetail(null); setPatient(null); setDraft(null); draftRef.current=null;
  }
  async function request<T>(path: string, epoch: number, body?: object): Promise<T> {
    if (!valid(epoch)) throw new Error('Session ended');
    const controller=new AbortController(); controllers.current.add(controller);
    const timeout=setTimeout(()=>controller.abort(),15000);
    try {
      const response=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'omit',cache:'no-store',redirect:'error',headers:{'x-demo-token':token.current,...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});
      const data=await response.json();
      if (!valid(epoch)) throw new Error('Session ended');
      if (!response.ok) throw new ApiFailure(`${response.status}: ${data.message ?? 'Request failed'}`,response.status);
      return data as T;
    } catch (cause) {
      if (cause instanceof Error && cause.name==='AbortError') throw new Error(body===undefined?'Read interrupted. Refresh to try again.':'Request interrupted; it may have committed. Refresh before acting again. CBC retries retain the same request ID.');
      if (cause instanceof TypeError) throw new Error(body===undefined?'Could not reach the local Worker. Check the server, then refresh.':'Connection failed; the request may have committed. Refresh before acting again. Retry the same CBC to reuse its request ID.');
      throw cause;
    } finally { clearTimeout(timeout); controllers.current.delete(controller); }
  }
  async function run(label: string, action: (epoch: number)=>Promise<void>) {
    if (lock.current) return;
    lock.current=true; const epoch=session.current; setBusy(label); setError(''); setNotice('');
    try { await action(epoch); }
    catch (cause) { if (valid(epoch)) setError(cause instanceof Error?cause.message:'Request failed. Refresh before retrying.'); }
    finally { if (session.current===epoch) { lock.current=false; setBusy(''); } }
  }
  async function loadDetail(order: Order, epoch: number) {
    const [operation,events,results]=await Promise.all([
      request<{operation:Operation}>(`/v1/operations/${encodeURIComponent(order.operation_id)}`,epoch),
      request<{events:Event[]}>(`/v1/operations/${encodeURIComponent(order.operation_id)}/events`,epoch),
      request<{results:ChartResult[]}>(`/v1/demo/patients/${encodeURIComponent(order.patient_id)}/results`,epoch)
    ]);
    if (valid(epoch)) setDetail({operation:operation.operation,events:events.events,results:results.results});
  }
  async function refresh(epoch: number, selection=selected) {
    const data=await request<{orders:Order[]}>('/v1/operations',epoch);
    if (!valid(epoch)) return;
    setOrders(data.orders);
    const order=data.orders.find(item=>item.operation_id===selection);
    if (order) await loadDetail(order,epoch);
    else {setSelected('');setDetail(null);}
  }
  async function connect() {
    if (lock.current || tokenInput.trim().length<24) return;
    token.current=tokenInput.trim(); setTokenInput(''); setConnected(true);
    await run('Connecting',async epoch=>{await refresh(epoch);if(valid(epoch))setNotice('Connected to this local demo. No automatic dispatch or result import.');});
  }
  const selectedOrder=orders.find(order=>order.operation_id===selected);
  const mutation=(label: string,path: string,body: object={},message=label+' finished.')=>run(label,async epoch=>{await request(path,epoch,body);if(valid(epoch))setNotice(message);await refresh(epoch);});
  return <main>
    <header><p className="eyebrow">LOCAL INTEGRATION LAB</p><h1>Hospital Fabric</h1><p>Operator console <span className="tag">Synthetic demo</span></p></header>
    <aside className="warning"><strong>Synthetic data only.</strong> Not a medical device, clinical EMR, or validated LIS. Never enter real patient data. Keep this demo on loopback.</aside>
    <section aria-label="Connection" className="connection">
      {!connected ? <form onSubmit={event=>{event.preventDefault();void connect();}}><label htmlFor="token">Local demo token</label><div className="row"><input id="token" type="password" autoComplete="off" spellCheck={false} value={tokenInput} onChange={event=>setTokenInput(event.target.value)} placeholder="DEMO_API_KEY from local .dev.vars" required minLength={24}/><button disabled={!!busy || tokenInput.trim().length<24}>Connect</button></div><small>Kept in memory only. Closing or disconnecting clears it.</small></form> : <div className="row spread"><span>Local session · {location.origin}</span><button className="secondary" onClick={disconnect}>Disconnect &amp; clear</button></div>}
    </section>
    <div aria-live="polite" role="status">{busy && <p className="message">{busy}…</p>}{notice && <p className="message">{notice}</p>}</div>
    {error && <p role="alert" className="error">{error}</p>}
    {connected && <>
      <section><h2>1. Prepare a synthetic order</h2><p>Initialize local tables once, then register a generated demo patient and queue a CBC.</p><div className="row wrap">
        <button className="secondary" disabled={!!busy} onClick={()=>void mutation('Initialize demo','/v1/admin/bootstrap',{},'Demo tables initialized. Existing records are preserved.')}>Initialize demo</button>
        <button disabled={!!busy || !!patient} onClick={()=>void run('Registering synthetic patient',async epoch=>{const data=await request<{id:string;label:string}>('/v1/demo/patients',epoch,{label:`SYNTHETIC-CONSOLE-${crypto.randomUUID().slice(0,8)}`});if(valid(epoch)){setPatient(data);setNotice('Synthetic patient registered.');}})}>Register synthetic patient</button>
        <button disabled={!!busy || !patient || !!draft?.operationId} onClick={()=>void run('Queueing CBC',async epoch=>{
          if(!patient)return;
          const pending=draftRef.current ?? {patientId:patient.id,requestId:`console-${crypto.randomUUID()}`};
          draftRef.current=pending;setDraft(pending);
          const data=await request<{operationId:string;duplicated:boolean}>('/v1/demo/lab-orders',epoch,{patientId:pending.patientId,testCode:'CBC',requestId:pending.requestId});
          if(!valid(epoch))return;
          const confirmed={...pending,operationId:data.operationId};draftRef.current=confirmed;setDraft(confirmed);setSelected(data.operationId);setDetail(null);setNotice(data.duplicated?'Existing CBC recovered using the same request ID.':'CBC queued durably.');await refresh(epoch,data.operationId);
        })}>{draft && !draft.operationId?'Retry same CBC':'Queue CBC'}</button>
        {draft?.operationId && <button className="secondary" disabled={!!busy} onClick={()=>{draftRef.current=null;setDraft(null);setNotice('Ready to queue another distinct CBC for this synthetic patient.');}}>Prepare another CBC</button>}
      </div>{patient && <p className="mono">{patient.label} · {patient.id}</p>}{draft && <small className="mono">Request ID: {draft.requestId}{draft.operationId?' · Confirmed':' · Retained for safe retry'}</small>}
      <small>Registration is not retry-idempotent. If its response is interrupted, a new registration may create another synthetic patient.</small></section>
      <section><h2>2. Drive delivery explicitly</h2><p>Arm the lost-ACK fault before ticking to simulate a committed LIS request with a missing reply. Tick dispatches up to 10 eligible orders and imports available results.</p><div className="row wrap"><button className="secondary" disabled={!!busy} onClick={()=>void mutation('Arming lost ACK','/v1/demo/faults/drop-next-ack',{},'Lost ACK armed for the next eligible simulated delivery, which may belong to another queued operation.')}>Arm lost ACK</button><button disabled={!!busy} onClick={()=>void mutation('Running manual tick','/v1/admin/tick',{},'Manual dispatch and result-poll tick finished.')}>Tick delivery / poll results</button><button className="secondary" disabled={!!busy} onClick={()=>void run('Refreshing',epoch=>refresh(epoch))}>Refresh read-only</button></div><small>The console never runs mutations on a timer. A configured server scheduler can still advance operations.</small></section>
      <div className="workspace"><section><h2>Operations <span className="count">{orders.length}</span></h2><p>Latest 100 synthetic orders. Select one to inspect its state and timeline.</p>{orders.length===0?<p>No orders yet.</p>:<ul className="orders">{orders.map(order=><li key={order.operation_id}><button className={'order '+(selected===order.operation_id?'selected':'')} aria-pressed={selected===order.operation_id} disabled={!!busy} onClick={()=>void run('Loading operation',async epoch=>{setSelected(order.operation_id);setDetail(null);await loadDetail(order,epoch);})}><span className="row spread"><strong>{order.test_code}</strong><span className={'state '+order.operation_state}>{stateLabel(order.operation_state)}</span></span><span className="mono">{order.operation_id}</span><small className="mono">Patient: {order.patient_id}</small><small>{date(order.updated_at)} · {order.attempt_count} attempts</small></button></li>)}</ul>}</section>
      <section><h2>Selected operation</h2>{!detail || !selectedOrder?<p>Select an operation to view delivery evidence.</p>:<><p className="mono">{detail.operation.id}</p><p className="mono">Synthetic patient: {selectedOrder.patient_id}</p><p className="mono">Correlation key: {detail.operation.idempotency_key}</p><p><span className={'state '+detail.operation.state}>{stateLabel(detail.operation.state)}</span> · {detail.operation.attempt_count} attempts</p>{detail.operation.last_error && <p className="error">{detail.operation.last_error}</p>}{detail.operation.state==='queued' && <p>Not sent yet. The order is durably queued for delivery.</p>}{detail.operation.state==='outcome_unknown' && <p>Delivery not confirmed. The destination may have committed the order; reconcile before retrying.</p>}<p>Destination reference: {detail.operation.target_resource ?? 'Not confirmed'}</p><div className="row wrap"><button disabled={!!busy || !['outcome_unknown','retry'].includes(detail.operation.state)} onClick={()=>void mutation('Reconciling selected operation',`/v1/operations/${encodeURIComponent(selected)}/reconcile`,{},'Selected-operation reconciliation check finished. Inspect its current state and timeline.')}>Reconcile selected only</button><button className="secondary" disabled={!!busy || detail.operation.state!=='accepted'} onClick={()=>void mutation('Releasing simulated result',`/v1/demo/lis/orders/${encodeURIComponent(selected)}/release`,{resultText:'SYNTHETIC: 7.5',unitCode:'10^9/L'},'Simulated result released at the LIS. Use Tick delivery / poll results to import it.')}>Release simulated result</button></div><p><small>Unknown outcomes require a destination lookup before retry. Manual-review states need investigation; this console provides no bypass.</small></p><h3>Event timeline</h3>{detail.events.length?<ol className="timeline">{detail.events.map(event=><li key={event.id}><strong>{event.event_type}</strong><small>{date(event.occurred_at)}</small><code>{event.details_json}</code></li>)}</ol>:<p>No events recorded.</p>}<h3>Synthetic patient results</h3><small>All chart results for this operation’s synthetic patient.</small>{detail.results.length?<ul>{detail.results.map(result=><li key={result.source_report_id}>{result.test_code}: {result.result_text} {result.unit_code}</li>)}</ul>:<p>No imported results yet.</p>}</> }</section></div>
    </>}
    <footer>Single Worker · SQLite-backed outbox · Independently persisted simulated LIS<br/>Offline runtime after local installation. No remote scripts, fonts, or analytics.</footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
