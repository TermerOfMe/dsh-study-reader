import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import {test} from 'node:test'
const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
const definition = source.match(/^    function createAnswerScroll\([^]*?^    \}/m)
assert.ok(definition)
const create = vm.runInNewContext('(' + definition[0] + ')')
const pane = () => ({ scrollHeight: 2000, clientHeight: 500, scrollTop: 1500 })
function renderFollow(control, element) {
  control.follow(element)
  element.scrollTop = Math.max(0, Math.min(element.scrollTop, element.scrollHeight - element.clientHeight))
}

test('staying at the bottom follows new chunks even when one update exceeds the viewport', () => {
 const control=create(), element=pane()
 element.scrollHeight+=1200
 renderFollow(control,element)
 assert.equal(element.scrollTop,2700)
})

test('scrolling upward during generation keeps the chosen position over repeated chunks and completion', () => {
 const control=create(), element=pane()
 element.scrollTop=120
 control.onScroll({currentTarget:element})
 for(let i=0;i<30;i++) { element.scrollHeight+=40;renderFollow(control,element);assert.equal(element.scrollTop,120) }
 renderFollow(control,element)
 assert.equal(element.scrollTop,120)
})

test('reading within the old 160px near-bottom area does not snap back', () => {
 const control=create(),element=pane()
 element.scrollTop=1420
 control.onScroll({currentTarget:element})
 element.scrollHeight+=30
 renderFollow(control,element)
 assert.equal(element.scrollTop,1420)
})

test('upward wheel pauses immediately before a native scroll event or another model chunk', () => {
 const control=create(),element=pane()
 control.onWheel({deltaY:-20})
 element.scrollHeight+=40
 renderFollow(control,element)
 assert.equal(element.scrollTop,1500)
})

test('only manually returning to the bottom resumes following', () => {
 const control=create(),element=pane()
 element.scrollTop=200;control.onScroll({currentTarget:element})
 element.scrollTop=1000;control.onScroll({currentTarget:element})
 control.onWheel({deltaY:40})
 renderFollow(control,element);assert.equal(element.scrollTop,1000)
 element.scrollTop=1500;control.onScroll({currentTarget:element})
 element.scrollHeight+=50;renderFollow(control,element)
 assert.equal(element.scrollTop,1550)
})

test('independent panels do not share follow state and null pane is safe', () => {
 const first=create(),second=create(),a=pane(),b=pane()
 first.onWheel({deltaY:-1});a.scrollHeight+=50;b.scrollHeight+=50
 renderFollow(first,a);renderFollow(second,b)
 assert.equal(a.scrollTop,1500);assert.equal(b.scrollTop,1550)
 first.follow(null)
})
