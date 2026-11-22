import { reducer, DEFAULT_STATE, STATE_ACTIONS } from '../StateManager';

test('a tab\'s language applies to it only: the reader\'s setting (and the menus) stay (2026-11-22)', () => {
  let s = reducer({ ...DEFAULT_STATE, textLanguage: 'hebrew', savedTextLanguage: 'hebrew' },
    { type: STATE_ACTIONS.setTextLanguage, value: 'english', fromTab: true });
  expect(s.textLanguage).toBe('english');
  expect(s.savedTextLanguage).toBe('hebrew');
  // the reader choosing it (Settings, the Aa menu, the language button): it is the setting
  s = reducer(s, { type: STATE_ACTIONS.setTextLanguage, value: 'bilingual' });
  expect(s).toMatchObject({ textLanguage: 'bilingual', savedTextLanguage: 'bilingual' });
});
