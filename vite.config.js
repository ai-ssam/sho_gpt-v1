import {defineConfig} from 'vite';
export default defineConfig({root:'dist',server:{host:'0.0.0.0',port:4174,strictPort:true,allowedHosts:['terminal.local']}});
