import {defineConfig} from 'vite';
export default defineConfig({root:'dist',server:{host:'0.0.0.0',port:4175,strictPort:true,allowedHosts:['terminal.local'],headers:{'Cache-Control':'no-store'}}});
