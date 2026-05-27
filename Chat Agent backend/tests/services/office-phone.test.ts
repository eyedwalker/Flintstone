import { mockDynamoDB, GetCommand } from '../helpers/mock-aws';
import { getOfficePhone } from '../../src/services/integrations';

const ddbMock = mockDynamoDB();

describe('getOfficePhone', () => {
  const TENANT_ID = 'tenant-123';
  const ORIGINAL_DEFAULT = process.env['DEFAULT_OFFICE_PHONE'];

  beforeEach(() => {
    ddbMock.reset();
    delete process.env['DEFAULT_OFFICE_PHONE'];
  });

  afterAll(() => {
    if (ORIGINAL_DEFAULT === undefined) delete process.env['DEFAULT_OFFICE_PHONE'];
    else process.env['DEFAULT_OFFICE_PHONE'] = ORIGINAL_DEFAULT;
  });

  it('returns the tenant officePhone when set', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { officePhone: '+15551234567' } });
    expect(await getOfficePhone(TENANT_ID)).toBe('+15551234567');
  });

  it('falls back to DEFAULT_OFFICE_PHONE env when tenant has no officePhone', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { id: TENANT_ID } });
    process.env['DEFAULT_OFFICE_PHONE'] = '+15559998888';
    expect(await getOfficePhone(TENANT_ID)).toBe('+15559998888');
  });

  it('falls back to legacy literal when tenant and env are both unset', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    expect(await getOfficePhone(TENANT_ID)).toBe('+15806336937');
  });

  it('prefers tenant value over env even when both are set', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { officePhone: '+15551234567' } });
    process.env['DEFAULT_OFFICE_PHONE'] = '+15559998888';
    expect(await getOfficePhone(TENANT_ID)).toBe('+15551234567');
  });
});
