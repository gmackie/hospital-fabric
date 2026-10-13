import { choice } from './protocol.js';
export const PROFILE_IDS = ['emt2-research-v2', 'emt3-research-v2'] as const;
export type ProfileId = typeof PROFILE_IDS[number];
export type Profile = {
  id: ProfileId; wardBeds: number; icuBeds: number; theatres: number; pacuBays: number;
  missionDays: number; maxPatients: number; maxCommands: number; sterileSets: number;
};
/** Planning scenarios, NOT WHO verification. Forty ward + four ICU is an explicit conservative choice. */
export const PROFILES: Readonly<Record<ProfileId, Readonly<Profile>>> = Object.freeze({
  'emt2-research-v2': Object.freeze({id:'emt2-research-v2',wardBeds:20,icuBeds:0,theatres:1,pacuBays:2,missionDays:21,maxPatients:80,maxCommands:1000,sterileSets:4}),
  'emt3-research-v2': Object.freeze({id:'emt3-research-v2',wardBeds:40,icuBeds:4,theatres:2,pacuBays:4,missionDays:28,maxPatients:160,maxCommands:2000,sterileSets:8}),
});
export function profile(id: unknown): Profile { return {...PROFILES[choice(id, PROFILE_IDS)]}; }
export const STANDARD_REFERENCES = [
  {id:'WHO-EMT-2021-TYPOLOGY',source:'https://extranet.who.int/emt/sites/default/files/BlueBook2021.pdf',printedPages:'18-19',scope:'Type 3 capacity and deployment duration; not a complete assessment'},
  {id:'WHO-EMT-2021-ICU',source:'https://extranet.who.int/emt/sites/default/files/BlueBook2021.pdf',printedPages:'55',scope:'ICU beds, nursing and multidisciplinary capabilities'},
  {id:'WHO-EMT-2021-LAB',source:'https://extranet.who.int/emt/sites/default/files/BlueBook2021.pdf',printedPages:'68',scope:'Additional tests and referral specimens'},
];
