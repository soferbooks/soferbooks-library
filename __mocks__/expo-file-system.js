
const testCache = {};
const timeStamps = {};

// using this seems more "correct", but much more difficult to implement correctly. Unclear at this time if worth the effort
function getPath(path) {
  let curdir = testCache;
  let pathList = path.split('/').slice(1);  // get rid of the leading slash
  for (let p in pathList) {
    if (curdir instanceof Object && p in curdir)
      curdir = curdir[p];
    else
      throw new Error(`Path ${path} does not exist`);
  }
  return curdir
}

function stat(path) {
  if (!(path in testCache))
    return Promise.reject(new Error(`File ${path} not found`));
  let timestamp = (path in timeStamps) ? timeStamps[path] : new Date();
  return Promise.resolve({
    filename: path.split('/').pop(),
    path: path,
    size: 1,
    type: 'file',
    lastModified: timestamp.valueOf()
  })
}

const getInfoAsync = jest.fn((fileUri, options) => {
  if (typeof options === 'object' && options.log) {
    // console.log(fileUri);
    // console.log(Object.keys(testCache));
  }
  return new Promise(resolve => {
    if (fileUri in testCache) {
      resolve({
        exists: true,
        isDirectory: false,
        modificationTime: (fileUri in timeStamps) ? parseInt(timeStamps[fileUri] / 1000) : new Date(),
        size: 5,
        uri: fileUri
      })
    } else {
      resolve({exists: false, isDirectory: false})
    }
  })
});

const writeAsStringAsync = jest.fn((fileUri, contents, options) => {
  testCache[fileUri] = contents;
  return Promise.resolve();
});

const readAsStringAsync = jest.fn((fileUri, options) => {
  return new Promise((resolve, reject) => {
    // console.log(testCache)
    if (fileUri in testCache) {
      resolve(testCache[fileUri])
    } else {
      reject(new Error(`File ${fileUri} does not exist`));
    }
  })
});

const deleteAsync = jest.fn((fileUri, options) => {
  return new Promise((resolve, reject) => {
    if (fileUri in testCache) {
      delete testCache[fileUri];
      if (fileUri in timeStamps) {
        delete timeStamps[fileUri];
      }
      resolve('');
    } else if (typeof(options) === 'object' && options.idempotent) {
      resolve('');
    } else {
      reject(new Error('File does not exist'));
    }
  })
})

const moveAsync = jest.fn(options => {
  return new Promise((resolve, reject) => {
    if (options.from in testCache) {
      testCache[options.to] = testCache[options.from];
      delete testCache[options.to];
      resolve()
    } else reject(Error(`File at ${options.to} does not exist`));
  })
})

// const readDirectoryAsync = jest.fn(async fileUri => Promise.resolve(Object.keys(testCache).filter(k => k.startsWith(fileUri))));
const readDirectoryAsync = jest.fn(fileUri => {
  return new Promise(resolve => {
    let fileNames = Object.keys(testCache).filter(k => k.startsWith(fileUri));
    resolve(fileNames.map(x => x.split('/').pop()));
  })
});

const makeDirectoryAsync = jest.fn(() => Promise.resolve());
// Downloads: tests register what a URL serves with setRemote(url, content[, status]).
const remotes = {};
const setRemote = jest.fn((url, content, status = 200) => { remotes[url] = {content, status}; });
const downloadAsync = jest.fn((url, fileUri) => {
  const remote = remotes[url];
  if (!remote) { return Promise.resolve({status: 404, uri: fileUri}); }
  if (remote.status >= 200 && remote.status < 300) { testCache[fileUri] = remote.content; }
  return Promise.resolve({status: remote.status, uri: fileUri});
});
const setTimestamp = jest.fn((filename, timestamp) => {
  timeStamps[filename] = timestamp;
});
const clear = jest.fn(() => {
  Object.keys(testCache).forEach(x => { delete testCache[x]});
  Object.keys(timeStamps).forEach(x => { delete timeStamps[x]});
  Object.keys(remotes).forEach(x => { delete remotes[x]});
});
const documentDirectory = '';
const cacheDirectory = '';
const bundleDirectory = '';

/** Minimal stand-in for the new `expo-file-system` File class (bytes()/size). */
class File {
  constructor(uri) {
    this.uri = typeof uri === 'string' ? uri : uri.uri;
  }
  get size() {
    const value = testCache[this.uri];
    if (value === undefined || value === null) return 0;
    return value instanceof Uint8Array ? value.length : String(value).length;
  }
  async bytes() {
    const value = testCache[this.uri];
    if (value === undefined) throw new Error(`File ${this.uri} does not exist`);
    return value instanceof Uint8Array ? value : new TextEncoder().encode(String(value));
  }
}

export {
  getInfoAsync,
  writeAsStringAsync,
  readAsStringAsync,
  deleteAsync,
  moveAsync,
  makeDirectoryAsync,
  setTimestamp,
  clear,
  documentDirectory,
  cacheDirectory,
  bundleDirectory,
  readDirectoryAsync,
  downloadAsync,
  setRemote,
  File,
}
