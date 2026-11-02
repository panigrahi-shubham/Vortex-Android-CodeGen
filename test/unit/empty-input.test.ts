import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseTree } from '../../src/tree.js';
import { annotate } from '../../src/locators.js';
import { mwLocator } from '../../src/engines/mobilewright/ts-codegen.ts';
import type { LocatorParts } from '../../src/model/recording.ts';

test('empty modal inputs retain editable class locators rather than a labelled parent', () => {
  const nodes = parseTree(JSON.stringify({elements: [{type:'android.view.ViewGroup', identifier:'com.example:id/parent', children:[
    {type:'android.widget.EditText', rect:{x:10,y:10,width:80,height:40}},
    {type:'android.widget.EditText', rect:{x:10,y:60,width:80,height:40}}
  ]}]}));
  annotate(nodes, 'com.example');
  for (const [index, node] of nodes.filter(n => /EditText/.test(n.type)).entries()) {
    const target = node.target as {viaAncestor: boolean; parts: LocatorParts; warnings: string[]};
    assert.equal(target.viaAncestor, false);
    assert.deepEqual(target.parts, {by:'type', value:'android.widget.EditText', index});
    assert.deepEqual(mwLocator(target.parts, 'com.example', 'screen'), {code:`screen.getByType('android.widget.EditText').nth(${index})`});
    assert.match(target.warnings.join(' '), /order changes/);
  }
});
