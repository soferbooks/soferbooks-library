/**
 * The dibbur hamaschil in bold (reader/dibbur.js): the same result as Sofer's markup.bold_dibbur.
 * The first block is Sofer's own test (tests/test_small_modules.py,
 * test_dibbur_hamaschil_is_made_bold_when_the_source_did_not); the second, more cases with the
 * results Sofer's Python gives for them (run through bold_dibbur(parse_comment(html)) on
 * 2026-11-11), shown as Sofer's test shows them: the bold in {braces}, tags left out.
 */
import {boldDibbur, tokenize, plainWithBold, boldRuns, isCommentaryBook, isCommentaryCategory} from '../reader/dibbur';

// Sofer's test's `marked`: the text, "{" / "}" for bold, other tags left out (and spaces as
// Sofer's parser leaves them: runs of two or more as one, none at the start)
const marked = html => tokenize(boldDibbur(html)).map(t => {
  if (t.kind === 'text') { return t.units.map(u => u[1]).join(''); }
  if (t.kind === 'open' && t.style === 'bold') { return '{'; }
  if (t.kind === 'close' && t.style === 'bold') { return '}'; }
  return '';
}).join('').replace(/\}\{/g, '').replace(/[  ]{2,}/g, ' ').replace(/^\s+/, '');
// ("}{": the bold cut around a tag of the HTML's own, a <span>: one run of bold, as Sofer's)

describe('boldDibbur: Sofer\'s own test', () => {
  test('a dibbur up to its full stop', () => {
    expect(marked('מאימתי קורין את שמע בערבין. משעה')).toBe('{מאימתי קורין את שמע בערבין.} משעה');
  });
  test('up to a dash (not included)', () => {
    expect(marked('עד סוף האשמורה הראשונה – שליש הלילה')).toBe('{עד סוף האשמורה הראשונה} – שליש הלילה');
  });
  test('a label first is skipped', () => {
    expect(marked("[מתני']: מעשה ובאו בניו. מה ששנינו")).toBe("[מתני']: {מעשה ובאו בניו.} מה ששנינו");
  });
  test("Sefaria's own bold is kept", () => {
    expect(marked('<b>וילך משה.</b> היום')).toBe('{וילך משה.} היום');
    expect(boldDibbur('<b>וילך משה.</b> היום')).toBe('<b>וילך משה.</b> היום');
  });
  test('no clear end: left alone', () => {
    const long = 'מילה '.repeat(20) + 'סוף.';
    expect(marked(long)).toBe(long);
    expect(boldDibbur(long)).toBe(long);
  });
});

