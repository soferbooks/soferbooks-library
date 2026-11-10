// Sefaria Shomer - presets and groups.
// Ported unchanged in substance from the owner's browser extension "Sefaria Shomer" 1.16.0
// (sefaria-shomer-extension/settings.js). Keep the two in step: rules.json in this folder is a
// verbatim copy of the extension's rules.json.
//
// The presets are one ladder: each hides everything the one before it hides, and more.
// Every group says the first preset that hides it ("level"); a preset hides each group whose
// level is at or below its own. The reader can still switch any group on or off ("Custom").
// Every switch means "hide": on = hidden.

export const PRESETS = [
  { id: 'centrist_mo', level: 1, name: 'Centrist Modern Orthodox' },
  { id: 'rwmo', level: 2, name: 'Right-Wing Modern Orthodox' },
  { id: 'yeshivish', level: 3, name: 'Yeshivish' },
  { id: 'strict_charedi', level: 4, name: 'Strict Charedi' },
];

// "translation": a translation, hidden from translation lists and from the reader, but the book
// itself is not blocked (the book is fine; only that translation is not).
export const GROUPS = [
  { id: 'reform', short: 'Reform', level: 1, name: 'Reform movement', examples: 'Plaut commentary, CCAR responsa, Geiger' },
  { id: 'reconstructionist', short: 'Reconstructionist', level: 1, name: 'Reconstructionist & Jewish Renewal', examples: 'Mordecai Kaplan, Schachter-Shalomi, Waskow' },
  { id: 'conservative', short: 'Conservative', level: 1, name: 'Conservative movement', examples: 'Etz Hayim, CJLS, Dr. Joshua Kulp / Daf Shevui, Louis Jacobs' },
  { id: 'biblical_criticism', short: 'Bible criticism', level: 1, name: 'Academic Bible criticism', examples: 'Documentary Hypothesis, Anchor Bible, Hermeneia' },
  { id: 'christian_translations', short: 'Christian translations', level: 1, name: 'Christian Bible translations', examples: 'King James, American Standard, Douay-Rheims', translation: true },
  { id: 'sefarim_chitzoniim', short: 'Sefarim Chitzoniim', level: 1, name: 'Sefarim Chitzoniim', examples: 'Jubilees, Enoch, Judith, Tobit, Susanna, Wisdom of Solomon' },
  { id: 'polemics', short: 'Toldot Yeshu', level: 1, name: 'Anti-Christian polemic', examples: 'Toldot Yeshu' },

  { id: 'non_orthodox_translations', short: 'non-Orthodox translations', level: 2, name: 'Non-Orthodox Tanakh translations', examples: 'Gender-sensitive JPS (Contemporary Torah), JPS 1985, Robert Alter, Everett Fox', translation: true },
  { id: 'open_orthodox', short: 'Open Orthodoxy', level: 2, name: 'Open Orthodoxy', examples: 'Yeshivat Maharat, partnership minyanim' },
  { id: 'haskalah_secular', short: 'Haskalah', level: 2, name: 'Haskalah & secular authors', examples: 'Bialik, Nachman Krochmal, Yeshayahu Leibowitz, Shinan, Wessely' },
  { id: 'feminist_translations', short: 'feminist translations', level: 2, name: "Women's / feminist translations", examples: 'Hadar (Dena Weiss), Rabbi Debra Robbins, Jen Taylor Friedman', translation: true },

  { id: 'jps_1917', short: 'JPS 1917', level: 3, name: 'JPS 1917 translation', examples: 'The Holy Scriptures: A New Translation (JPS 1917)', translation: true },
  { id: 'historical_apocrypha', short: 'Ben Sira & Maccabees', level: 3, name: 'Ben Sira & Maccabees', examples: 'Ben Sira, Books of the Maccabees, Megillat Antiochus' },
  { id: 'academic_orthodox', short: 'Mishnat Eretz Yisrael', level: 3, name: 'Academic Orthodox scholarship', examples: 'Mishnat Eretz Yisrael (the Safrais)' },
  { id: 'community_sheets', short: 'community sheets', level: 3, name: 'Community source sheets', examples: 'Sheets by anyone, except from known Orthodox sources' },
  { id: 'women_authors', short: 'works by women', level: 3, name: 'Works by women authors', examples: 'Dirshuni, Jewish Legal Writings by Women, Torah of the Mothers, Erica Brown, translations by women' },

  { id: 'religious_zionist_thought', short: 'Rav Kook, Rav Soloveitchik, Nechama Leibowitz', level: 4, name: 'Religious Zionist & Modern Orthodox thought', examples: "Rav Kook's Orot, Rav J. B. Soloveitchik's Halakhic Man, Nechama Leibowitz" },
];

// "Off": nothing is hidden. Not on the ladder (PRESETS); offered beside it, first.
export const OFF = { id: 'off', level: 0, name: 'Off' };
export const CHOICES = [OFF, ...PRESETS];

export const presetById = id => CHOICES.find(p => p.id === id);

// The groups a preset hides: { groupId: true/false }
export function groupsFor(presetId) {
  const preset = presetById(presetId) || presetById('rwmo');
  const groups = {};
  for (const g of GROUPS) { groups[g.id] = g.level <= preset.level; }
  return groups;
}

// Any saved settings -> the current shape. Unlike the extension, `null` stays `null`: the app
// asks the reader to choose a preset on first launch instead of picking one silently.
export function normalize(stored) {
  if (!stored || typeof stored !== 'object') { return null; }
  const s = stored;
  const off = s.preset === 'off' || s.active === false;
  const cfg = {
    version: 2,
    active: !off,
    preset: off ? 'off' : s.preset === 'custom' || presetById(s.preset) ? s.preset : 'rwmo',
    customBlacklist: Array.isArray(s.customBlacklist) ? s.customBlacklist : [],
    customWhitelist: Array.isArray(s.customWhitelist) ? s.customWhitelist : [],
  };
  if (off) {
    cfg.groups = groupsFor('off');
  } else if (s.preset === 'custom' && s.groups) {
    cfg.groups = Object.assign(groupsFor('rwmo'), s.groups);
  } else {
    if (cfg.preset === 'custom') { cfg.preset = 'rwmo'; }
    cfg.groups = groupsFor(cfg.preset);
  }
  return cfg;
}

// The preset whose groups are exactly these ('off' when none is hidden), else 'custom'
export function presetOf(groups) {
  for (const p of CHOICES) {
    const want = groupsFor(p.id);
    if (GROUPS.every(g => !!groups[g.id] === want[g.id])) { return p.id; }
  }
  return 'custom';
}

// A config for a preset chosen by the reader
export function configForPreset(presetId) {
  return normalize({ preset: presetId });
}

// A config with one group switched by hand (switching one on while "Off" turns the filter on)
export function toggleGroup(cfg, groupId, hidden) {
  const groups = { ...(cfg ? cfg.groups : groupsFor('rwmo')), [groupId]: !!hidden };
  const preset = presetOf(groups);
  return { ...(cfg || normalize({ preset: 'rwmo' })), groups, preset, active: preset !== 'off' };
}
