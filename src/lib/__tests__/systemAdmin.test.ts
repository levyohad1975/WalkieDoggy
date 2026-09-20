const ORIGINAL_ENV = process.env;

function mockSupabaseClient(rpc: jest.Mock) {
  jest.doMock('@supabase/supabase-js', () => ({
    createClient: jest.fn(() => ({
      auth: {
        getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
        signInAnonymously: jest.fn().mockResolvedValue({ error: null }),
      },
      rpc,
      from: jest.fn(),
      storage: { from: jest.fn() },
    })),
  }));
}

/**
 * BATCH 4 (item A — System Admin V1). Client-side (call-shape/error-
 * propagation/row-mapping) tests for lib/systemAdmin.ts, mirroring
 * lib/__tests__/permissionedWalks.test.ts's approach exactly. The actual
 * server-side is_system_admin() enforcement lives in the RPCs themselves
 * (migration 0029) and can only be verified against a real Supabase
 * project — this file only proves the client calls the right RPC with the
 * right arguments and maps the result faithfully.
 */
describe('lib/systemAdmin — Supabase mode', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon-key',
    };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('checkIsSystemAdmin calls am_i_system_admin with no arguments and returns the boolean verbatim', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: true, error: null });
    mockSupabaseClient(rpc);
    const { checkIsSystemAdmin } = require('../systemAdmin');

    await expect(checkIsSystemAdmin()).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('am_i_system_admin');
  });

  it('checkIsSystemAdmin returns false (not merely falsy-passthrough) for a non-admin caller', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: false, error: null });
    mockSupabaseClient(rpc);
    const { checkIsSystemAdmin } = require('../systemAdmin');

    await expect(checkIsSystemAdmin()).resolves.toBe(false);
  });

  it('checkIsSystemAdmin surfaces a genuine RPC error rather than swallowing it as false', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'JWT expired' } });
    mockSupabaseClient(rpc);
    const { checkIsSystemAdmin } = require('../systemAdmin');

    await expect(checkIsSystemAdmin()).rejects.toBeTruthy();
  });

  it('listSystemAdminFamilies calls system_admin_list_families with p_search and maps every field, including the distinguishing inviteCode', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [
        {
          family_id: 'fam-1',
          family_name: 'משפחת לוי',
          invite_code: 'ABC123',
          created_at: '2026-01-01T00:00:00Z',
          member_count: 3,
          admin_names: ['דנה'],
          dog_name: 'רקסי',
          status: 'active',
        },
      ],
      error: null,
    });
    mockSupabaseClient(rpc);
    const { listSystemAdminFamilies } = require('../systemAdmin');

    const result = await listSystemAdminFamilies('לוי');

    expect(rpc).toHaveBeenCalledWith('system_admin_list_families', { p_search: 'לוי' });
    expect(result).toEqual([
      {
        familyId: 'fam-1',
        familyName: 'משפחת לוי',
        inviteCode: 'ABC123',
        createdAt: '2026-01-01T00:00:00Z',
        memberCount: 3,
        adminNames: ['דנה'],
        dogName: 'רקסי',
        status: 'active',
      },
    ]);
  });

  it('listSystemAdminFamilies passes through a real (non-"active") approval status, not a hardcoded constant', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [
        { family_id: 'fam-1', family_name: 'משפחה ממתינה', invite_code: 'PND001', created_at: '2026-01-01T00:00:00Z', member_count: 1, admin_names: ['דנה'], dog_name: null, status: 'pending' },
        { family_id: 'fam-2', family_name: 'משפחה נדחתה', invite_code: 'REJ002', created_at: '2026-01-02T00:00:00Z', member_count: 1, admin_names: ['יוסי'], dog_name: null, status: 'rejected' },
      ],
      error: null,
    });
    mockSupabaseClient(rpc);
    const { listSystemAdminFamilies } = require('../systemAdmin');

    const result = await listSystemAdminFamilies();
    expect(result[0].status).toBe('pending');
    expect(result[1].status).toBe('rejected');
  });

  it('listSystemAdminFamilies with no/blank search sends p_search: null (server treats it as "no filter")', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [], error: null });
    mockSupabaseClient(rpc);
    const { listSystemAdminFamilies } = require('../systemAdmin');

    await listSystemAdminFamilies();
    expect(rpc).toHaveBeenCalledWith('system_admin_list_families', { p_search: null });

    await listSystemAdminFamilies('   ');
    expect(rpc).toHaveBeenLastCalledWith('system_admin_list_families', { p_search: null });
  });

  it('two families with the SAME name are both returned as distinct rows, distinguished by inviteCode — duplicate family names must work', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [
        { family_id: 'fam-1', family_name: 'המשפחה שלנו', invite_code: 'AAA111', created_at: '2026-01-01T00:00:00Z', member_count: 2, admin_names: [], dog_name: null, status: 'active' },
        { family_id: 'fam-2', family_name: 'המשפחה שלנו', invite_code: 'BBB222', created_at: '2026-01-02T00:00:00Z', member_count: 4, admin_names: [], dog_name: null, status: 'active' },
      ],
      error: null,
    });
    mockSupabaseClient(rpc);
    const { listSystemAdminFamilies } = require('../systemAdmin');

    const result = await listSystemAdminFamilies();
    expect(result).toHaveLength(2);
    expect(result[0].familyName).toBe(result[1].familyName);
    expect(result[0].familyId).not.toBe(result[1].familyId);
    expect(result[0].inviteCode).not.toBe(result[1].inviteCode);
  });

  it('listSystemAdminFamilies surfaces "system admin permission required" rather than swallowing a denial', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'system admin permission required' } });
    mockSupabaseClient(rpc);
    const { listSystemAdminFamilies } = require('../systemAdmin');

    await expect(listSystemAdminFamilies()).rejects.toBeTruthy();
  });

  it('listSystemAdminFamilies defaults to an empty list when the RPC succeeds with a null/undefined data payload', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: null });
    mockSupabaseClient(rpc);
    const { listSystemAdminFamilies } = require('../systemAdmin');

    await expect(listSystemAdminFamilies()).resolves.toEqual([]);
  });

  it('listSystemAdminFamilies maps a null admin_names to an empty array rather than null', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [
        { family_id: 'fam-1', family_name: 'משפחת כהן', invite_code: 'CCC333', created_at: '2026-01-01T00:00:00Z', member_count: 1, admin_names: null, dog_name: null, status: 'active' },
      ],
      error: null,
    });
    mockSupabaseClient(rpc);
    const { listSystemAdminFamilies } = require('../systemAdmin');

    const result = await listSystemAdminFamilies();
    expect(result[0].adminNames).toEqual([]);
  });

  it('setSystemAdminFamilyApproval calls system_admin_set_family_approval with p_family_id/p_approval_status and resolves with no return value on success', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: null });
    mockSupabaseClient(rpc);
    const { setSystemAdminFamilyApproval } = require('../systemAdmin');

    await expect(setSystemAdminFamilyApproval('fam-1', 'active')).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith('system_admin_set_family_approval', {
      p_family_id: 'fam-1',
      p_approval_status: 'active',
    });
  });

  it('setSystemAdminFamilyApproval passes through the rejected status verbatim', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: null });
    mockSupabaseClient(rpc);
    const { setSystemAdminFamilyApproval } = require('../systemAdmin');

    await setSystemAdminFamilyApproval('fam-2', 'rejected');
    expect(rpc).toHaveBeenCalledWith('system_admin_set_family_approval', {
      p_family_id: 'fam-2',
      p_approval_status: 'rejected',
    });
  });

  it('setSystemAdminFamilyApproval surfaces "system admin permission required" rather than swallowing it', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'system admin permission required' } });
    mockSupabaseClient(rpc);
    const { setSystemAdminFamilyApproval } = require('../systemAdmin');

    await expect(setSystemAdminFamilyApproval('fam-1', 'active')).rejects.toBeTruthy();
  });

  it('getSystemAdminFamilyDetail calls system_admin_get_family_detail with p_family_id and returns the jsonb bundle with safe array defaults', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: {
        family: { id: 'fam-1', name: 'משפחת לוי', inviteCode: 'ABC123', createdAt: '2026-01-01T00:00:00Z', approvalStatus: 'pending' },
        dog: null,
        members: [{ id: 'u1', name: 'דנה', avatar: '🐶', photoUrl: null, role: 'admin', removedAt: null, claimed: true }],
        // activeRequests/recentAudit intentionally omitted — mapping must default to [], never throw.
      },
      error: null,
    });
    mockSupabaseClient(rpc);
    const { getSystemAdminFamilyDetail } = require('../systemAdmin');

    const result = await getSystemAdminFamilyDetail('fam-1');

    expect(rpc).toHaveBeenCalledWith('system_admin_get_family_detail', { p_family_id: 'fam-1' });
    expect(result.family?.name).toBe('משפחת לוי');
    // approvalStatus must be a real per-family value passed through verbatim
    // (0035 fix), not silently dropped or a hardcoded constant.
    expect(result.family?.approvalStatus).toBe('pending');
    expect(result.dog).toBeNull();
    expect(result.members).toHaveLength(1);
    expect(result.activeRequests).toEqual([]);
    expect(result.recentAudit).toEqual([]);
  });

  it('getSystemAdminFamilyDetail surfaces a genuine RPC error rather than swallowing it', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'system admin permission required' } });
    mockSupabaseClient(rpc);
    const { getSystemAdminFamilyDetail } = require('../systemAdmin');

    await expect(getSystemAdminFamilyDetail('fam-1')).rejects.toBeTruthy();
  });

  it('getSystemAdminFamilyDetail defaults every field to its safe empty shape when the RPC succeeds with a null/undefined data payload', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: null });
    mockSupabaseClient(rpc);
    const { getSystemAdminFamilyDetail } = require('../systemAdmin');

    const result = await getSystemAdminFamilyDetail('fam-1');
    expect(result).toEqual({
      family: null,
      dog: null,
      members: [],
      walks: [],
      activeRequests: [],
      recentAudit: [],
    });
  });

  it('getSystemAdminEmailDeliveryLog calls system_admin_list_email_delivery_log with p_limit and maps every field, including nullable ones', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [
        {
          id: 'log-1',
          family_id: 'fam-1',
          auth_user_id: 'auth-1',
          message_type: 'family_welcome',
          recipient_email: 'dana@example.com',
          provider: 'resend',
          provider_message_id: 'msg-123',
          status: 'delivered',
          error: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:05:00Z',
        },
      ],
      error: null,
    });
    mockSupabaseClient(rpc);
    const { getSystemAdminEmailDeliveryLog } = require('../systemAdmin');

    const result = await getSystemAdminEmailDeliveryLog(25);

    expect(rpc).toHaveBeenCalledWith('system_admin_list_email_delivery_log', { p_limit: 25 });
    expect(result).toEqual([
      {
        id: 'log-1',
        familyId: 'fam-1',
        authUserId: 'auth-1',
        messageType: 'family_welcome',
        recipientEmail: 'dana@example.com',
        provider: 'resend',
        providerMessageId: 'msg-123',
        status: 'delivered',
        error: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:05:00Z',
      },
    ]);
  });

  it('getSystemAdminEmailDeliveryLog with no limit sends p_limit: null (server applies its own default of 50)', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [], error: null });
    mockSupabaseClient(rpc);
    const { getSystemAdminEmailDeliveryLog } = require('../systemAdmin');

    await getSystemAdminEmailDeliveryLog();
    expect(rpc).toHaveBeenCalledWith('system_admin_list_email_delivery_log', { p_limit: null });
  });

  it('getSystemAdminEmailDeliveryLog surfaces a genuine RPC error rather than swallowing it', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'system admin permission required' } });
    mockSupabaseClient(rpc);
    const { getSystemAdminEmailDeliveryLog } = require('../systemAdmin');

    await expect(getSystemAdminEmailDeliveryLog()).rejects.toBeTruthy();
  });

  it('getSystemAdminEmailDeliveryLog defaults to an empty list when the RPC succeeds with a null/undefined data payload', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: null });
    mockSupabaseClient(rpc);
    const { getSystemAdminEmailDeliveryLog } = require('../systemAdmin');

    await expect(getSystemAdminEmailDeliveryLog()).resolves.toEqual([]);
  });

  it('local/demo mode: every function throws SupabaseNotConfiguredError rather than pretending to succeed', async () => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const {
      checkIsSystemAdmin,
      listSystemAdminFamilies,
      getSystemAdminFamilyDetail,
      getSystemAdminEmailDeliveryLog,
      setSystemAdminFamilyApproval,
    } = require('../systemAdmin');
    const { SupabaseNotConfiguredError } = require('../supabase');

    await expect(checkIsSystemAdmin()).rejects.toBeInstanceOf(SupabaseNotConfiguredError);
    await expect(listSystemAdminFamilies()).rejects.toBeInstanceOf(SupabaseNotConfiguredError);
    await expect(getSystemAdminFamilyDetail('fam-1')).rejects.toBeInstanceOf(SupabaseNotConfiguredError);
    await expect(getSystemAdminEmailDeliveryLog()).rejects.toBeInstanceOf(SupabaseNotConfiguredError);
    await expect(setSystemAdminFamilyApproval('fam-1', 'active')).rejects.toBeInstanceOf(SupabaseNotConfiguredError);
  });
});
