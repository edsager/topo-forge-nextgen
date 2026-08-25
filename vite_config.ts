// File: vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  // This line is the magic trick for hosting on IONOS or shared web hosts.
  // It tells the app to use relative paths (./) for all its assets, 
  // meaning you can drag and drop the folder anywhere on edsager.com
  // (e.g., edsager.com/3d-puzzles/ or edsager.com/topoforge/) and it will just work!
  base: './',
  
  worker: {
    format: 'es'
  }
});