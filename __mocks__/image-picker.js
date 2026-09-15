// The picker is a system UI; under jest each launch resolves to whatever the
// test last queued, or to a cancel.
let queued = [];
module.exports = {
  __queue: response => queued.push(response),
  __reset: () => {
    queued = [];
    module.exports.launchImageLibrary.mockClear();
    module.exports.launchCamera.mockClear();
  },
  launchImageLibrary: jest.fn(() => Promise.resolve(queued.shift() ?? { didCancel: true })),
  launchCamera: jest.fn(() => Promise.resolve(queued.shift() ?? { didCancel: true })),
};
