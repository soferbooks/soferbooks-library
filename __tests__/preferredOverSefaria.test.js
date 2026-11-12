/**
 * A book an extra source marks `preferred` (Sofer's wikisource.PREFERRED: Wikisource's Rokeach on
 * Shir HaShirim, with its footnotes) is used instead of Sefaria's own copy when Sefaria adds one
 * (owner, 2026-11-12: "Sefaria will soon add Rokeach on Shir HaShirim but without the footnotes;
 * make sure not to replace our footnoted edition with Sefaria's"). In the app: Sefaria's copy is
 * out of the toc (so of booksDict: shelves, autocomplete, links), and its title - a sefaria.org
 * link, a ref - opens ours, offering to download it. The choice itself: __tests__/wikisource.test.js.
 */
import {parseCatalog} from '../extras/wikisource';

const OURS = 'רוקח על שיר השירים';
const SEFARIAS = 'Rokeach on Song of Songs';      // (a likely name: Sefaria's own is not known yet)
const TOC = [
  {category: 'Tanakh', heCategory: 'תנ״ך', contents: [
    {title: 'Song of Songs', heTitle: 'שיר השירים', categories: ['Tanakh']},
    {category: 'Commentary', heCategory: 'מפרשים', contents: [
      {category: 'Rokeach', heCategory: 'רוקח', contents: [
        {title: SEFARIAS, heTitle: OURS, categories: ['Tanakh', 'Commentary', 'Rokeach']},
      ]},
    ]},
  ]},
];

test('Sefaria adds the book: the library has ours in its place, and Sefaria\'s title opens ours', () => {
  jest.resetModules();
  const React = require('react');
  const renderer = require('react-test-renderer');
  const {act} = renderer;
  const Sefaria = require('../sefaria').default;
  const ex = require('../extras');
  const TestContextWrapper = require('../TestContextWrapper').default;
  const ReaderApp = require('../ReaderApp').default;
  const strings = require('../LocalizedStrings').default;
  const {Alert: RNAlert} = require('react-native');
  ex._reset({enabled: {wikisource: true}, catalogs: {wikisource: {entries: parseCatalog()}}});
  Sefaria._cacheIndexFromToc(ex.applyToToc(TOC), true);
  expect(Sefaria.booksDict[SEFARIAS]).toBeUndefined();
  expect(Sefaria.booksDict[OURS]).toBe(1);
  expect(Sefaria.booksDict['Song of Songs']).toBe(1);
  expect(ex.replacementOf(SEFARIAS)).toBe(OURS);
  expect(ex.redirectRef(`${SEFARIAS} 1:2`)).toBe(OURS);
  expect(ex.redirectRef('Song of Songs 1:2')).toBeNull();
  // a sefaria.org link (DeepLinkRouter: urlToRef, then ref === title opens the book's contents)
  expect(Sefaria.urlToRef('Rokeach_on_Song_of_Songs.1.2')).toEqual({ref: OURS, title: OURS});
  expect(Sefaria.urlToRef('Song_of_Songs.1.2')).toEqual({ref: 'Song of Songs 1:2', title: 'Song of Songs'});
  // autocomplete from Sefaria's Name API
  const names = ex.redirectNameResults({completion_objects: [{title: SEFARIAS, key: SEFARIAS, type: 'ref'}]});
  expect(names.completion_objects).toEqual([{title: OURS, key: OURS, type: 'book'}]);

  let inst;
  act(() => {
    inst = renderer.create(React.createElement(TestContextWrapper,
      {passContextToChildren: true, child: ReaderApp, childProps: {showErrorBoundary: () => {}}}));
  });
  const app = inst.root.findByType(ReaderApp).instance;
  const alert = jest.spyOn(RNAlert, 'alert').mockImplementation(() => {});
  app.showToast = jest.fn();
  app.openRef(`${SEFARIAS} 1:2`, 'deep link');
  expect(alert).toHaveBeenCalledTimes(1);           // (ours is not downloaded: offered for download)
  expect(alert.mock.calls[0][0]).toBe(strings.extras.not_downloaded_title);
  expect(alert.mock.calls[0][1]).toContain(OURS);
  alert.mockClear();
  app.openTextTocDirectly(SEFARIAS);
  expect(alert).toHaveBeenCalledTimes(1);
  expect(alert.mock.calls[0][0]).toBe(strings.extras.not_downloaded_title);
  alert.mockRestore();
  act(() => inst.unmount());
}, 60000);
