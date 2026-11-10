jest.mock('react-native-version-number', () => ({ appVersion: '6.8.4', buildVersion: '1' }));
// @sefaria/search sends the 4th constructor arg as extra request headers;
// this checks that sefaria.js passes the User-Agent in.
jest.mock('@sefaria/search', () => {
  function Search(...args) { Search.constructedWith = args; }
  return { Search };
});

import Sefaria from '../sefaria';
import { USER_AGENT } from '../userAgent';
import { Search } from '@sefaria/search';

const EXPECTED_UA = 'SoferBooksLibrary/mobile-ios (6.8.4)';

const okResponse = (body = {}) => Promise.resolve({
  ok: true, status: 200, statusText: 'OK',
  json: () => Promise.resolve(body),
  text: () => Promise.resolve(JSON.stringify(body)),
});

describe('User-Agent on Sefaria API requests', () => {
  beforeEach(() => {
    global.fetch = jest.fn(() => okResponse({ hits: { hits: [] } }));
  });

  test('builds SoferBooksLibrary/<service> (<appVersion>)', () => {
    expect(USER_AGENT).toBe(EXPECTED_UA);
  });

  test('omits the version comment when the app version is unavailable', () => {
    jest.resetModules();
    jest.doMock('react-native-version-number', () => ({ appVersion: undefined, buildVersion: undefined }));
    expect(require('../userAgent').USER_AGENT).toBe('SoferBooksLibrary/mobile-ios');
  });

  test('api.js request funnel sends it, and never an Authorization header', async () => {
    await Sefaria.api._request('Genesis 1', 'text', true, {}, true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].headers['User-Agent']).toBe(EXPECTED_UA);
    expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  test('search client is constructed with it', () => {
    expect(Search.constructedWith).toEqual(['https://www.sefaria.org', 'text', 'sheet', { 'User-Agent': EXPECTED_UA }]);
  });
});
