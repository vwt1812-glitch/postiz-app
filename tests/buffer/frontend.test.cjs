const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const dependencies = require('node:module').createRequire(process.env.BUFFER_TEST_PACKAGE || path.resolve('package.json'));
const { JSDOM } = dependencies('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
Object.assign(global, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
  MutationObserver: dom.window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator });
const React = dependencies('react');
const { useForm, FormProvider } = dependencies('react-hook-form');
const { render, screen, waitFor, fireEvent, cleanup } = dependencies('@testing-library/react');
const ts = dependencies('typescript');
let request;
const moduleUnderTest = { exports: {} };
const source = fs.readFileSync('apps/frontend/src/components/launches/buffer.channel.select.tsx', 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
vm.runInNewContext(output.outputText, { module: moduleUnderTest, exports: moduleUnderTest.exports,
  require: name => name.includes('custom.fetch') ? { useFetch: () => (...args) => request(...args) } : dependencies(name) });
const { BufferChannelSelect } = moduleUnderTest.exports;
afterEach(cleanup);
function mount(identifier = 'x-buffer') {
  let form;
  function Wrapper() {
    form = useForm();
    return React.createElement(FormProvider, { ...form }, React.createElement(BufferChannelSelect, { identifier }));
  }
  render(React.createElement(Wrapper));
  return () => form.getValues();
}
test('channel selector discovers separate X accounts and disables unavailable channels', async () => {
  request = async url => {
    assert.equal(url, '/integrations/buffer/channels/x-buffer');
    return { ok: true, json: async () => [
      { id: 'x1', name: 'Council', handle: 'council', available: true },
      { id: 'x2', name: 'Association', handle: 'association', available: true },
      { id: 'paused', name: 'Paused', handle: 'paused', available: false },
    ] };
  };
  const values = mount();
  await waitFor(() => assert.equal(screen.getAllByRole('option').length, 4));
  assert.equal(screen.getByRole('option', { name: /Paused/ }).disabled, true);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'x2' } });
  assert.equal(values().channelId, 'x2');
});
test('discovery errors stay visible and prevent channel selection', async () => {
  request = async () => ({ ok: false });
  mount('tiktok-buffer');
  await waitFor(() => assert.match(screen.getByRole('alert').textContent, /could not be loaded/));
  assert.equal(screen.getByRole('combobox').disabled, true);
});
