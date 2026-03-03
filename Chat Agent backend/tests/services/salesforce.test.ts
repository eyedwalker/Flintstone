import * as crypto from 'crypto';
import { mockSSM, GetParameterCommand } from '../helpers/mock-aws';

// Mock the global fetch for Salesforce API calls
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const ssmMock = mockSSM();

// Generate a real RSA key pair for testing JWT signing
const { privateKey: testPrivateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

beforeEach(() => {
  ssmMock.reset();
  mockFetch.mockReset();
});

// Import after mocks are set up
import { getAccessToken, createCase } from '../../src/services/salesforce';

describe('salesforce service', () => {
  describe('getAccessToken', () => {
    it('exchanges JWT for access token', async () => {
      ssmMock.on(GetParameterCommand).resolves({
        Parameter: { Value: testPrivateKey },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'fake-access-token',
          instance_url: 'https://test.salesforce.com',
        }),
      });

      const result = await getAccessToken({
        instanceUrl: 'https://test.salesforce.com',
        consumerKey: 'test-consumer-key',
        username: 'admin@test.com',
        ssmPrivateKeyParam: '/chat-agent/dev/salesforce/test/private-key',
      });

      expect(result.accessToken).toBe('fake-access-token');
      expect(result.instanceUrl).toBe('https://test.salesforce.com');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Verify the request body contains a JWT grant
      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toBe('https://login.salesforce.com/services/oauth2/token');
      const bodyStr = fetchCall[1].body;
      expect(bodyStr).toContain('grant_type=urn');
      expect(bodyStr).toContain('assertion=');
    });

    it('throws on failed token exchange', async () => {
      ssmMock.on(GetParameterCommand).resolves({
        Parameter: { Value: testPrivateKey },
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => '{"error":"invalid_grant"}',
      });

      await expect(getAccessToken({
        instanceUrl: 'https://test.salesforce.com',
        consumerKey: 'test-key',
        username: 'admin@test.com',
        ssmPrivateKeyParam: '/test/key',
      })).rejects.toThrow('Salesforce token exchange failed');
    });
  });

  describe('createCase', () => {
    it('creates a Salesforce case and returns case number', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: '5001234567890', success: true }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ CaseNumber: '00001234' }),
      });

      const result = await createCase('fake-token', 'https://test.salesforce.com', {
        Subject: 'Test Case',
        Description: 'Test description',
        Priority: 'Medium',
        Origin: 'Chat',
        Status: 'New',
      });

      expect(result.id).toBe('5001234567890');
      expect(result.caseNumber).toBe('00001234');
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Verify authorization header
      const createCall = mockFetch.mock.calls[0];
      expect(createCall[1].headers['Authorization']).toBe('Bearer fake-token');
    });

    it('handles case creation failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: async () => '[{"message":"Invalid field"}]',
      });

      await expect(createCase('fake-token', 'https://test.salesforce.com', {
        Subject: 'Test',
        Description: 'Fail test',
      })).rejects.toThrow('Salesforce case creation failed');
    });
  });
});
