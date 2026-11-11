// Owner's changes of 2026-11-11: the name "SoferBooks Library" with the book-and-quill logo,
// "Today's learning" under the library shelves, no content-filter chooser at first launch, and
// sefaria.org links opening in the app.
import fs from 'fs';
import path from 'path';
import React from 'react';
import { Text, Linking, Platform } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import Sefaria from '../sefaria';
import * as shomer from '../shomer';
import DeepLinkRouter, { WEB_ONLY_PAGES } from '../DeepLinkRouter';
import TestContextWrapper from '../TestContextWrapper';
import { TextsPage, continueReadingItems } from '../TextsPage';
import ReaderAppContext from '../context';
import { AboutPage } from '../AboutPage';
import SoferBooksLogo from '../SoferBooksLogo';
import { SefariaLinksSetting, openSefariaLinkSettings } from '../SettingsPage';
import strings from '../LocalizedStrings';

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const noop = () => {};

beforeAll(() => {
  global.fetch = jest.fn(() => Promise.reject(new Error('no network in tests')));
  // what the home page reads off the Sefaria singleton (as in i18nRendering.test.js)
  Sefaria.toc = [{ category: 'Tanakh', heCategory: 'תנ״ך', enShortDesc: 'The Hebrew Bible.', heShortDesc: 'המקרא.' }];
  Sefaria.calendar = {};   // truthy: the calendar counts as loaded, nothing is read from the device
  Sefaria.galusOrIsrael = 'diaspora';
});

const allText = inst => inst.root.findAllByType(Text)
  .flatMap(n => [].concat(n.props.children).filter(c => typeof c === 'string'));

describe('the name', () => {
  test('the launcher label and app name are "SoferBooks Library" (Hebrew phones: ספריית SoferBooks)', () => {
    const gradle = read('android/app/build.gradle');
    expect(gradle).toMatch(/resValue "string", "app_name", project\.findProperty\("qaAppName"\) \?: "SoferBooks Library"/);
    expect(gradle).toMatch(/resValue "string", "launcher_label", project\.findProperty\("qaAppName"\) \?: "SoferBooks Library"/);
    const he = read('android/app/src/main/res/values-iw/strings.xml');
    expect(he).toContain('<string name="app_name">ספריית SoferBooks</string>');
    expect(he).toContain('<string name="launcher_label">ספריית SoferBooks</string>');
  });

  test('About and the strings use the name in both languages', () => {
    const en = require('../i18n/en.json');
    const he = require('../i18n/he.json');
    expect(en['a11y.soferbooks_logo']).toBe('SoferBooks Library');
    expect(he['a11y.soferbooks_logo']).toBe('ספריית SoferBooks');
    expect(JSON.stringify(he)).not.toContain('SoferBooks Library');
  });

  test('the logo is the book-and-quill mark with "SoferBooks Library", not the old SOFER picture', () => {
    let inst;
    act(() => { inst = renderer.create(<SoferBooksLogo />); });
    expect(inst.root.findAllByProps({ testID: 'soferbooks-mark' }).length).toBeGreaterThan(0);
    expect(allText(inst).join('').replace(/\s+/g, ' ').trim()).toBe('SoferBooks Library');
    act(() => { inst.update(<SoferBooksLogo hebrew />); });
    expect(allText(inst).join('').replace(/\s+/g, ' ').trim()).toBe('ספריית SoferBooks');
    act(() => { inst.unmount(); });
    expect(fs.existsSync(path.join(ROOT, 'img/soferbooks-logo@2x.png'))).toBe(false);
  });

  test('the home page and About show the new logo', () => {
    for (const [Page, props] of [
      [TextsPage, { categories: [], setCategories: noop, openRef: noop, openLearningSchedules: noop, onBack: noop, openAbout: noop, openHistory: noop }],
      [AboutPage, { close: noop, openUri: noop }],
    ]) {
      let inst;
      act(() => { inst = renderer.create(<TestContextWrapper child={Page} childProps={props} />); });
      expect(inst.root.findAllByProps({ testID: 'soferbooks-logo' }).length).toBeGreaterThan(0);
      act(() => { inst.unmount(); });
    }
  });
});

describe('home page order', () => {
  test('"Today\'s learning" comes after "Browse the library" (the shelves)', () => {
    Sefaria.history.lastPlace = [];
    let inst;
    act(() => {
      inst = renderer.create(<TestContextWrapper child={TextsPage} childProps={{
        categories: [], setCategories: noop, openRef: noop, openLearningSchedules: noop,
        onBack: noop, openAbout: noop, openHistory: noop,
      }} />);
    });
    const texts = allText(inst);
    const browse = texts.findIndex(t => t.includes(strings.nav.browse_the_library));
    const learning = texts.findIndex(t => t.includes(strings.home.todays_learning));
    const about = texts.findIndex(t => t.includes(strings.about.about_soferbooks));
    expect(browse).toBeGreaterThanOrEqual(0);
    expect(learning).toBeGreaterThan(browse);
    expect(about).toBeGreaterThan(learning);
    act(() => { inst.unmount(); });
  });
});

