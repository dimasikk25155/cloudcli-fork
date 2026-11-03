import assert from 'node:assert/strict';
import { test } from 'node:test';

import { printDocument } from './printDocument';

test('print preview inserts untrusted document as text nodes and invokes native print',()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'window');let printed=0;const nodes:{textContent:string;style:Record<string,string>}[]=[];
 const popup={opener:{} as unknown,document:{title:'',createElement:()=>({textContent:'',style:{}}),body:{replaceChildren:(...children:typeof nodes)=>nodes.push(...children)}},focus:()=>{},print:()=>{printed++;}};
 Object.defineProperty(globalThis,'window',{configurable:true,value:{open:()=>popup}});
 try{printDocument('<script>title</script>','<img src=x onerror=alert(1)>');assert.equal(nodes[0].textContent,'<script>title</script>');assert.equal(nodes[1].textContent,'<img src=x onerror=alert(1)>');assert.equal(popup.opener,null);assert.equal(printed,1);}finally{if(previous)Object.defineProperty(globalThis,'window',previous);else Reflect.deleteProperty(globalThis,'window');}
});
test('blocked popup returns actionable error rather than claiming PDF saved',()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'window');Object.defineProperty(globalThis,'window',{configurable:true,value:{open:()=>null}});
 try{assert.throws(()=>printDocument('Title','Text'),/Разрешите окно/);}finally{if(previous)Object.defineProperty(globalThis,'window',previous);else Reflect.deleteProperty(globalThis,'window');}
});
