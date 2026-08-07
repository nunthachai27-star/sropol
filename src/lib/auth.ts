// T085: NextAuth.js v5 — full Node-side config. Extends the Edge-safe
// `auth.config.ts` with the Credentials providers (which call into DB-backed
// `assertHospitalAccess` + the in-memory ProviderID pending-session store).
// The middleware must NOT import this file — it imports `auth.config` only.
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { authConfig } from '@/lib/auth.config';
import { mapPositionToRole, validateBmsSession } from '@/lib/auth-utils';
import { promoteRoleByAllowedCid } from '@/lib/admin-access';
import { assertHospitalAccess } from '@/lib/hospital-access-guard';
import { logger } from '@/lib/logger';
import { UserRole } from '@/types/domain';
import { consumeProviderPendingSession } from '@/lib/provider-id-session-store';
import { extractProviderScopes } from '@/lib/provider-id';

export { mapPositionToRole, validateBmsSession } from '@/lib/auth-utils';
export type { BmsUserIdentity } from '@/lib/auth-utils';

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: 'BMS Session',
      credentials: {
        sessionId: { label: 'BMS Session ID', type: 'text' },
      },
      async authorize(credentials) {
        const sessionId = credentials?.sessionId as string;
        if (!sessionId) return null;

        const tunnelUrl = process.env.DEV_HOSPITAL_TUNNEL_URL ?? '';
        const identity = await validateBmsSession(sessionId, tunnelUrl);
        if (!identity) return null;

        // ADMIN_ALLOWED_CIDS is a grant as well as a cap: a BMS (readwrite)
        // login whose CID is on the list becomes ADMIN even when the HOSxP
        // position string doesn't say "director". Rule + rationale live in
        // @/lib/admin-access; ProviderID readonly sessions are never promoted.
        const role = promoteRoleByAllowedCid(identity.role, {
          userCid: identity.userCid,
          accessMode: 'readwrite',
        });
        if (role !== identity.role) {
          logger.info('admin_role_promoted_by_cid', {
            hospitalCode: identity.hospitalCode,
            positionRole: identity.role,
            // Named userIdLast4 (not userCidLast4) to match the denial logs in
            // middleware.ts / admin-guard.ts — any key containing "cid" is
            // redacted by the PDPA logger, which would blank the one line that
            // attributes a privilege escalation.
            userIdLast4: identity.userCid.slice(-4),
          });
        }

        // Reject the login when the BMS identity belongs to a hospital that
        // isn't registered (or is deactivated). Exempt only: hcode 00000 /
        // 99999 (system + provincial admin). Role does NOT bypass — even
        // ADMIN role from an unregistered hospital is denied; cross-province
        // admins must use one of the exempt hcodes. Failure closed so an
        // operator removing a hospital from the admin list immediately
        // blocks new sessions.
        const access = await assertHospitalAccess({
          hospitalCode: identity.hospitalCode,
          role,
          accessMode: 'readwrite',
        });
        if (!access.allowed) {
          logger.warn('bms_login_rejected', {
            hospitalCode: identity.hospitalCode,
            hospitalName: identity.hospitalName,
            role,
            reason: access.reason,
          });
          return null;
        }

        return {
          id: sessionId,
          name: identity.name,
          userCid: identity.userCid,
          role,
          hospitalCode: identity.hospitalCode,
          hospitalName: identity.hospitalName,
          tunnelUrl: identity.tunnelUrl,
          databaseType: identity.databaseType,
          authProvider: 'bms',
          accessMode: 'readwrite',
        };
      },
    }),
    Credentials({
      id: 'provider-id',
      name: 'ProviderID',
      credentials: {
        token: { label: 'ProviderID one-time token', type: 'text' },
        organizationIndex: { label: 'Organization index', type: 'text' },
      },
      async authorize(credentials) {
        const token = typeof credentials?.token === 'string' ? credentials.token : '';
        const organizationIndex = Number(credentials?.organizationIndex ?? 0);
        logger.info('provider_id_authorize_attempt', {
          hasToken: Boolean(token),
          organizationIndex,
        });
        if (!token || !Number.isInteger(organizationIndex)) {
          logger.warn('provider_id_authorize_rejected', {
            reason: 'invalid_credentials',
            hasToken: Boolean(token),
            organizationIndex,
          });
          return null;
        }

        const consumed = consumeProviderPendingSession(token, organizationIndex);
        if (!consumed.ok) {
          logger.warn('provider_id_authorize_rejected', {
            reason: consumed.reason,
            organizationIndex,
          });
          return null;
        }

        const { data, flowId } = consumed;
        const org = data.organizations[consumed.organizationIndex];
        if (!org?.hcode) {
          logger.warn('provider_id_authorize_rejected', {
            flowId,
            reason: 'org_missing_hcode',
            organizationIndex: consumed.organizationIndex,
            providerId: data.user.provider_id,
          });
          return null;
        }

        const mappedRole = mapPositionToRole(org.position ?? '');
        const readonlyRole = mappedRole === UserRole.ADMIN ? UserRole.NURSE : mappedRole;

        logger.info('provider_id_authorize_org_selected', {
          flowId,
          providerId: data.user.provider_id,
          organizationIndex: consumed.organizationIndex,
          hospitalCode: org.hcode,
          hospitalName: org.hname_th,
          position: org.position,
          mappedRole,
          readonlyRole,
        });

        const access = await assertHospitalAccess({
          hospitalCode: org.hcode,
          role: readonlyRole,
          accessMode: 'readonly',
        });
        if (!access.allowed) {
          logger.warn('provider_id_login_rejected', {
            flowId,
            hospitalCode: org.hcode,
            hospitalName: org.hname_th,
            providerId: data.user.provider_id,
            position: org.position,
            mappedRole,
            readonlyRole,
            reason: access.reason,
          });
          return null;
        }

        logger.info('provider_id_login_succeeded', {
          flowId,
          providerId: data.user.provider_id,
          hospitalCode: org.hcode,
          hospitalName: org.hname_th || org.hname_eng || `รพ.${org.hcode}`,
          role: readonlyRole,
          accessMode: 'readonly',
          accessReason: access.reason,
        });

        return {
          id: `provider:${data.user.provider_id}`,
          name: `${data.user.title_th ?? ''}${data.user.name_th ?? data.user.name_eng}`.trim(),
          userCid: data.user.cid ?? '',
          role: readonlyRole,
          hospitalCode: org.hcode,
          hospitalName: org.hname_th || org.hname_eng || `รพ.${org.hcode}`,
          tunnelUrl: '',
          databaseType: '',
          authProvider: 'provider-id',
          accessMode: 'readonly',
          providerId: data.user.provider_id,
          providerCidHash: data.user.cid_hash,
          providerOrgHcode: org.hcode,
          providerScopes: extractProviderScopes(org),
        };
      },
    }),
  ],
});
