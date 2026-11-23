import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePath } from '../server.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const at = (...parts) => path.join(ROOT, ...parts);

describe('resolvePath mounts', () => {
  test('the web root is /public', () => {
    assert.equal(resolvePath('/'), at('public', 'index.html'));
    assert.equal(resolvePath('/index.html'), at('public', 'index.html'));
    assert.equal(resolvePath('/styles.css'), at('public', 'styles.css'));
    assert.equal(resolvePath('/models/handshapes.json'), at('public', 'models', 'handshapes.json'));
  });

  test('/src and /evals are served from the project', () => {
    assert.equal(resolvePath('/src/core/vec.js'), at('src', 'core', 'vec.js'));
    assert.equal(resolvePath('/evals/cases/01-text-language.json'), at('evals', 'cases', '01-text-language.json'));
  });

  test('vendor mounts map into whitelisted node_modules folders only', () => {
    assert.equal(
      resolvePath('/vendor/mediapipe/vision_bundle.mjs'),
      at('node_modules', '@mediapipe', 'tasks-vision', 'vision_bundle.mjs'),
    );
    assert.equal(
      resolvePath('/vendor/transformers/transformers.min.js'),
      at('node_modules', '@huggingface', 'transformers', 'dist', 'transformers.min.js'),
    );
    assert.equal(resolvePath('/vendor/ort/ort.wasm'), at('node_modules', 'onnxruntime-web', 'dist', 'ort.wasm'));
    // Anything else under /vendor or /node_modules falls through to /public.
    assert.equal(resolvePath('/vendor/other/x.js'), at('public', 'vendor', 'other', 'x.js'));
    assert.equal(resolvePath('/node_modules/x/index.js'), at('public', 'node_modules', 'x', 'index.js'));
  });

  test('files outside the mounts are not reachable by their real path', () => {
    assert.equal(resolvePath('/server.js'), at('public', 'server.js'));
    assert.equal(resolvePath('/package.json'), at('public', 'package.json'));
    assert.equal(resolvePath('/src'), at('public', 'src'));
  });

  test('a mount root resolves to its index.html', () => {
    assert.equal(resolvePath('/src/'), at('src', 'index.html'));
    assert.equal(resolvePath('/evals/'), at('evals', 'index.html'));
  });

  test('percent-encoded names are decoded', () => {
    assert.equal(resolvePath('/src/core/vec%2Ejs'), at('src', 'core', 'vec.js'));
    assert.equal(resolvePath('/my%20file.txt'), at('public', 'my file.txt'));
    assert.equal(resolvePath('/%D7%A9%D7%9C%D7%95%D7%9D.txt'), at('public', 'שלום.txt'));
  });

  test('harmless dot segments that stay inside the mount are allowed', () => {
    assert.equal(resolvePath('/src/core/../core/./vec.js'), at('src', 'core', 'vec.js'));
    assert.equal(resolvePath('/a/../index.html'), at('public', 'index.html'));
  });
});

describe('resolvePath refuses path traversal', () => {
  const attacks = [
    '/../server.js',
    '/../../etc/passwd',
    '/../public/../server.js',
    '/src/../server.js',
    '/src/../package.json',
    '/src/../../../../etc/passwd',
    '/src/core/../../../server.js',
    '/evals/../src/core/vec.js',
    '/vendor/mediapipe/../../../server.js',
    '/vendor/mediapipe/../package.json',
    '/vendor/ort/../../.package-lock.json',
    '/%2e%2e/server.js',
    '/%2E%2E/%2E%2E/etc/passwd',
    '/src/%2e%2e/server.js',
    '/src/%2e%2e%2fserver.js',
    '/src/..%2f..%2fetc%2fpasswd',
    '/src/%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    '/..%2fserver.js',
    '/src//etc/passwd',
    '/evals//etc/hosts',
    '//etc/passwd',
    '/%2fetc%2fpasswd',
    '/..',
    '/src/..',
  ];
  for (const attack of attacks) {
    test(`rejects ${attack}`, () => {
      assert.equal(resolvePath(attack), null);
    });
  }

  test('a sibling directory sharing the mount prefix is not inside the mount', () => {
    assert.equal(resolvePath('/src/../src-secret/x.js'), null);
    assert.equal(resolvePath('/../public-backup/index.html'), null);
  });

  test('rejects null bytes, raw or encoded', () => {
    assert.equal(resolvePath('/index.html%00.png'), null);
    assert.equal(resolvePath('/src/core/vec.js%00'), null);
    assert.equal(resolvePath('/index.html\0'), null);
    assert.equal(resolvePath('/%00'), null);
  });

  test('rejects malformed percent-encoding', () => {
    assert.equal(resolvePath('/%'), null);
    assert.equal(resolvePath('/%E0%A4%A'), null);
    assert.equal(resolvePath('/src/%zz'), null);
  });

  test('rejects paths that do not start with a slash', () => {
    assert.equal(resolvePath('index.html'), null);
    assert.equal(resolvePath('src/core/vec.js'), null);
    assert.equal(resolvePath(''), null);
    assert.equal(resolvePath('..'), null);
  });

  test('double-encoded traversal stays a literal file name inside the mount', () => {
    // %252e decodes once to "%2e", which is just an odd file name, not "..".
    const file = resolvePath('/src/%252e%252e/server.js');
    assert.equal(file, at('src', '%2e%2e', 'server.js'));
  });

  test('every accepted path lies inside the project root (fuzz)', () => {
    const pieces = ['..', '.', 'src', 'evals', 'vendor', 'mediapipe', 'ort', '%2e%2e', '%2f', '', 'a.js', '%5c..', '..%5c'];
    let seed = 12345;
    const next = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 4294967296;
    };
    const allowed = [
      at('public'),
      at('src'),
      at('evals'),
      at('node_modules', '@mediapipe', 'tasks-vision'),
      at('node_modules', '@huggingface', 'transformers', 'dist'),
      at('node_modules', 'onnxruntime-web', 'dist'),
    ];
    for (let i = 0; i < 3000; i++) {
      const depth = 1 + Math.floor(next() * 6);
      let url = '';
      for (let d = 0; d < depth; d++) url += `/${pieces[Math.floor(next() * pieces.length)]}`;
      const file = resolvePath(url);
      if (file == null) continue;
      assert.ok(
        allowed.some((dir) => file === dir || file.startsWith(dir + path.sep)),
        `${url} escaped to ${file}`,
      );
    }
  });
});
