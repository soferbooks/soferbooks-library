import { CORRECTIONS, FALLBACK_EMAIL, correctionEmail, sourceOfVersion, versionOnScreen } from '../reportError';
import { SOURCES } from '../sources';

const email = version => correctionEmail({ ref: 'Genesis 1:1', text: 'בראשית ברא', version, platform: 'android' });

describe('report a mistake: routing', () => {
  test('Sefaria texts go to Sefaria\'s corrections address, as in Sefaria\'s app', () => {
    const e = email({ versionTitle: 'Miqra according to the Masorah', versionSource: 'https://he.wikisource.org/wiki/x' });
    expect(e.to).toBe('corrections@sefaria.org');
    expect(e.subject).toBe('Sefaria Text Correction from SoferBooks Library (android)');
    expect(e.body).toBe('Genesis 1:1\n\nבראשית ברא\n\nVersion: Miqra according to the Masorah (https://he.wikisource.org/wiki/x)\n\nDescribe the error:');
  });

  test('the source is the library the text came from, not where Sefaria got it', () => {
    expect(sourceOfVersion({ versionSource: 'https://dicta.org.il/' })).toBe('sefaria');
    expect(sourceOfVersion(null)).toBe('sefaria');
    expect(sourceOfVersion({ librarySource: 'dicta' })).toBe('dicta');
  });

  test('other libraries without a corrections address go to SoferBooks', () => {
    for (const id of ['dicta', 'otzaria', 'wikisource', 'soferbooks_extras']) {
      const e = email({ librarySource: id, versionTitle: 'v' });
      expect(e.to).toBe(FALLBACK_EMAIL);
      expect(e.source).toBe(id);
    }
    expect(email({ librarySource: 'otzaria' }).subject).toBe('Text Correction (Otzaria) from SoferBooks Library (android)');
    expect(email({ librarySource: 'someday' }).to).toBe(FALLBACK_EMAIL);
  });

  test('every library source has a row in the table', () => {
    expect(SOURCES.map(s => s.id).filter(id => !CORRECTIONS[id])).toEqual([]);
  });

  test('the version on screen: Hebrew unless only English is shown', () => {
    const he = { versionTitle: 'he' };
    const en = { versionTitle: 'en' };
    expect(versionOnScreen({ he, en }, 'bilingual')).toBe(he);
    expect(versionOnScreen({ he, en }, 'english')).toBe(en);
    expect(versionOnScreen({ he: null, en }, 'hebrew')).toBe(en);
    expect(versionOnScreen(undefined, 'hebrew')).toBeNull();
  });
});
