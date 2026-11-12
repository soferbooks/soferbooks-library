import fs from 'fs';
import path from 'path';
import Sefaria from '../sefaria';
import DeepLinkRouter, { APP_HOME_URL, isAppHomeUrl } from '../DeepLinkRouter';
import ReaderApp from '../ReaderApp';
import { tabShortcutUrl } from '../tabs/tabShortcuts';

// Owner, 2026-11-12: "Open always to homepage when clicking the app." Launching from the icon
// (cold or while the app still runs with a book open) shows Home; recents keeps the screen;
// a pinned tab's shortcut and a sefaria.org link still open their own place.

const routerProps = () => ({
  openNav: jest.fn(), openMenu: jest.fn(), openRef: jest.fn(), openUri: jest.fn(),
  openRefInNewTab: jest.fn(), openTabShortcut: jest.fn(), openTextTocDirectly: jest.fn(),
  openSearch: jest.fn(), setSearchOptions: jest.fn(), setTextLanguage: jest.fn(),
  setNavigationCategories: jest.fn(),
});

describe('the app-icon launch link', () => {
  test('is recognised, and nothing else is', () => {
    expect(APP_HOME_URL).toBe('soferbooks://home');
    expect(isAppHomeUrl('soferbooks://home')).toBe(true);
    expect(isAppHomeUrl('soferbooks://home/')).toBe(true);
    expect(isAppHomeUrl('SOFERBOOKS://HOME')).toBe(true);
    expect(isAppHomeUrl('soferbooks://homework')).toBe(false);
    expect(isAppHomeUrl(tabShortcutUrl('t1', 'Niddah'))).toBe(false);
    expect(isAppHomeUrl('https://www.sefaria.org/Genesis.1')).toBe(false);
    expect(isAppHomeUrl(null)).toBe(false);
  });

  test('SplashActivity marks an icon launch (MAIN, no link) with that same link', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'java',
      'org', 'sefaria', 'sefaria', 'SplashActivity.java'), 'utf8');
    expect(src).toContain(`Uri.parse("${APP_HOME_URL}")`);
    expect(src).toMatch(/data == null && Intent\.ACTION_MAIN\.equals\(action\)/);
    // RN's Linking only reports VIEW intents (getInitialURL and the 'url' event)
    expect(src).toMatch(/action = Intent\.ACTION_VIEW;/);
  });
});

describe('DeepLinkRouter', () => {
  test('the icon launch opens Home, never the browser or a tab', () => {
    const props = routerProps();
    new DeepLinkRouter(props).route(APP_HOME_URL, true);
    expect(props.openNav).toHaveBeenCalledWith(false);
    expect(props.openUri).not.toHaveBeenCalled();
    expect(props.openTabShortcut).not.toHaveBeenCalled();
    expect(props.openRef).not.toHaveBeenCalled();
    expect(props.openRefInNewTab).not.toHaveBeenCalled();
  });

  test("a pinned tab's shortcut still opens its tab", () => {
    const props = routerProps();
    new DeepLinkRouter(props).route(tabShortcutUrl('t9', 'Ezekiel'), true);
    expect(props.openTabShortcut).toHaveBeenCalledWith({ tabId: 't9', title: 'Ezekiel' });
    expect(props.openNav).not.toHaveBeenCalled();
  });

  test('a sefaria.org link still opens its text (in a new tab)', () => {
    const props = routerProps();
    const spy = jest.spyOn(Sefaria, 'urlToRef').mockReturnValue({ ref: 'Genesis 1', title: 'Genesis' });
    try {
      new DeepLinkRouter(props).route('https://www.sefaria.org/Genesis.1', true);
    } finally { spy.mockRestore(); }
    expect(props.openRefInNewTab).toHaveBeenCalledWith('Genesis 1', null);
    expect(props.openNav).not.toHaveBeenCalled();
  });
});

describe('ReaderApp', () => {
  const makeApp = () => {
    const app = new ReaderApp({ dispatch: () => {}, showErrorBoundary: () => {}, theme: {}, themeStr: 'white', biLayout: 'stacked', textLanguage: 'hebrew' });
    app._deepLinkRouterRef = { route: jest.fn() };
    return app;
  };

  test('an icon launch while starting up is kept and routed once the app is ready', () => {
    const app = makeApp();
    app.state = { ...app.state, _completedInit: false };
    app.handleOpenURLNamedParam({ url: APP_HOME_URL, fromOutside: true });
    expect(app._initDeepLinkURL).toBe(APP_HOME_URL);
    expect(app._deepLinkRouterRef.route).not.toHaveBeenCalled();
  });

  test('an icon tap while the app runs (a book open) is routed straight away, to Home', () => {
    const app = makeApp();
    app.state = { ...app.state, _completedInit: true };
    app.handleOpenURLNamedParam({ url: APP_HOME_URL, fromOutside: true });
    expect(app._deepLinkRouterRef.route).toHaveBeenCalledWith(APP_HOME_URL, true);
  });

  test('a start with no link opens Home, without touching the saved tabs', () => {
    const app = makeApp();
    app.openNav = jest.fn();
    const tabsBefore = app.state.readerTabs;
    app.getInitialPromise();
    expect(app.openNav).toHaveBeenCalledWith(false);
    expect(app.state.readerTabs).toBe(tabsBefore);
  });
});
