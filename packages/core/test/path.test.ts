import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basename, dirname, isAbsolute, isWithin, join, normalize, resolve } from '../src/path.ts';

test('posix, Windows drive and UNC paths', () => {
  assert.equal(normalize('/a/./b//c/../d'), '/a/b/d');
  assert.equal(normalize('/..'), '/');
  assert.equal(normalize('a/../../b'), '../b');
  assert.equal(normalize('C:/a/../b'), 'C:/b');
  assert.equal(normalize('//server/share/a/..'), '//server/share/');
  assert.equal(resolve('/a/b', '../c', 'd.md'), '/a/c/d.md');
  assert.equal(resolve('C:/work', 'D:/other'), 'D:/other');
  assert.equal(join('/a', '', 'b'), '/a/b');
  assert.equal(dirname('/a/b.d2'), '/a');
  assert.equal(dirname('/a'), '/');
  assert.equal(dirname('C:/a'), 'C:/');
  assert.equal(basename('/a/b.d2'), 'b.d2');
  assert.ok(isAbsolute('/a') && isAbsolute('C:/a') && !isAbsolute('a/b'));
  assert.ok(isWithin('/a', '/a/b/c') && isWithin('/a', '/a') && !isWithin('/a', '/ab') && !isWithin('/a/b', '/a'));
  assert.ok(isWithin('/', '/x'));
});
