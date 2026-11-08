// Journey events for observe.gmac.io (DATFLR-9). apps/hospital/dataflare.js defines window.dataflare;
// every call here is a no-op when it is missing (non-demo profiles, DNT/GPC, blocked script).
// Medical-data rules: events carry no properties apart from the small enums typed below. Never pass
// patient ids, names, departments, results or any other record data. The public demo has no
// accounts, so nothing calls identify.

export type HospitalAction = 'advance' | 'arrival' | 'wan' | 'clock' | 'resupply';

type Events = {
  hospital_action_completed: { action: HospitalAction };
  encounter_completed: undefined;
};
export type JourneyEvent = keyof Events;

const ACTIONS: readonly string[] = ['advance', 'arrival', 'wan', 'clock', 'resupply'];

type Dataflare = { track(event: string, props?: Record<string, string>): void };

export function track<E extends JourneyEvent>(event: E, ...[props]: Events[E] extends undefined ? [] : [Events[E]]): void {
  const df = (globalThis as { dataflare?: Dataflare }).dataflare;
  if (!df) return;
  // Re-check the enum at runtime so a widened caller can never leak free text.
  const safe = props && 'action' in props && ACTIONS.includes(props.action) ? { action: props.action } : undefined;
  if (props && !safe) return;
  try {
    df.track(event, safe);
  } catch {
    // Analytics must never break the simulator.
  }
}
