// (jest) react-native-android-widget's drawing parts as plain components; its native calls do nothing
const React = require('react');

const widget = name => {
  const W = ({ children }) => React.createElement(name, null, children);
  W.displayName = name;
  return W;
};

module.exports = {
  FlexWidget: widget('FlexWidget'),
  ListWidget: widget('ListWidget'),
  TextWidget: widget('TextWidget'),
  ImageWidget: widget('ImageWidget'),
  requestWidgetUpdate: jest.fn(() => Promise.resolve()),
  registerWidgetTaskHandler: jest.fn(),
  registerWidgetConfigurationScreen: jest.fn(),
};
