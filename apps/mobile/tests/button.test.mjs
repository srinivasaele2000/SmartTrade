import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {buttonModule} from './button-adapter.mjs';
import {readFileSync,readdirSync} from 'node:fs';
import ts from 'typescript';
const require=createRequire(new URL('../../admin/package.json',import.meta.url));
const jsx=require('react/jsx-runtime');
function harness(props){
 const state=[];
 const react={useRef:()=>({current:false}),useState:()=>[false,value=>state.push(value)]};
 const native={Pressable:'pressable',View:'view',Text:'text',ActivityIndicator:'spinner',StyleSheet:{create:s=>s}};
 const module=buttonModule(react,native,jsx);
 return {tree:module.Button({title:'Save branch',onPress(){},...props}),state,palette:module.buttonPalette};
}
test('primary, secondary, tertiary and destructive have distinct readable intent',()=>{
 const colors=['primary','secondary','tertiary','destructive'].map(variant=>harness({variant}).tree.props.style({pressed:false})[1]);
 assert.equal(new Set(colors.map(c=>c.backgroundColor)).size,4);
 assert.equal(colors[0].backgroundColor,'#14553E');assert.equal(colors[3].backgroundColor,'#B42318');
 for(const variant of ['primary','destructive'])assert.equal(harness({variant}).palette[variant].color,'#FFFFFF');
});
test('selected navigation exposes tab semantics and does not use primary styling',()=>{
 const {tree,palette}=harness({variant:'navigation',selected:true});
 assert.equal(tree.props.accessibilityRole,'tab');assert.equal(tree.props.accessibilityState.selected,true);
 assert.equal(tree.props.style({pressed:false})[1].backgroundColor,palette.selected.backgroundColor);
 assert.notEqual(palette.selected.backgroundColor,palette.primary.backgroundColor);
});
test('disabled and loading buttons reject presses and expose accessible states',()=>{
 for(const props of [{disabled:true},{loading:true}]){
  let calls=0;const {tree,palette}=harness({...props,onPress:()=>calls++});
  tree.props.onPress();assert.equal(calls,0);assert.equal(tree.props.disabled,true);
  assert.equal(tree.props.style({pressed:false})[1].backgroundColor,palette.disabled.backgroundColor);
  assert.equal(tree.props.accessibilityLabel,'Save branch');
  if(props.loading)assert.equal(tree.props.accessibilityState.busy,true);
 }
});
test('rapid taps invoke a synchronous handler once and allow later intentional presses',async()=>{
 let calls=0;const {tree}=harness({onPress:()=>calls++});
 tree.props.onPress();tree.props.onPress();assert.equal(calls,1);
 await new Promise(resolve=>setTimeout(resolve,375));tree.props.onPress();assert.equal(calls,2);
});
test('async submissions remain locked until completion, including failure recovery',async()=>{
 for(const reject of [false,true]){
  let settle,calls=0;const operation=new Promise((resolve,rejectFn)=>{settle=reject?rejectFn:resolve;});
  const {tree,state}=harness({onPress:()=>{calls++;return operation;}});
  tree.props.onPress();tree.props.onPress();assert.equal(calls,1);assert.deepEqual(state,[true]);
  settle();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(state,[true,false]);
  tree.props.onPress();assert.equal(calls,2);
 }
});
test('long labels wrap without reducing the minimum Android touch target',()=>{
 const {tree}=harness({title:'Find dealer branches for selected SKU'});
 const base=tree.props.style({pressed:false})[0];assert.ok(base.minHeight>=48);assert.equal(base.flexShrink,1);assert.equal(base.maxWidth,'100%');
});
test('all mobile action call sites specify intent and screens share one implementation',()=>{
 const files=[new URL('../App.tsx',import.meta.url),...readdirSync(new URL('../src',import.meta.url)).filter(f=>f.endsWith('.tsx')&&f!=='Button.tsx').map(f=>new URL('../src/'+f,import.meta.url))];
 let buttons=0;
 for(const f of files){
  const text=readFileSync(f,'utf8'),source=ts.createSourceFile(f.pathname,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  function walk(node){
   if(ts.isFunctionDeclaration(node))assert.ok(!['Button','Action'].includes(node.name?.text),'local button implementation must not return');
   if(ts.isJsxSelfClosingElement(node)&&['Button','Action'].includes(node.tagName.getText(source))){buttons++;assert.ok(node.attributes.properties.some(a=>a.name?.getText(source)==='variant'),f.pathname+' has an action without explicit intent');}
   ts.forEachChild(node,walk);
  }walk(source);
 }
 assert.ok(buttons>100,'covers the entire existing mobile UI');
});
