export interface ProviderOrganization {
  business_id: string;
  hcode: string;
  hcode9: string | null;
  hname_th: string;
  hname_eng: string;
  position: string;
  position_id: string;
  affiliation: string;
  license_id: string;
  tax_id: string;
  expertise: string;
  level: string;
  is_hr_admin: boolean;
  is_director: boolean;
  moph_station_ref_code: string;
  moph_access_token_idp: string;
  license_expired_date: string;
  address?: {
    address?: string;
    moo?: string | null;
    building?: string | null;
    soi?: string | null;
    street?: string | null;
    province?: string;
    district?: string;
    sub_district?: string;
    zip_code?: string;
  };
}

export interface ProviderUserInfo {
  account_id: string;
  provider_id: string;
  cid_hash: string;
  cid?: string;
  title_th: string;
  title_en: string;
  name_th: string;
  name_eng: string;
  firstname_th: string;
  lastname_th: string;
  firstname_en: string;
  lastname_en: string;
  mobile_number: string;
  birth_date: string;
  gender_th?: string;
  gender_eng?: string;
}

export interface ProviderPendingSession {
  user: ProviderUserInfo;
  organizations: ProviderOrganization[];
  authTime: string;
}

export interface ProviderOrgSummary {
  index: number;
  hcode: string;
  hnameTh: string;
  hnameEng: string;
  position: string;
  affiliation: string;
  province?: string;
  district?: string;
  isDirector: boolean;
  isHrAdmin: boolean;
}

interface MophTokenResponse {
  status: string;
  data?: {
    access_token: string;
    token_type: string;
    expires_in: number;
    account_id: string;
  };
  message?: string;
}

interface MophAccountResponse {
  status: string;
  data?: {
    mobile_number: string;
    birth_date: string;
    gender_th?: string;
    gender_eng?: string;
  };
  message?: string;
}

interface ProviderTokenResponse {
  status: number;
  message: string;
  data?: {
    access_token: string;
    token_type: string;
    expires_in: number;
    account_id: string;
  };
}

interface StaffProfileResponse {
  status: number;
  message: string;
  data?: {
    account_id: string;
    hash_cid: string;
    provider_id: string;
    title_th: string;
    title_en: string;
    name_th: string;
    name_eng: string;
    firstname_th: string;
    lastname_th: string;
    firstname_en: string;
    lastname_en: string;
    date_of_birth: string;
    organization: ProviderOrganization[];
  };
}

export interface MophAccessTokenPayload {
  scopes_detail?: {
    id_card?: string;
    hash_id_card?: string;
  };
  [key: string]: unknown;
}

export interface MophIdpTokenPayload {
  exp?: number;
  iat?: number;
  client?: {
    scope?: Array<{ code: string }>;
    role?: string[];
    hospital_code?: string;
    hospital_name?: string;
    provider_id?: string;
  };
}

function getProviderConfig() {
  const mophOAuthUrl = process.env.NEXT_PUBLIC_MOPH_OAUTH_URL || 'https://moph.id.th';
  const providerApiUrl = process.env.NEXT_PUBLIC_PROVIDER_API_URL || 'https://provider.id.th';
  const clientId = process.env.NEXT_PUBLIC_MOPH_OAUTH_CLIENT_ID || '';
  const clientSecret = process.env.MOPH_OAUTH_CLIENT_SECRET || '';
  const providerClientId = process.env.PROVIDER_API_CLIENT_ID || '';
  const providerSecretKey = process.env.PROVIDER_API_SECRET_KEY || '';

  if (!clientId || !clientSecret || !providerClientId || !providerSecretKey) {
    throw new Error('ProviderID OAuth credentials are not configured');
  }

  return {
    mophOAuthUrl: mophOAuthUrl.replace(/\/$/, ''),
    providerApiUrl: providerApiUrl.replace(/\/$/, ''),
    clientId,
    clientSecret,
    providerClientId,
    providerSecretKey,
  };
}

export function buildProviderAuthorizeUrl(redirectUri: string, state: string): string {
  const config = getProviderConfig();
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    scope: 'ProviderID',
    response_type: 'code',
    response_mode: 'query',
    state,
  });
  return `${config.mophOAuthUrl}/oauth/redirect?${params.toString()}`;
}

