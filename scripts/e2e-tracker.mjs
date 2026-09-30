import http from 'node:http';
http.createServer((q,r)=>{console.log('HIT '+q.url);r.writeHead(200);r.end('x')}).listen(54399,'127.0.0.1',()=>console.log('tracker up'));
