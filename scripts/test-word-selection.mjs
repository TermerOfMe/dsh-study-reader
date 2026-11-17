import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import {test} from 'node:test'
const source=await readFile(new URL('../client.js',import.meta.url),'utf8')
const match=source.match(/^    function englishWordBounds\([^]*?^    \}/m)
assert.ok(match)
const bounds=vm.runInNewContext('('+match[0]+')')
function selected(text,start,end){const result=bounds(text,start,end);return text.slice(result.start,result.end)}
test('both partial English endpoints expand to complete words',()=>{
 const text='The policy gradient improves learning.'
 assert.equal(selected(text,6,34),'policy gradient improves learning')
 assert.equal(selected('English',2,3),'English')
})
test('exact boundaries and surrounding punctuation stay untouched',()=>{
 assert.equal(selected('(policy), next',1,7),'policy')
 assert.equal(selected('one two',3,4),' ')
 assert.equal(selected('one, two',3,5),', ')
})
test('contractions, apostrophes and technical hyphenated words stay complete',()=>{
 for(const word of ["don't",'isn’t','on-policy','off‑policy','actor‐critic'])assert.equal(selected(word,1,word.length-1),word)
})
test('Chinese, digits and formula symbols keep native boundaries',()=>{
 for(const text of ['中文选择测试','123456','θ∇παβ'])assert.deepEqual({...bounds(text,1,3)},{start:1,end:3})
 assert.equal(selected('中文policy中文',3,7),'policy')
 assert.equal(selected('x₁ + θ',5,6),'θ')
})
test('Latin accents and combining marks use full word without splitting UTF-16',()=>{
 for(const text of ['café','naïve','cafe\u0301','ﬁne']){
  const result=bounds(text,1,text.length-1)
  assert.equal(text.slice(result.start,result.end),text)
 }
 assert.equal(selected('😀 policy 😀',5,7),'policy')
})
test('line breaks and whitespace separate words',()=>{
 assert.equal(selected('first\nsecond',2,8),'first\nsecond')
 assert.equal(selected('first\nsecond',6,9),'second')
 assert.equal(selected('state\u00a0value',2,9),'state\u00a0value')
})

test('mouse selection changes snap during drag before release and listeners clean up',()=>{
 const definition=source.match(/^    function bindEnglishWordSelection\([^]*?^    \}/m)
 const listeners=new Map(),winListeners=new Map()
 const events=map=>({addEventListener:(name,fn)=>map.set(name,fn),removeEventListener:(name,fn)=>{if(map.get(name)===fn)map.delete(name)}})
 let calls=0
 const selection={direction:'backward'}
 const window={...events(winListeners),getSelection:()=>selection}
 const document=events(listeners)
 const fn=vm.runInNewContext('('+definition[0]+')',{window,document,expandEnglishSelection:(value,root)=>{assert.equal(value,selection);calls++}})
 const layer={}
 const root={contains:target=>target===layer}
 layer.closest=()=>layer
 const cleanup=fn(root)
 const down=listeners.get('pointerdown'),snap=listeners.get('selectionchange'),up=listeners.get('pointerup')
 const mouse={button:0,pointerType:'mouse',pointerId:1,target:layer}
 snap();assert.equal(calls,0)
 down(mouse);snap();snap();assert.equal(calls,2,'live snap occurs without pointerup')
 up({pointerId:1});snap();assert.equal(calls,3,'release snaps once, later changes remain native')
 for(const extra of [{ctrlKey:true},{metaKey:true},{pointerType:'touch'},{button:2}]){down({...mouse,...extra});snap()}
 assert.equal(calls,3)
 down(mouse);winListeners.get('blur')();snap();assert.equal(calls,3)
 cleanup();assert.equal(listeners.size,0);assert.equal(winListeners.size,0)
})