export function parseJwtPayload<T>(token: string): T | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const decoded = Buffer.from(payload, 'base64url').toString('utf8');
    return JSON.parse(decoded) as T;
  } catch {
    return null;
  }
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export async function completeProviderOAuth(
  code: string,
  redirectUri: string,
): Promise<ProviderPendingSession> {
  const config = getProviderConfig();

  const tokenResponse = await fetch(`${config.mophOAuthUrl}/api/v1/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const tokenData = await readJson<MophTokenResponse>(tokenResponse);
  if (!tokenResponse.ok || tokenData.status !== 'success' || !tokenData.data?.access_token) {
    throw new Error(tokenData.message || 'ProviderID token exchange failed');
  }

  const accessToken = tokenData.data.access_token;
  const mophClaims = parseJwtPayload<MophAccessTokenPayload>(accessToken);
  const userCid = mophClaims?.scopes_detail?.id_card;

  const accountResponse = await fetch(`${config.mophOAuthUrl}/api/v1/accounts`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  const accountData = await readJson<MophAccountResponse>(accountResponse);
  if (!accountResponse.ok || accountData.status !== 'success' || !accountData.data) {
    throw new Error(accountData.message || 'Unable to fetch MOPH account profile');
  }

  const providerTokenResponse = await fetch(`${config.providerApiUrl}/api/v1/services/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.providerClientId,
      secret_key: config.providerSecretKey,
      token_by: 'Health ID',
      token: accessToken,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const providerTokenData = await readJson<ProviderTokenResponse>(providerTokenResponse);
  if (
    !providerTokenResponse.ok ||
    providerTokenData.status !== 200 ||
    !providerTokenData.data?.access_token
  ) {
    throw new Error(providerTokenData.message || 'Unable to fetch ProviderID service token');
  }

  const staffResponse = await fetch(`${config.providerApiUrl}/api/v1/services/moph-idp/profile-staff`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${providerTokenData.data.access_token}`,
    },
    body: JSON.stringify({
      client_id: config.providerClientId,
      secret_key: config.providerSecretKey,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const staffData = await readJson<StaffProfileResponse>(staffResponse);
  if (!staffResponse.ok || staffData.status !== 200 || !staffData.data) {
    throw new Error(staffData.message || 'Unable to fetch ProviderID staff profile');
  }

  const organizations = staffData.data.organization ?? [];
  if (organizations.length === 0) {
    throw new Error('ProviderID profile has no organization');
  }

  return {
    user: {
      account_id: staffData.data.account_id,
      provider_id: staffData.data.provider_id,
      cid_hash: staffData.data.hash_cid,
      cid: userCid,
      title_th: staffData.data.title_th,
      title_en: staffData.data.title_en,
      name_th: staffData.data.name_th,
      name_eng: staffData.data.name_eng,
      firstname_th: staffData.data.firstname_th,
      lastname_th: staffData.data.lastname_th,
      firstname_en: staffData.data.firstname_en,
      lastname_en: staffData.data.lastname_en,
      mobile_number: accountData.data.mobile_number,
      birth_date: staffData.data.date_of_birth || accountData.data.birth_date,
      gender_th: accountData.data.gender_th,
      gender_eng: accountData.data.gender_eng,
    },
    organizations,
    authTime: new Date().toISOString(),
  };
}

export function summarizeProviderOrgs(organizations: ProviderOrganization[]): ProviderOrgSummary[] {
  return organizations.map((org, index) => ({
    index,
    hcode: org.hcode,
    hnameTh: org.hname_th,
    hnameEng: org.hname_eng,
    position: org.position,
    affiliation: org.affiliation,
    province: org.address?.province,
    district: org.address?.district,
    isDirector: org.is_director,
    isHrAdmin: org.is_hr_admin,
  }));
}

export function extractProviderScopes(org: ProviderOrganization): string[] {
  const payload = parseJwtPayload<MophIdpTokenPayload>(org.moph_access_token_idp);
  return (payload?.client?.scope ?? [])
    .map((scope) => scope.code)
    .filter((code): code is string => typeof code === 'string' && code.length > 0);
}
