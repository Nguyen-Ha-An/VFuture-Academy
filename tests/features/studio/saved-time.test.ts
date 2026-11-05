import {afterEach,expect,it} from 'vitest';
import {workspaceSavedTime} from '@/features/studio/saved-time';
const original=process.env.TZ;
afterEach(()=>{if(original===undefined)delete process.env.TZ;else process.env.TZ=original;});
it.each(['en','vi'] as const)('keeps the saved time stable between UTC server and ICT browser in %s',locale=>{
 const timestamp=Date.parse('2026-11-05T10:18:38Z');
 process.env.TZ='UTC';const server=workspaceSavedTime(timestamp,locale);
 process.env.TZ='Asia/Ho_Chi_Minh';const browser=workspaceSavedTime(timestamp,locale);
 expect(server).toBe('17:18:38');expect(browser).toBe(server);
});
it.each([NaN,Infinity,-Infinity,1e100])('does not render an invalid timestamp %s',value=>{
 expect(workspaceSavedTime(value,'en')).toBe('');
});
