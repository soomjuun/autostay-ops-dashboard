const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const args=process.argv.slice(2);
const previewIndex=args.indexOf('--snapshot');
const preview=previewIndex>=0 ? JSON.parse(fs.readFileSync(args[previewIndex+1],'utf8')) : null;
const files={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/style.css':'style.css'};
const port=Number(process.env.PORT||4173);
let dataRequests=0;
const server=http.createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  res.setHeader('Cache-Control','no-store');
  res.status=code=>{res.statusCode=code;return res;};
  res.json=value=>{res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(value));};
  if(pathname==='/api/check')return res.json({ok:true});
  if(pathname==='/api/data') {
    if(args.includes('--fail-after-first') && dataRequests++>0) return res.status(503).json({code:'SOURCE_BUILD_PENDING',error:'원천 시트를 재생성 중입니다. 완료 후 자동으로 다시 조회합니다.'});
    if(preview) return res.json({...preview,preview:!args.includes('--cache-test')});
    return require('./api/data.js')(req,res);
  }
  if(pathname==='/favicon.ico'){res.statusCode=204;return res.end();}
  const file=files[pathname];
  if(!file){res.statusCode=404;return res.end('Not found');}
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');
  res.end(fs.readFileSync(path.join(__dirname,file)));
});
server.listen(port,'127.0.0.1',()=>console.log(`http://127.0.0.1:${port} (${preview?'captured data preview, NOT live':'API integration test'})`));
process.on('SIGINT',()=>server.close(()=>process.exit(0)));