describe('boldDibbur: the same as Sofer\'s Python', () => {
  // [html, what Sofer's bold_dibbur gives]
  const CASES = [
    ['גמרא: אמר רב יהודה - כך', 'גמרא: {אמר רב יהודה} - כך'],
    ["גמ': תנא היכא קאי. דקתני", "גמ': {תנא היכא קאי.} דקתני"],
    ["מתני': הכל חייבין בראייה. חוץ", "מתני': {הכל חייבין בראייה.} חוץ"],
    ["שמע <i>ישראל</i> ה'. אלהינו", "שמע ישראל ה'. אלהינו"],
    ['<span class="x">ויאמר</span> אלהים. יהי אור', '{ויאמר אלהים.} יהי אור'],
    ['ויאמר&nbsp;אלהים. יהי', '{ויאמר אלהים.} יהי'],
    ['שלום — עליכם. כן', '{שלום} — עליכם. כן'],
    ['  <br>ויקרא אל משה. וידבר', '{ויקרא אל משה.} וידבר'],
    ['אין כאן שום סוף', 'אין כאן שום סוף'],
    ['דבר אחר <b>ויאמר</b>. שם', 'דבר אחר {ויאמר}. שם'],
    ['ויאמר משה<b> אל</b> העם. כך', 'ויאמר משה{ אל} העם. כך'],
    ['<i>הקדמה</i> ויאמר. כן', 'הקדמה ויאמר. כן'],
    ['[א] ויהי. כן', '[א] {ויהי.} כן'],
    ['ויאמר &amp; עשה. כן', '{ויאמר & עשה.} כן'],
    ['ו<sup class="footnote-marker">1</sup><i class="footnote">הערה</i>יאמר. כן', 'ו הערהיאמר. כן'],
    ['. התחלה', '{.} התחלה'],
    ['<b></b>ויאמר. כן', '{}ויאמר. כן'],
    ['ויאמר.', '{ויאמר.}'],
    ['<small>(א)</small> ויאמר משה. כן', '(א) ויאמר משה. כן'],
    ['<i data-commentator="Siftei Chakhamim" data-label="א"></i>ברכו במן. שכל ימות', '{ברכו במן.} שכל ימות'],
    ['ויאמר <i>משה. כן</i> הלאה', 'ויאמר משה. כן הלאה'],
    ['ויאמר משה <i>כן</i>. הלאה', 'ויאמר משה כן. הלאה'],
    [`${'מילה '.repeat(14)}מילה. סוף`, `{${'מילה '.repeat(14)}מילה.} סוף`],     // 15 words: bold
    [`${'מילה '.repeat(15)}מילה. סוף`, `${'מילה '.repeat(15)}מילה. סוף`],       // 16: left alone
  ];
  test.each(CASES)('%s', (html, sofer) => {
    expect(marked(html)).toBe(sofer);
  });

  test('the HTML around it is kept as it was', () => {
    expect(boldDibbur('<span class="x">ויאמר</span> אלהים. יהי')).toBe('<span class="x"><b>ויאמר</b></span><b> אלהים.</b> יהי');
    expect(boldDibbur('ויאמר &amp; עשה. כן')).toBe('<b>ויאמר &amp; עשה.</b> כן');
    expect(boldDibbur("[מתני']: מעשה. מה")).toBe("[מתני']: <b>מעשה.</b> מה");
    expect(boldDibbur('')).toBe('');
    expect(boldDibbur(null)).toBe(null);
  });
});

describe('the commentary under each passage: plain text with its bold words', () => {
  test('plainWithBold', () => {
    expect(plainWithBold('<b>וילך משה.</b> היום<br>עוד &amp; כן')).toEqual({
      text: 'וילך משה. היום עוד & כן', bold: [true, true, false, false, false, false],
    });
    expect(plainWithBold(boldDibbur('מאימתי קורין. משעה'))).toEqual({text: 'מאימתי קורין. משעה', bold: [true, true, false]});
  });
  test('boldRuns: by word, so the flags fit the text with nikud added', () => {
    expect(boldRuns('מֵאֵימָתַי קוֹרִין. מִשָּׁעָה', [true, true, false])).toEqual([
      {text: 'מֵאֵימָתַי קוֹרִין.', bold: true}, {text: ' מִשָּׁעָה', bold: false},
    ]);
    expect(boldRuns('א ב', [false, false])).toEqual([{text: 'א ב', bold: false}]);
    expect(boldRuns('', [])).toEqual([]);
  });
});

describe('which texts are commentaries', () => {
  const saved = global.Sefaria;
  afterEach(() => { global.Sefaria = saved; });
  test('categories', () => {
    expect(isCommentaryCategory('Commentary')).toBe(true);
    expect(isCommentaryCategory('Quoting Commentary')).toBe(true);
    expect(isCommentaryCategory('Targum')).toBe(false);
    expect(isCommentaryCategory('Talmud')).toBe(false);
  });
  test('books: the catalogue, else the extra books\' links', () => {
    global.Sefaria = {index: t => ({
      'Rashi on Genesis': {dependence: 'Commentary', primary_category: 'Commentary'},
      'Genesis': {primary_category: 'Tanakh'},
      'Onkelos Genesis': {dependence: 'Targum'},
    })[t] || null};
    expect(isCommentaryBook('Rashi on Genesis')).toBe(true);
    expect(isCommentaryBook('Genesis')).toBe(false);
    expect(isCommentaryBook('Onkelos Genesis')).toBe(false);
    expect(isCommentaryBook('פירוש על ספר')).toBe(false);
    expect(isCommentaryBook('פירוש על ספר', new Set(['פירוש על ספר']))).toBe(true);
  });
});
