import React from 'react';
import renderer, { act } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import TestContextWrapper from '../TestContextWrapper';
import ReaderApp from '../ReaderApp';
// import mockRNCNetInfo from '@react-native-community/netinfo/jest/netinfo-mock.js';
//
// jest.mock('@react-native-community/netinfo', () => mockRNCNetInfo);

describe('ReaderApp', () => {
  test('module graph loads without the removed Sefaria account, topics and analytics modules', () => {
    // Importing ReaderApp pulls in every screen; a dangling import of a deleted module fails here.
    expect(typeof ReaderApp).toBe('function');
  });
});

describe('ReaderApp noInternet', () =>{
  // todo: finish this test (xtest skips the test)
  xtest('loadNewText', async () => {
    // fetch = jest.fn(() => Promise.reject(e => null));
    fetch = jest.fn(() => Promise.resolve({
      status: 200,
      json() {
        return Promise.resolve({
          user_history: webHistory,
          last_sync: 11,
          settings: {
            time_stamp: 11,
          },
        })
      }
    }));
    const inst = renderer.create(<TestContextWrapper passContextToChildren child={ReaderApp} />);
    const readerApp = inst.root.findByType(ReaderApp);
    const resolve = jest.fn();
    readerApp.instance.setState = jest.fn();
    readerApp.props.dispatch = jest.fn();
    const loadNewText = () => {
      return readerApp.instance.loadNewText({ref: 'Genesis 1', versions: null });
    }
    // await act(loadNewText);
    // return readerApp.loadNewText({ref: 'Genesis 1', versions: null })
    // .then(data => expect(data).toBe('foo'));
    await loadNewText().then(resolve);
    expect(resolve.mock.calls.length).toBe(1);
  })
});
