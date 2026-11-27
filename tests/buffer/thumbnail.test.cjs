const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const root='libraries/nestjs-libraries/src/integrations/social/';
let fetcher;
const dispatcher={};
const forms=[];
class Form {
  constructor(){this.fields=[];forms.push(this);}
  append(...args){this.fields.push(args);}
  getHeaders(){return {};}
  getLengthSync(){return 100;}
  pipe(){return new (require('node:stream').PassThrough)();}
}
function load(file){
  const module={exports:{}};
  const output=ts.transpileModule(fs.readFileSync(root+file+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  vm.runInNewContext(output,{module,exports:module.exports,Buffer,AbortSignal,fetch:(...a)=>fetcher(...a),require:name=>{
    if(name.startsWith('node:')||name==='stream')return require(name);
    if(name==='./mastodon.thumbnail')return load('mastodon.thumbnail');
    if(name==='form-data')return Form;
    if(name.endsWith('social.abstract'))return {SocialAbstract:class{async runStreamedUpload(fn){return fn();}},BadBody:Error};
    if(name.endsWith('ssrf.safe.dispatcher'))return {getSsrfSafeDispatcher:()=>dispatcher};
    return {};
  }});
  return module.exports;
}
const {loadMastodonThumbnail}=load('mastodon.thumbnail');
const {MastodonProvider}=load('mastodon.provider');
const jpeg=Buffer.from([255,216,255,0,1]);
test('Mastodon thumbnails are bounded, typed and fetched without credentials or redirects',async()=>{
  for(const [data,type] of [[jpeg,'image/jpeg'],[Buffer.from([137,80,78,71,13,10,26,10,0]),'image/png']]){
    const result=await loadMastodonThumbnail('https://media.example/cover',dispatcher,async(_,options)=>{
      assert.equal(options.dispatcher,dispatcher);assert.equal(options.redirect,'error');
      assert.equal(options.headers.Authorization,undefined);assert.ok(options.signal instanceof AbortSignal);
      return new Response(data,{headers:{'content-type':type}});
    });
    assert.deepEqual(result.data,data);assert.equal(result.contentType,type);
  }
  for(const response of [new Response('bad',{headers:{'content-type':'image/jpeg'}}),new Response(jpeg,{headers:{'content-type':'text/html'}}),new Response(jpeg,{headers:{'content-type':'image/jpeg','content-length':3*1024*1024}}),new Response(Buffer.alloc(2*1024*1024+1),{headers:{'content-type':'image/jpeg'}})]){
    await assert.rejects(()=>loadMastodonThumbnail('https://media.example/cover',dispatcher,async()=>response));
  }
  assert.equal(await loadMastodonThumbnail(undefined,dispatcher),undefined);
});
test('Mastodon upload includes the thumbnail in v2 and its v1 fallback',async()=>{
  forms.length=0;let uploads=0;let covers=0;
  fetcher=async(url,options)=>{
    if(url==='https://media.example/cover.jpg'){covers++;return new Response(jpeg,{headers:{'content-type':'image/jpeg'}});}
    if(url==='https://media.example/video.mp4')return new Response('video',{headers:{'content-length':'5'}});
    uploads++;
    assert.equal(options.headers.Authorization,'Bearer dummy-token');
    return uploads===1?new Response('{}',{status:500}):Response.json({id:'media-id'});
  };
  assert.equal(await new MastodonProvider().uploadFile('https://mastodon.example','https://media.example/video.mp4','dummy-token','description','https://media.example/cover.jpg'),'media-id');
  assert.equal(covers,1);assert.equal(uploads,2);
  for(const form of forms){
    assert.deepEqual(form.fields.find(f=>f[0]==='thumbnail')[1],jpeg);
    assert.equal(form.fields.find(f=>f[0]==='description')[1],'description');
  }
});
