import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const unavailable=()=>({sourceClean:false,sourceCommit:null,sourceTree:null});
/** Same root, clean-tree, commit and tree checks as the existing forward package/deploy path. */
export function captureForward53Source({git=args=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim(),cwd=process.cwd()}={}) {
  try {
    if(resolve(git(['rev-parse','--show-toplevel']))!==resolve(cwd)
      || git(['status','--porcelain=v1','--untracked-files=all','--ignore-submodules=none'])) return unavailable();
    const sourceCommit=git(['rev-parse','--verify','HEAD']);
    const sourceTree=git(['rev-parse','--verify','HEAD^{tree}']);
    if(!/^[a-f0-9]{40}$/.test(sourceCommit) || !/^[a-f0-9]{40}$/.test(sourceTree))return unavailable();
    return {sourceClean:true,sourceCommit,sourceTree};
  } catch { return unavailable(); }
}
/** Check both before and after any local package staging and before constructing a target client. */
export function assertForward53Source(expected,options) {
  const current=captureForward53Source(options);
  if(!expected || expected.sourceClean!==true || current.sourceClean!==true
    || expected.sourceCommit!==current.sourceCommit || expected.sourceTree!==current.sourceTree) {
    throw new Error('Forward 53 requires matching clean committed source');
  }
  return current;
}
