// QA round 1 (2026-11-10): content-filter leaks in preview text, counts in the connections panel,
// and the first-launch library prompt showing over the content-filter chooser.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import { ERRORS } from '../errors';

jest.mock('../offline', () => ({
  ...jest.requireActual('../offline'),
  loadTextOffline: jest.fn(() => Promise.reject('Missing offline data')),
}));

import Sefaria from '../sefaria';
import * as shomer from '../shomer';
import { configForPreset } from '../shomer/presets';
import { loadText } from '../offlineOnline';
import ReaderApp from '../ReaderApp';
import strings from '../LocalizedStrings';

const JPS_1985 = 'Tanakh: The Holy Scriptures, published by JPS';

beforeEach(() => {
  shomer.setConfig(configForPreset('yeshivish'));
});
afterAll(() => shomer.setConfig(null));

describe('previews use only allowed translations', () => {
  test('History/Saved previews (bulktext) show no English from an unknown, possibly hidden version', async () => {
    expect(ERRORS.MISSING_OFFLINE_DATA).toBe('Missing offline data');
    const spy = jest.spyOn(Sefaria.api, '_request').mockResolvedValue({
      'Genesis 1:3': { ref: 'Genesis 1:3', en: 'God said, “Let there be light”; and there was light.', he: 'וַיֹּאמֶר אֱלֹהִים' },
    });
    const out = await Sefaria.api.getBulkText(['Genesis 1:3'], true);
    expect(out['Genesis 1:3'].en).toBe('');
    expect(out['Genesis 1:3'].he).toBe('וַיֹּאמֶר אֱלֹהִים');
    // with the filter off the preview is untouched (from the cache this time)
    shomer.setConfig({ preset: 'off' });
    expect((await Sefaria.api.getBulkText(['Genesis 1:3'], true))['Genesis 1:3'].en).toMatch(/light/);
    spy.mockRestore();
  });

  test('a links-panel preview whose English is a hidden translation keeps only the Hebrew', async () => {
    const spy = jest.spyOn(Sefaria.api, '_request').mockImplementation(async (ref) => ({
      text: ref === 'Exodus 1:1' ? 'These are the names (JPS 1985)' : 'These are the names (Koren)',
      he: 'וְאֵלֶּה שְׁמוֹת',
      sectionRef: ref.replace(/:\d+$/, ''),
      versionTitle: ref === 'Exodus 1:1' ? JPS_1985 : 'The Koren Jerusalem Bible',
    }));
    const hidden = await loadText('Exodus 1:1', false);
    expect(hidden.result.en).toBe('');
    expect(hidden.result.he).toBe('וְאֵלֶּה שְׁמוֹת');
    const allowed = await loadText('Exodus 1:2', false);
    expect(allowed.result.en).toBe('These are the names (Koren)');
    spy.mockRestore();
  });
});

describe('connection counts count only visible books', () => {
  test('links to a hidden book are left out, also under a shared collective title', () => {
    const saved = { index: Sefaria._index, list: Sefaria._commentatorListBySection };
    Sefaria._index = { 'Rashi on Genesis': { title: 'Rashi on Genesis', heTitle: 'רש"י על בראשית' } };
    Sefaria._commentatorListBySection = {};
    const link = (textTitle, sourceRef, category = 'Commentary', collectiveTitle) => (
      { category, textTitle, sourceRef, sourceHeRef: sourceRef, collectiveTitle, sourceHasEn: true });
    const summary = Sefaria.links.linkSummary('Genesis 1', [
      link('Rashi on Genesis', 'Rashi on Genesis 1:1:1', 'Commentary', 'Rashi'),
      link('Hidden Rashi Edition', 'Hidden Rashi Edition 1:1:1', 'Commentary', 'Rashi'),
      link('Hidden Book', 'Hidden Book 1:1'),
      link('Hidden Midrash', 'Hidden Midrash 1', 'Midrash'),
    ], 'english');
    const commentary = summary.find(c => c.category === 'Commentary');
    expect(commentary.count).toBe(1);
    expect(commentary.books.map(b => [b.title, b.count])).toEqual([['Rashi', 1]]);
    // a category whose books are all hidden does not show up as "Midrash (0)"
    expect(summary.find(c => c.category === 'Midrash')).toBeUndefined();
    Sefaria._index = saved.index;
    Sefaria._commentatorListBySection = saved.list;
  });
});

describe('first launch: the library prompt waits for the content-filter choice', () => {
  const makeApp = contentFilter => {
    const app = Object.create(ReaderApp.prototype);
    app.props = { contentFilter };
    app.state = { readerTabs: null, menuOpen: 'navigation' };
    app.openMenu = jest.fn();
    return app;
  };

  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });
  afterEach(() => Alert.alert.mockRestore());

  test('no alert while the chooser is up, then exactly one once a filter is chosen', async () => {
    const app = makeApp(null);
    await app.promptLibraryDownload();
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem('libraryDownloadPrompted')).toBeNull();

    const prevProps = app.props;
    app.props = { contentFilter: configForPreset('yeshivish') };
    app.componentDidUpdate(prevProps, app.state);
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    expect(Alert.alert).toHaveBeenCalledTimes(1);

    // later updates and calls do not show it again
    app.componentDidUpdate(app.props, app.state);
    await app.promptLibraryDownload();
    expect(Alert.alert).toHaveBeenCalledTimes(1);
  });

  test('when the filter was chosen before (later launches) it shows straight away, once ever', async () => {
    const app = makeApp(configForPreset('rwmo'));
    await app.promptLibraryDownload();
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    await makeApp(configForPreset('rwmo')).promptLibraryDownload();
    expect(Alert.alert).toHaveBeenCalledTimes(1);
  });

  test('"Not now" closes the welcome prompt without a second alert', async () => {
    await makeApp(configForPreset('rwmo')).promptLibraryDownload();
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    const [, message, buttons] = Alert.alert.mock.calls[0];
    expect(message).toContain(strings.download.how_to_download_library_message);
    const notNow = buttons.find(b => b.text === strings.common.not_now);
    if (notNow.onPress) { notNow.onPress(); }
    expect(Alert.alert).toHaveBeenCalledTimes(1);
  });
});
