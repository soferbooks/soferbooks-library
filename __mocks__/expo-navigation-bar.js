// (Android's button bar: native, not in tests - reader/navigationBar.js)
module.exports = {
  setBackgroundColorAsync: jest.fn(() => Promise.resolve()),
  setButtonStyleAsync: jest.fn(() => Promise.resolve()),
};