describe('home page "Continue reading"', () => {
  const place = (book, n) => ({ ref: `${book} ${n}`, he_ref: null, versions: {}, book });
  const history = [place('Genesis', 1), place('Berakhot', '2a'), place('Psalms', 3), place('Exodus', 4), place('Mishnah Berurah', 5)];

  test('leaves out the books open as tabs, and shows at most three', () => {
    const tabs = [{ id: 't1', title: 'Genesis' }, { id: 't2', title: 'Psalms' }];
    expect(continueReadingItems(history, tabs).map(i => i.book)).toEqual(['Berakhot', 'Exodus', 'Mishnah Berurah']);
    expect(continueReadingItems(history, []).map(i => i.book)).toEqual(['Genesis', 'Berakhot', 'Psalms']);
    expect(continueReadingItems(history, undefined)).toHaveLength(3);
    expect(continueReadingItems([], tabs)).toEqual([]);
  });

  test('the home page shows them so', () => {
    Sefaria.history.lastPlace = history;
    Sefaria.primaryCategoryForTitle = jest.fn(() => 'Tanakh');
    const readerTabs = { tabs: [{ id: 't1', title: 'Genesis', ref: 'Genesis 1' }], activeTabId: 't1', archived: [] };
    let inst;
    act(() => {
      inst = renderer.create(
        <ReaderAppContext.Provider value={{ readerTabs, openReaderTab: noop }}>
          <TestContextWrapper child={TextsPage} childProps={{
            categories: [], setCategories: noop, openRef: noop, openLearningSchedules: noop,
            onBack: noop, openAbout: noop, openHistory: noop,
          }} />
        </ReaderAppContext.Provider>);
    });
    // (the open tab itself is in the "Open tabs" strip above)
    const all = allText(inst);
    const texts = all.slice(all.findIndex(t => t.includes(strings.home.continue_reading))).join('\n');
    for (const shown of ['Berakhot 2a', 'Psalms 3', 'Exodus 4']) { expect(texts).toContain(shown); }
    for (const hidden of ['Genesis 1', 'Mishnah Berurah 5']) { expect(texts).not.toContain(hidden); }
    act(() => { inst.unmount(); });
    Sefaria.history.lastPlace = [];
  });
});

describe('first launch', () => {
  test('the app no longer shows a content-filter chooser', () => {
    expect(read('ReaderApp.js')).not.toContain('ContentFilterChooser');
    expect(fs.existsSync(path.join(ROOT, 'shomer/ContentFilterChooser.js'))).toBe(false);
  });
});

