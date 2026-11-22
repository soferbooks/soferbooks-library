// (the screen kept on: native, not in tests - reader/keepScreenOn.js)
module.exports = {
  activateKeepAwakeAsync: jest.fn(() => Promise.resolve()),
  deactivateKeepAwake: jest.fn(() => Promise.resolve()),
};
