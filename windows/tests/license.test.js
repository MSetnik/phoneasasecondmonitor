const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {License}=require('../app/license');
test('the trial survives restarts and only a validated payment or recovery unlocks sharing',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'monitor-license-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'access.bin'),storage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
  const first=new License(file,storage);assert.equal(first.remaining(),1200);
  first.data.first-=21*60000;first.save();
  const license=new License(file,storage);assert.equal(license.remaining(),0);
  const original=license.data.code;let paid=false;
  t.mock.method(globalThis,'fetch',async(url,opts)=>{
    assert.equal(url,'https://phone-as-monitor-mcode.web.app/api/license');
    const reference=crypto.createHash('sha256').update(JSON.parse(opts.body).license).digest('hex');
    return Response.json({active:paid,checkout:paid?null:'https://buy.stripe.com/example?client_reference_id='+reference});
  });
  assert.match(await license.check(),/^https:\/\/buy\.stripe\.com\//);
  await assert.rejects(license.check('a'.repeat(64)),/No active purchase/);assert.equal(license.data.code,original);
  paid=true;await license.check('b'.repeat(64));assert.equal(license.remaining(),null);
  const reopened=new License(file,storage);assert.equal(reopened.remaining(),null);assert.equal(reopened.data.code,'b'.repeat(64));
  paid=false;await reopened.check();assert.equal(reopened.remaining(),0);
});
