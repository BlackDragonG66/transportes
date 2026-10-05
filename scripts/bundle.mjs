import {readdir,readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const skip=new Set(['.git','node_modules','dist','artifacts','.test-postgres','.env']);
async function files(dir){const output=[];for(const e of await readdir(dir,{withFileTypes:true})){if(skip.has(e.name))continue;const path=resolve(dir,e.name);if(e.isDirectory())output.push(...await files(path));else if(!e.name.endsWith('.log'))output.push(path);}return output;}
const langs={'.js':'javascript','.mjs':'javascript','.jsx':'jsx','.sql':'sql','.css':'css','.yaml':'yaml','.yml':'yaml','.json':'json','.html':'html','.svg':'xml','.md':'markdown'};
let text='# ConexionES — código completo\n\n';
for(const path of (await files(root)).sort()){
 const name=path.slice(root.length+1).replaceAll('\\','/');
 if(name==='package-lock.json')continue;
 text+=`## ${name}\n\n\`\`\`\`${langs[extname(path)]||'text'}\n${await readFile(path,'utf8')}\n\`\`\`\`\n\n`;
}
await mkdir(resolve(root,'artifacts'),{recursive:true});
await writeFile(resolve(root,'artifacts/CODIGO_COMPLETO.md'),text);
console.log('artifacts/CODIGO_COMPLETO.md');
