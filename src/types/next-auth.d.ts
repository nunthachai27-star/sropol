// NextAuth v5 module augmentation — adds custom session/JWT fields
import 'next-auth';
import 'next-auth/jwt';
import type { UserRole } from '@/types/domain';

type AuthProviderKind = 'bms' | 'provider-id';
type SessionAccessMode = 'readwrite' | 'readonly';

declare module 'next-auth' {
  interface User {
    id: string;
    name?: string | null;
    userCid: string;
    role: UserRole;
    hospitalCode: string;
    hospitalName: string;
    tunnelUrl: string;
    databaseType: string;
    authProvider: AuthProviderKind;
    accessMode: SessionAccessMode;
    providerId?: string;
    providerCidHash?: string;
    providerOrgHcode?: string;
    providerScopes?: string[];
  }

  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      userCid: string;
      role: UserRole;
      hospitalCode: string;
      hospitalName: string;
      tunnelUrl: string;
      databaseType: string;
      authProvider: AuthProviderKind;
      accessMode: SessionAccessMode;
      providerId?: string;
      providerCidHash?: string;
      providerOrgHcode?: string;
      providerScopes?: string[];
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userCid: string;
    role: UserRole;
    hospitalCode: string;
    hospitalName: string;
    tunnelUrl: string;
    databaseType: string;
    authProvider: AuthProviderKind;
    accessMode: SessionAccessMode;
    providerId?: string;
    providerCidHash?: string;
    providerOrgHcode?: string;
    providerScopes?: string[];
  }
}
