import type { TableDefinition } from '../table-definition';
import { hospitalsTable } from './hospitals';
import { hospitalBmsConfigTable } from './hospital-bms-config';
import { cachedPatientsTable } from './cached-patients';
import { cachedPartographObservationsTable } from './cached-partograph-observations';
import { cachedVitalSignsTable } from './cached-vital-signs';
import { cpdScoresTable } from './cpd-scores';
import { usersTable } from './users';
import { auditLogsTable } from './audit-logs';
import { webhookApiKeysTable } from './webhook-api-keys';
import { maternalJourneysTable } from './maternal-journeys';
import { cachedAncVisitsTable } from './cached-anc-visits';
import { cachedAncRisksTable } from './cached-anc-risks';
import { cachedReferralsTable } from './cached-referrals';
import { cachedNewbornsTable } from './cached-newborns';

export {
  hospitalsTable,
  hospitalBmsConfigTable,
  cachedPatientsTable,
  cachedPartographObservationsTable,
  cachedVitalSignsTable,
  cpdScoresTable,
  usersTable,
  auditLogsTable,
  webhookApiKeysTable,
  maternalJourneysTable,
  cachedAncVisitsTable,
  cachedAncRisksTable,
  cachedReferralsTable,
  cachedNewbornsTable,
};

// All tables in creation order (respects foreign key dependencies)
export const ALL_TABLES: TableDefinition[] = [
  hospitalsTable,
  hospitalBmsConfigTable,
  usersTable,
  maternalJourneysTable,
  cachedPatientsTable,
  cachedPartographObservationsTable,
  cachedVitalSignsTable,
  cpdScoresTable,
  auditLogsTable,
  webhookApiKeysTable,
  cachedAncVisitsTable,
  cachedAncRisksTable,
  cachedReferralsTable,
  cachedNewbornsTable,
];
