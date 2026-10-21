'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const files = {'/':'index.html','/index.html':'index.html','/styles.css':'styles.css','/app.js':'app.js','/engine.js':'engine.js','/curriculum.js':'curriculum.js','/standalone.html':'微积分晋级.html','/config.js':'config.js','/vendor/supabase.js':'vendor/supabase.js','/cloud.js':'cloud.js','/cloud-sync.js':'cloud-sync.js','/accounts.js':'accounts.js'};
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};
const port = Number(process.env.PORT || 4188);
http.createServer((req,res)=>{
  const name=files[new URL(req.url,'http://localhost').pathname];
  if(!name){res.writeHead(404);res.end('Not found');return;}
  fs.readFile(path.join(__dirname,name),(error,data)=>{
    if(error){res.writeHead(404);res.end('Not found');return;}
    res.writeHead(200,{'Content-Type':types[path.extname(name)],'Cache-Control':'no-store'});res.end(data);
  });
}).listen(port,'127.0.0.1',()=>console.log(`微积分晋级：http://127.0.0.1:${port}`));
