/**
 * Israel or outside Israel (Settings): the guess before the user chooses, the saved choice, and
 * the learning schedules that follow it - the week's parsha and Shnayim Mikra (Sefaria's
 * calendar.json, its Israel entries) and Chok LeYisrael's week (@hebcal/core's Sedra, il flag).
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { HDate, Sedra } from '@hebcal/core';
import Sefaria from '../sefaria';
import { GlobalStateContext, DEFAULT_STATE, STATE_ACTIONS, reducer, initAsyncStorage } from '../StateManager';
import {
  guessCalendarLocation, localeRegion, validCalendarLocation, isDiaspora, ISRAEL, DIASPORA,
} from '../learningSchedules/calendarLocation';
import { useCalendarItems } from '../learningSchedules/useCalendarItems';
import { weekParshiot } from '../learningSchedules/chokDay';
import { withExtraSchedules } from '../learningSchedules/extraSchedules';

const CALENDAR = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'assets', 'sources', 'calendar.json'), 'utf8'));
const day = (y, m, d) => new Date(y, m - 1, d);
const titled = (items, en) => items.find(i => i.title.en === en);
const parsha = (items) => titled(items, 'Parashat Hashavua').subs[0].en;

describe('the guess before the user chooses (the phone itself, no network)', () => {
  test("Israel's time zone", () => {
    expect(guessCalendarLocation({ timeZone: 'Asia/Jerusalem', locale: 'en-US' })).toBe(ISRAEL);
    expect(guessCalendarLocation({ timeZone: 'Asia/Tel_Aviv' })).toBe(ISRAEL);
    expect(guessCalendarLocation({ timeZone: 'Israel' })).toBe(ISRAEL);
  });

  test("Israel's region", () => {
    expect(guessCalendarLocation({ timeZone: 'America/New_York', locale: 'iw-IL' })).toBe(ISRAEL);
    expect(guessCalendarLocation({ timeZone: null, locale: 'en_IL' })).toBe(ISRAEL);
    expect(guessCalendarLocation({ timeZone: 'UTC', locale: 'ar-Arab-IL' })).toBe(ISRAEL);
  });

  test('anywhere else, or nothing known: outside Israel', () => {
    expect(guessCalendarLocation({ timeZone: 'America/New_York', locale: 'en-US' })).toBe(DIASPORA);
    expect(guessCalendarLocation({ timeZone: 'Europe/London', locale: 'he' })).toBe(DIASPORA);   // Hebrew alone is not Israel
    expect(guessCalendarLocation({ timeZone: null, locale: null })).toBe(DIASPORA);
  });

  test('regions of locales', () => {
    expect(localeRegion('iw-IL')).toBe('IL');
    expect(localeRegion('he_il')).toBe('IL');
    expect(localeRegion('zh-Hant-TW')).toBe('TW');
    expect(localeRegion('en')).toBeNull();
    expect(localeRegion(undefined)).toBeNull();
  });
});

describe('the setting (remembered like the other settings)', () => {
  beforeEach(() => AsyncStorage.clear && AsyncStorage.clear());

  test('a choice is saved; a value from storage is not saved again', async () => {
    let state = reducer(DEFAULT_STATE, { type: STATE_ACTIONS.setCalendarLocation, value: ISRAEL });
    expect(state.calendarLocation).toBe(ISRAEL);
    expect(await AsyncStorage.getItem('calendarLocation')).toBe(JSON.stringify(ISRAEL));
    state = reducer(state, { type: STATE_ACTIONS.setCalendarLocation, value: DIASPORA, fromAsync: true });
    expect(state.calendarLocation).toBe(DIASPORA);
    expect(await AsyncStorage.getItem('calendarLocation')).toBe(JSON.stringify(ISRAEL));
  });

  test('the saved choice is loaded at start; nothing saved is the guess', async () => {
    const dispatched = [];
    await initAsyncStorage(a => dispatched.push(a));
    const first = dispatched.find(a => a.type === STATE_ACTIONS.setCalendarLocation);
    expect(first.value).toBe(DEFAULT_STATE.calendarLocation);
    expect([ISRAEL, DIASPORA]).toContain(DEFAULT_STATE.calendarLocation);

    await AsyncStorage.setItem('calendarLocation', JSON.stringify(ISRAEL));
    dispatched.length = 0;
    await initAsyncStorage(a => dispatched.push(a));
    expect(dispatched.find(a => a.type === STATE_ACTIONS.setCalendarLocation).value).toBe(ISRAEL);
  });

  test('an unknown value is the guess', () => {
    expect(validCalendarLocation('mars', DIASPORA)).toBe(DIASPORA);
    expect(validCalendarLocation(ISRAEL, DIASPORA)).toBe(ISRAEL);
    expect(isDiaspora(ISRAEL)).toBe(false);
    expect(isDiaspora(DIASPORA)).toBe(true);
    expect(isDiaspora(undefined)).toBe(true);
  });
});

describe("the week's parsha and Shnayim Mikra (Sefaria's calendar.json)", () => {
  beforeAll(() => { Sefaria.calendar = CALENDAR; });
  afterAll(() => { Sefaria.calendar = null; });

  test('after the second day of Shavuot on Shabbat (5787): Israel is a week ahead', () => {
    // 12 June 2027 is Shavuot's second day outside Israel; Israel reads Nasso then
    const diaspora = Sefaria.getCalendars('sephardi', true, day(2027, 6, 14));
    const israel = Sefaria.getCalendars('sephardi', false, day(2027, 6, 14));
    expect(parsha(diaspora)).toBe('Nasso');
    expect(parsha(israel)).toBe("Beha'alotcha");
    expect(titled(diaspora, 'Shnayim Mikra').subs[0].en).toBe('Nasso');
    expect(titled(israel, 'Shnayim Mikra').subs[0].en).toBe("Beha'alotcha");
    expect(titled(israel, 'Shnayim Mikra').refs).toEqual(titled(israel, 'Parashat Hashavua').refs);
    // ashkenazi too
    expect(parsha(Sefaria.getCalendars('ashkenazi', false, day(2027, 6, 14)))).toBe("Beha'alotcha");
    expect(parsha(Sefaria.getCalendars('ashkenazi', true, day(2027, 6, 14)))).toBe('Nasso');
  });

  test('together again once the diaspora reads a double parsha (Pinchas, July 2027)', () => {
    expect(parsha(Sefaria.getCalendars('sephardi', false, day(2027, 7, 20)))).toBe('Pinchas');
    expect(parsha(Sefaria.getCalendars('sephardi', true, day(2027, 7, 20)))).toBe('Pinchas');
  });

  test('Daf Yomi and the Rambam are the same in both', () => {
    for (const d of [day(2027, 6, 14), day(2026, 11, 12)]) {
      const pick = items => items.filter(i => ['Daf Yomi', 'Daily Rambam', 'Daily Rambam (3 Chapters)'].includes(i.title.en))
        .map(i => [i.title.en, i.refs]);
      expect(pick(Sefaria.getCalendars('sephardi', false, d))).toEqual(pick(Sefaria.getCalendars('sephardi', true, d)));
      expect(pick(Sefaria.getCalendars('sephardi', false, d)).length).toBeGreaterThan(0);
    }
  });

  test("every day of calendar.json: its parsha in Israel and outside agrees with hebcal's Sedra", () => {
    const wrong = [];
    for (const iso of Object.keys(CALENDAR).filter(k => /^\d{4}-\d\d-\d\d$/.test(k))) {
      const [y, m, d] = iso.split('-').map(Number);
      const date = day(y, m, d);
      const sat = new HDate(date).onOrAfter(6);
      for (const il of [false, true]) {
        const r = new Sedra(sat.getFullYear(), il).lookup(sat);
        if (!r || r.chag) { continue; }   // a festival Shabbat: Sefaria shows the next parsha read
        const item = titled(Sefaria.getCalendars('sephardi', !il, date), 'Parashat Hashavua');
        const sefaria = item && item.subs[0].en;
        if (sefaria !== r.parsha.join('-')) { wrong.push(`${iso} ${il ? 'IL' : 'DI'}: ${sefaria} / ${r.parsha.join('-')}`); }
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe("Chok LeYisrael's week (@hebcal/core, il flag)", () => {
  const week = (d, israel) => weekParshiot(d, israel).map(p => p.en);

  test('after the eighth day of Pesach on Shabbat (5782): Israel is a week ahead until Matot-Masei', () => {
    // 23 April 2022 is the eighth day of Pesach outside Israel; Israel reads Achrei Mot then
    expect(week(day(2022, 4, 18), true)).toEqual(['Achrei Mot']);
    expect(week(day(2022, 4, 18), false)).toEqual(['Achrei Mot']);   // (the next parsha read, Chok's custom)
    expect(week(day(2022, 4, 25), false)).toEqual(['Achrei Mot']);
    expect(week(day(2022, 4, 25), true)).toEqual(['Kedoshim']);
    expect(week(day(2022, 7, 4), false)).toEqual(['Chukat']);
    expect(week(day(2022, 7, 4), true)).toEqual(['Balak']);
    // 30 July 2022: Matot-Masei outside Israel, Masei in Israel; then together
    expect(week(day(2022, 7, 25), false)).toEqual(['Matot', 'Masei']);
    expect(week(day(2022, 7, 25), true)).toEqual(['Masei']);
    expect(week(day(2022, 8, 1), false)).toEqual(['Devarim']);
    expect(week(day(2022, 8, 1), true)).toEqual(['Devarim']);
  });

  test("the day's item follows the setting (Sefaria.getCalendars, withExtraSchedules)", () => {
    const chok = items => titled(items, 'Chok LeYisrael');
    expect(chok(withExtraSchedules([], day(2027, 6, 14), { israel: false })).summary.en).toBe('Nasso, Monday');
    expect(chok(withExtraSchedules([], day(2027, 6, 14), { israel: true })).summary.en).toBe("Beha'alotcha, Monday");
    expect(chok(withExtraSchedules([], day(2027, 6, 14), { israel: true })).chok).toEqual({ date: '2027-06-14', israel: true });
    Sefaria.calendar = CALENDAR;
    try {
      expect(chok(Sefaria.getCalendars('sephardi', false, day(2027, 6, 14))).summary.en).toBe("Beha'alotcha, Monday");
      expect(chok(Sefaria.getCalendars('sephardi', true, day(2027, 6, 14))).summary.en).toBe('Nasso, Monday');
    } finally {
      Sefaria.calendar = null;
    }
  });
});

describe("home's learning schedules use the setting", () => {
  const itemsWith = (calendarLocation) => {
    let result;
    const Probe = () => { result = useCalendarItems().calendarItems; return null; };
    act(() => {
      renderer.create(
        <GlobalStateContext.Provider value={{ ...DEFAULT_STATE, calendarLocation }}>
          <Probe />
        </GlobalStateContext.Provider>
      );
    });
    return result;
  };

  test('Israel / outside Israel', () => {
    Sefaria.calendar = CALENDAR;
    jest.useFakeTimers({ now: day(2027, 6, 14).getTime() + 12 * 3600 * 1000, doNotFake: ['nextTick', 'setImmediate'] });
    try {
      expect(parsha(itemsWith(ISRAEL))).toBe("Beha'alotcha");
      expect(parsha(itemsWith(DIASPORA))).toBe('Nasso');
    } finally {
      jest.useRealTimers();
      Sefaria.calendar = null;
    }
  });
});
