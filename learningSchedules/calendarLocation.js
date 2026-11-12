/**
 * Israel or outside Israel, for the learning schedules and the calendar (Settings: "Outside
 * Israel" / "Israel"). Where they differ - the weeks after the eighth day of Pesach or the
 * second day of Shavuot falls on Shabbat - the parsha (and Shnayim Mikra, Chok LeYisrael's
 * week, the haftarah) follows it:
 *   - Sefaria's calendar.json: its Israel entries ("0|a", "0|s") over the default ones
 *     (Sefaria.getCalendars, diaspora = not Israel)
 *   - @hebcal/core: Sedra(year, il) (learningSchedules/chokDay.js)
 *   - Sefaria's API: diaspora=0/1
 * Daf Yomi, the Rambam, Mishnah Berurah Yomi and Tehillim are the same everywhere.
 *
 * Until the user chooses, a guess from the phone itself - no network: its time zone
 * (Asia/Jerusalem) or its region (a locale such as "he-IL" / "en-IL"); otherwise outside Israel.
 * Pure JavaScript, unit-tested in __tests__/calendarLocation.test.js.
 */

export const ISRAEL = 'israel';
export const DIASPORA = 'diaspora';
export const CALENDAR_LOCATIONS = [DIASPORA, ISRAEL];

// IANA names for Israel's time zone (Asia/Tel_Aviv and Israel are old aliases of Asia/Jerusalem)
const ISRAEL_TIME_ZONES = ['Asia/Jerusalem', 'Asia/Tel_Aviv', 'Israel'];

/** The phone's IANA time zone ("Asia/Jerusalem"), or null when the platform does not say */
export function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch (e) {
    return null;
  }
}

/** The region of a locale ("iw-IL", "he_IL", "en-Latn-IL" -> "IL"), or null */
export function localeRegion(locale) {
  const parts = String(locale || '').split(/[-_]/).slice(1);
  const region = parts.find(p => /^[A-Za-z]{2}$/.test(p) || /^\d{3}$/.test(p));
  return region ? region.toUpperCase() : null;
}

/**
 * The guess before the user chooses: Israel when the phone's time zone or region is Israel's,
 * else outside Israel. timeZone, locale: the phone's (the locale from react-native-localization).
 */
export function guessCalendarLocation({ timeZone = deviceTimeZone(), locale = null } = {}) {
  if (timeZone && ISRAEL_TIME_ZONES.includes(timeZone)) { return ISRAEL; }
  if (localeRegion(locale) === 'IL') { return ISRAEL; }
  return DIASPORA;
}

/** A saved value, or the guess when it is missing or not one of the two */
export const validCalendarLocation = (value, guess = DIASPORA) => (CALENDAR_LOCATIONS.includes(value) ? value : guess);

/** true outside Israel (the `diaspora` flag of Sefaria.getCalendars and Sefaria's API) */
export const isDiaspora = location => location !== ISRAEL;