describe('sefaria.org links', () => {
  test('the manifest offers the app for http/https links on Sefaria-Mobile\'s hosts, unverified', () => {
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    const filter = manifest.match(/<intent-filter>(?:(?!<\/intent-filter>)[\s\S])*android\.intent\.action\.VIEW[\s\S]*?<\/intent-filter>/);
    expect(filter).not.toBeNull();
    const f = filter[0];
    expect(f).toContain('android.intent.category.BROWSABLE');
    expect(f).toContain('android.intent.category.DEFAULT');
    for (const scheme of ['http', 'https']) { expect(f).toContain(`android:scheme="${scheme}"`); }
    for (const host of ['sefaria.org', 'www.sefaria.org', 'sefaria.org.il', 'www.sefaria.org.il']) {
      expect(f).toContain(`android:host="${host}"`);
    }
    expect(manifest).not.toContain('autoVerify="true"');   // we don't own sefaria.org
  });

  const makeRouter = () => {
    const props = {
      openNav: jest.fn(), openMenu: jest.fn(), openRef: jest.fn(), openRefInNewTab: jest.fn(),
      openUri: jest.fn(), openTextTocDirectly: jest.fn(), openSearch: jest.fn(),
      setSearchOptions: jest.fn(), setTextLanguage: jest.fn(), setNavigationCategories: jest.fn(),
    };
    return { props, router: new DeepLinkRouter(props) };
  };
  let nameSpy;
  const saved = {};
  beforeEach(() => {
    saved.booksDict = Sefaria.booksDict;
    Sefaria.booksDict = { ...(Sefaria.booksDict || {}), Genesis: 1, Berakhot: 1 };
    nameSpy = jest.spyOn(Sefaria.api, 'name').mockResolvedValue({ completion_objects: [] });
  });
  afterEach(() => {
    Sefaria.booksDict = saved.booksDict;
    nameSpy.mockRestore();
    shomer.setConfig(null);
  });

  test.each([
    ['https://www.sefaria.org/Genesis.1.3', 'Genesis 1:3'],
    ['https://sefaria.org/Genesis.1.3?lang=bi&with=all', 'Genesis 1:3'],
    ['http://www.sefaria.org.il/Berakhot.2a', 'Berakhot 2a'],
    ['https://www.sefaria.org/Berakhot.2a.5', 'Berakhot 2a:5'],
  ])('%s from another app opens %s in a new tab', (url, ref) => {
    const { props, router } = makeRouter();
    router.route(url, true);
    expect(props.openRefInNewTab).toHaveBeenCalledWith(ref, null);
    expect(props.openRef).not.toHaveBeenCalled();
    expect(props.openUri).not.toHaveBeenCalled();
  });

  test('a chosen translation comes along to the new tab', () => {
    const { props, router } = makeRouter();
    router.route('https://www.sefaria.org/Genesis.1.3?ven=english|The_Koren_Jerusalem_Bible', true);
    expect(props.openRefInNewTab).toHaveBeenCalledWith('Genesis 1:3', { en: 'The Koren Jerusalem Bible', he: undefined });
  });

  test('a link inside the app still opens in the current tab', () => {
    const { props, router } = makeRouter();
    router.route('https://www.sefaria.org/Genesis.1.3', false);
    expect(props.openRef).toHaveBeenCalledWith('Genesis 1:3', 'deep link', expect.anything(), true, false);
    expect(props.openRefInNewTab).not.toHaveBeenCalled();
  });

  test('a book\'s table of contents opens the book', () => {
    const { props, router } = makeRouter();
    router.route('https://www.sefaria.org/Genesis', true);
    expect(props.openTextTocDirectly).toHaveBeenCalledWith('Genesis');
    expect(props.openUri).not.toHaveBeenCalled();
  });

  test.each([
    'https://www.sefaria.org/sheets/12345',
    'https://www.sefaria.org/sheets',
    'https://www.sefaria.org/topics/shabbat',
    'https://www.sefaria.org/profile/someone',
    'https://www.sefaria.org/collections/abc',
    'https://www.sefaria.org/about',
    'https://www.sefaria.org/donate',
    'https://www.sefaria.org/login',
  ])('%s is not in the app: it opens in the browser', url => {
    const { props, router } = makeRouter();
    router.route(url, true);
    expect(props.openUri).toHaveBeenCalledWith(url);
    expect(props.openRef).not.toHaveBeenCalled();
    expect(props.openRefInNewTab).not.toHaveBeenCalled();
    expect(nameSpy).not.toHaveBeenCalled();
  });

  test('every web-only page is a plain path segment', () => {
    for (const p of WEB_ONLY_PAGES) { expect(p).toMatch(/^[a-z-]+$/); }
  });

  test('an unknown title falls back to the browser', async () => {
    const { props, router } = makeRouter();
    router.route('https://www.sefaria.org/Not_A_Book.1', true);
    await new Promise(r => setTimeout(r, 0));
    expect(props.openUri).toHaveBeenCalledWith('https://www.sefaria.org/Not_A_Book.1');
    expect(props.openRefInNewTab).not.toHaveBeenCalled();
  });

  test('a book hidden by the content filter gets the usual "hidden by your filter" message, not the website', () => {
    const toc = [{ category: 'Tanakh', contents: [{ title: 'Genesis' }, { title: 'Book of Judith' }] }];
    global.Sefaria = Sefaria;
    shomer.setConfig(null);
    const filtered = shomer.applyToToc(toc);
    shomer.setConfig({ preset: 'yeshivish' });   // apocrypha hidden from Yeshivish up
    expect(shomer.hiddenBookForRef('Book of Judith 1:2')).toMatchObject({ title: 'Book of Judith' });
    const savedShomer = Sefaria.shomer;
    Sefaria.shomer = shomer;
    delete Sefaria.booksDict['Book of Judith'];
    try {
      const { props, router } = makeRouter();
      router.route('https://www.sefaria.org/Book_of_Judith.1.2', true);
      // ReaderApp.openRef -> textUnavailableAlert shows "hidden by your filter" for it
      expect(props.openRef).toHaveBeenCalledWith('Book of Judith 1.2', 'deep link');
      expect(props.openUri).not.toHaveBeenCalled();
      expect(nameSpy).not.toHaveBeenCalled();
    } finally {
      Sefaria.shomer = savedShomer;
      expect(filtered).toBeTruthy();
    }
  });
});

describe('Settings: "Open Sefaria links in this app"', () => {
  const realOS = Platform.OS;
  afterEach(() => { Platform.OS = realOS; });

  test('shown on Android, with its explanation; it opens the app\'s page in Android settings', async () => {
    Platform.OS = 'android';
    const spy = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    let inst;
    act(() => { inst = renderer.create(<TestContextWrapper child={SefariaLinksSetting} childProps={{ langStyle: {} }} />); });
    const texts = allText(inst);
    expect(texts).toContain(strings.settings.open_sefaria_links);
    expect(texts).toContain(strings.settings.open_sefaria_links_explanation);
    act(() => { inst.unmount(); });
    await openSefariaLinkSettings();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  test('not shown on iPhone', () => {
    Platform.OS = 'ios';
    let inst;
    act(() => { inst = renderer.create(<TestContextWrapper child={SefariaLinksSetting} childProps={{ langStyle: {} }} />); });
    expect(inst.root.findAllByProps({ testID: 'sefaria-links-setting' })).toHaveLength(0);
    act(() => { inst.unmount(); });
  });
});
