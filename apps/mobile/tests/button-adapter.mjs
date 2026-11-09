import {readFileSync} from 'node:fs';
import ts from 'typescript';
export function buttonModule(React,native,jsx) {
 const source=readFileSync(new URL('../src/Button.tsx',import.meta.url),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const icons=new Proxy({}, {get:()=>()=>null});
 const imports={react:React,'react-native':native,'react/jsx-runtime':jsx,'lucide-react-native':icons};
 const module={exports:{}};new Function('require','module','exports',code)(name=>imports[name],module,module.exports);return module.exports;
}
