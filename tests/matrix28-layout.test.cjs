const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../matrix28.js'), 'utf8') + '\nthis.layout = Matrix28.layout;', context);
const chain = Array.from({length: 10}, (_, i) => ({public_id: `s${i}`, parent_public_id: i ? `s${i - 1}` : null, status: 'planned'}));
const long = context.layout(chain);
assert.equal(long.points.size, 10);
assert.ok(long.width > 2800);
assert.equal(long.height, 500);
for (let i = 1; i < 10; i++) {
  assert.equal(long.points.get(`s${i}`).x - long.points.get(`s${i - 1}`).x, 280);
  assert.equal(long.points.get(`s${i}`).y, long.points.get('s0').y);
}
const branched = context.layout([...chain.slice(0, 3), {public_id: 'branch', parent_public_id: 's1'}]);
assert.equal(branched.points.get('branch').x, branched.points.get('s2').x);
assert.equal(Math.abs(branched.points.get('branch').y - branched.points.get('s2').y), 200);
assert.equal(branched.points.get('s1').y, (branched.points.get('branch').y + branched.points.get('s2').y) / 2);
const changedStatuses = context.layout(chain.map((s, i) => ({...s, status: i % 2 ? 'completed' : 'in_progress'})));
assert.deepEqual([...changedStatuses.points], [...long.points]);
assert.equal(context.layout([{public_id:'a',parent_public_id:'b'},{public_id:'b',parent_public_id:'a'}]).points.size, 2);
console.log('Tree layout: chain, branches, status independence and cycles passed.');

const custom = context.layout([{public_id:"custom",map_x:900,map_y:800}]);
assert.equal(custom.points.get("custom").x,900);assert.equal(custom.points.get("custom").y,800);assert.ok(custom.width>=1165);assert.ok(custom.height>=1010);
